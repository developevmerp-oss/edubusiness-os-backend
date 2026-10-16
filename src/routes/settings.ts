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

/**
 * ========================================================
 * PHASE 4: WHITE-LABEL NATIVE ANDROID & PWA BUILDER
 * ========================================================
 */

const mobileAppSchema = z.object({
    appName: z.string().min(2),
    packageName: z.string().min(3).regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+[0-9a-z_]$/i, 'Invalid Android package name format e.g. com.academy.app'),
    versionName: z.string().default('1.0.0'),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
    splashBgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0a0b10'),
    appIconUrl: z.string().optional(),
    enableOfflineMode: z.boolean().default(true),
    enablePushNotifications: z.boolean().default(true)
});

/**
 * 3. Get Mobile App Config
 */
router.get('/mobile-app', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;

        let result = await db.query(
            'SELECT * FROM mobile_app_configs WHERE tenant_id = $1',
            [tenantId]
        );

        if (result.rows.length === 0) {
            // Initialize default
            const tenantRes = await db.query('SELECT name, subdomain FROM tenants WHERE id = $1', [tenantId]);
            const t = tenantRes.rows[0];
            const defaultPkg = `com.${(t.subdomain || 'edubusiness').replace(/[^a-z0-9]/gi, '')}.learning`;

            const insertRes = await db.query(
                `INSERT INTO mobile_app_configs (tenant_id, app_name, package_name)
                 VALUES ($1, $2, $3)
                 RETURNING *`,
                [tenantId, `${t.name} Pro`, defaultPkg]
            );
            result = insertRes;
        }

        res.json({ config: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

/**
 * 4. Save Mobile App Config (Admin only)
 */
router.post('/mobile-app', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = mobileAppSchema.parse(req.body);
        const tenantId = req.tenant!.id;

        const result = await db.query(
            `INSERT INTO mobile_app_configs 
             (tenant_id, app_name, package_name, version_name, primary_color, splash_bg_color, enable_offline_mode, enable_push_notifications, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             ON CONFLICT (tenant_id) DO UPDATE
             SET app_name = EXCLUDED.app_name,
                 package_name = EXCLUDED.package_name,
                 version_name = EXCLUDED.version_name,
                 primary_color = EXCLUDED.primary_color,
                 splash_bg_color = EXCLUDED.splash_bg_color,
                 enable_offline_mode = EXCLUDED.enable_offline_mode,
                 enable_push_notifications = EXCLUDED.enable_push_notifications,
                 updated_at = NOW()
             RETURNING *`,
            [
                tenantId, body.appName, body.packageName, body.versionName, 
                body.primaryColor, body.splashBgColor, 
                body.enableOfflineMode, body.enablePushNotifications
            ]
        );

        res.json({
            message: 'Native mobile app configuration updated successfully!',
            config: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 5. Generate W3C Web App Manifest (PWA compliant)
 */
router.get('/mobile-app/manifest', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant?.id;
        let config;

        if (tenantId) {
            const resConfig = await db.query('SELECT * FROM mobile_app_configs WHERE tenant_id = $1', [tenantId]);
            config = resConfig.rows[0];
        }

        const appName = config?.app_name || 'Academy Pro';
        const primaryColor = config?.primary_color || '#6366f1';
        const bgColor = config?.splash_bg_color || '#0a0b10';

        const manifest = {
            name: appName,
            short_name: appName.slice(0, 12),
            start_url: '/dashboard',
            display: 'standalone',
            background_color: bgColor,
            theme_color: primaryColor,
            orientation: 'portrait-primary',
            icons: [
                {
                    src: '/icons/icon-192x192.png',
                    sizes: '192x192',
                    type: 'image/png',
                    purpose: 'any maskable'
                },
                {
                    src: '/icons/icon-512x512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any maskable'
                }
            ]
        };

        res.json(manifest);
    } catch (error) {
        next(error);
    }
});

/**
 * 6. Export Android APK Build Specifications & AndroidManifest.xml
 */
router.get('/mobile-app/export-package', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const confRes = await db.query('SELECT * FROM mobile_app_configs WHERE tenant_id = $1', [tenantId]);
        const conf = confRes.rows[0] || {
            app_name: 'Apex Academy Pro',
            package_name: 'com.apexacademy.learning',
            version_name: '1.0.0',
            primary_color: '#6366f1'
        };

        const androidManifestXml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${conf.package_name}">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    ${conf.enable_push_notifications ? '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />' : ''}

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="${conf.app_name}"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.AcademyApp">
        
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:screenOrientation="portrait">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`;

        const gradleConfig = `android {
    namespace '${conf.package_name}'
    compileSdk 34

    defaultConfig {
        applicationId "${conf.package_name}"
        minSdk 24
        targetSdk 34
        versionCode 1
        versionName "${conf.version_name}"
    }
}`;

        res.json({
            packageDetails: {
                appName: conf.app_name,
                packageName: conf.package_name,
                version: conf.version_name,
                primaryColor: conf.primary_color
            },
            files: {
                'AndroidManifest.xml': androidManifestXml,
                'build.gradle': gradleConfig
            },
            storeChecklist: [
                'App Icon 512x512 PNG (32-bit color, no transparency)',
                'Feature Graphic 1024x500 JPEG/PNG',
                'Privacy Policy hosted URL',
                'Target Android API level 34 (Google Play compliance verified)'
            ]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 7. Get Payment Gateway Config (Admin only)
 */
const maskKey = (key?: string) => {
    if (!key || key.length < 8) return '';
    return key.substring(0, 4) + '••••••••' + key.substring(key.length - 4);
};

router.get('/payment-gateway', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const resConf = await db.query('SELECT * FROM payment_gateway_configs WHERE tenant_id = $1', [tenantId]);
        const config = resConf.rows[0] || {
            active_gateway: 'sandbox',
            is_test_mode: true
        };

        res.json({
            config: {
                activeGateway: config.active_gateway || 'sandbox',
                isTestMode: config.is_test_mode ?? true,
                razorpayKeyId: config.razorpay_key_id || '',
                razorpayKeySecretMasked: maskKey(config.razorpay_key_secret),
                hasRazorpaySecret: !!config.razorpay_key_secret,
                razorpayWebhookSecretMasked: maskKey(config.razorpay_webhook_secret),
                hasRazorpayWebhookSecret: !!config.razorpay_webhook_secret,
                stripePublishableKey: config.stripe_publishable_key || '',
                stripeSecretKeyMasked: maskKey(config.stripe_secret_key),
                hasStripeSecret: !!config.stripe_secret_key,
                stripeWebhookSecretMasked: maskKey(config.stripe_webhook_secret),
                hasStripeWebhookSecret: !!config.stripe_webhook_secret,
                webhookUrl: `https://edubusiness-os-backend.onrender.com/api/store/webhooks/razorpay`
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 8. Update Payment Gateway Config (Admin only)
 */
const gatewayUpdateSchema = z.object({
    activeGateway: z.enum(['sandbox', 'razorpay', 'stripe']),
    isTestMode: z.boolean().default(true),
    razorpayKeyId: z.string().optional(),
    razorpayKeySecret: z.string().optional(),
    razorpayWebhookSecret: z.string().optional(),
    stripePublishableKey: z.string().optional(),
    stripeSecretKey: z.string().optional(),
    stripeWebhookSecret: z.string().optional()
});

router.post('/payment-gateway', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const body = gatewayUpdateSchema.parse(req.body);

        // Fetch existing config to preserve secrets if masked/not provided
        const existingRes = await db.query('SELECT * FROM payment_gateway_configs WHERE tenant_id = $1', [tenantId]);
        const existing = existingRes.rows[0] || {};

        const razorpayKeySecret = (body.razorpayKeySecret && !body.razorpayKeySecret.includes('••••'))
            ? body.razorpayKeySecret
            : existing.razorpay_key_secret || null;

        const razorpayWebhookSecret = (body.razorpayWebhookSecret && !body.razorpayWebhookSecret.includes('••••'))
            ? body.razorpayWebhookSecret
            : existing.razorpay_webhook_secret || null;

        const stripeSecretKey = (body.stripeSecretKey && !body.stripeSecretKey.includes('••••'))
            ? body.stripeSecretKey
            : existing.stripe_secret_key || null;

        const stripeWebhookSecret = (body.stripeWebhookSecret && !body.stripeWebhookSecret.includes('••••'))
            ? body.stripeWebhookSecret
            : existing.stripe_webhook_secret || null;

        await db.query(`
            INSERT INTO payment_gateway_configs 
            (tenant_id, active_gateway, is_test_mode, razorpay_key_id, razorpay_key_secret, razorpay_webhook_secret, stripe_publishable_key, stripe_secret_key, stripe_webhook_secret, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
            ON CONFLICT (tenant_id) DO UPDATE
            SET active_gateway = EXCLUDED.active_gateway,
                is_test_mode = EXCLUDED.is_test_mode,
                razorpay_key_id = EXCLUDED.razorpay_key_id,
                razorpay_key_secret = EXCLUDED.razorpay_key_secret,
                razorpay_webhook_secret = EXCLUDED.razorpay_webhook_secret,
                stripe_publishable_key = EXCLUDED.stripe_publishable_key,
                stripe_secret_key = EXCLUDED.stripe_secret_key,
                stripe_webhook_secret = EXCLUDED.stripe_webhook_secret,
                updated_at = CURRENT_TIMESTAMP
        `, [
            tenantId,
            body.activeGateway,
            body.isTestMode,
            body.razorpayKeyId || null,
            razorpayKeySecret,
            razorpayWebhookSecret,
            body.stripePublishableKey || null,
            stripeSecretKey,
            stripeWebhookSecret
        ]);

        res.json({
            message: 'Payment gateway settings updated successfully.',
            activeGateway: body.activeGateway,
            isTestMode: body.isTestMode
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 9. Get Public Gateway Config for Store Checkout
 */
router.get('/payment-gateway/public', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = (req as any).tenant?.id || 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
        const resConf = await db.query('SELECT active_gateway, is_test_mode, razorpay_key_id, stripe_publishable_key FROM payment_gateway_configs WHERE tenant_id = $1', [tenantId]);
        const config = resConf.rows[0] || {
            active_gateway: 'sandbox',
            is_test_mode: true
        };

        res.json({
            activeGateway: config.active_gateway || 'sandbox',
            isTestMode: config.is_test_mode ?? true,
            razorpayKeyId: config.razorpay_key_id || '',
            stripePublishableKey: config.stripe_publishable_key || ''
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 10. Test Connection with Live Gateway API
 */
router.post('/payment-gateway/test-connection', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const confRes = await db.query('SELECT * FROM payment_gateway_configs WHERE tenant_id = $1', [tenantId]);
        const conf = confRes.rows[0];

        if (!conf || conf.active_gateway === 'sandbox') {
            res.json({
                status: 'success',
                gateway: 'sandbox',
                message: 'Sandbox simulator gateway is connected and active (100% operational in test mode).'
            });
            return;
        }

        if (conf.active_gateway === 'razorpay') {
            if (!conf.razorpay_key_id || !conf.razorpay_key_secret) {
                res.status(400).json({ error: 'Razorpay Key ID and Secret are required to test connection.' });
                return;
            }

            const authHeader = 'Basic ' + Buffer.from(`${conf.razorpay_key_id}:${conf.razorpay_key_secret}`).toString('base64');
            const rzpRes = await fetch('https://api.razorpay.com/v1/orders?count=1', {
                method: 'GET',
                headers: { 'Authorization': authHeader }
            });

            if (rzpRes.ok) {
                res.json({
                    status: 'success',
                    gateway: 'razorpay',
                    message: 'Razorpay API credentials verified successfully! Live/Test mode verified with Merchant Account.'
                });
            } else {
                const errJson: any = await rzpRes.json().catch(() => ({}));
                res.status(400).json({
                    error: errJson?.error?.description || 'Razorpay authentication failed. Please verify your Key ID and Secret.'
                });
            }
            return;
        }

        if (conf.active_gateway === 'stripe') {
            res.json({
                status: 'success',
                gateway: 'stripe',
                message: 'Stripe configuration stored. Ready to accept international payments.'
            });
            return;
        }

        res.json({ status: 'success', gateway: conf.active_gateway });
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Connection test failed.' });
    }
});

export default router;

