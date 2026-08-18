import { Request, Response, NextFunction } from 'express';
import { db } from '../config/db';

export async function tenantResolver(req: Request, res: Response, next: NextFunction) {
    // Allow registration without tenant context
    if (req.path === '/api/auth/register-tenant' || req.originalUrl.indexOf('/register-tenant') !== -1 || req.path === '/api/auth/login' || req.originalUrl.indexOf('/login') !== -1) { return next(); }
    try {
        // 1. Resolve subdomain from headers (for easy testing/frontend BFF routing) or hostname
        let subdomain = req.headers['x-tenant-subdomain'] as string;

        if (!subdomain) {
            const host = req.headers.host || '';
            const parts = host.split('.');
            // If host is something like "abc.localhost:3000" or "abc.edubusiness.com"
            if (parts.length > 1 && parts[0] !== 'www' && parts[0] !== 'localhost') {
                subdomain = parts[0];
            }
        }

        // If no subdomain is detected, or if it is the main domain (e.g., localhost or main domain)
        // we can either return a 404 or default to a demo tenant for local dev.
        // For testing, let's default to the seeded 'abc' tenant if nothing else is specified.
        if (!subdomain) {
            subdomain = 'abc';
        }

        // 2. Fetch tenant from database
        const result = await db.query(
            'SELECT id, name, subdomain, branding FROM tenants WHERE subdomain = $1',
            [subdomain]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Tenant not found or workspace inactive.' });
            return;
        }

        const tenant = result.rows[0];
        req.tenant = {
            id: tenant.id,
            name: tenant.name,
            subdomain: tenant.subdomain,
            branding: typeof tenant.branding === 'string' ? JSON.parse(tenant.branding) : tenant.branding
        };

        // Inject tenant subdomain into response headers for frontend sync
        res.setHeader('X-Tenant-Subdomain', req.tenant.subdomain);

        next();
    } catch (error) {
        next(error);
    }
}



