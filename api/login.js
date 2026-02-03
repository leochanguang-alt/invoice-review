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
        const { email, password } = body;

        if (!email || !password) {
            return json(res, 400, { success: false, message: "Email and password are required" });
        }

        // Query user by email
        const { data: user, error } = await supabase
            .from('owners')
            .select('owner_id, owner_name, email, password, first_name, last_name')
            .eq('email', email.toLowerCase().trim())
            .single();

        if (error || !user) {
            console.log(`[LOGIN] User not found: ${email}`);
            return json(res, 401, { success: false, message: "Invalid email or password" });
        }

        // Check password (simple comparison - in production, use bcrypt)
        if (user.password !== password) {
            console.log(`[LOGIN] Invalid password for: ${email}`);
            return json(res, 401, { success: false, message: "Invalid email or password" });
        }

        console.log(`[LOGIN] Success: ${user.owner_name} (${email})`);
        
        // Return user info (exclude password)
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

    } catch (e) {
        console.error("[LOGIN] Error:", e);
        return json(res, 500, { success: false, message: e?.message || "Internal server error" });
    }
}
