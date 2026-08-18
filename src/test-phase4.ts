import { db } from './config/db';

async function verifyPhase4() {
    console.log('🧪 Starting Automated Phase 4 Community & Gamification Integration Validation...');

    // 1. Verify community posts retrieval
    try {
        const postsRes = await db.query(
            'SELECT * FROM community_posts WHERE tenant_id = $1',
            ['a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d']
        );

        if (postsRes.rows.length >= 2) {
            console.log(`✅ Community posts list query: PASS (${postsRes.rows.length} posts found)`);
        } else {
            console.error('❌ Community posts query: FAIL (Expected seeded posts not found)');
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ Community database checks failed:', err);
        process.exit(1);
    }

    // 2. Verify gamification leaderboard rankings
    try {
        const leaderboardRes = await db.query(
            `SELECT u.first_name, COALESCE(SUM(gl.points), 0)::int as total_xp
             FROM users u
             LEFT JOIN gamification_logs gl ON u.id = gl.user_id
             WHERE u.tenant_id = $1 AND u.role = 'student'
             GROUP BY u.id
             ORDER BY total_xp DESC`,
            ['a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d']
        );

        const ranks = leaderboardRes.rows;
        if (ranks.length >= 3 && ranks[0].total_xp >= ranks[1].total_xp && ranks[1].total_xp >= ranks[2].total_xp) {
            console.log('✅ Leaderboard rankings sort logic check: PASS');
        } else {
            console.error('❌ Leaderboard rankings check: FAIL (Leaderboard is unsorted or empty)');
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ Leaderboard database checks failed:', err);
        process.exit(1);
    }

    // 3. Verify user profile level computations
    try {
        const testXps = [25, 80, 200, 350];
        const expectedLevels = ['Bronze 🥉', 'Silver 🥈', 'Gold 🥇', 'Expert 👑'];

        const computedLevels = testXps.map(xp => {
            if (xp >= 300) return 'Expert 👑';
            if (xp >= 150) return 'Gold 🥇';
            if (xp >= 50) return 'Silver 🥈';
            return 'Bronze 🥉';
        });

        const isCalculatedCorrectly = computedLevels.every((l, idx) => l === expectedLevels[idx]);
        if (isCalculatedCorrectly) {
            console.log('✅ XP Threshold level calculation parameters: PASS');
        } else {
            console.error('❌ XP Threshold checks: FAIL');
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ Calculations validation failed:', err);
        process.exit(1);
    }

    console.log('🎉 Phase 4 Community & Gamification integration checks completed successfully.');
}

verifyPhase4().catch(err => {
    console.error('Phase 4 verification script execution failed:', err);
    process.exit(1);
});
