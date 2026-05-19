-- KhelSetu Database Schema - Football Phase 3: Standings & Statistics
-- PostgreSQL 14+ (Neon)
-- Version: 1.0.0
-- Phase 3: Enhanced Standings, Statistics, Tournament Progression

-- ========================================
-- ENUM TYPES
-- ========================================

CREATE TYPE progression_status AS ENUM ('pending', 'scheduled', 'completed', 'bye');

-- ========================================
-- ENHANCED STANDINGS
-- ========================================

ALTER TABLE standings ADD COLUMN IF NOT EXISTS fair_play_points INT DEFAULT 0;
ALTER TABLE standings ADD COLUMN IF NOT EXISTS wins_home INT DEFAULT 0;
ALTER TABLE standings ADD COLUMN IF NOT EXISTS wins_away INT DEFAULT 0;
ALTER TABLE standings ADD COLUMN IF NOT EXISTS draws_home INT DEFAULT 0;
ALTER TABLE standings ADD COLUMN IF NOT EXISTS draws_away INT DEFAULT 0;
ALTER TABLE standings ADD COLUMN IF NOT EXISTS losses_home INT DEFAULT 0;
ALTER TABLE standings ADD COLUMN IF NOT EXISTS losses_away INT DEFAULT 0;
ALTER TABLE standings ADD COLUMN IF NOT EXISTS goals_for_home INT DEFAULT 0;
ALTER TABLE standings ADD COLUMN IF NOT EXISTS goals_for_away INT DEFAULT 0;
ALTER TABLE standings ADD COLUMN IF NOT EXISTS goals_against_home INT DEFAULT 0;
ALTER TABLE standings ADD COLUMN IF NOT EXISTS goals_against_away INT DEFAULT 0;
ALTER TABLE standings ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_standings_fair_play ON standings(tournament_id, group_name, fair_play_points DESC);

-- ========================================
-- HEAD-TO-HEAD STANDINGS
-- ========================================

CREATE TABLE IF NOT EXISTS h2h_standings (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    opponent_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    group_name VARCHAR(50),
    matches_played INT DEFAULT 0,
    wins INT DEFAULT 0,
    draws INT DEFAULT 0,
    losses INT DEFAULT 0,
    goals_for INT DEFAULT 0,
    goals_against INT DEFAULT 0,
    points INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE (tournament_id, team_id, opponent_team_id)
);

CREATE INDEX idx_h2h_team ON h2h_standings(tournament_id, team_id);
CREATE INDEX idx_h2h_opponent ON h2h_standings(tournament_id, opponent_team_id);

CREATE TRIGGER trg_h2h_standings_updated_at
    BEFORE UPDATE ON h2h_standings
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- TEAM MATCH STATISTICS (Football-specific, renamed to avoid collision)
-- ========================================

CREATE TABLE IF NOT EXISTS football_team_match_stats (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    possession_percent INT,
    shots_total INT DEFAULT 0,
    shots_on_target INT DEFAULT 0,
    shots_off_target INT DEFAULT 0,
    shots_blocked INT DEFAULT 0,
    corners INT DEFAULT 0,
    free_kicks INT DEFAULT 0,
    penalties INT DEFAULT 0,
    throw_ins INT DEFAULT 0,
    offsides INT DEFAULT 0,
    fouls INT DEFAULT 0,
    yellow_cards INT DEFAULT 0,
    red_cards INT DEFAULT 0,
    pass_accuracy_percent INT,
    passes_completed INT DEFAULT 0,
    passes_failed INT DEFAULT 0,
    tackles_won INT DEFAULT 0,
    tackles_lost INT DEFAULT 0,
    interceptions INT DEFAULT 0,
    clearances INT DEFAULT 0,
    blocks INT DEFAULT 0,
    own_goals INT DEFAULT 0,
    goals_conceded INT DEFAULT 0,
    goals_prevented INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE (match_id, team_id)
);

CREATE INDEX idx_football_team_stats_match ON football_team_match_stats(match_id);
CREATE INDEX idx_football_team_stats_team ON football_team_match_stats(team_id);

CREATE TRIGGER trg_football_team_match_stats_updated_at
    BEFORE UPDATE ON football_team_match_stats
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- PLAYER MATCH STATISTICS (Football-specific, renamed to avoid collision)
-- ========================================

CREATE TABLE IF NOT EXISTS football_player_match_stats (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    minutes_played INT DEFAULT 0,
    position VARCHAR(50),
    goals INT DEFAULT 0,
    assists INT DEFAULT 0,
    shots_total INT DEFAULT 0,
    shots_on_target INT DEFAULT 0,
    shots_off_target INT DEFAULT 0,
    passes_completed INT DEFAULT 0,
    passes_failed INT DEFAULT 0,
    key_passes INT DEFAULT 0,
    through_balls INT DEFAULT 0,
    crosses INT DEFAULT 0,
    crosses_completed INT DEFAULT 0,
    dribbles_won INT DEFAULT 0,
    dribbles_lost INT DEFAULT 0,
    tackles_won INT DEFAULT 0,
    tackles_lost INT DEFAULT 0,
    interceptions INT DEFAULT 0,
    clearances INT DEFAULT 0,
    yellow_cards INT DEFAULT 0,
    red_cards INT DEFAULT 0,
    fouls_won INT DEFAULT 0,
    fouls_conceded INT DEFAULT 0,
    offsides INT DEFAULT 0,
    goals_conceded INT DEFAULT 0,
    saves INT DEFAULT 0,
    punches INT DEFAULT 0,
    crosses_cleared INT DEFAULT 0,
    is_man_of_match BOOLEAN DEFAULT FALSE,
    is_starting BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE (match_id, player_id)
);

CREATE INDEX idx_football_player_stats_match ON football_player_match_stats(match_id);
CREATE INDEX idx_football_player_stats_player ON football_player_match_stats(player_id);

CREATE TRIGGER trg_football_player_match_stats_updated_at
    BEFORE UPDATE ON football_player_match_stats
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- TOURNAMENT PROGRESSION
-- ========================================

CREATE TABLE IF NOT EXISTS tournament_progression (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    round_name VARCHAR(50) NOT NULL,
    round_number INT NOT NULL,
    match_id UUID REFERENCES matches(id) ON DELETE SET NULL,
    home_team_id UUID REFERENCES teams(id),
    away_team_id UUID REFERENCES teams(id),
    home_aggregate_score INT,
    away_aggregate_score INT,
    winner_id UUID REFERENCES teams(id),
    status progression_status DEFAULT 'pending',
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_tournament_progression_tournament ON tournament_progression(tournament_id, round_number);
CREATE INDEX idx_tournament_progression_match ON tournament_progression(match_id);
CREATE INDEX idx_tournament_progression_metadata ON tournament_progression USING GIN(metadata);

CREATE TRIGGER trg_tournament_progression_updated_at
    BEFORE UPDATE ON tournament_progression
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- TOURNAMENT TIE-BREAKER CONFIG
-- ========================================

CREATE TABLE IF NOT EXISTS tournament_tie_breakers (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    tie_breaker_name VARCHAR(50) NOT NULL,
    tie_breaker_order INT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE (tournament_id, tie_breaker_order)
);

-- ========================================
-- LEAGUE TABLE SNAPSHOTS
-- ========================================

CREATE TABLE IF NOT EXISTS league_table_snapshots (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    group_name VARCHAR(50),
    snapshot_data JSONB NOT NULL,
    match_id UUID REFERENCES matches(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_league_snapshots_tournament ON league_table_snapshots(tournament_id, group_name);
CREATE INDEX idx_league_snapshots_match ON league_table_snapshots(match_id);
CREATE INDEX idx_league_snapshots_created ON league_table_snapshots(created_at);
CREATE INDEX idx_league_snapshots_data ON league_table_snapshots USING GIN(snapshot_data);
