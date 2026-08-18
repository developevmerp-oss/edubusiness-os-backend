import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { UserPayload } from '../types/express';

// Cookie name config
export const AUTH_COOKIE_NAME = env.NODE_ENV === 'production' ? '__Host-session' : 'session';

export function authenticate(req: Request, res: Response, next: NextFunction) {
    try {
        const token = req.cookies[AUTH_COOKIE_NAME];

        if (!token) {
            res.status(401).json({ error: 'Authentication required. Please login.' });
            return;
        }

        const decoded = jwt.verify(token, env.JWT_SECRET) as UserPayload;

        // CRITICAL SECURITY CHECK: Ensure user tenant matches the active context tenant
        if (req.tenant && decoded.tenant_id !== req.tenant.id && decoded.role !== 'super_admin') {
            res.status(403).json({ error: 'Access denied. You do not belong to this organization.' });
            return;
        }

        req.user = decoded;
        next();
    } catch (error: any) {
        if (error.name === 'TokenExpiredError') {
            res.status(401).json({ error: 'Session expired. Please login again.' });
            return;
        }
        res.status(401).json({ error: 'Invalid authentication token.' });
    }
}

/**
 * Role-Based Access Control (RBAC) middleware generator.
 */
export function requireRole(allowedRoles: ('super_admin' | 'admin' | 'teacher' | 'student' | 'parent')[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            res.status(401).json({ error: 'Authentication required.' });
            return;
        }

        if (!allowedRoles.includes(req.user.role)) {
            res.status(403).json({ error: 'Access forbidden. Insufficient permissions.' });
            return;
        }

        next();
    };
}
