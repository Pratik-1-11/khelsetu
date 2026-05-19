-- KhelSetu Database Schema - Audit, Sync, Notifications
-- PostgreSQL 14+ (Neon)
-- Version: 1.0.0

-- ========================================
-- ENUM TYPES
-- ========================================

CREATE TYPE sync_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'conflict');
CREATE TYPE sync_operation AS ENUM ('create', 'update', 'delete');

-- ========================================
-- AUDIT LOGS (Consolidated - single definition)
-- ========================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id),
    user_id UUID REFERENCES users(id),
    action_type VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    metadata JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_audit_logs_org ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action_type);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_date ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_old_values ON audit_logs USING GIN(old_values);
CREATE INDEX idx_audit_logs_new_values ON audit_logs USING GIN(new_values);
CREATE INDEX idx_audit_logs_metadata ON audit_logs USING GIN(metadata);

-- ========================================
-- OFFLINE SYNC QUEUE
-- ========================================

CREATE TABLE IF NOT EXISTS sync_queue (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    device_id VARCHAR(100),
    client_event_id VARCHAR(100) NOT NULL UNIQUE,
    operation sync_operation NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    idempotency_key VARCHAR(100),
    status sync_status DEFAULT 'pending',
    retry_count INT DEFAULT 0 CHECK (retry_count >= 0),
    max_retries INT DEFAULT 3,
    error_message TEXT,
    processed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_sync_queue_org ON sync_queue(organization_id);
CREATE INDEX idx_sync_queue_device ON sync_queue(device_id);
CREATE INDEX idx_sync_queue_status ON sync_queue(status);
CREATE INDEX idx_sync_queue_pending ON sync_queue(status) WHERE status = 'pending';
CREATE INDEX idx_sync_queue_idempotency ON sync_queue(idempotency_key);
CREATE INDEX idx_sync_queue_created ON sync_queue(created_at);
CREATE INDEX idx_sync_queue_payload ON sync_queue USING GIN(payload);

CREATE TRIGGER trg_sync_queue_updated_at
    BEFORE UPDATE ON sync_queue
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- Device tracking for offline sync
CREATE TABLE IF NOT EXISTS devices (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    device_id VARCHAR(100) NOT NULL,
    device_name VARCHAR(255),
    device_type VARCHAR(50),
    os_version VARCHAR(50),
    app_version VARCHAR(20),
    last_sync_at TIMESTAMPTZ NULL,
    last_seen_at TIMESTAMPTZ NULL,
    is_active BOOLEAN DEFAULT TRUE,
    metadata JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id),
    UNIQUE (organization_id, device_id)
);

CREATE INDEX idx_devices_org ON devices(organization_id);
CREATE INDEX idx_devices_user ON devices(user_id);
CREATE INDEX idx_devices_active ON devices(is_active);
CREATE INDEX idx_devices_deleted ON devices(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_devices_metadata ON devices USING GIN(metadata);

CREATE TRIGGER trg_devices_updated_at
    BEFORE UPDATE ON devices
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- NOTIFICATIONS
-- ========================================

CREATE TABLE IF NOT EXISTS notifications (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    data JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ NULL,
    metadata JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_notifications_org ON notifications(organization_id);
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_created ON notifications(created_at);
CREATE INDEX idx_notifications_deleted ON notifications(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_notifications_data ON notifications USING GIN(data);
CREATE INDEX idx_notifications_metadata ON notifications USING GIN(metadata);

CREATE TRIGGER trg_notifications_updated_at
    BEFORE UPDATE ON notifications
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- BROADCAST OVERLAYS (OBS/Web overlays)
-- ========================================

CREATE TABLE IF NOT EXISTS overlay_templates (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    sport_id UUID REFERENCES sports(id) ON DELETE SET NULL,
    template_config JSONB NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT NULL,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_overlay_templates_org ON overlay_templates(organization_id);
CREATE INDEX idx_overlay_templates_sport ON overlay_templates(sport_id);
CREATE INDEX idx_overlay_templates_deleted ON overlay_templates(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_overlay_templates_config ON overlay_templates USING GIN(template_config);

CREATE TRIGGER trg_overlay_templates_updated_at
    BEFORE UPDATE ON overlay_templates
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS live_overlays (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,
    match_id UUID REFERENCES matches(id) ON DELETE SET NULL,
    template_id UUID NOT NULL REFERENCES overlay_templates(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    overlay_config JSONB NOT NULL,
    is_active BOOLEAN DEFAULT FALSE,
    is_public BOOLEAN DEFAULT FALSE,
    access_token VARCHAR(100),
    metadata JSONB DEFAULT NULL,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_live_overlays_org ON live_overlays(organization_id);
CREATE INDEX idx_live_overlays_tournament ON live_overlays(tournament_id);
CREATE INDEX idx_live_overlays_match ON live_overlays(match_id);
CREATE INDEX idx_live_overlays_active ON live_overlays(is_active);
CREATE INDEX idx_live_overlays_deleted ON live_overlays(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_live_overlays_config ON live_overlays USING GIN(overlay_config);

CREATE TRIGGER trg_live_overlays_updated_at
    BEFORE UPDATE ON live_overlays
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- TACTICAL VISUALIZATION
-- ========================================

CREATE TABLE IF NOT EXISTS formations (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    formation_name VARCHAR(100) NOT NULL,
    positions JSONB NOT NULL,
    metadata JSONB DEFAULT NULL,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_formations_org ON formations(organization_id);
CREATE INDEX idx_formations_match ON formations(match_id);
CREATE INDEX idx_formations_team ON formations(team_id);
CREATE INDEX idx_formations_deleted ON formations(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_formations_positions ON formations USING GIN(positions);

CREATE TRIGGER trg_formations_updated_at
    BEFORE UPDATE ON formations
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS tactical_annotations (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    player_id UUID REFERENCES players(id) ON DELETE SET NULL,
    annotation_type VARCHAR(50) NOT NULL,
    coordinates JSONB NOT NULL,
    description TEXT,
    metadata JSONB DEFAULT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_tactical_annotations_org ON tactical_annotations(organization_id);
CREATE INDEX idx_tactical_annotations_match ON tactical_annotations(match_id);
CREATE INDEX idx_tactical_annotations_team ON tactical_annotations(team_id);
CREATE INDEX idx_tactical_annotations_player ON tactical_annotations(player_id);
CREATE INDEX idx_tactical_annotations_deleted ON tactical_annotations(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_tactical_annotations_coordinates ON tactical_annotations USING GIN(coordinates);

CREATE TRIGGER trg_tactical_annotations_updated_at
    BEFORE UPDATE ON tactical_annotations
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- ANALYTICS EVENTS
-- ========================================

CREATE TABLE IF NOT EXISTS analytics_events (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id),
    user_id UUID REFERENCES users(id),
    event_type VARCHAR(100) NOT NULL,
    event_category VARCHAR(50),
    event_name VARCHAR(100) NOT NULL,
    properties JSONB,
    session_id VARCHAR(100),
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_analytics_events_org ON analytics_events(organization_id);
CREATE INDEX idx_analytics_events_user ON analytics_events(user_id);
CREATE INDEX idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX idx_analytics_events_name ON analytics_events(event_name);
CREATE INDEX idx_analytics_events_date ON analytics_events(created_at);
CREATE INDEX idx_analytics_events_properties ON analytics_events USING GIN(properties);
