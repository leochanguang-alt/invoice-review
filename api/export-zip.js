import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import archiver from "archiver";
import { supabase } from "../lib/_supabase.js";

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT?.replace(/\/$/, ""),
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: false,
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || "buiservice-assets";

async function listProjectFolderKeys(projectCode) {
    const prefix = `bui_invoice/projects/${projectCode}/`;
    const listRes = await r2.send(new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
    }));

    return (listRes.Contents || [])
        .map(file => file.Key)
        .filter(key => key && !key.endsWith("/") && !key.endsWith("/.placeholder"));
}

async function listArchivedInvoiceKeys(projectCode) {
    if (!supabase) return [];

    const { data, error } = await supabase
        .from("invoices")
        .select("achieved_file_id, achieved_file_link")
        .eq("charge_to_project", projectCode)
        .is("deleted_at", null);

    if (error) {
        console.error("[export-zip] Failed to load archived invoice paths:", error.message);
        return [];
    }

    const keys = new Set();
    for (const row of data || []) {
        const achievedId = (row.achieved_file_id || "").replace(/^\/+/, "");
        if (achievedId.startsWith("bui_invoice/")) {
            keys.add(achievedId);
            continue;
        }

        const link = row.achieved_file_link || "";
        const match = link.match(/(bui_invoice\/projects\/[^?]+)/);
        if (match) keys.add(match[1].replace(/^\/+/, ""));
    }

    return Array.from(keys);
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.statusCode = 405;
        return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }

    const projectCode = req.query.project;
    
    if (!projectCode) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Missing project parameter' }));
    }

    console.log(`[export-zip] Starting export for project: ${projectCode}`);

    try {
        let fileKeys = await listProjectFolderKeys(projectCode);
        let source = "project-folder";

        // After a project rename, archived files may still live under the old R2 folder.
        if (fileKeys.length === 0) {
            fileKeys = await listArchivedInvoiceKeys(projectCode);
            source = "archived-invoice-paths";
        }

        if (fileKeys.length === 0) {
            res.statusCode = 404;
            return res.end(JSON.stringify({
                error: "No files found",
                message: `No files found for project ${projectCode} in R2 project folder or archived invoice paths`,
            }));
        }

        console.log(`[export-zip] Found ${fileKeys.length} files for ${projectCode} via ${source}`);

        // Set response headers for ZIP download
        const zipFilename = `${projectCode}_files.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
        res.setHeader('Transfer-Encoding', 'chunked');

        // Create archiver instance
        const archive = archiver('zip', {
            zlib: { level: 5 } // Compression level (0-9)
        });

        // Pipe archive to response
        archive.pipe(res);

        // Handle archive errors
        archive.on('error', (err) => {
            console.error('[export-zip] Archive error:', err);
            throw err;
        });

        archive.on('warning', (err) => {
            if (err.code === 'ENOENT') {
                console.warn('[export-zip] Warning:', err);
            } else {
                throw err;
            }
        });

        // Add each file to the archive
        for (const fileKey of fileKeys) {
            let fileName = fileKey.split('/').pop();
            
            // Skip if empty filename or directory marker
            if (!fileName || fileName === '') continue;
            
                // Skip placeholder files
                if (fileName === '.placeholder') continue;

            console.log(`[export-zip] Adding file: ${fileName}`);

            try {
                // Get file from R2
                const getRes = await r2.send(new GetObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: fileKey,
                }));

                // Add file stream to archive
                archive.append(getRes.Body, { name: fileName });
            } catch (fileErr) {
                console.error(`[export-zip] Error fetching file ${fileName}:`, fileErr.message);
                // Continue with other files even if one fails
            }
        }

        // Finalize archive
        await archive.finalize();
        
        console.log(`[export-zip] Archive finalized for ${projectCode}`);

    } catch (err) {
        console.error('[export-zip] Error:', err);
        
        // Only send error response if headers haven't been sent
        if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({
                error: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
            }));
        }
    }
}
