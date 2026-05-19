-- KhelSetu Cricket Scoring Engine - Enhanced Version 3.0
-- PostgreSQL 14+ (Neon)
-- Adds: DRS/Reviews, Enhanced DLS, Super Over, Analytics

-- ========================================
-- ENUM TYPES
-- ========================================

CREATE TYPE cricket_review_type AS ENUM ('lbw', 'caught', 'caught_behind', 'stumped', 'bowled', 'run_out', 'not_out');
CREATE TYPE cricket_review_decision AS ENUM ('not_out', 'out', 'withdrawn', 'lost');
CREATE TYPE cricket_super_over_status AS ENUM ('pending', 'in_progress', 'completed', 'abandoned');
CREATE TYPE cricket_match_phase AS ENUM ('powerplay', 'middle', 'death', 'overall');

-- ========================================
-- CRICKET DLS WITH WICKETS (DLS-S)
-- ========================================

CREATE TABLE IF NOT EXISTS cricket_dls_wicket_resources (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    overs_remaining DECIMAL(6,1) NOT NULL,
    wickets_lost INT NOT NULL,
    resource_percentage DECIMAL(6,2) NOT NULL CHECK (resource_percentage BETWEEN 0 AND 100),
    PRIMARY KEY (id)
);

CREATE INDEX idx_cricket_dls_wkt_overs ON cricket_dls_wicket_resources(overs_remaining, wickets_lost);

INSERT INTO cricket_dls_wicket_resources (id, overs_remaining, wickets_lost, resource_percentage) VALUES
(gen_random_uuid(), 20.0, 0, 100.00), (gen_random_uuid(), 20.0, 1, 93.54), (gen_random_uuid(), 20.0, 2, 86.15), (gen_random_uuid(), 20.0, 3, 77.80), (gen_random_uuid(), 20.0, 4, 68.48), (gen_random_uuid(), 20.0, 5, 58.21), (gen_random_uuid(), 20.0, 6, 47.00), (gen_random_uuid(), 20.0, 7, 34.88), (gen_random_uuid(), 20.0, 8, 21.89), (gen_random_uuid(), 20.0, 9, 8.21), (gen_random_uuid(), 20.0, 10, 0.00),
(gen_random_uuid(), 15.0, 0, 74.58), (gen_random_uuid(), 15.0, 1, 68.21), (gen_random_uuid(), 15.0, 2, 61.19), (gen_random_uuid(), 15.0, 3, 53.52), (gen_random_uuid(), 15.0, 4, 45.21), (gen_random_uuid(), 15.0, 5, 36.31), (gen_random_uuid(), 15.0, 6, 26.86), (gen_random_uuid(), 15.0, 7, 16.91), (gen_random_uuid(), 15.0, 8, 6.51), (gen_random_uuid(), 15.0, 9, 0.00), (gen_random_uuid(), 15.0, 10, 0.00),
(gen_random_uuid(), 10.0, 0, 47.53), (gen_random_uuid(), 10.0, 1, 42.35), (gen_random_uuid(), 10.0, 2, 36.74), (gen_random_uuid(), 10.0, 3, 30.70), (gen_random_uuid(), 10.0, 4, 24.24), (gen_random_uuid(), 10.0, 5, 17.38), (gen_random_uuid(), 10.0, 6, 10.14), (gen_random_uuid(), 10.0, 7, 2.55), (gen_random_uuid(), 10.0, 8, 0.00), (gen_random_uuid(), 10.0, 9, 0.00), (gen_random_uuid(), 10.0, 10, 0.00),
(gen_random_uuid(), 5.0, 0, 21.27), (gen_random_uuid(), 5.0, 1, 18.15), (gen_random_uuid(), 5.0, 2, 14.85), (gen_random_uuid(), 5.0, 3, 11.37), (gen_random_uuid(), 5.0, 4, 7.72), (gen_random_uuid(), 5.0, 5, 3.90), (gen_random_uuid(), 5.0, 6, 0.00), (gen_random_uuid(), 5.0, 7, 0.00), (gen_random_uuid(), 5.0, 8, 0.00), (gen_random_uuid(), 5.0, 9, 0.00), (gen_random_uuid(), 5.0, 10, 0.00),
(gen_random_uuid(), 50.0, 0, 100.00), (gen_random_uuid(), 50.0, 1, 96.15), (gen_random_uuid(), 50.0, 2, 91.71), (gen_random_uuid(), 50.0, 3, 86.71), (gen_random_uuid(), 50.0, 4, 81.15), (gen_random_uuid(), 50.0, 5, 75.04), (gen_random_uuid(), 50.0, 6, 68.40), (gen_random_uuid(), 50.0, 7, 61.24), (gen_random_uuid(), 50.0, 8, 53.58), (gen_random_uuid(), 50.0, 9, 45.44), (gen_random_uuid(), 50.0, 10, 36.83);

-- ========================================
-- CRICKET PLAYER REVIEWS (DRS)
-- ========================================

CREATE TABLE IF NOT EXISTS cricket_player_reviews (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    innings_number INT NOT NULL,
    review_type cricket_review_type DEFAULT 'lbw',
    decision_original cricket_review_decision NOT NULL,
    decision_final cricket_review_decision DEFAULT 'not_out',
    batter_id UUID REFERENCES players(id),
    bowler_id UUID REFERENCES players(id),
    fielder_id UUID REFERENCES players(id),
    on_field_umpire_id UUID REFERENCES users(id),
    ball_sequence_number INT,
    over_number INT,
    ball_in_over INT,
    is_umpire_call BOOLEAN DEFAULT FALSE,
    is_wicket BOOLEAN DEFAULT FALSE,
    result_comment VARCHAR(255),
    requested_by UUID REFERENCES users(id),
    decided_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_cricket_reviews_match ON cricket_player_reviews(match_id);
CREATE INDEX idx_cricket_reviews_team ON cricket_player_reviews(match_id, team_id);
CREATE INDEX idx_cricket_reviews_innings ON cricket_player_reviews(innings_number);

-- ========================================
-- CRICKET MATCH REVIEWS CONFIG
-- ========================================

CREATE TABLE IF NOT EXISTS cricket_review_configs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team1_reviews_remaining INT DEFAULT 1,
    team2_reviews_remaining INT DEFAULT 1,
    max_reviews_per_innings INT DEFAULT 1,
    lost_on_mistake BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE (match_id)
);

-- ========================================
-- CRICKET SUPER OVERS
-- ========================================

CREATE TABLE IF NOT EXISTS cricket_super_overs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    super_over_number INT NOT NULL,
    team1_id UUID REFERENCES teams(id),
    team2_id UUID REFERENCES teams(id),
    team1_runs INT DEFAULT 0,
    team1_wickets INT DEFAULT 0,
    team1_balls_bowled INT DEFAULT 0,
    team2_runs INT DEFAULT 0,
    team2_wickets INT DEFAULT 0,
    team2_balls_bowled INT DEFAULT 0,
    winner_team_id UUID REFERENCES teams(id),
    status cricket_super_over_status DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ NULL,
    PRIMARY KEY (id)
);

CREATE INDEX idx_cricket_super_overs_match ON cricket_super_overs(match_id);

CREATE TABLE IF NOT EXISTS cricket_super_over_deliveries (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    super_over_id UUID NOT NULL REFERENCES cricket_super_overs(id) ON DELETE CASCADE,
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    batting_team_id UUID NOT NULL REFERENCES teams(id),
    sequence_number INT NOT NULL,
    delivery_type cricket_delivery_type DEFAULT 'legal',
    batter_runs INT DEFAULT 0,
    extra_runs INT DEFAULT 0,
    total_runs INT DEFAULT 0,
    wicket BOOLEAN DEFAULT FALSE,
    wicket_type cricket_wicket_type,
    bowler_id UUID REFERENCES players(id),
    striker_id UUID REFERENCES players(id),
    non_striker_id UUID REFERENCES players(id),
    is_powerplay BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_cricket_so_deliveries_super ON cricket_super_over_deliveries(super_over_id);

-- ========================================
-- CRICKET ENHANCED ANALYTICS
-- ========================================

CREATE TABLE IF NOT EXISTS cricket_match_analytics (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    innings_number INT NOT NULL,
    over_start INT NOT NULL,
    over_end INT NOT NULL,
    phase_type cricket_match_phase NOT NULL,
    runs_scored INT DEFAULT 0,
    balls_faced INT DEFAULT 0,
    wickets_lost INT DEFAULT 0,
    boundaries INT DEFAULT 0,
    sixes INT DEFAULT 0,
    dot_balls INT DEFAULT 0,
    run_rate DECIMAL(6,2),
    boundary_percentage DECIMAL(6,2),
    dot_ball_percentage DECIMAL(6,2),
    momentum_score DECIMAL(6,2),
    pressure_index DECIMAL(6,2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_cricket_analytics_match ON cricket_match_analytics(match_id, innings_number);
CREATE INDEX idx_cricket_analytics_phase ON cricket_match_analytics(match_id, phase_type);

-- ========================================
-- CRICKET FALLOW OVER TRACKING
-- ========================================

CREATE TABLE IF NOT EXISTS cricket_fallow_overs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    innings_id UUID NOT NULL REFERENCES cricket_innings(id) ON DELETE CASCADE,
    over_number INT NOT NULL,
    bowler_id UUID REFERENCES players(id),
    runs_conceded INT DEFAULT 0,
    wickets_taken INT DEFAULT 0,
    is_maiden BOOLEAN DEFAULT FALSE,
    is_wicket_maiden BOOLEAN DEFAULT FALSE,
    ball_1_runs INT, ball_1_type VARCHAR(20),
    ball_2_runs INT, ball_2_type VARCHAR(20),
    ball_3_runs INT, ball_3_type VARCHAR(20),
    ball_4_runs INT, ball_4_type VARCHAR(20),
    ball_5_runs INT, ball_5_type VARCHAR(20),
    ball_6_runs INT, ball_6_type VARCHAR(20),
    no_balls INT DEFAULT 0,
    wides INT DEFAULT 0,
    byes INT DEFAULT 0,
    leg_byes INT DEFAULT 0,
    penalty_runs INT DEFAULT 0,
    overthrow_runs INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_cricket_fallow_innings ON cricket_fallow_overs(innings_id);
CREATE INDEX idx_cricket_fallow_bowler ON cricket_fallow_overs(bowler_id);

-- ========================================
-- CRICKET FOLLOW-ON LOG
-- ========================================

CREATE TABLE IF NOT EXISTS cricket_followon_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    innings_triggered INT NOT NULL,
    lead_runs INT NOT NULL,
    recommended BOOLEAN DEFAULT FALSE,
    accepted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_cricket_followon_match ON cricket_followon_logs(match_id);
