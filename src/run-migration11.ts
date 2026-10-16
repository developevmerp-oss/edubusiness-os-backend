import fs from 'fs';
import path from 'path';
import { db } from './config/db';

async function runMigration() {
    console.log('🚀 Running Phase 11 Database Migration (Exam Lockdown & Proctoring Shield)...');
    try {
        const sqlPath = path.join(__dirname, 'config/schema_phase11.sql');
        const sql = fs.readFileSync(sqlPath, 'utf-8');

        await db.query(sql);
        console.log('✅ Phase 11 Schema applied successfully (Proctoring columns added to exams & exam_attempts)!');

        // Update existing exams with proctoring defaults if null
        await db.query(`
            UPDATE exams 
            SET is_fullscreen_enforced = COALESCE(is_fullscreen_enforced, true),
                max_tab_switches = COALESCE(max_tab_switches, 3);
        `);
        console.log('✅ Exam defaults updated with 3 max tab switches & fullscreen enforcement.');

        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
