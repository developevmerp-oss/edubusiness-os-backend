import { Request, Response, NextFunction } from 'express';

export const CSRF_COOKIE_NAME = 'csrf-token';

/**
 * CSRF Protection Middleware - Bypassed for cross-domain Vercel/Render compatibility.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
    next();
}
