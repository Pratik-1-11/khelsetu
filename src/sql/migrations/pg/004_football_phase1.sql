-- KhelSetu Database Schema - Football Phase 1 Critical Updates
-- PostgreSQL 14+ (Neon)
-- Version: 1.0.0
-- Phase 1: Event-Sourcing Fixes, Match Periods, Card Tracking, Substitutions

-- ========================================
-- ENUM TYPES
-- ========================================

CREATE TYPE period_type AS ENUM ('first_half', 'second_half', 'halftime', 'extra_time_first', 'extra_time_second', 'penalties', 'finished');
CREATE TYPE period_status AS ENUM ('pending', 'in_progress', 'completed', 'abandoned');
CREATE TYPE card_type AS ENUM ('yellow', 'red', 'second_yellow');
CREATE TYPE substitution_reason AS ENUM ('tactical', 'injury', 'red_card', 'other');
CREATE TYPE score_action_type AS ENUM ('score_update', 'event_reverse', 'event_correction', 'var_decision', 'manual_correction');

-- ========================================
-- MATCH PERIODS
-- ========================================

CREATE TABLE IF NOT EXISTS football_match_periods (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    period_number INT NOT NULL,
    period_type period_type NOT NULL,
    status period_status DEFAULT 'pending',
    start_time TIMESTAMPTZ NULL,
    end_time TIMESTAMPTZ NULL,
    injury_time_minutes INT DEFAULT 0,
    actual_minute INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    version INT DEFAULT 1,
    PRIMARY KEY (id),
    UNIQUE (match_id, period_number)
);

CREATE INDEX idx_football_match_periods_match ON football_match_periods(match_id);
CREATE INDEX idx_football_match_periods_status ON football_match_periods(status);
CREATE INDEX idx_football_match_periods_type ON football_match_periods(period_type);

CREATE TRIGGER trg_football_match_periods_updated_at
    BEFORE UPDATE ON football_match_periods
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- PLAYER MATCH CARDS
-- ========================================

CREATE TABLE IF NOT EXISTS football_player_match_cards (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    card_type card_type NOT NULL,
    minute INT NOT NULL,
    reason VARCHAR(255),
    event_id UUID REFERENCES scoring_events(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_football_cards_match_player ON football_player_match_cards(match_id, player_id);
CREATE INDEX idx_football_cards_team ON football_player_match_cards(team_id);
CREATE INDEX idx_football_cards_event ON football_player_match_cards(event_id);
CREATE INDEX idx_football_cards_active ON football_player_match_cards(match_id, is_active);

CREATE TRIGGER trg_football_player_match_cards_updated_at
    BEFORE UPDATE ON football_player_match_cards
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- MATCH LINEUPS
-- ========================================

CREATE TABLE IF NOT EXISTS football_match_lineups (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    position VARCHAR(50),
    is_starting BOOLEAN DEFAULT FALSE,
    is_on_bench BOOLEAN DEFAULT FALSE,
    shirt_number INT,
    minutes_played INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    version INT DEFAULT 1,
    PRIMARY KEY (id),
    UNIQUE (match_id, team_id, player_id)
);

CREATE INDEX idx_football_lineups_match_team ON football_match_lineups(match_id, team_id);
CREATE INDEX idx_football_lineups_player ON football_match_lineups(player_id);
CREATE INDEX idx_football_lineups_starting ON football_match_lineups(match_id, team_id, is_starting);
CREATE INDEX idx_football_lineups_bench ON football_match_lineups(match_id, team_id, is_on_bench);

CREATE TRIGGER trg_football_match_lineups_updated_at
    BEFORE UPDATE ON football_match_lineups
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- SUBSTITUTION EVENTS
-- ========================================

CREATE TABLE IF NOT EXISTS football_substitution_events (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    player_in_id UUID NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
    player_out_id UUID NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
    minute INT NOT NULL,
    substitution_order INT NOT NULL,
    reason substitution_reason DEFAULT 'tactical',
    is_valid BOOLEAN DEFAULT TRUE,
    validation_error VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_football_subs_match_team ON football_substitution_events(match_id, team_id);
CREATE INDEX idx_football_subs_player_out ON football_substitution_events(player_out_id);
CREATE INDEX idx_football_subs_player_in ON football_substitution_events(player_in_id);

-- ========================================
-- TEAM SUBSTITUTION LIMITS
-- ========================================

CREATE TABLE IF NOT EXISTS football_team_substitution_limits (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    max_substitutions INT DEFAULT 5,
    substitutions_used INT DEFAULT 0,
    extra_time_substitutions INT DEFAULT 1,
    extra_time_substitutions_used INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE (match_id, team_id)
);

CREATE INDEX idx_football_sub_limits_match ON football_team_substitution_limits(match_id);

CREATE TRIGGER trg_football_team_substitution_limits_updated_at
    BEFORE UPDATE ON football_team_substitution_limits
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- MATCH STATE VERSION
-- ========================================

ALTER TABLE matches ADD COLUMN IF NOT EXISTS state_version INT DEFAULT 0;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS current_period_id UUID NULL;

CREATE INDEX IF NOT EXISTS idx_matches_state_version ON matches(id, state_version);

-- ========================================
-- ENHANCED SCORING EVENTS
-- ========================================

ALTER TABLE scoring_events ADD COLUMN IF NOT EXISTS period_type VARCHAR(50) NULL;
ALTER TABLE scoring_events ADD COLUMN IF NOT EXISTS original_event_id UUID NULL;
ALTER TABLE scoring_events ADD COLUMN IF NOT EXISTS is_compensation BOOLEAN DEFAULT FALSE;
ALTER TABLE scoring_events ADD COLUMN IF NOT EXISTS correction_reason VARCHAR(255) NULL;

CREATE INDEX IF NOT EXISTS idx_scoring_events_period_type ON scoring_events(match_id, period_type);
CREATE INDEX IF NOT EXISTS idx_scoring_events_compensation ON scoring_events(match_id, is_compensation);

-- ========================================
-- ENHANCED MATCH SNAPSHOTS
-- ========================================

ALTER TABLE match_snapshots ADD COLUMN IF NOT EXISTS period_type VARCHAR(50) NULL;
ALTER TABLE match_snapshots ADD COLUMN IF NOT EXISTS current_minute INT DEFAULT 0;
ALTER TABLE match_snapshots ADD COLUMN IF NOT EXISTS period_state JSONB NULL;

-- ========================================
-- SCORE AUDIT LOGS
-- ========================================

CREATE TABLE IF NOT EXISTS football_score_audit_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    action_type score_action_type NOT NULL,
    previous_score_home INT,
    previous_score_away INT,
    new_score_home INT,
    new_score_away INT,
    event_id UUID REFERENCES scoring_events(id),
    user_id UUID REFERENCES users(id),
    reason TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_football_score_audit_match ON football_score_audit_logs(match_id);
CREATE INDEX idx_football_score_audit_event ON football_score_audit_logs(event_id);
CREATE INDEX idx_football_score_audit_user ON football_score_audit_logs(user_id);
CREATE INDEX idx_football_score_audit_created ON football_score_audit_logs(created_at);
CREATE INDEX idx_football_score_audit_metadata ON football_score_audit_logs USING GIN(metadata);
