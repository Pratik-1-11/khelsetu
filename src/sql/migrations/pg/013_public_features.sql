-- Migration 013: Public Portal Features
-- PostgreSQL 14+ (Neon)
-- Adds: user_type, free match quota, public user auto-org creation

-- ========================================
-- USER TYPE DIFFERENTIATION
-- ========================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type VARCHAR(20) DEFAULT 'dashboard';
-- 'dashboard' = tenant-based user with org membership
-- 'public' = free-tier user (no org membership initially)

CREATE INDEX IF NOT EXISTS idx_users_type ON users(user_type);

-- ========================================
-- FREE MATCH QUOTA TRACKING
-- ========================================

CREATE TABLE IF NOT EXISTS user_free_matches (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    matches_allocated INT DEFAULT 5,
    matches_used INT DEFAULT 0 CHECK (matches_used >= 0),
    first_match_org_id UUID REFERENCES organizations(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id)
);

CREATE INDEX idx_user_free_matches_user ON user_free_matches(user_id);

CREATE TRIGGER trg_user_free_matches_updated_at
    BEFORE UPDATE ON user_free_matches
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- AUTO-CREATE FREE MATCH QUOTA ON PUBLIC USER REGISTRATION
-- ========================================

CREATE OR REPLACE FUNCTION fn_create_free_match_quota()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.user_type = 'public' THEN
        INSERT INTO user_free_matches (user_id, matches_allocated, matches_used)
        VALUES (NEW.id, 5, 0);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_create_free_match_quota ON users;

CREATE TRIGGER trg_create_free_match_quota
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION fn_create_free_match_quota();
