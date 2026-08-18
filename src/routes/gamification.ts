import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../config/db';
import { authenticate, requireRole } from '../middlewares/auth';

const router = Router();

/**
 * 1. Get Leaderboard (sorted list of tenant students by points sum)
 */
router.get('/leaderboard', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;

        const result = await db.query(
            `SELECT u.id, u.first_name, u.last_name, u.email,
                    COALESCE(SUM(gl.points), 0)::int as total_xp,
                    CASE 
                        WHEN COALESCE(SUM(gl.points), 0) < 50 THEN 'Bronze 🥉'
                        WHEN COALESCE(SUM(gl.points), 0) < 150 THEN 'Silver 🥈'
                        WHEN COALESCE(SUM(gl.points), 0) < 300 THEN 'Gold 🥇'
                        ELSE 'Expert 👑'
                    END as level
             FROM users u
             LEFT JOIN gamification_logs gl ON u.id = gl.user_id AND gl.tenant_id = $1
             WHERE u.tenant_id = $1 AND u.role = 'student'
             GROUP BY u.id
             ORDER BY total_xp DESC, u.first_name ASC`,
            [tenantId]
        );

        res.json({ leaderboard: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 2. Get User Gamification Profile details
 */
router.get('/profile', authenticate, requireRole(['student']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.id;
        const tenantId = req.tenant!.id;

        // Fetch sum of points
        const pointsRes = await db.query(
            'SELECT COALESCE(SUM(points), 0)::int as total_xp FROM gamification_logs WHERE user_id = $1 AND tenant_id = $2',
            [userId, tenantId]
        );

        const totalXp = pointsRes.rows[0].total_xp;

        // Calculate Level parameters
        let level = 'Bronze 🥉';
        let xpToNextLevel = 50 - totalXp;
        let nextLevelThreshold = 50;

        if (totalXp >= 300) {
            level = 'Expert 👑';
            xpToNextLevel = 0;
            nextLevelThreshold = 300;
        } else if (totalXp >= 150) {
            level = 'Gold 🥇';
            xpToNextLevel = 300 - totalXp;
            nextLevelThreshold = 300;
        } else if (totalXp >= 50) {
            level = 'Silver 🥈';
            xpToNextLevel = 150 - totalXp;
            nextLevelThreshold = 150;
        }

        // Fetch recent points logs
        const logsRes = await db.query(
            `SELECT action_type, points, created_at 
             FROM gamification_logs 
             WHERE user_id = $1 AND tenant_id = $2
             ORDER BY created_at DESC LIMIT 5`,
            [userId, tenantId]
        );

        // Check if daily check-in already claimed today
        const todayClaimRes = await db.query(
            `SELECT 1 FROM gamification_logs 
             WHERE user_id = $1 AND tenant_id = $2 AND action_type = 'daily_login' AND created_at::date = CURRENT_DATE`,
            [userId, tenantId]
        );

        const isDailyClaimed = todayClaimRes.rows.length > 0;

        res.json({
            profile: {
                totalXp,
                level,
                xpToNextLevel: Math.max(0, xpToNextLevel),
                nextLevelThreshold,
                isDailyClaimed
            },
            logs: logsRes.rows
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 3. Claim daily login reward points (+2 XP, once per day)
 */
router.post('/claim-login', authenticate, requireRole(['student']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.id;
        const tenantId = req.tenant!.id;

        // Double check daily limit
        const checkRes = await db.query(
            `SELECT 1 FROM gamification_logs 
             WHERE user_id = $1 AND tenant_id = $2 AND action_type = 'daily_login' AND created_at::date = CURRENT_DATE`,
            [userId, tenantId]
        );

        if (checkRes.rows.length > 0) {
            res.status(400).json({ error: 'You have already claimed your daily check-in points today.' });
            return;
        }

        const result = await db.query(
            `INSERT INTO gamification_logs (tenant_id, user_id, action_type, points)
             VALUES ($1, $2, 'daily_login', 2)
             RETURNING points, created_at`,
            [tenantId, userId]
        );

        res.status(201).json({
            message: 'Daily check-in points claimed successfully!',
            log: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

export default router;
