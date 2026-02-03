import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-do-not-use-in-prod';

// Enable JSON body parsing and Cookie parsing
app.use(express.json());
app.use(cookieParser());

// Serve static files from 'public'
app.use(express.static(join(__dirname, 'public')));

// Silence favicon.ico 404 errors
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Authentication Middleware (DISABLED FOR NOW)
/*
app.use('/api', (req, res, next) => {
    const publicEndpoints = ['/auth'];
    if (publicEndpoints.some(endpoint => req.path.startsWith(endpoint))) {
        return next();
    }

    const token = req.cookies.auth_token;

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    try {
        jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
});
*/

// API Router
app.all('/api/:functionName', async (req, res) => {
    const { functionName } = req.params;
    const modulePath = join(__dirname, 'api', `${functionName}.js`);

    if (fs.existsSync(modulePath)) {
        try {
            // Add cache busting timestamp in development to reload modules
            const cacheBust = process.env.NODE_ENV === 'production' ? '' : `?t=${Date.now()}`;
            const module = await import(`file://${modulePath}${cacheBust}`);
            if (module.default) {
                await module.default(req, res);
            } else {
                res.status(500).json({ error: 'Module does not export default handler' });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    } else {
        res.status(404).json({ error: 'API Function not found' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
