-- ==============================================================================
-- PHASE 13: WHATSAPP CLOUD API INTEGRATIONS & INBOUND WEBHOOKS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS whatsapp_api_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    provider VARCHAR(50) DEFAULT 'meta_cloud_api' CHECK (provider IN ('meta_cloud_api', 'simulator', 'aisensy')),
    phone_number_id VARCHAR(100),
    waba_id VARCHAR(100),
    access_token TEXT,
    webhook_verify_token VARCHAR(100) DEFAULT 'edubusiness_wa_secret_2026',
    is_enabled BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_configs_tenant ON whatsapp_api_configs(tenant_id);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    recipient_phone VARCHAR(50) NOT NULL,
    recipient_name VARCHAR(255),
    direction VARCHAR(20) DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
    template_name VARCHAR(100) DEFAULT 'cart_recovery',
    message_body TEXT NOT NULL,
    meta_message_id VARCHAR(100),
    status VARCHAR(50) DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed', 'received', 'simulated')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_tenant ON whatsapp_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created ON whatsapp_messages(created_at DESC);
