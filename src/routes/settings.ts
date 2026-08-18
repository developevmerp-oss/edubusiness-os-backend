import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { authenticate, requireRole } from '../middlewares/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

// Configure multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const tenantId = (req as any).tenant?.id || 'default';
        const ext = path.extname(file.originalname);
        const name = `${tenantId}_logo_${Date.now()}${ext}`;
        cb(null, name);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|webp|svg/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Only image formats (jpg, png, webp, svg) are allowed.'));
    }
});

const brandingSchema = z.object({
    name: z.string().min(2),
    description: z.string().optional(),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), // e.g. #6366f1
    logoUrl: z.string().url().or(z.string().length(0)).optional()
});

/**
 * 1. Update Tenant Branding settings (Admin only)
 */
router.post('/branding', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = brandingSchema.parse(req.body);
        const tenantId = req.tenant!.id;

        // Fetch current branding to preserve other fields (e.g. logoUrl if not sent)
        const tenantRes = await db.query('SELECT branding FROM tenants WHERE id = $1', [tenantId]);
        const currentBranding = tenantRes.rows[0]?.branding || {};

        const brandingJson = {
            ...currentBranding,
            name: body.name,
            description: body.description || '',
            accentColor: body.accentColor,
            logoUrl: body.logoUrl !== undefined ? body.logoUrl : (currentBranding.logoUrl || '')
        };

        const result = await db.query(
            `UPDATE tenants
             SET branding = $1, name = $2
             WHERE id = $3
             RETURNING id, name, branding`,
            [JSON.stringify(brandingJson), body.name, tenantId]
        );

        res.json({
            message: 'Branding customizations updated successfully.',
            tenant: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 2. Upload Academy Logo (Admin only)
 */
router.post('/logo', authenticate, requireRole(['admin']), upload.single('logo'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: 'No file uploaded.' });
            return;
        }

        const tenantId = req.tenant!.id;
        const logoUrl = `http://localhost:5000/uploads/${req.file.filename}`;

        // Get existing branding and update logoUrl
        const tenantRes = await db.query('SELECT name, branding FROM tenants WHERE id = $1', [tenantId]);
        const currentBranding = tenantRes.rows[0]?.branding || {};
        
        const updatedBranding = {
            ...currentBranding,
            logoUrl
        };

        const result = await db.query(
            `UPDATE tenants
             SET branding = $1
             WHERE id = $2
             RETURNING id, name, branding`,
            [JSON.stringify(updatedBranding), tenantId]
        );

        res.json({
            message: 'Logo uploaded successfully!',
            tenant: result.rows[0],
            logoUrl
        });
    } catch (error) {
        next(error);
    }
});

export default router;
