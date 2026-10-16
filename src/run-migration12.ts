import fs from 'fs';
import path from 'path';
import { db } from './config/db';

async function runMigration() {
    console.log('🚀 Running Phase 12 Database Migration (Payment Gateway Configurations)...');
    try {
        const sqlPath = path.join(__dirname, 'config/schema_phase12.sql');
        const sql = fs.readFileSync(sqlPath, 'utf-8');

        await db.query(sql);
        console.log('✅ Phase 12 Schema applied (payment_gateway_configs table created)!');

        // Seed default config for all existing tenants
        const tenantsRes = await db.query('SELECT id, name FROM tenants');
        for (const t of tenantsRes.rows) {
            await db.query(`
                INSERT INTO payment_gateway_configs (tenant_id, active_gateway, is_test_mode)
                VALUES ($1, 'sandbox', true)
                ON CONFLICT (tenant_id) DO NOTHING
            `, [t.id]);
        }
        console.log(`✅ Initialized payment gateway configs across ${tenantsRes.rows.length} tenants!`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
