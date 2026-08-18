-- Database schema updates for Phase 5: CRM Leads and Marketing Automation Systems

-- 1. CRM Leads Table
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'converted', 'closed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads(tenant_id);

-- 2. Marketing Campaigns Table
CREATE TABLE IF NOT EXISTS marketing_campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    trigger_type VARCHAR(100) NOT NULL CHECK (trigger_type IN ('inactive_7_days', 'course_completed', 'manual')),
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'whatsapp', 'both')),
    message_template TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'paused')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON marketing_campaigns(tenant_id);

-- 3. Marketing Logs (Simulated delivery statuses)
CREATE TABLE IF NOT EXISTS marketing_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
    recipient_email VARCHAR(255) NOT NULL,
    channel VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_marketing_logs_tenant ON marketing_logs(tenant_id);


-- ========================================================
-- SEED DATA FOR PHASE 5 MOCKS
-- ========================================================

-- Seed CRM Leads for ABC Academy
INSERT INTO leads (id, tenant_id, name, email, phone, course_id, status)
VALUES 
(
    'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'Rohan Mehta',
    'rohan@gmail.com',
    '+919876543210',
    'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1', -- Physics Course
    'new'
),
(
    'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'Sneha Sen',
    'sneha@yahoo.com',
    '+919876543211',
    'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
    'contacted'
) ON CONFLICT DO NOTHING;

-- Seed Campaign Templates
INSERT INTO marketing_campaigns (id, tenant_id, title, trigger_type, channel, message_template, status)
VALUES 
(
    'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    '7-Day Inactivity Warning',
    'inactive_7_days',
    'both',
    'Hi {name}, we noticed you haven''t logged in to ABC Academy in the last week. Don''t fall behind! Tap here to continue: {link}',
    'active'
),
(
    'd2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'Course Completion Certificate Promo',
    'course_completed',
    'email',
    'Congratulations {name}! You have finished the course. Here is your certificate. Check out our next catalog!',
    'active'
) ON CONFLICT DO NOTHING;

-- Seed Delivery logs
INSERT INTO marketing_logs (id, tenant_id, campaign_id, recipient_email, channel, status)
VALUES 
(
    'f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
    'student@abc.com',
    'email',
    'sent'
) ON CONFLICT DO NOTHING;
