import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from backend root
dotenv.config({ path: path.join(__dirname, '../../.env') });

const envSchema = z.object({
    PORT: z.string().default('5000').transform((val) => parseInt(val, 10)),
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32, { message: 'JWT_SECRET must be at least 32 characters long' }),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    FRONTEND_URL: z.string().url().default('http://localhost:3000'),
    GEMINI_API_KEY: z.string().optional()
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error('❌ Invalid environment variables:', parsed.error.format());
    process.exit(1);
}

export const env = parsed.data;
