import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import path from 'path';
import { tenantResolver } from './middlewares/tenant';
import { csrfProtection } from './middlewares/csrf';
import { errorHandler } from './middlewares/error';

// Import Route Handlers
import authRouter from './routes/auth';
import coursesRouter from './routes/courses';
import batchesRouter from './routes/batches';
import attendanceRouter from './routes/attendance';
import feesRouter from './routes/fees';
import dashboardRouter from './routes/dashboard';
import lmsRouter from './routes/lms';
import examsRouter from './routes/exams';
import liveRouter from './routes/live';
import storeRouter from './routes/store';
import communityRouter from './routes/community';
import gamificationRouter from './routes/gamification';
import marketingRouter from './routes/marketing';
import aiRouter from './routes/ai';
import settingsRouter from './routes/settings';
import certificatesRouter from './routes/certificates';
import consultationsRouter from './routes/consultations';
import doubtsRouter from './routes/doubts';
import assignmentsRouter from './routes/assignments';

const app = express();

// 1. Configure CORS with credentials support for cookies
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, or local testing tools)
        if (!origin) return callback(null, true);

        const isLocalhost = 
            origin === 'http://localhost:3000' ||
            origin === 'http://127.0.0.1:3000' ||
            origin.startsWith('http://localhost:') ||
            origin.startsWith('http://127.0.0.1:') ||
            origin.endsWith('.localhost:3000') ||
            origin.endsWith('.localhost:5000');

        const isVercel = 
            origin.endsWith('.vercel.app') || 
            origin === 'https://vercel.app';

        // Match frontend domains, wildcard subdomains for tenant routing, or local dev url
        const isAllowed = 
            isLocalhost ||
            isVercel ||
            origin === env.FRONTEND_URL ||
            env.NODE_ENV === 'development';

        if (isAllowed) {
            callback(null, true);
        } else {
            callback(null, false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Tenant-Subdomain']
}));

// 2. Parsers & Security Headers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Anti-Clickjacking headers
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none';");
    next();
});

// 3. Multi-Tenant Resolver (Injected early)
app.use(tenantResolver);

// 4. CSRF Protection (Applies to all POST/PUT/DELETE APIs)
app.use(csrfProtection);

// 5. Connect Route Handlers
app.use('/api/auth', authRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/batches', batchesRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/fees', feesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/lms', lmsRouter);
app.use('/api/exams', examsRouter);
app.use('/api/live-classes', liveRouter);
app.use('/api/store', storeRouter);
app.use('/api/community', communityRouter);
app.use('/api/gamification', gamificationRouter);
app.use('/api/marketing', marketingRouter);
app.use('/api/ai', aiRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/certificates', certificatesRouter);
app.use('/api/consultations', consultationsRouter);
app.use('/api/doubts', doubtsRouter);
app.use('/api/assignments', assignmentsRouter);

// 6. Handle 404 Route Fallbacks
app.use((req, res) => {
    res.status(404).json({ error: `API endpoint '${req.originalUrl}' not found.` });
});

// 7. Centralized Error Handler (SQL masking, Zod parsing formatting)
app.use(errorHandler);

// 8. Bind Server Listener
const PORT = env.PORT;
const HOST = process.env.PORT || process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';

app.listen(PORT, HOST, () => {
    console.log(`🚀 EduBusiness OS Backend running at http://${HOST}:${PORT}`);
    console.log(`🔧 Mode: ${env.NODE_ENV}`);
});

