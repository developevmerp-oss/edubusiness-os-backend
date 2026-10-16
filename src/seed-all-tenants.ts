import { db } from './config/db';

async function seedAllTenants() {
    console.log('🚀 Seeding store products and bundles for ALL tenants...');
    try {
        const tenantsRes = await db.query('SELECT id, name, subdomain FROM tenants');
        console.log(`Found ${tenantsRes.rows.length} tenants in database.`);

        for (const t of tenantsRes.rows) {
            console.log(`Processing tenant: ${t.name} (${t.id})...`);

            // 1. Check & Seed Bundles
            const bCheck = await db.query('SELECT id FROM course_bundles WHERE tenant_id = $1', [t.id]);
            if (bCheck.rows.length === 0) {
                const cRes = await db.query('SELECT id, title FROM courses WHERE tenant_id = $1 LIMIT 3', [t.id]);
                const incCourses = cRes.rows.length > 0 ? cRes.rows : [
                    { id: 'sample-1', title: `${t.name} Core Foundation Mastery` },
                    { id: 'sample-2', title: `${t.name} Advanced Problem Solving` }
                ];

                await db.query(`
                    INSERT INTO course_bundles (tenant_id, title, description, bundle_price, original_price, discount_percentage, courses_included)
                    VALUES ($1, $2, $3, 4999.00, 7999.00, 38, $4)
                `, [
                    t.id, 
                    `${t.name} All-Access Ranker Super Pack 2026`, 
                    'Complete access to all courses, curated question banks, and mock test papers at an exclusive combo discount.', 
                    JSON.stringify(incCourses)
                ]);
                console.log(`  ✓ Seeded course bundle for ${t.name}`);
            } else {
                console.log(`  - Bundle already exists for ${t.name}`);
            }

            // 2. Check & Seed Digital Products
            const dCheck = await db.query('SELECT id FROM digital_products WHERE tenant_id = $1', [t.id]);
            if (dCheck.rows.length === 0) {
                await db.query(`
                    INSERT INTO digital_products (tenant_id, title, description, category, price, file_url, downloads_count)
                    VALUES 
                    ($1, 'VIP Handwritten Formula & Mind-Map Booklet', 'Complete 150-page high-yield formula notes, cheat-sheets, and quick revision mind maps with DRM watermark protection.', 'Formula Notes', 199.00, 'https://scaloy.com/samples/handwritten-physics-formula-booklet.pdf', 380),
                    ($1, '500 Must-Solve High-Yield Exam Problems', 'Curated question bank with step-by-step verified solutions strictly following the examination pattern.', 'Question Bank', 349.00, 'https://scaloy.com/samples/500-must-solve-physics-nta.pdf', 245),
                    ($1, '10 Full-Length All-India Mock Test Series with Solutions', 'Simulated full-syllabus mock papers strictly according to the latest NTA examination pattern.', 'Test Series PDF', 499.00, 'https://scaloy.com/samples/10-full-mock-tests-jee.pdf', 160)
                `, [t.id]);
                console.log(`  ✓ Seeded 3 digital products for ${t.name}`);
            } else {
                console.log(`  - Digital products already exist for ${t.name}`);
            }

            // 3. Check & Seed Mobile App Config
            const mCheck = await db.query('SELECT id FROM mobile_app_configs WHERE tenant_id = $1', [t.id]);
            if (mCheck.rows.length === 0) {
                const pkg = `com.${(t.subdomain || t.name || 'academy').replace(/[^a-z0-9]/gi, '').toLowerCase()}.learning`;
                await db.query(`
                    INSERT INTO mobile_app_configs (tenant_id, app_name, package_name, version_name, primary_color, splash_bg_color, enable_offline_mode, enable_push_notifications)
                    VALUES ($1, $2, $3, '1.0.0', '#6366f1', '#0a0b10', true, true)
                `, [t.id, `${t.name} Pro`, pkg]);
                console.log(`  ✓ Seeded mobile app config for ${t.name}`);
            }
        }

        console.log('🎉 Successfully seeded store products across all tenants!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Seeding error:', err);
        process.exit(1);
    }
}

seedAllTenants();
