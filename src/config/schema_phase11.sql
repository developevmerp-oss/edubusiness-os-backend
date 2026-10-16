-- ==============================================================================
-- PHASE 11: EXAM LOCKDOWN & ANTI-CHEATING PROCTORING SHIELD
-- ==============================================================================

-- 1. Extend Exams with Proctoring Controls
ALTER TABLE exams 
ADD COLUMN IF NOT EXISTS is_fullscreen_enforced BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS max_tab_switches INT DEFAULT 3;

-- 2. Extend Exam Attempts with Proctoring Audit Trail
ALTER TABLE exam_attempts 
ADD COLUMN IF NOT EXISTS tab_switch_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS proctoring_flags JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS submission_reason VARCHAR(100) DEFAULT 'manual';

-- 3. Add Index for Proctoring Audits
CREATE INDEX IF NOT EXISTS idx_exam_attempts_proctoring ON exam_attempts(submission_reason, tab_switch_count);
