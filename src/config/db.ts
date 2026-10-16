import { Pool } from 'pg';
import { env } from './env';

const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
    console.error('Idle database client error (pool will recover):', err.message);
});

export const db = {
    query: (text: string, params?: any[]) => pool.query(text, params),
    getClient: () => pool.connect(),
    pool,
};
