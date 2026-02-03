import { supabase } from "../lib/_supabase.js";

function json(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return json(res, 200, {});
    }

    if (req.method !== "POST") {
        return json(res, 405, { success: false, message: "Method not allowed" });
    }

    try {
        const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
        const { owner_id, current_password, new_password } = body;

        if (!owner_id || !current_password || !new_password) {
            return json(res, 400, { 
                success: false, 
                message: "Owner ID, current password, and new password are required" 
            });
        }

        // Validate new password
        if (new_password.length < 6) {
            return json(res, 400, { 
                success: false, 
                message: "New password must be at least 6 characters" 
            });
        }

        // Query user
        const { data: user, error } = await supabase
            .from('owners')
            .select('owner_id, owner_name, password')
            .eq('owner_id', owner_id)
            .single();

        if (error || !user) {
            console.log(`[CHANGE-PASSWORD] User not found: ${owner_id}`);
            return json(res, 404, { success: false, message: "User not found" });
        }

        // Verify current password
        if (user.password !== current_password) {
            console.log(`[CHANGE-PASSWORD] Invalid current password for: ${user.owner_name}`);
            return json(res, 401, { success: false, message: "Current password is incorrect" });
        }

        // Update password
        const { error: updateError } = await supabase
            .from('owners')
            .update({ password: new_password })
            .eq('owner_id', owner_id);

        if (updateError) {
            console.error("[CHANGE-PASSWORD] Update error:", updateError);
            return json(res, 500, { success: false, message: "Failed to update password" });
        }

        console.log(`[CHANGE-PASSWORD] Password changed for: ${user.owner_name}`);
        
        return json(res, 200, { 
            success: true, 
            message: "Password changed successfully" 
        });

    } catch (e) {
        console.error("[CHANGE-PASSWORD] Error:", e);
        return json(res, 500, { success: false, message: e?.message || "Internal server error" });
    }
}
