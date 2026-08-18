import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../config/db';
import { authenticate } from '../middlewares/auth';

const router = Router();

router.get('/metrics', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const user = req.user!;
        const today = new Date().toISOString().split('T')[0];

        if (user.role === 'admin') {
            // 1. ADMIN METRICS
            // A. Students Count
            const studentCountRes = await db.query(
                "SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND role = 'student' AND status = 'active'",
                [tenantId]
            );
            const totalStudents = parseInt(studentCountRes.rows[0].count, 10);

            // B. Active Batches Count
            const batchCountRes = await db.query(
                'SELECT COUNT(*) FROM batches WHERE tenant_id = $1',
                [tenantId]
            );
            const activeBatches = parseInt(batchCountRes.rows[0].count, 10);

            // C. Fees status
            const feesSummaryRes = await db.query(
                `SELECT 
                    COALESCE(SUM(amount_due), 0) as total_due,
                    COALESCE(SUM(amount_paid), 0) as total_collected,
                    COALESCE(SUM(amount_due - amount_paid), 0) as total_pending,
                    COALESCE(SUM(CASE WHEN due_date < $2 AND status != 'paid' THEN (amount_due - amount_paid) ELSE 0 END), 0) as total_overdue
                 FROM fees WHERE tenant_id = $1`,
                [tenantId, today]
            );
            const feesSummary = feesSummaryRes.rows[0];

            // D. Attendance Rate (overall)
            const attRateRes = await db.query(
                `SELECT 
                    COUNT(CASE WHEN status = 'present' THEN 1 END) as present_count,
                    COUNT(*) as total_count
                 FROM attendance WHERE tenant_id = $1`,
                [tenantId]
            );
            const present = parseInt(attRateRes.rows[0].present_count, 10);
            const total = parseInt(attRateRes.rows[0].total_count, 10);
            const attendanceRate = total > 0 ? Math.round((present / total) * 100) : 100;

            // E. Classes Today
            const classesTodayRes = await db.query(
                `SELECT b.id, b.name as batch_name, b.schedule, c.title as course_title,
                        u.first_name as teacher_first_name, u.last_name as teacher_last_name
                 FROM batches b
                 JOIN courses c ON b.course_id = c.id
                 LEFT JOIN users u ON b.teacher_id = u.id
                 WHERE b.tenant_id = $1`,
                [tenantId]
            );
            
            // Filter schedule in application layer for today's classes
            // Days mapping
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const todayDayName = days[new Date().getDay()];

            const todayClasses = classesTodayRes.rows.filter(b => {
                if (!b.schedule) return false;
                const scheduleList = typeof b.schedule === 'string' ? JSON.parse(b.schedule) : b.schedule;
                return Array.isArray(scheduleList) && scheduleList.some((s: any) => s.day === todayDayName);
            }).map(b => {
                const scheduleList = typeof b.schedule === 'string' ? JSON.parse(b.schedule) : b.schedule;
                const slot = scheduleList.find((s: any) => s.day === todayDayName);
                return {
                    id: b.id,
                    batchName: b.batch_name,
                    courseTitle: b.course_title,
                    teacherName: b.teacher_first_name ? `${b.teacher_first_name} ${b.teacher_last_name}` : 'Unassigned',
                    time: slot ? `${slot.startTime} - ${slot.endTime}` : 'All Day'
                };
            });

            res.json({
                role: 'admin',
                metrics: {
                    totalStudents,
                    activeBatches,
                    attendanceRate,
                    revenue: {
                        collected: parseFloat(feesSummary.total_collected),
                        pending: parseFloat(feesSummary.total_pending),
                        overdue: parseFloat(feesSummary.total_overdue)
                    },
                    todayClasses
                }
            });
            return;
        }

        if (user.role === 'teacher') {
            // 2. TEACHER METRICS
            // A. Batches list
            const teacherBatchesRes = await db.query(
                `SELECT id, name, schedule, start_date, end_date FROM batches 
                 WHERE tenant_id = $1 AND teacher_id = $2`,
                [tenantId, user.id]
            );

            // B. Today's classes
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const todayDayName = days[new Date().getDay()];
            const todayClasses = teacherBatchesRes.rows.filter(b => {
                if (!b.schedule) return false;
                const scheduleList = typeof b.schedule === 'string' ? JSON.parse(b.schedule) : b.schedule;
                return Array.isArray(scheduleList) && scheduleList.some((s: any) => s.day === todayDayName);
            }).map(b => {
                const scheduleList = typeof b.schedule === 'string' ? JSON.parse(b.schedule) : b.schedule;
                const slot = scheduleList.find((s: any) => s.day === todayDayName);
                return {
                    id: b.id,
                    batchName: b.name,
                    time: slot ? `${slot.startTime} - ${slot.endTime}` : 'All Day'
                };
            });

            // C. Enrolled Students aggregate count
            const enrolledCountRes = await db.query(
                `SELECT COUNT(DISTINCT student_id) FROM batch_students 
                 WHERE batch_id IN (SELECT id FROM batches WHERE tenant_id = $1 AND teacher_id = $2)`,
                [tenantId, user.id]
            );

            res.json({
                role: 'teacher',
                metrics: {
                    batchCount: teacherBatchesRes.rows.length,
                    totalStudents: parseInt(enrolledCountRes.rows[0].count, 10),
                    todayClasses
                }
            });
            return;
        }

        if (user.role === 'student') {
            // 3. STUDENT METRICS
            // A. Batches Enrolled
            const studentBatchesRes = await db.query(
                `SELECT b.id, b.name as batch_name, c.title as course_title, b.schedule
                 FROM batch_students bs
                 JOIN batches b ON bs.batch_id = b.id
                 JOIN courses c ON b.course_id = c.id
                 WHERE bs.student_id = $1 AND b.tenant_id = $2`,
                [user.id, tenantId]
            );

            // B. Attendance summary
            const attSummaryRes = await db.query(
                `SELECT 
                    COUNT(CASE WHEN status = 'present' THEN 1 END) as present_count,
                    COUNT(*) as total_count
                 FROM attendance WHERE tenant_id = $1 AND student_id = $2`,
                [tenantId, user.id]
            );
            const present = parseInt(attSummaryRes.rows[0].present_count, 10);
            const total = parseInt(attSummaryRes.rows[0].total_count, 10);
            const attendanceRate = total > 0 ? Math.round((present / total) * 100) : 100;

            // C. Fees due
            const feesDueRes = await db.query(
                `SELECT 
                    COALESCE(SUM(amount_due - amount_paid), 0) as pending_fees,
                    COALESCE(MIN(due_date), NULL) as next_due_date
                 FROM fees WHERE tenant_id = $1 AND student_id = $2 AND status != 'paid'`,
                [tenantId, user.id]
            );

            // D. Today's classes
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const todayDayName = days[new Date().getDay()];
            const todayClasses = studentBatchesRes.rows.filter(b => {
                if (!b.schedule) return false;
                const scheduleList = typeof b.schedule === 'string' ? JSON.parse(b.schedule) : b.schedule;
                return Array.isArray(scheduleList) && scheduleList.some((s: any) => s.day === todayDayName);
            }).map(b => {
                const scheduleList = typeof b.schedule === 'string' ? JSON.parse(b.schedule) : b.schedule;
                const slot = scheduleList.find((s: any) => s.day === todayDayName);
                return {
                    id: b.id,
                    batchName: b.batch_name,
                    courseTitle: b.course_title,
                    time: slot ? `${slot.startTime} - ${slot.endTime}` : 'All Day'
                };
            });

            res.json({
                role: 'student',
                metrics: {
                    attendanceRate,
                    pendingFees: parseFloat(feesDueRes.rows[0].pending_fees),
                    nextDueDate: feesDueRes.rows[0].next_due_date,
                    enrolledBatches: studentBatchesRes.rows.map(b => ({
                        id: b.id,
                        batchName: b.batch_name,
                        courseTitle: b.course_title
                    })),
                    todayClasses
                }
            });
            return;
        }

        if (user.role === 'parent') {
            // 4. PARENT METRICS
            // A. Fetch children of this parent
            const childrenRes = await db.query(
                `SELECT u.id, u.first_name, u.last_name, u.email 
                 FROM parents_students ps
                 JOIN users u ON ps.student_id = u.id
                 WHERE ps.parent_id = $1 AND u.tenant_id = $2`,
                [user.id, tenantId]
            );

            const childrenMetrics = [];

            for (const child of childrenRes.rows) {
                // Fetch attendance rate
                const attRes = await db.query(
                    `SELECT 
                        COUNT(CASE WHEN status = 'present' THEN 1 END) as present_count,
                        COUNT(*) as total_count
                     FROM attendance WHERE tenant_id = $1 AND student_id = $2`,
                    [tenantId, child.id]
                );
                const present = parseInt(attRes.rows[0].present_count, 10);
                const total = parseInt(attRes.rows[0].total_count, 10);
                const childAttRate = total > 0 ? Math.round((present / total) * 100) : 100;

                // Fetch fees due
                const feesRes = await db.query(
                    `SELECT 
                        COALESCE(SUM(amount_due - amount_paid), 0) as pending_fees,
                        COALESCE(MIN(due_date), NULL) as next_due_date
                     FROM fees WHERE tenant_id = $1 AND student_id = $2 AND status != 'paid'`,
                    [tenantId, child.id]
                );

                // Fetch enrolled batches
                const batchesRes = await db.query(
                    `SELECT b.name as batch_name, c.title as course_title
                     FROM batch_students bs
                     JOIN batches b ON bs.batch_id = b.id
                     JOIN courses c ON b.course_id = c.id
                     WHERE bs.student_id = $1`,
                    [child.id]
                );

                childrenMetrics.push({
                    id: child.id,
                    name: `${child.first_name} ${child.last_name}`,
                    email: child.email,
                    attendanceRate: childAttRate,
                    pendingFees: parseFloat(feesRes.rows[0].pending_fees),
                    nextDueDate: feesRes.rows[0].next_due_date,
                    enrolledBatches: batchesRes.rows
                });
            }

            res.json({
                role: 'parent',
                metrics: {
                    children: childrenMetrics
                }
            });
            return;
        }

        res.status(400).json({ error: 'Invalid user role' });
    } catch (error) {
        next(error);
    }
});

export default router;
