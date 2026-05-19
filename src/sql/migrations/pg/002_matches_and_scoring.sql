-- KhelSetu Database Schema - Matches and Scoring
-- PostgreSQL 14+ (Neon)
-- Version: 1.0.0

-- ========================================
-- ENUM TYPES
-- ========================================

CREATE TYPE match_status AS ENUM ('scheduled', 'live', 'completed', 'cancelled', 'postponed', 'abandoned', 'suspended');
CREATE TYPE fixture_status AS ENUM ('pending', 'scheduled', 'completed', 'bye');

-- ========================================
-- MATCHES (organization-scoped)
-- ========================================

CREATE TABLE IF NOT EXISTS matches (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    home_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    away_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    match_number INT,
    round_number INT,
    group_name VARCHAR(50),
    venue VARCHAR(255),
    scheduled_at TIMESTAMPTZ NULL,
    started_at TIMESTAMPTZ NULL,
    ended_at TIMESTAMPTZ NULL,
    status match_status DEFAULT 'scheduled',
    home_score INT DEFAULT 0 CHECK (home_score >= 0),
    away_score INT DEFAULT 0 CHECK (away_score >= 0),
    home_extra_time_score INT DEFAULT 0 CHECK (home_extra_time_score >= 0),
    away_extra_time_score INT DEFAULT 0 CHECK (away_extra_time_score >= 0),
    home_penalty_score INT DEFAULT 0 CHECK (home_penalty_score >= 0),
    away_penalty_score INT DEFAULT 0 CHECK (away_penalty_score >= 0),
    winner_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT NULL,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_matches_org ON matches(organization_id);
CREATE INDEX idx_matches_tournament ON matches(tournament_id);
CREATE INDEX idx_matches_teams ON matches(home_team_id, away_team_id);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_matches_scheduled ON matches(scheduled_at);
CREATE INDEX idx_matches_deleted ON matches(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_matches_tournament_status ON matches(tournament_id, status);
CREATE INDEX idx_matches_metadata ON matches USING GIN(metadata);

CREATE TRIGGER trg_matches_updated_at
    BEFORE UPDATE ON matches
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- Match officials (referees, umpires)
CREATE TABLE IF NOT EXISTS match_officials (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    role VARCHAR(50) NOT NULL,
    name VARCHAR(255),
    metadata JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_match_officials_match ON match_officials(match_id);
CREATE INDEX idx_match_officials_user ON match_officials(user_id);
CREATE INDEX idx_match_officials_deleted ON match_officials(deleted_at) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_match_officials_updated_at
    BEFORE UPDATE ON match_officials
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- EVENT-DRIVEN SCORING SYSTEM
-- ========================================

-- Scoring events (immutable event log)
CREATE TABLE IF NOT EXISTS scoring_events (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    client_event_id VARCHAR(100),
    event_type VARCHAR(50) NOT NULL,
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    player_id UUID REFERENCES players(id) ON DELETE SET NULL,
    minute INT,
    extra_minute INT,
    metadata JSONB DEFAULT NULL,
    is_reversed BOOLEAN DEFAULT FALSE,
    reversed_by UUID REFERENCES users(id),
    reversed_at TIMESTAMPTZ NULL,
    sequence_number BIGINT GENERATED ALWAYS AS IDENTITY,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    version INT DEFAULT 1,
    PRIMARY KEY (id),
    UNIQUE (client_event_id)
);

CREATE INDEX idx_scoring_events_match ON scoring_events(match_id);
CREATE INDEX idx_scoring_events_team ON scoring_events(team_id);
CREATE INDEX idx_scoring_events_player ON scoring_events(player_id);
CREATE INDEX idx_scoring_events_type ON scoring_events(event_type);
CREATE INDEX idx_scoring_events_sequence ON scoring_events(sequence_number);
CREATE INDEX idx_scoring_events_created ON scoring_events(created_at);
CREATE INDEX idx_scoring_events_metadata ON scoring_events USING GIN(metadata);

-- Score snapshots (computed from events)
CREATE TABLE IF NOT EXISTS match_snapshots (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    sequence_number BIGINT NOT NULL,
    home_score INT DEFAULT 0 CHECK (home_score >= 0),
    away_score INT DEFAULT 0 CHECK (away_score >= 0),
    home_extra_time_score INT DEFAULT 0 CHECK (home_extra_time_score >= 0),
    away_extra_time_score INT DEFAULT 0 CHECK (away_extra_time_score >= 0),
    home_penalty_score INT DEFAULT 0 CHECK (home_penalty_score >= 0),
    away_penalty_score INT DEFAULT 0 CHECK (away_penalty_score >= 0),
    event_count INT DEFAULT 0,
    snapshot_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_match_snapshots_match ON match_snapshots(match_id);
CREATE INDEX idx_match_snapshots_sequence ON match_snapshots(sequence_number);
CREATE INDEX idx_match_snapshots_data ON match_snapshots USING GIN(snapshot_data);

-- ========================================
-- STANDINGS
-- ========================================

CREATE TABLE IF NOT EXISTS standings (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    group_name VARCHAR(50),
    played INT DEFAULT 0 CHECK (played >= 0),
    won INT DEFAULT 0 CHECK (won >= 0),
    drawn INT DEFAULT 0 CHECK (drawn >= 0),
    lost INT DEFAULT 0 CHECK (lost >= 0),
    goals_for INT DEFAULT 0 CHECK (goals_for >= 0),
    goals_against INT DEFAULT 0 CHECK (goals_against >= 0),
    goal_difference INT,
    points INT DEFAULT 0 CHECK (points >= 0),
    position INT,
    metadata JSONB DEFAULT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    version INT DEFAULT 1,
    PRIMARY KEY (id),
    UNIQUE (tournament_id, team_id, group_name)
);

CREATE INDEX idx_standings_tournament ON standings(tournament_id);
CREATE INDEX idx_standings_team ON standings(team_id);
CREATE INDEX idx_standings_position ON standings(tournament_id, group_name, position);
CREATE INDEX idx_standings_points ON standings(tournament_id, group_name, points DESC);
CREATE INDEX idx_standings_metadata ON standings USING GIN(metadata);

CREATE TRIGGER trg_standings_updated_at
    BEFORE UPDATE ON standings
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- Historical standings snapshots
CREATE TABLE IF NOT EXISTS standings_snapshots (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    group_name VARCHAR(50),
    snapshot_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_standings_snapshots_tournament ON standings_snapshots(tournament_id);
CREATE INDEX idx_standings_snapshots_date ON standings_snapshots(created_at);
CREATE INDEX idx_standings_snapshots_data ON standings_snapshots USING GIN(snapshot_data);

-- ========================================
-- FIXTURES (Generated brackets/pairs)
-- ========================================

CREATE TABLE IF NOT EXISTS fixtures (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    round_number INT NOT NULL,
    match_id UUID REFERENCES matches(id) ON DELETE SET NULL,
    home_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    away_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    home_position INT,
    away_position INT,
    group_name VARCHAR(50),
    status fixture_status DEFAULT 'pending',
    metadata JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_fixtures_tournament ON fixtures(tournament_id);
CREATE INDEX idx_fixtures_round ON fixtures(round_number);
CREATE INDEX idx_fixtures_match ON fixtures(match_id);
CREATE INDEX idx_fixtures_status ON fixtures(status);
CREATE INDEX idx_fixtures_deleted ON fixtures(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_fixtures_metadata ON fixtures USING GIN(metadata);

CREATE TRIGGER trg_fixtures_updated_at
    BEFORE UPDATE ON fixtures
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
