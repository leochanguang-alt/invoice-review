import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;

export default async function handler(req, res) {
    // Get file path from query
    const filePath = req.query.path;
    const fileId = req.query.id; // file_ID_HASH

    if (!filePath && !fileId) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ error: "Missing path or id parameter" }));
    }

    try {
        let r2Key;

        if (filePath) {
            // Direct path provided
            r2Key = filePath;
        } else if (fileId) {
            // Find file by hash in fr_google_drive
            // For now, we need to find the file by iterating (or use a lookup)
            // This is a placeholder - in production you'd want to store the R2 key in Supabase
            const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
            let found = null;
            let token = null;

            do {
                const listRes = await r2.send(new ListObjectsV2Command({
                    Bucket: BUCKET_NAME,
                    Prefix: "bui_invoice/original_files/fr_google_drive/",
                    ContinuationToken: token,
                }));

                for (const obj of listRes.Contents || []) {
                    const etag = obj.ETag?.replace(/"/g, '');
                    if (etag === fileId) {
                        found = obj.Key;
                        break;
                    }
                }
                token = listRes.IsTruncated ? listRes.NextContinuationToken : null;
            } while (token && !found);

            if (!found) {
                res.statusCode = 404;
                res.setHeader("Content-Type", "application/json");
                return res.end(JSON.stringify({ error: "File not found" }));
            }
            r2Key = found;
        }

        // Check file exists and get metadata
        const headRes = await r2.send(new HeadObjectCommand({
            Bucket: BUCKET_NAME,
            Key: r2Key,
        }));

        // Get file content
        const getRes = await r2.send(new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: r2Key,
        }));

        // Set appropriate headers
        const contentType = headRes.ContentType || "application/octet-stream";
        const filename = r2Key.split('/').pop();

        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Length", headRes.ContentLength);
        res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
        res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 1 day

        // Stream the file
        const stream = getRes.Body;
        stream.pipe(res);

    } catch (err) {
        console.error("Error serving file:", err);

        if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ error: "File not found" }));
        }

        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ error: err.message }));
    }
}
