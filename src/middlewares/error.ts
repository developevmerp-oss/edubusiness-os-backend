import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

/**
 * Centralized error handling middleware.
 * Ensures SQL/Database errors are masked and generic, user-safe error messages are returned.
 */
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
    // 1. Log error details server-side securely
    console.error('Unhandled Server Error:', {
        message: err.message,
        stack: env.NODE_ENV === 'development' ? err.stack : undefined,
        code: err.code, // DB error code if available
        detail: err.detail, // DB detailed info
        path: req.path,
        method: req.method
    });

    // 2. Identify PostgreSQL errors (typically have code property as a string of length 5)
    const isDbError = typeof err.code === 'string' && err.code.length === 5;

    if (isDbError) {
        // Return masked generic error response
        res.status(500).json({
            error: 'An internal database operation failed. The administrators have been notified.'
        });
        return;
    }

    // 3. Return client validation errors if thrown via Zod
    if (err.name === 'ZodError') {
        res.status(400).json({
            error: 'Invalid input data provided.',
            details: err.errors
        });
        return;
    }

    // 4. Default generic error fallback
    const status = err.status || err.statusCode || 500;
    const message = env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred.';

    res.status(status).json({ error: message });
}
