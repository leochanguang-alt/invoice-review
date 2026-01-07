import jwt from 'jsonwebtoken';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-do-not-use-in-prod';

export default function handler(req, res) {
    if (req.method === 'POST') {
        const { action, password } = req.body;

        if (action === 'login') {
            if (password === ADMIN_PASSWORD) {
                const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1d' });
                res.cookie('auth_token', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    maxAge: 86400000 // 1 day
                });
                return res.json({ success: true, message: 'Logged in' });
            } else {
                return res.status(401).json({ success: false, message: 'Invalid password' });
            }
        } else if (action === 'logout') {
            res.clearCookie('auth_token');
            return res.json({ success: true, message: 'Logged out' });
        }
    } else if (req.method === 'GET') {
        // Since middleware handles auth check, if we reach here, we are auth'd
        // However, this file is hit via /api/auth which MIGHT be excluded in middleware for login...
        // Wait, my middleware exclusion was for `/auth`.
        // So `GET /api/auth` would be checked by middleware unless I exclude it?
        // Let's re-read the middleware plan. "Public endpoints ... /auth".
        // So `GET /api/auth` will NOT be checked by middleware. We need to check manually or just return status.
        // Actually, for "me" endpoint, we usually want it protected.
        // But if I put login/logout/me all in one file `auth.js` -> `/api/auth`, then the whole file is skipped by middleware.

        // Let's handle verification manually here for 'GET' just to be safe/explicit if we want to check status from client
        // without triggering a 401 on the middleware level. 
        // OR better: Client calls `/api/me` which IS protected. 
        // But for simplicity let's keep all in `auth.js`.

        const token = req.cookies?.auth_token;
        if (!token) return res.json({ authenticated: false });

        try {
            jwt.verify(token, JWT_SECRET);
            return res.json({ authenticated: true });
        } catch (e) {
            return res.json({ authenticated: false });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
