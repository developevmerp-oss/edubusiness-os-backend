import fs from 'fs';
import path from 'path';
import { db } from './config/db';

async function runMigration() {
    console.log('🚀 Running Phase 13 Database Migration (WhatsApp Cloud API & Webhooks)...');
    try {
        const sqlPath = path.join(__dirname, 'config/schema_phase13.sql');
        const sql = fs.readFileSync(sqlPath, 'utf-8');

        await db.query(sql);
        console.log('✅ Phase 13 Schema applied (whatsapp_api_configs and whatsapp_messages tables created)!');

        // Seed default config for all existing tenants
        const tenantsRes = await db.query('SELECT id, name FROM tenants');
        for (const t of tenantsRes.rows) {
            await db.query(`
                INSERT INTO whatsapp_api_configs (tenant_id, provider, is_enabled, webhook_verify_token)
                VALUES ($1, 'simulator', false, 'edubusiness_wa_secret_2026')
                ON CONFLICT (tenant_id) DO NOTHING
            `, [t.id]);
        }
        console.log(`✅ Initialized WhatsApp API configs across ${tenantsRes.rows.length} tenants!`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
