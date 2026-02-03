import { supabase } from "../lib/_supabase.js";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

// R2 Configuration
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');

// Only create R2 client if all credentials are present
const r2 = (R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) ? new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
}) : null;

function json(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}

async function checkR2FolderExists(folderPath) {
    if (!r2 || !BUCKET_NAME) return false;
    try {
        await r2.send(new HeadObjectCommand({
            Bucket: BUCKET_NAME,
            Key: `${folderPath}/.placeholder`,
        }));
        return true;
    } catch {
        return false;
    }
}

async function createR2ProjectFolder(folderName) {
    if (!r2 || !BUCKET_NAME) {
        return null;
    }

    const r2FolderPath = `bui_invoice/projects/${folderName}/.placeholder`;
    
    await r2.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: r2FolderPath,
        Body: '',
        ContentType: 'text/plain'
    }));

    const folderLink = R2_PUBLIC_URL 
        ? `${R2_PUBLIC_URL}/bui_invoice/projects/${folderName}/`
        : `https://${BUCKET_NAME}.r2.cloudflarestorage.com/bui_invoice/projects/${folderName}/`;
    
    return folderLink;
}

export default async function handler(req, res) {
    try {
        if (!supabase) {
            return json(res, 500, { success: false, message: "Supabase client not initialized" });
        }

        if (!r2) {
            return json(res, 500, { success: false, message: "R2 client not configured. Check R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY environment variables." });
        }

        // GET: Check status of all projects
        // POST: Fix missing folders
        
        if (req.method === "GET") {
            const { data: projects, error } = await supabase
                .from('projects')
                .select('project_id, project_code, project_name, drive_folder_link')
                .order('project_code');

            if (error) {
                return json(res, 500, { success: false, message: error.message });
            }

            const results = [];
            for (const project of projects || []) {
                const folderName = project.project_code || project.project_name;
                const hasLink = !!project.drive_folder_link;
                
                results.push({
                    project_id: project.project_id,
                    project_code: project.project_code,
                    project_name: project.project_name,
                    has_folder_link: hasLink,
                    drive_folder_link: project.drive_folder_link || null
                });
            }

            const missing = results.filter(r => !r.has_folder_link);
            
            return json(res, 200, { 
                success: true, 
                total: results.length,
                missing_count: missing.length,
                projects: results
            });
        }

        if (req.method === "POST") {
            const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
            const { project_id } = body; // Optional: fix specific project only

            let query = supabase
                .from('projects')
                .select('project_id, project_code, project_name, drive_folder_link');

            if (project_id) {
                query = query.eq('project_id', project_id);
            } else {
                // Only fix projects without folder link
                query = query.or('drive_folder_link.is.null,drive_folder_link.eq.');
            }

            const { data: projects, error } = await query;

            if (error) {
                return json(res, 500, { success: false, message: error.message });
            }

            if (!projects || projects.length === 0) {
                return json(res, 200, { success: true, message: "No projects need fixing", fixed: 0 });
            }

            const results = [];
            let fixed = 0;
            let errors = 0;

            for (const project of projects) {
                const folderName = project.project_code || project.project_name;
                
                if (!folderName) {
                    results.push({
                        project_id: project.project_id,
                        status: 'skipped',
                        reason: 'No project code or name'
                    });
                    continue;
                }

                try {
                    const folderLink = await createR2ProjectFolder(folderName);
                    
                    if (folderLink) {
                        const { error: updateErr } = await supabase
                            .from('projects')
                            .update({ drive_folder_link: folderLink })
                            .eq('project_id', project.project_id);

                        if (updateErr) {
                            results.push({
                                project_id: project.project_id,
                                project_code: folderName,
                                status: 'error',
                                reason: updateErr.message
                            });
                            errors++;
                        } else {
                            results.push({
                                project_id: project.project_id,
                                project_code: folderName,
                                status: 'fixed',
                                drive_folder_link: folderLink
                            });
                            fixed++;
                        }
                    }
                } catch (err) {
                    results.push({
                        project_id: project.project_id,
                        project_code: folderName,
                        status: 'error',
                        reason: err.message
                    });
                    errors++;
                }
            }

            return json(res, 200, { 
                success: true, 
                message: `Fixed ${fixed} project(s), ${errors} error(s)`,
                fixed,
                errors,
                results
            });
        }

        return json(res, 405, { error: "Method not allowed" });
    } catch (e) {
        console.error("[FIX-PROJECT-FOLDERS] Error:", e);
        return json(res, 500, { success: false, message: e?.message || String(e) });
    }
}
