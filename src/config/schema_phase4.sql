-- Database schema updates for Phase 4: Community Feed and Gamification System

-- 1. Community Posts
CREATE TABLE IF NOT EXISTS community_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_posts_tenant ON community_posts(tenant_id);

-- 2. Community Comments
CREATE TABLE IF NOT EXISTS community_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON community_comments(post_id);

-- 3. Community Likes
CREATE TABLE IF NOT EXISTS community_likes (
    post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, user_id)
);

-- 4. Gamification logs (XP ledger)
CREATE TABLE IF NOT EXISTS gamification_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    action_type VARCHAR(100) NOT NULL CHECK (action_type IN ('attend_class', 'pass_test', 'post_question', 'daily_login')),
    points INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_xp_tenant ON gamification_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_xp_user ON gamification_logs(user_id);


-- ========================================================
-- SEED DATA FOR PHASE 4 MOCKS
-- ========================================================

-- Insert mock students for leaderboard rankings
INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role)
VALUES 
(
    '55555555-5555-5555-5555-555555555555',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'student2@abc.com',
    '$2b$10$U.DszM/j3C8k8F9wD5wzLeY.Z8W3l9076lqf.w20VepE2g4h9NZaW', -- hash of password123
    'Amit',
    'Sharma',
    'student'
),
(
    '66666666-6666-6666-6666-666666666666',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'student3@abc.com',
    '$2b$10$U.DszM/j3C8k8F9wD5wzLeY.Z8W3l9076lqf.w20VepE2g4h9NZaW', -- hash of password123
    'Priya',
    'Patel',
    'student'
) ON CONFLICT DO NOTHING;

-- Seed community discussion threads
INSERT INTO community_posts (id, tenant_id, user_id, content)
VALUES 
(
    '1a1a1a1a-1a1a-1a1a-1a1a-1a1a1a1a1a1a',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    '22222222-2222-2222-2222-222222222222', -- teacher@abc.com
    'Welcome everyone to the ABC Academy study feed! Feel free to ask questions, share lecture notes, and interact with peers here.'
),
(
    '2b2b2b2b-2b2b-2b2b-2b2b-2b2b2b2b2b2b',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    '33333333-3333-3333-3333-333333333333', -- student@abc.com
    'Hey guys, does anyone have reference notes on Gauss''s law derivation? Having a bit of trouble with the electric flux integration.'
) ON CONFLICT DO NOTHING;

-- Seed comment replies
INSERT INTO community_comments (id, post_id, user_id, content)
VALUES 
(
    '3c3c3c3c-3c3c-3c3c-3c3c-3c3c3c3c3c3c',
    '2b2b2b2b-2b2b-2b2b-2b2b-2b2b2b2b2b2b',
    '66666666-6666-6666-6666-666666666666', -- Priya Patel
    'Yes Rahul, check out Chapter 1 in the course syllabus! The teacher uploaded a detailed PDF note on Coulomb''s law and Gauss law today.'
) ON CONFLICT DO NOTHING;

-- Seed likes
INSERT INTO community_likes (post_id, user_id)
VALUES 
('1a1a1a1a-1a1a-1a1a-1a1a-1a1a1a1a1a1a', '33333333-3333-3333-3333-333333333333'),
('2b2b2b2b-2b2b-2b2b-2b2b-2b2b2b2b2b2b', '66666666-6666-6666-6666-666666666666')
ON CONFLICT DO NOTHING;

-- Seed XP points logs to generate leaderboard podium rankings
INSERT INTO gamification_logs (id, tenant_id, user_id, action_type, points)
VALUES 
-- Rahul (student@abc.com - 33333333-3333-3333-3333-333333333333) -> 120 XP
('e1111111-1111-1111-1111-111111111111', 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', '33333333-3333-3333-3333-333333333333', 'attend_class', 50),
('e1111111-1111-1111-1111-111111111112', 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', '33333333-3333-3333-3333-333333333333', 'pass_test', 50),
('e1111111-1111-1111-1111-111111111113', 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', '33333333-3333-3333-3333-333333333333', 'post_question', 20),

-- Amit Sharma (student2@abc.com) -> 80 XP
('e2222222-2222-2222-2222-222222222221', 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', '55555555-5555-5555-5555-555555555555', 'attend_class', 40),
('e2222222-2222-2222-2222-222222222222', 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', '55555555-5555-5555-5555-555555555555', 'pass_test', 40),

-- Priya Patel (student3@abc.com) -> 170 XP
('e3333333-3333-3333-3333-333333333331', 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', '66666666-6666-6666-6666-666666666666', 'attend_class', 70),
('e3333333-3333-3333-3333-333333333332', 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', '66666666-6666-6666-6666-666666666666', 'pass_test', 80),
('e3333333-3333-3333-3333-333333333333', 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', '66666666-6666-6666-6666-666666666666', 'post_question', 20)
ON CONFLICT DO NOTHING;
