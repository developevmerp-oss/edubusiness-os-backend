import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { env } from '../config/env';

export const CSRF_COOKIE_NAME = env.NODE_ENV === 'production' ? '__Host-csrf-token' : 'csrf-token';

/**
 * CSRF Protection Middleware using Double Submit Cookie pattern.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
    // 0. Skip authentication setup endpoints (no session exists yet to protect)
    if (req.path === '/api/auth/login' || req.path === '/api/auth/register-tenant') {
        next();
        return;
    }

    // 1. Skip GET, HEAD, OPTIONS requests
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        // Set a new CSRF token if not already present, so frontend can capture it
        let token = req.cookies[CSRF_COOKIE_NAME];
        if (!token) {
            token = crypto.randomBytes(32).toString('hex');
            res.cookie(CSRF_COOKIE_NAME, token, {
                httpOnly: false, // Must be readable by client JS to send in header
                secure: env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/'
            });
        }
        next();
        return;
    }

    // 2. Validate token for state-changing requests
    const cookieToken = req.cookies[CSRF_COOKIE_NAME];
    const headerToken = req.headers['x-csrf-token'] as string;

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        res.status(403).json({ error: 'CSRF token mismatch. Action denied.' });
        return;
    }

    next();
}
