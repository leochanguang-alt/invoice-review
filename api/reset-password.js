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
        const { email } = body;

        if (!email) {
            return json(res, 400, { success: false, message: "Email is required" });
        }

        // Query user by email
        const { data: user, error } = await supabase
            .from('owners')
            .select('owner_id, owner_name, email')
            .eq('email', email.toLowerCase().trim())
            .single();

        if (error || !user) {
            console.log(`[RESET-PASSWORD] User not found: ${email}`);
            // For security, don't reveal if email exists
            return json(res, 200, { 
                success: true, 
                message: "If the email exists, a new password has been sent." 
            });
        }

        // Generate new password
        const newPassword = generateRandomPassword();

        // Update password in database
        const { error: updateError } = await supabase
            .from('owners')
            .update({ password: newPassword })
            .eq('owner_id', user.owner_id);

        if (updateError) {
            console.error("[RESET-PASSWORD] Update error:", updateError);
            return json(res, 500, { success: false, message: "Failed to reset password" });
        }

        console.log(`[RESET-PASSWORD] New password generated for ${user.owner_name}: ${newPassword}`);

        // Send email with new password
        // Using a simple approach - in production, use a proper email service
        const emailSent = await sendPasswordEmail(user.email, user.owner_name, newPassword);

        if (emailSent) {
            return json(res, 200, { 
                success: true, 
                message: "New password has been sent to your email." 
            });
        } else {
            // If email sending fails, still return success but log the password
            console.log(`[RESET-PASSWORD] Email sending skipped. New password for ${email}: ${newPassword}`);
            return json(res, 200, { 
                success: true, 
                message: "Password reset successful. Please check your email or contact administrator.",
                // In development, return the password (remove in production)
                _debug_password: process.env.NODE_ENV !== 'production' ? newPassword : undefined
            });
        }

    } catch (e) {
        console.error("[RESET-PASSWORD] Error:", e);
        return json(res, 500, { success: false, message: e?.message || "Internal server error" });
    }
}

// Simple email sending function (placeholder)
// In production, integrate with SendGrid, Mailgun, AWS SES, etc.
async function sendPasswordEmail(toEmail, userName, newPassword) {
    try {
        // Check if email service is configured
        const SMTP_HOST = process.env.SMTP_HOST;
        const SMTP_USER = process.env.SMTP_USER;
        const SMTP_PASS = process.env.SMTP_PASS;

        if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
            console.log("[RESET-PASSWORD] Email service not configured, skipping email");
            return false;
        }

        // TODO: Implement actual email sending
        // Example with nodemailer:
        // const transporter = nodemailer.createTransport({...});
        // await transporter.sendMail({
        //     from: '"BUI Service" <noreply@buiservice.com>',
        //     to: toEmail,
        //     subject: "Your New Password - BUI Service Expense System",
        //     text: `Hello ${userName},\n\nYour new password is: ${newPassword}\n\nPlease login and change your password immediately.\n\nBest regards,\nBUI Service Team`,
        //     html: `<p>Hello ${userName},</p><p>Your new password is: <strong>${newPassword}</strong></p><p>Please login and change your password immediately.</p><p>Best regards,<br>BUI Service Team</p>`
        // });

        console.log(`[RESET-PASSWORD] Would send email to ${toEmail} with password ${newPassword}`);
        return false; // Return false for now since email is not implemented
    } catch (e) {
        console.error("[RESET-PASSWORD] Email error:", e);
        return false;
    }
}
