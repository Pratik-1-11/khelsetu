-- KhelSetu Database Schema - Football Phase 2: VAR & Penalty Shootout
-- PostgreSQL 14+ (Neon)
-- Version: 1.0.0
-- Phase 2: VAR Workflow, Penalty Shootout, Event Corrections

-- ========================================
-- ENUM TYPES
-- ========================================

CREATE TYPE var_review_type AS ENUM ('goal', 'penalty', 'red_card', 'goal_denial', 'other');
CREATE TYPE var_review_status AS ENUM ('pending', 'check_initiated', 'in_progress', 'decision_pending', 'completed');
CREATE TYPE var_final_decision AS ENUM ('confirmed', 'overturned', 'changed_to_penalty', 'changed_to_free_kick', 'no_goal', 'no_penalty', 'no_red_card');
CREATE TYPE penalty_result AS ENUM ('scored', 'missed', 'saved', 'post', 'blocked', 'neutral_miss');
CREATE TYPE penalty_shootout_status AS ENUM ('pending', 'in_progress', 'completed', 'abandoned');
CREATE TYPE correction_type AS ENUM ('undo', 'edit', 'compensation', 'var_reversal');
CREATE TYPE eligibility_status AS ENUM ('eligible', 'ineligible', 'suspended', 'pending');

-- ========================================
-- VAR REVIEWS
-- ========================================

CREATE TABLE IF NOT EXISTS football_var_reviews (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    review_type var_review_type NOT NULL,
    status var_review_status DEFAULT 'pending',
    original_event_id UUID REFERENCES scoring_events(id) ON DELETE SET NULL,
    original_event_type VARCHAR(50),
    original_decision VARCHAR(100),
    final_decision var_final_decision NULL,
    var_reason TEXT,
    check_initiated_at TIMESTAMPTZ NULL,
    decision_made_at TIMESTAMPTZ NULL,
    check_duration_seconds INT,
    metadata JSONB,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_football_var_match ON football_var_reviews(match_id);
CREATE INDEX idx_football_var_status ON football_var_reviews(status);
CREATE INDEX idx_football_var_event ON football_var_reviews(original_event_id);
CREATE INDEX idx_football_var_created ON football_var_reviews(created_at);
CREATE INDEX idx_football_var_metadata ON football_var_reviews USING GIN(metadata);

CREATE TRIGGER trg_football_var_reviews_updated_at
    BEFORE UPDATE ON football_var_reviews
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- PENALTY SHOOTOUTS
-- ========================================

CREATE TABLE IF NOT EXISTS football_penalty_shootouts (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    status penalty_shootout_status DEFAULT 'pending',
    round_number INT DEFAULT 1,
    current_kick_team UUID REFERENCES teams(id),
    current_kick_order INT DEFAULT 1,
    is_sudden_death BOOLEAN DEFAULT FALSE,
    home_score INT DEFAULT 0 CHECK (home_score >= 0),
    away_score INT DEFAULT 0 CHECK (away_score >= 0),
    home_kicks_taken INT DEFAULT 0 CHECK (home_kicks_taken >= 0),
    away_kicks_taken INT DEFAULT 0 CHECK (away_kicks_taken >= 0),
    winner_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    completed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    version INT DEFAULT 1,
    PRIMARY KEY (id),
    UNIQUE (match_id)
);

CREATE INDEX idx_football_shootout_match_status ON football_penalty_shootouts(match_id, status);
CREATE INDEX idx_football_shootout_round ON football_penalty_shootouts(match_id, round_number);

CREATE TRIGGER trg_football_penalty_shootouts_updated_at
    BEFORE UPDATE ON football_penalty_shootouts
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- PENALTY KICKS
-- ========================================

CREATE TABLE IF NOT EXISTS football_penalty_kicks (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    shootout_id UUID NOT NULL REFERENCES football_penalty_shootouts(id) ON DELETE CASCADE,
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    kicker_player_id UUID NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
    goalkeeper_player_id UUID REFERENCES players(id) ON DELETE SET NULL,
    kick_number INT NOT NULL,
    round_number INT NOT NULL,
    result penalty_result NOT NULL,
    kick_direction VARCHAR(20),
    kick_timestamp TIMESTAMPTZ DEFAULT NOW(),
    is_sudden_death BOOLEAN DEFAULT FALSE,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_football_pk_shootout ON football_penalty_kicks(shootout_id);
CREATE INDEX idx_football_pk_match_team ON football_penalty_kicks(match_id, team_id);
CREATE INDEX idx_football_pk_round ON football_penalty_kicks(shootout_id, round_number, kick_number);
CREATE INDEX idx_football_pk_metadata ON football_penalty_kicks USING GIN(metadata);

-- ========================================
-- PENALTY KICK ORDER
-- ========================================

CREATE TABLE IF NOT EXISTS football_penalty_kick_orders (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    shootout_id UUID NOT NULL REFERENCES football_penalty_shootouts(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    kick_order INT NOT NULL,
    is_kicked BOOLEAN DEFAULT FALSE,
    was_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE (shootout_id, team_id, kick_order)
);

CREATE INDEX idx_football_pk_order_team ON football_penalty_kick_orders(shootout_id, team_id);

-- ========================================
-- EVENT CORRECTIONS
-- ========================================

CREATE TABLE IF NOT EXISTS football_event_corrections (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    original_event_id UUID NOT NULL REFERENCES scoring_events(id) ON DELETE CASCADE,
    correction_type correction_type NOT NULL,
    previous_value JSONB,
    new_value JSONB,
    reason VARCHAR(255) NOT NULL,
    justification TEXT,
    var_review_id UUID REFERENCES football_var_reviews(id) ON DELETE SET NULL,
    corrected_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    corrected_at TIMESTAMPTZ DEFAULT NOW(),
    is_undone BOOLEAN DEFAULT FALSE,
    undone_by UUID REFERENCES users(id),
    undone_at TIMESTAMPTZ NULL,
    PRIMARY KEY (id)
);

CREATE INDEX idx_football_corrections_match ON football_event_corrections(match_id);
CREATE INDEX idx_football_corrections_event ON football_event_corrections(original_event_id);
CREATE INDEX idx_football_corrections_by ON football_event_corrections(corrected_by);
CREATE INDEX idx_football_corrections_at ON football_event_corrections(corrected_at);
CREATE INDEX idx_football_corrections_prev ON football_event_corrections USING GIN(previous_value);
CREATE INDEX idx_football_corrections_new ON football_event_corrections USING GIN(new_value);

-- ========================================
-- PLAYER ELIGIBILITY
-- ========================================

CREATE TABLE IF NOT EXISTS football_player_eligibility (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    eligibility_status eligibility_status DEFAULT 'eligible',
    is_in_squad BOOLEAN DEFAULT FALSE,
    is_starting BOOLEAN DEFAULT FALSE,
    is_on_bench BOOLEAN DEFAULT FALSE,
    suspension_reason VARCHAR(255),
    suspension_until TIMESTAMPTZ NULL,
    checked_at TIMESTAMPTZ DEFAULT NOW(),
    checked_by UUID REFERENCES users(id),
    PRIMARY KEY (id),
    UNIQUE (match_id, player_id)
);

CREATE INDEX idx_football_eligibility_match_team ON football_player_eligibility(match_id, team_id);
CREATE INDEX idx_football_eligibility_status ON football_player_eligibility(match_id, eligibility_status);

-- ========================================
-- ENHANCED MATCH STATUS
-- ========================================

ALTER TABLE matches ADD COLUMN IF NOT EXISTS is_knockout BOOLEAN DEFAULT FALSE;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS agg_home_score INT DEFAULT NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS agg_away_score INT DEFAULT NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS agg_winner_id UUID DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_matches_knockout ON matches(tournament_id, is_knockout, status);
