-- KhelSetu Cricket Scoring Engine - Production Grade
-- PostgreSQL 14+ (Neon)
-- Version: 2.0.0

-- ========================================
-- ENUM TYPES
-- ========================================

CREATE TYPE innings_status AS ENUM ('pending', 'in_progress', 'completed', 'abandoned', 'forfeited', 'super_over');
CREATE TYPE innings_type AS ENUM ('first', 'second', 'third', 'fourth', 'super_over', 'super_super_over');
CREATE TYPE cricket_delivery_type AS ENUM ('legal', 'no_ball', 'wide');
CREATE TYPE cricket_wicket_type AS ENUM ('none', 'bowled', 'caught', 'caught_behind', 'lbw', 'stumped', 'run_out', 'hit_wicket', 'obstructing_field', 'timed_out', 'retired_hurt', 'retired_out', 'handled_ball');
CREATE TYPE cricket_powerplay_type AS ENUM ('mandatory', 'strategic', 'non_powerplay');
CREATE TYPE cricket_runs_from_delivery AS ENUM ('dot', 'single', 'double', 'triple', 'four', 'six', 'boundary_four', 'boundary_six');
CREATE TYPE cricket_striker_end AS ENUM ('pitch', 'non_pitch');
CREATE TYPE cricket_pp_format AS ENUM ('T20', 'ODI', 'TEST');
CREATE TYPE cricket_pp_type AS ENUM ('mandatory', 'strategic');

-- ========================================
-- CRICKET INNINGS
-- ========================================

CREATE TABLE IF NOT EXISTS cricket_innings (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    innings_number INT NOT NULL DEFAULT 1,
    batting_team_id UUID NOT NULL REFERENCES teams(id),
    bowling_team_id UUID NOT NULL REFERENCES teams(id),
    status innings_status DEFAULT 'pending',
    innings_type innings_type DEFAULT 'first',
    total_runs INT DEFAULT 0 CHECK (total_runs >= 0),
    wickets_fallen INT DEFAULT 0 CHECK (wickets_fallen >= 0),
    overs_bowled DECIMAL(6,1) DEFAULT 0.0 CHECK (overs_bowled >= 0),
    balls_bowled INT DEFAULT 0 CHECK (balls_bowled >= 0),
    target_runs INT,
    required_run_rate DECIMAL(6,2) DEFAULT 0.00,
    current_run_rate DECIMAL(6,2) DEFAULT 0.00,
    is_declared BOOLEAN DEFAULT FALSE,
    is_follow_on BOOLEAN DEFAULT FALSE,
    dls_target_runs INT,
    dls_overs_remaining DECIMAL(6,1),
    rain_interruption BOOLEAN DEFAULT FALSE,
    powerplay_overs DECIMAL(6,1) DEFAULT 0.0,
    powerplay_runs INT DEFAULT 0,
    powerplay_wickets INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ NULL,
    PRIMARY KEY (id)
);

CREATE INDEX idx_cricket_innings_match ON cricket_innings(match_id);
CREATE INDEX idx_cricket_innings_status ON cricket_innings(status);
CREATE INDEX idx_cricket_innings_number ON cricket_innings(innings_number);

CREATE TRIGGER trg_cricket_innings_updated_at
    BEFORE UPDATE ON cricket_innings
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- CRICKET DELIVERIES (Immutable Events)
-- ========================================

CREATE TABLE IF NOT EXISTS cricket_deliveries (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    innings_id UUID REFERENCES cricket_innings(id),
    sequence_number INT NOT NULL,
    over_number INT NOT NULL,
    ball_in_over INT NOT NULL,
    delivery_type cricket_delivery_type NOT NULL DEFAULT 'legal',
    batter_runs INT DEFAULT 0,
    extra_runs INT DEFAULT 0,
    overthrow_runs INT DEFAULT 0,
    bye_runs INT DEFAULT 0,
    leg_bye_runs INT DEFAULT 0,
    penalty_runs INT DEFAULT 0,
    total_runs INT DEFAULT 0,
    wicket BOOLEAN DEFAULT FALSE,
    wicket_type cricket_wicket_type DEFAULT 'none',
    wicket_detail VARCHAR(255),
    bowler_id UUID REFERENCES players(id),
    striker_id UUID REFERENCES players(id),
    non_striker_id UUID REFERENCES players(id),
    fielder_id UUID REFERENCES players(id),
    striker_end cricket_striker_end DEFAULT 'pitch',
    strike_rotated BOOLEAN DEFAULT FALSE,
    is_no_ball BOOLEAN DEFAULT FALSE,
    is_wide BOOLEAN DEFAULT FALSE,
    is_bye BOOLEAN DEFAULT FALSE,
    is_leg_bye BOOLEAN DEFAULT FALSE,
    is_free_hit BOOLEAN DEFAULT FALSE,
    is_overthrow BOOLEAN DEFAULT FALSE,
    is_powerplay BOOLEAN DEFAULT FALSE,
    powerplay_type cricket_powerplay_type DEFAULT 'non_powerplay',
    runs_from_delivery cricket_runs_from_delivery DEFAULT 'dot',
    is_valid BOOLEAN DEFAULT TRUE,
    validation_notes VARCHAR(500),
    is_corrected BOOLEAN DEFAULT FALSE,
    correction_of UUID REFERENCES cricket_deliveries(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_reversed BOOLEAN DEFAULT FALSE,
    reversed_at TIMESTAMPTZ NULL,
    reversed_by UUID REFERENCES users(id),
    reversal_reason VARCHAR(255),
    PRIMARY KEY (id)
);

CREATE INDEX idx_cricket_deliveries_match ON cricket_deliveries(match_id);
CREATE INDEX idx_cricket_deliveries_innings ON cricket_deliveries(innings_id);
CREATE INDEX idx_cricket_deliveries_sequence ON cricket_deliveries(sequence_number);
CREATE INDEX idx_cricket_deliveries_over ON cricket_deliveries(over_number, ball_in_over);
CREATE INDEX idx_cricket_deliveries_bowler ON cricket_deliveries(bowler_id);
CREATE INDEX idx_cricket_deliveries_striker ON cricket_deliveries(striker_id);
CREATE INDEX idx_cricket_deliveries_reversed ON cricket_deliveries(is_reversed);

-- ========================================
-- CRICKET PARTNERSHIPS
-- ========================================

CREATE TABLE IF NOT EXISTS cricket_partnerships (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    innings_id UUID NOT NULL REFERENCES cricket_innings(id) ON DELETE CASCADE,
    batsman1_id UUID NOT NULL REFERENCES players(id),
    batsman2_id UUID NOT NULL REFERENCES players(id),
    runs INT DEFAULT 0,
    balls INT DEFAULT 0,
    fours INT DEFAULT 0,
    sixes INT DEFAULT 0,
    minutes INT,
    wicket_ball_id UUID REFERENCES cricket_deliveries(id),
    is_current BOOLEAN DEFAULT FALSE,
    is_broken BOOLEAN DEFAULT FALSE,
    broken_by VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_cricket_partnerships_match ON cricket_partnerships(match_id);
CREATE INDEX idx_cricket_partnerships_innings ON cricket_partnerships(innings_id);
CREATE INDEX idx_cricket_partnerships_batsman1 ON cricket_partnerships(batsman1_id);
CREATE INDEX idx_cricket_partnerships_batsman2 ON cricket_partnerships(batsman2_id);
CREATE INDEX idx_cricket_partnerships_current ON cricket_partnerships(is_current);

CREATE TRIGGER trg_cricket_partnerships_updated_at
    BEFORE UPDATE ON cricket_partnerships
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- CRICKET BOWLER STATISTICS
-- ========================================

CREATE TABLE IF NOT EXISTS cricket_bowler_stats (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    innings_id UUID NOT NULL REFERENCES cricket_innings(id) ON DELETE CASCADE,
    bowler_id UUID NOT NULL REFERENCES players(id),
    overs_bowled DECIMAL(6,1) DEFAULT 0.0,
    legal_balls INT DEFAULT 0,
    maidens INT DEFAULT 0,
    runs_conceded INT DEFAULT 0,
    wickets INT DEFAULT 0,
    no_balls INT DEFAULT 0,
    wides INT DEFAULT 0,
    spell_number INT DEFAULT 1,
    spell_start_over INT,
    spell_end_over INT,
    dot_balls INT DEFAULT 0,
    boundary_fours INT DEFAULT 0,
    boundary_sixes INT DEFAULT 0,
    economy_rate DECIMAL(6,2) DEFAULT 0.00,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE (bowler_id, innings_id)
);

CREATE INDEX idx_cricket_bowler_match ON cricket_bowler_stats(match_id);
CREATE INDEX idx_cricket_bowler_bowler ON cricket_bowler_stats(bowler_id);

CREATE TRIGGER trg_cricket_bowler_stats_updated_at
    BEFORE UPDATE ON cricket_bowler_stats
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- CRICKET BATTER STATISTICS
-- ========================================

CREATE TABLE IF NOT EXISTS cricket_batter_stats (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    innings_id UUID NOT NULL REFERENCES cricket_innings(id) ON DELETE CASCADE,
    batter_id UUID NOT NULL REFERENCES players(id),
    runs INT DEFAULT 0,
    balls_faced INT DEFAULT 0,
    fours INT DEFAULT 0,
    sixes INT DEFAULT 0,
    minutes INT,
    dismissal_type VARCHAR(50),
    dismissal_bowler_id UUID REFERENCES players(id),
    dismissal_fielder_id UUID REFERENCES players(id),
    dismissal_comment VARCHAR(255),
    strike_rate DECIMAL(6,2) DEFAULT 0.00,
    is_not_out BOOLEAN DEFAULT FALSE,
    is_on_strike BOOLEAN DEFAULT FALSE,
    is_retired_hurt BOOLEAN DEFAULT FALSE,
    has_retired INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE (batter_id, innings_id)
);

CREATE INDEX idx_cricket_batter_match ON cricket_batter_stats(match_id);
CREATE INDEX idx_cricket_batter_batter ON cricket_batter_stats(batter_id);

CREATE TRIGGER trg_cricket_batter_stats_updated_at
    BEFORE UPDATE ON cricket_batter_stats
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- CRICKET BALL-BY-BALL SNAPSHOTS
-- ========================================

CREATE TABLE IF NOT EXISTS cricket_match_snapshots (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    sequence_number INT NOT NULL,
    innings_number INT,
    over_number INT,
    ball_in_over INT,
    total_runs INT DEFAULT 0,
    wickets_fallen INT DEFAULT 0,
    overs_completed DECIMAL(6,1) DEFAULT 0.0,
    striker_id UUID REFERENCES players(id),
    non_striker_id UUID REFERENCES players(id),
    bowler_id UUID REFERENCES players(id),
    striker_runs INT DEFAULT 0,
    striker_balls INT DEFAULT 0,
    non_striker_runs INT DEFAULT 0,
    non_striker_balls INT DEFAULT 0,
    partnership_runs INT DEFAULT 0,
    partnership_balls INT DEFAULT 0,
    required_run_rate DECIMAL(6,2) DEFAULT 0.00,
    snapshot_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_cricket_snapshots_match_seq ON cricket_match_snapshots(match_id, sequence_number);
CREATE INDEX idx_cricket_snapshots_match ON cricket_match_snapshots(match_id);
CREATE INDEX idx_cricket_snapshots_data ON cricket_match_snapshots USING GIN(snapshot_data);

-- ========================================
-- CRICKET DLS CALCULATIONS
-- ========================================

CREATE TABLE IF NOT EXISTS cricket_dls_schedules (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    overs_remaining DECIMAL(6,1) NOT NULL,
    resource_percentage DECIMAL(6,2) NOT NULL CHECK (resource_percentage BETWEEN 0 AND 100),
    PRIMARY KEY (id)
);

CREATE INDEX idx_cricket_dls_overs ON cricket_dls_schedules(overs_remaining);

-- Seed DLS resource table
INSERT INTO cricket_dls_schedules (id, overs_remaining, resource_percentage) VALUES
(gen_random_uuid(), 50.0, 100.00), (gen_random_uuid(), 49.5, 99.21), (gen_random_uuid(), 49.0, 98.41), (gen_random_uuid(), 48.5, 97.60), (gen_random_uuid(), 48.0, 96.78),
(gen_random_uuid(), 47.5, 95.96), (gen_random_uuid(), 47.0, 95.13), (gen_random_uuid(), 46.5, 94.29), (gen_random_uuid(), 46.0, 93.44), (gen_random_uuid(), 45.5, 92.58),
(gen_random_uuid(), 45.0, 91.71), (gen_random_uuid(), 44.5, 90.84), (gen_random_uuid(), 44.0, 89.95), (gen_random_uuid(), 43.5, 89.06), (gen_random_uuid(), 43.0, 88.16),
(gen_random_uuid(), 42.5, 87.25), (gen_random_uuid(), 42.0, 86.33), (gen_random_uuid(), 41.5, 85.40), (gen_random_uuid(), 41.0, 84.46), (gen_random_uuid(), 40.5, 83.51),
(gen_random_uuid(), 40.0, 82.55), (gen_random_uuid(), 39.5, 81.58), (gen_random_uuid(), 39.0, 80.60), (gen_random_uuid(), 38.5, 79.61), (gen_random_uuid(), 38.0, 78.60),
(gen_random_uuid(), 37.5, 77.59), (gen_random_uuid(), 37.0, 76.56), (gen_random_uuid(), 36.5, 75.52), (gen_random_uuid(), 36.0, 74.47), (gen_random_uuid(), 35.5, 73.41),
(gen_random_uuid(), 35.0, 72.33), (gen_random_uuid(), 34.5, 71.24), (gen_random_uuid(), 34.0, 70.14), (gen_random_uuid(), 33.5, 69.03), (gen_random_uuid(), 33.0, 67.91),
(gen_random_uuid(), 32.5, 66.77), (gen_random_uuid(), 32.0, 65.62), (gen_random_uuid(), 31.5, 64.46), (gen_random_uuid(), 31.0, 63.28), (gen_random_uuid(), 30.5, 62.09),
(gen_random_uuid(), 30.0, 60.89), (gen_random_uuid(), 29.5, 59.68), (gen_random_uuid(), 29.0, 58.45), (gen_random_uuid(), 28.5, 57.21), (gen_random_uuid(), 28.0, 55.96),
(gen_random_uuid(), 27.5, 54.70), (gen_random_uuid(), 27.0, 53.43), (gen_random_uuid(), 26.5, 52.14), (gen_random_uuid(), 26.0, 50.84), (gen_random_uuid(), 25.5, 49.53),
(gen_random_uuid(), 25.0, 48.20), (gen_random_uuid(), 24.5, 46.87), (gen_random_uuid(), 24.0, 45.52), (gen_random_uuid(), 23.5, 44.17), (gen_random_uuid(), 23.0, 42.80),
(gen_random_uuid(), 22.5, 41.42), (gen_random_uuid(), 22.0, 40.03), (gen_random_uuid(), 21.5, 38.63), (gen_random_uuid(), 21.0, 37.22), (gen_random_uuid(), 20.5, 35.80),
(gen_random_uuid(), 20.0, 34.37), (gen_random_uuid(), 19.5, 32.93), (gen_random_uuid(), 19.0, 31.48), (gen_random_uuid(), 18.5, 30.03), (gen_random_uuid(), 18.0, 28.57),
(gen_random_uuid(), 17.5, 27.11), (gen_random_uuid(), 17.0, 25.64), (gen_random_uuid(), 16.5, 24.17), (gen_random_uuid(), 16.0, 22.70), (gen_random_uuid(), 15.5, 21.23),
(gen_random_uuid(), 15.0, 19.75), (gen_random_uuid(), 14.5, 18.28), (gen_random_uuid(), 14.0, 16.81), (gen_random_uuid(), 13.5, 15.34), (gen_random_uuid(), 13.0, 13.88),
(gen_random_uuid(), 12.5, 12.42), (gen_random_uuid(), 12.0, 10.97), (gen_random_uuid(), 11.5, 9.53), (gen_random_uuid(), 11.0, 8.11), (gen_random_uuid(), 10.5, 6.70),
(gen_random_uuid(), 10.0, 5.31), (gen_random_uuid(), 9.5, 3.94), (gen_random_uuid(), 9.0, 2.60), (gen_random_uuid(), 8.5, 1.29), (gen_random_uuid(), 8.0, 0.00);

-- ========================================
-- CRICKET POWERPLAY CONFIGURATION
-- ========================================

CREATE TABLE IF NOT EXISTS cricket_powerplay_configs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    format cricket_pp_format NOT NULL,
    powerplay_type cricket_pp_type NOT NULL,
    start_over INT NOT NULL,
    end_over INT NOT NULL,
    PRIMARY KEY (id)
);

CREATE INDEX idx_cricket_pp_format ON cricket_powerplay_configs(format);

INSERT INTO cricket_powerplay_configs (id, format, powerplay_type, start_over, end_over) VALUES
(gen_random_uuid(), 'T20', 'mandatory', 1, 6),
(gen_random_uuid(), 'ODI', 'mandatory', 1, 10),
(gen_random_uuid(), 'ODI', 'strategic', 11, 40),
(gen_random_uuid(), 'TEST', 'mandatory', 1, 15),
(gen_random_uuid(), 'TEST', 'strategic', 16, 80);
