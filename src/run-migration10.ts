import fs from 'fs';
import path from 'path';
import { db } from './config/db';

async function runMigration() {
    console.log('🚀 Running Phase 10 Database Migration...');
    try {
        const sqlPath = path.join(__dirname, 'config/schema_phase10.sql');
        const sql = fs.readFileSync(sqlPath, 'utf-8');

        await db.query(sql);
        console.log('✅ Phase 10 Tables (course_bundles, digital_products, digital_product_purchases, mobile_app_configs) created successfully!');

        const tenantId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
        const courseId = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'; // Physics

        // 1. Seed demo bundles
        const bundleCheck = await db.query('SELECT id FROM course_bundles WHERE tenant_id = $1', [tenantId]);
        if (bundleCheck.rows.length === 0) {
            await db.query(`
                INSERT INTO course_bundles (tenant_id, title, description, bundle_price, original_price, discount_percentage, courses_included)
                VALUES 
                (
                    $1, 
                    'PCM Ultimate All-India Ranker Super Pack 2026', 
                    'All 3 core subjects combined: Physics, Chemistry & Mathematics with full question bank, live doubt sessions, and all-India mock tests.',
                    7999.00,
                    12999.00,
                    38,
                    $2
                )
            `, [
                tenantId, 
                JSON.stringify([
                    { id: courseId, title: 'Complete JEE Physics Mastery 2026' },
                    { id: 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', title: 'Complete JEE Chemistry Mastery 2026' },
                    { id: 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', title: 'Complete JEE Mathematics Mastery 2026' }
                ])
            ]);
            console.log('✅ Seeded demo Course Bundle!');
        }

        // 2. Seed demo digital download products
        const productCheck = await db.query('SELECT id FROM digital_products WHERE tenant_id = $1', [tenantId]);
        if (productCheck.rows.length === 0) {
            await db.query(`
                INSERT INTO digital_products (tenant_id, title, description, category, price, file_url, preview_url, downloads_count)
                VALUES 
                (
                    $1,
                    'VIP Handwritten Physics Formula & Cheat-Sheet Booklet',
                    'Complete 150-page high-yield formula notes, mind maps, and key derivations with watermark protection.',
                    'Formula Notes',
                    199.00,
                    'https://scaloy.com/samples/handwritten-physics-formula-booklet.pdf',
                    'https://scaloy.com/samples/preview-handwritten-physics.pdf',
                    420
                ),
                (
                    $1,
                    '500 Must-Solve NTA Pattern Physics Problems & Video Solutions',
                    'Curated questions with step-by-step video solution QR codes for rapid revision.',
                    'Question Bank',
                    349.00,
                    'https://scaloy.com/samples/500-must-solve-physics-nta.pdf',
                    'https://scaloy.com/samples/preview-500-questions.pdf',
                    290
                ),
                (
                    $1,
                    '10 Full-Length All-India Mock Test Series Papers with Detailed Answer Keys',
                    'Simulated full-syllabus mock papers strictly according to the latest examination pattern.',
                    'Test Series PDF',
                    499.00,
                    'https://scaloy.com/samples/10-full-mock-tests-jee.pdf',
                    'https://scaloy.com/samples/preview-mock-tests.pdf',
                    180
                )
            `, [tenantId]);
            console.log('✅ Seeded demo Digital Download Products!');
        }

        // 3. Seed demo mobile app config
        const appConfigCheck = await db.query('SELECT id FROM mobile_app_configs WHERE tenant_id = $1', [tenantId]);
        if (appConfigCheck.rows.length === 0) {
            await db.query(`
                INSERT INTO mobile_app_configs (tenant_id, app_name, package_name, version_name, primary_color, splash_bg_color, enable_offline_mode, enable_push_notifications)
                VALUES 
                ($1, 'Apex Academy Pro', 'com.apexacademy.learning', '1.0.0', '#6366f1', '#0a0b10', true, true)
            `, [tenantId]);
            console.log('✅ Seeded default Mobile App & PWA Config!');
        }

        console.log('🎉 Phase 10 Migration & Seeding Complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration Error:', error);
        process.exit(1);
    }
}

runMigration();
