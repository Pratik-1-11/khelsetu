-- KhelSetu Basketball Scoring Engine
-- PostgreSQL 14+ (Neon)
-- Version: 1.0.0

-- ========================================
-- ENUM TYPES
-- ========================================

CREATE TYPE shot_clock_event_type AS ENUM ('reset', 'violation', 'manual_stop', 'expired', 'start', 'pause');
CREATE TYPE basketball_foul_type AS ENUM ('personal', 'shooting', 'offensive', 'technical', 'flagrant_1', 'flagrant_2', 'unsportsmanlike', 'disqualifying');
CREATE TYPE basketball_bonus_status AS ENUM ('none', 'bonus', 'double_bonus');
CREATE TYPE basketball_shot_type AS ENUM ('and_one', 'technical', 'unsportsmanlike', 'flagrant', 'clear_path', 'bonus', 'three_point');
CREATE TYPE basketball_timeout_type AS ENUM ('full', 'short', 'official', 'injury');
CREATE TYPE basketball_jump_ball_type AS ENUM ('initial', 'tie_up', 'held_ball');

-- ========================================
-- POSSESSION TRACKING
-- ========================================

CREATE TABLE IF NOT EXISTS match_possession (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    current_possession_team_id UUID NOT NULL REFERENCES teams(id),
    possession_arrow_team_id UUID NOT NULL REFERENCES teams(id),
    last_possession_event_id UUID REFERENCES scoring_events(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_match_possession_match ON match_possession(match_id);

CREATE TRIGGER trg_match_possession_updated_at
    BEFORE UPDATE ON match_possession
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- SHOT CLOCK TRACKING
-- ========================================

CREATE TABLE IF NOT EXISTS shot_clock_events (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    event_type shot_clock_event_type NOT NULL,
    reset_reason VARCHAR(50),
    clock_value_before INT,
    clock_value_after INT,
    triggered_by_player_id UUID REFERENCES players(id),
    quarter INT NOT NULL CHECK (quarter BETWEEN 1 AND 5),
    game_minute INT NOT NULL,
    game_second INT NOT NULL,
    sequence_number BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_shot_clock_match ON shot_clock_events(match_id);
CREATE INDEX idx_shot_clock_sequence ON shot_clock_events(sequence_number);

-- ========================================
-- PLAYER FOUL TRACKING
-- ========================================

CREATE TABLE IF NOT EXISTS player_fouls (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    foul_type basketball_foul_type NOT NULL,
    quarter INT NOT NULL CHECK (quarter BETWEEN 1 AND 5),
    game_minute INT NOT NULL,
    game_second INT NOT NULL,
    metadata JSONB DEFAULT NULL,
    is_reversed BOOLEAN DEFAULT FALSE,
    original_foul_id UUID REFERENCES player_fouls(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_player_fouls_match_player ON player_fouls(match_id, player_id);
CREATE INDEX idx_player_fouls_team_quarter ON player_fouls(match_id, team_id, quarter);
CREATE INDEX idx_player_fouls_metadata ON player_fouls USING GIN(metadata);

-- ========================================
-- TEAM FOUL COUNTERS
-- ========================================

CREATE TABLE IF NOT EXISTS team_foul_counters (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    quarter_1_fouls INT DEFAULT 0,
    quarter_2_fouls INT DEFAULT 0,
    quarter_3_fouls INT DEFAULT 0,
    quarter_4_fouls INT DEFAULT 0,
    overtime_1_fouls INT DEFAULT 0,
    overtime_2_fouls INT DEFAULT 0,
    overtime_3_fouls INT DEFAULT 0,
    bonus_status basketball_bonus_status DEFAULT 'none',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE (match_id, team_id)
);

CREATE INDEX idx_team_foul_counters_match ON team_foul_counters(match_id);

CREATE TRIGGER trg_team_foul_counters_updated_at
    BEFORE UPDATE ON team_foul_counters
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- FREE THROW SEQUENCES
-- ========================================

CREATE TABLE IF NOT EXISTS free_throw_sequences (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    shooting_team_id UUID NOT NULL REFERENCES teams(id),
    shooting_player_id UUID NOT NULL REFERENCES players(id),
    fouled_player_id UUID REFERENCES players(id),
    shot_number INT NOT NULL,
    total_shots INT NOT NULL,
    shot_type basketball_shot_type NOT NULL,
    made BOOLEAN,
    quarter INT NOT NULL CHECK (quarter BETWEEN 1 AND 5),
    game_minute INT NOT NULL,
    game_second INT NOT NULL,
    sequence_number BIGINT,
    is_completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_free_throw_match ON free_throw_sequences(match_id);
CREATE INDEX idx_free_throw_shooting ON free_throw_sequences(match_id, shooting_team_id);

-- ========================================
-- TIMEOUT TRACKING
-- ========================================

CREATE TABLE IF NOT EXISTS timeout_events (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    timeout_type basketball_timeout_type NOT NULL,
    quarter INT NOT NULL CHECK (quarter BETWEEN 1 AND 5),
    minute INT NOT NULL,
    second INT NOT NULL,
    remaining_from_original INT NOT NULL,
    status VARCHAR(20) DEFAULT 'granted',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_timeout_match_team ON timeout_events(match_id, team_id);

-- ========================================
-- JUMP BALL TRACKING
-- ========================================

CREATE TABLE IF NOT EXISTS jump_ball_events (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    quarter INT NOT NULL CHECK (quarter BETWEEN 1 AND 5),
    minute INT NOT NULL,
    second INT NOT NULL,
    jump_ball_type basketball_jump_ball_type NOT NULL,
    team_1_id UUID REFERENCES teams(id),
    team_2_id UUID REFERENCES teams(id),
    winner_team_id UUID NOT NULL REFERENCES teams(id),
    sequence_number BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_jump_ball_match ON jump_ball_events(match_id);

-- ========================================
-- PLAYER MATCH STATISTICS (Basketball-specific, renamed to avoid collision)
-- ========================================

CREATE TABLE IF NOT EXISTS basketball_player_match_stats (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    minutes_played INT DEFAULT 0,
    points INT DEFAULT 0 CHECK (points >= 0),
    field_goals_made INT DEFAULT 0,
    field_goals_attempted INT DEFAULT 0,
    three_pointers_made INT DEFAULT 0,
    three_pointers_attempted INT DEFAULT 0,
    free_throws_made INT DEFAULT 0,
    free_throws_attempted INT DEFAULT 0,
    offensive_rebounds INT DEFAULT 0,
    defensive_rebounds INT DEFAULT 0,
    total_rebounds INT DEFAULT 0,
    assists INT DEFAULT 0,
    steals INT DEFAULT 0,
    blocks INT DEFAULT 0,
    turnovers INT DEFAULT 0,
    personal_fouls INT DEFAULT 0,
    technical_fouls INT DEFAULT 0,
    plus_minus INT DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE (match_id, player_id)
);

CREATE INDEX idx_bball_player_stats_match ON basketball_player_match_stats(match_id);

-- ========================================
-- TEAM MATCH STATISTICS (Basketball-specific, renamed to avoid collision)
-- ========================================

CREATE TABLE IF NOT EXISTS basketball_team_match_stats (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    points INT DEFAULT 0 CHECK (points >= 0),
    field_goals_made INT DEFAULT 0,
    field_goals_attempted INT DEFAULT 0,
    three_pointers_made INT DEFAULT 0,
    three_pointers_attempted INT DEFAULT 0,
    free_throws_made INT DEFAULT 0,
    free_throws_attempted INT DEFAULT 0,
    offensive_rebounds INT DEFAULT 0,
    defensive_rebounds INT DEFAULT 0,
    total_rebounds INT DEFAULT 0,
    assists INT DEFAULT 0,
    steals INT DEFAULT 0,
    blocks INT DEFAULT 0,
    turnovers INT DEFAULT 0,
    personal_fouls INT DEFAULT 0,
    technical_fouls INT DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE (match_id, team_id)
);

CREATE INDEX idx_bball_team_stats_match ON basketball_team_match_stats(match_id);

-- ========================================
-- CLOCK SYNCHRONIZATION LOG
-- ========================================

CREATE TABLE IF NOT EXISTS clock_sync_log (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    server_time BIGINT NOT NULL,
    client_time BIGINT NOT NULL,
    clock_drift_ms INT NOT NULL,
    event_type VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_clock_sync_match ON clock_sync_log(match_id);

-- ========================================
-- BASKETBALL-SPECIFIC MATCH COLUMNS
-- ========================================

ALTER TABLE matches ADD COLUMN IF NOT EXISTS current_possession_team_id UUID REFERENCES teams(id);
ALTER TABLE matches ADD COLUMN IF NOT EXISTS shot_clock_seconds INT DEFAULT 24;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS game_clock_seconds INT DEFAULT 720;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS current_quarter INT DEFAULT 1 CHECK (current_quarter BETWEEN 1 AND 5);
ALTER TABLE matches ADD COLUMN IF NOT EXISTS overtime_count INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_matches_quarter ON matches(current_quarter);
CREATE INDEX IF NOT EXISTS idx_matches_shot_clock ON matches(shot_clock_seconds);
