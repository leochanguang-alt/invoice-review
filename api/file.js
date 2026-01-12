import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

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

export default async function handler(req, res) {
    console.log("File Proxy Request:", req.query);
    console.log("Env Check:", {
        endpoint: !!process.env.R2_ENDPOINT,
        key: !!process.env.R2_ACCESS_KEY_ID,
        secret: !!process.env.R2_SECRET_ACCESS_KEY,
        bucket: !!BUCKET_NAME,
        bucket_val: BUCKET_NAME
    });
    // Get file path from query
    const filePath = req.query.path;
    const fileLink = req.query.link; // Full R2 URL from file_link field

    if (!filePath && !fileLink) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ error: "Missing path or link parameter" }));
    }

    try {
        let r2Key;

        if (filePath) {
            // Direct path provided
            r2Key = filePath;
        } else if (fileLink) {
            // Extract R2 key from full URL
            // Supported formats:
            // 1. https://bucket.r2.cloudflarestorage.com/path/to/file
            // 2. https://pub-xxx.r2.dev/path/to/file (R2.dev subdomain)
            // 3. bui_invoice/... (already a path)
            
            if (fileLink.includes('.r2.cloudflarestorage.com/')) {
                r2Key = fileLink.split('.r2.cloudflarestorage.com/')[1];
            } else if (fileLink.includes('.r2.dev/')) {
                // R2.dev subdomain format: https://pub-xxx.r2.dev/path/to/file
                r2Key = fileLink.split('.r2.dev/')[1];
            } else if (fileLink.startsWith('bui_invoice/')) {
                // Already a path
                r2Key = fileLink;
            } else {
                console.error("Unrecognized file link format:", fileLink);
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                return res.end(JSON.stringify({ 
                    error: "Invalid file link format",
                    received: fileLink,
                    hint: "Expected formats: *.r2.cloudflarestorage.com/*, *.r2.dev/*, or bui_invoice/*"
                }));
            }
        }

        if (!r2Key) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ error: "Could not determine file path" }));
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
        return res.end(JSON.stringify({
            error: err.message,
            name: err.name,
            code: err.code,
            stack: err.stack,
            metadata: err.$metadata,
            env_check: {
                endpoint: !!process.env.R2_ENDPOINT,
                bucket: !!BUCKET_NAME,
                bucket_name: BUCKET_NAME,
                region: "auto",
                forcePathStyle: false
            }
        }));
    }
}
