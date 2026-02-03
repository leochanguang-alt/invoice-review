import { supabase } from "../lib/_supabase.js";

function json(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}

// Generate 6-digit random password
function generateRandomPassword() {
    return Math.floor(100000 + Math.random() * 900000).toString();
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
        const { action } = body;

        // === LOGIN ===
        if (action === "login") {
            const { email, password } = body;

            if (!email || !password) {
                return json(res, 400, { success: false, message: "Email and password are required" });
            }

            const { data: user, error } = await supabase
                .from('owners')
                .select('owner_id, owner_name, email, password, first_name, last_name')
                .eq('email', email.toLowerCase().trim())
                .single();

            if (error || !user) {
                console.log(`[AUTH] Login failed - user not found: ${email}`);
                return json(res, 401, { success: false, message: "Invalid email or password" });
            }

            if (user.password !== password) {
                console.log(`[AUTH] Login failed - invalid password for: ${email}`);
                return json(res, 401, { success: false, message: "Invalid email or password" });
            }

            console.log(`[AUTH] Login success: ${user.owner_name} (${email})`);
            
            return json(res, 200, {
                success: true,
                user: {
                    owner_id: user.owner_id,
                    owner_name: user.owner_name,
                    email: user.email,
                    first_name: user.first_name,
                    last_name: user.last_name
                }
            });
        }

        // === RESET PASSWORD ===
        if (action === "reset-password") {
            const { email } = body;

            if (!email) {
                return json(res, 400, { success: false, message: "Email is required" });
            }

            const { data: user, error } = await supabase
                .from('owners')
                .select('owner_id, owner_name, email')
                .eq('email', email.toLowerCase().trim())
                .single();

            if (error || !user) {
                // For security, don't reveal if email exists
                return json(res, 200, { 
                    success: true, 
                    message: "If the email exists, a new password has been sent." 
                });
            }

            const newPassword = generateRandomPassword();

            const { error: updateError } = await supabase
                .from('owners')
                .update({ password: newPassword })
                .eq('owner_id', user.owner_id);

            if (updateError) {
                console.error("[AUTH] Reset password update error:", updateError);
                return json(res, 500, { success: false, message: "Failed to reset password" });
            }

            console.log(`[AUTH] Password reset for ${user.owner_name}: ${newPassword}`);

            return json(res, 200, { 
                success: true, 
                message: "Password reset successful. Please check your email or contact administrator.",
                _debug_password: process.env.NODE_ENV !== 'production' ? newPassword : undefined
            });
        }

        // === CHANGE PASSWORD ===
        if (action === "change-password") {
            const { owner_id, current_password, new_password } = body;

            if (!owner_id || !current_password || !new_password) {
                return json(res, 400, { 
                    success: false, 
                    message: "Owner ID, current password, and new password are required" 
                });
            }

            if (new_password.length < 6) {
                return json(res, 400, { 
                    success: false, 
                    message: "New password must be at least 6 characters" 
                });
            }

            const { data: user, error } = await supabase
                .from('owners')
                .select('owner_id, owner_name, password')
                .eq('owner_id', owner_id)
                .single();

            if (error || !user) {
                return json(res, 404, { success: false, message: "User not found" });
            }

            if (user.password !== current_password) {
                return json(res, 401, { success: false, message: "Current password is incorrect" });
            }

            const { error: updateError } = await supabase
                .from('owners')
                .update({ password: new_password })
                .eq('owner_id', owner_id);

            if (updateError) {
                return json(res, 500, { success: false, message: "Failed to update password" });
            }

            console.log(`[AUTH] Password changed for: ${user.owner_name}`);
            
            return json(res, 200, { 
                success: true, 
                message: "Password changed successfully" 
            });
        }

        return json(res, 400, { success: false, message: "Invalid action" });

    } catch (e) {
        console.error("[AUTH] Error:", e);
        return json(res, 500, { success: false, message: e?.message || "Internal server error" });
    }
}
