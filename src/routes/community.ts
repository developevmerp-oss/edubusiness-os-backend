import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { authenticate } from '../middlewares/auth';

const router = Router();

const postSchema = z.object({
    content: z.string().min(2)
});

const commentSchema = z.object({
    content: z.string().min(1)
});

/**
 * 1. Get all community posts
 */
router.get('/posts', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const userId = req.user!.id;

        const postsRes = await db.query(
            `SELECT p.id, p.content, p.created_at, p.user_id,
                    u.first_name, u.last_name, u.role,
                    (SELECT COUNT(*)::int FROM community_likes WHERE post_id = p.id) as likes_count,
                    (SELECT COUNT(*)::int FROM community_comments WHERE post_id = p.id) as comments_count,
                    EXISTS(SELECT 1 FROM community_likes WHERE post_id = p.id AND user_id = $1) as has_liked
             FROM community_posts p
             JOIN users u ON p.user_id = u.id
             WHERE p.tenant_id = $2
             ORDER BY p.created_at DESC`,
            [userId, tenantId]
        );

        res.json({ posts: postsRes.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 2. Create post (awards +10 XP to students)
 */
router.post('/posts', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    const client = await db.getClient();
    try {
        const { content } = postSchema.parse(req.body);
        const tenantId = req.tenant!.id;
        const user = req.user!;

        await client.query('BEGIN');

        // Insert post
        const result = await client.query(
            `INSERT INTO community_posts (tenant_id, user_id, content)
             VALUES ($1, $2, $3)
             RETURNING id, content, created_at`,
            [tenantId, user.id, content]
        );

        const newPost = result.rows[0];

        // Award +10 XP if user is a student
        if (user.role === 'student') {
            await client.query(
                `INSERT INTO gamification_logs (tenant_id, user_id, action_type, points)
                 VALUES ($1, $2, 'post_question', 10)`,
                [tenantId, user.id]
            );
        }

        await client.query('COMMIT');
        res.status(201).json({
            message: 'Post created successfully.',
            post: newPost
        });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

/**
 * 3. Toggle Like on post
 */
router.post('/posts/:id/like', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const userId = req.user!.id;
        const tenantId = req.tenant!.id;

        // Verify post exists under tenant
        const postCheck = await db.query(
            'SELECT id FROM community_posts WHERE id = $1 AND tenant_id = $2',
            [id, tenantId]
        );

        if (postCheck.rows.length === 0) {
            res.status(404).json({ error: 'Post not found.' });
            return;
        }

        // Check if already liked
        const likeCheck = await db.query(
            'SELECT 1 FROM community_likes WHERE post_id = $1 AND user_id = $2',
            [id, userId]
        );

        if (likeCheck.rows.length > 0) {
            // Unlike
            await db.query(
                'DELETE FROM community_likes WHERE post_id = $1 AND user_id = $2',
                [id, userId]
            );
            res.json({ liked: false });
        } else {
            // Like
            await db.query(
                'INSERT INTO community_likes (post_id, user_id) VALUES ($1, $2)',
                [id, userId]
            );
            res.json({ liked: true });
        }
    } catch (error) {
        next(error);
    }
});

/**
 * 4. Add Comment to post
 */
router.post('/posts/:id/comments', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { content } = commentSchema.parse(req.body);
        const tenantId = req.tenant!.id;
        const userId = req.user!.id;

        // Verify post
        const postCheck = await db.query(
            'SELECT id FROM community_posts WHERE id = $1 AND tenant_id = $2',
            [id, tenantId]
        );

        if (postCheck.rows.length === 0) {
            res.status(404).json({ error: 'Post not found.' });
            return;
        }

        const result = await db.query(
            `INSERT INTO community_comments (post_id, user_id, content)
             VALUES ($1, $2, $3)
             RETURNING id, content, created_at`,
            [id, userId, content]
        );

        res.status(201).json({
            message: 'Comment added successfully.',
            comment: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 5. Get Comments for post
 */
router.get('/posts/:id/comments', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;

        // Verify post
        const postCheck = await db.query(
            'SELECT id FROM community_posts WHERE id = $1 AND tenant_id = $2',
            [id, tenantId]
        );

        if (postCheck.rows.length === 0) {
            res.status(404).json({ error: 'Post not found.' });
            return;
        }

        const commentsRes = await db.query(
            `SELECT c.id, c.content, c.created_at,
                    u.first_name, u.last_name, u.role
             FROM community_comments c
             JOIN users u ON c.user_id = u.id
             WHERE c.post_id = $1
             ORDER BY c.created_at ASC`,
            [id]
        );

        res.json({ comments: commentsRes.rows });
    } catch (error) {
        next(error);
    }
});

export default router;
