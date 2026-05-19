-- KhelSetu Database Schema - Analytics & Billing
-- PostgreSQL 14+ (Neon)
-- Version: 1.0.1

-- ========================================
-- ENUM TYPES
-- ========================================

CREATE TYPE plan_interval AS ENUM ('month', 'year');
CREATE TYPE subscription_status AS ENUM ('active', 'paused', 'cancelled', 'expired');
CREATE TYPE invoice_status AS ENUM ('pending', 'paid', 'failed', 'cancelled', 'refunded');
CREATE TYPE payment_method_type AS ENUM ('card', 'bank', 'wallet');

-- ========================================
-- BILLING TABLES
-- ========================================

CREATE TABLE IF NOT EXISTS plans (
    id VARCHAR(50) NOT NULL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    interval plan_interval DEFAULT 'month',
    features JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_plans_active ON plans(is_active);
CREATE INDEX idx_plans_features ON plans USING GIN(features);

CREATE TRIGGER trg_plans_updated_at
    BEFORE UPDATE ON plans
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- SEED DEFAULT PLANS
-- ========================================

INSERT INTO plans (id, name, price, interval, features, is_active) VALUES
    ('free', 'Free', 0, 'month', '{"tournaments": 5, "teams": 10, "players": 50, "matches": 100, "storage_mb": 100, "users": 5}', TRUE),
    ('starter', 'Starter', 9.99, 'month', '{"tournaments": 20, "teams": 50, "players": 200, "matches": 500, "storage_mb": 500, "users": 20}', TRUE),
    ('professional', 'Professional', 29.99, 'month', '{"tournaments": 100, "teams": 200, "players": 1000, "matches": 2000, "storage_mb": 2000, "users": 50}', TRUE),
    ('enterprise', 'Enterprise', 99.99, 'month', '{"tournaments": -1, "teams": -1, "players": -1, "matches": -1, "storage_mb": -1, "users": -1}', TRUE)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, price = EXCLUDED.price, features = EXCLUDED.features;

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan_id VARCHAR(50) NOT NULL REFERENCES plans(id),
    status subscription_status DEFAULT 'active',
    external_id VARCHAR(255),
    current_period_start TIMESTAMPTZ NULL,
    current_period_end TIMESTAMPTZ NULL,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    PRIMARY KEY (id)
);

CREATE INDEX idx_subscriptions_org ON subscriptions(organization_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_plan ON subscriptions(plan_id);
CREATE INDEX idx_subscriptions_deleted ON subscriptions(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_subscriptions_metadata ON subscriptions USING GIN(metadata);

CREATE TRIGGER trg_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS invoices (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    invoice_number VARCHAR(50),
    amount DECIMAL(10, 2) NOT NULL CHECK (amount >= 0),
    currency VARCHAR(10) DEFAULT 'NPR',
    status invoice_status DEFAULT 'pending',
    external_id VARCHAR(255),
    pdf_url VARCHAR(500),
    paid_at TIMESTAMPTZ NULL,
    due_date TIMESTAMPTZ NULL,
    metadata JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_invoices_org ON invoices(organization_id);
CREATE INDEX idx_invoices_subscription ON invoices(subscription_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_number ON invoices(invoice_number);
CREATE INDEX idx_invoices_metadata ON invoices USING GIN(metadata);

CREATE TRIGGER trg_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS payment_methods (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    type payment_method_type NOT NULL,
    token VARCHAR(255) NOT NULL,
    last_four VARCHAR(4),
    brand VARCHAR(50),
    expiry_month INT,
    expiry_year INT,
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    metadata JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_payment_methods_org ON payment_methods(organization_id);
CREATE INDEX idx_payment_methods_default ON payment_methods(is_default);
CREATE INDEX idx_payment_methods_type ON payment_methods(type);
CREATE INDEX idx_payment_methods_metadata ON payment_methods USING GIN(metadata);

CREATE TRIGGER trg_payment_methods_updated_at
    BEFORE UPDATE ON payment_methods
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- SEED DEFAULT PERMISSIONS
-- ========================================

INSERT INTO permissions (id, name, description, category) VALUES
    ('perm_tournament_read', 'tournament:read', 'View tournament details', 'tournaments'),
    ('perm_tournament_create', 'tournament:create', 'Create tournaments', 'tournaments'),
    ('perm_tournament_update', 'tournament:update', 'Update tournaments', 'tournaments'),
    ('perm_tournament_delete', 'tournament:delete', 'Delete tournaments', 'tournaments'),
    ('perm_team_read', 'team:read', 'View team details', 'teams'),
    ('perm_team_create', 'team:create', 'Create teams', 'teams'),
    ('perm_team_update', 'team:update', 'Update teams', 'teams'),
    ('perm_team_delete', 'team:delete', 'Delete teams', 'teams'),
    ('perm_player_read', 'player:read', 'View player details', 'players'),
    ('perm_player_create', 'player:create', 'Create players', 'players'),
    ('perm_player_update', 'player:update', 'Update players', 'players'),
    ('perm_player_delete', 'player:delete', 'Delete players', 'players'),
    ('perm_match_read', 'match:read', 'View match details', 'matches'),
    ('perm_match_create', 'match:create', 'Create matches', 'matches'),
    ('perm_match_update', 'match:update', 'Update matches', 'matches'),
    ('perm_match_delete', 'match:delete', 'Delete matches', 'matches'),
    ('perm_match_score', 'match:score', 'Update match scores', 'matches'),
    ('perm_analytics_view', 'analytics:view', 'View analytics', 'analytics'),
    ('perm_audit_view', 'audit:view', 'View audit logs', 'audit'),
    ('perm_billing_manage', 'billing:manage', 'Manage billing', 'billing'),
    ('perm_org_manage', 'org:manage', 'Manage organization', 'organization'),
    ('perm_org_members', 'org:members', 'Manage organization members', 'organization'),
    ('perm_rbac_manage', 'rbac:manage', 'Manage roles and permissions', 'rbac')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- ========================================
-- SEED DEFAULT ROLES
-- ========================================

INSERT INTO roles (id, name, description, scope, is_system) VALUES
    ('role_super_admin', 'Super Admin', 'Full system access', 'global', TRUE),
    ('role_org_admin', 'Organization Admin', 'Full organization access', 'organization', TRUE),
    ('role_org_member', 'Organization Member', 'Standard organization member', 'organization', TRUE),
    ('role_org_viewer', 'Organization Viewer', 'Read-only organization access', 'organization', TRUE),
    ('role_tournament_admin', 'Tournament Admin', 'Manage specific tournament', 'tournament', TRUE),
    ('role_match_official', 'Match Official', 'Official for matches', 'match', TRUE)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- ========================================
-- SEED ROLE-PERMISSION MAPPINGS FOR ORG_ADMIN
-- ========================================

INSERT INTO role_permissions (id, role_id, permission_id)
SELECT gen_random_uuid(), 'role_org_admin', p.id FROM permissions p
ON CONFLICT (role_id, permission_id) DO NOTHING;
