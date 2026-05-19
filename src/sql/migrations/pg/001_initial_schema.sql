-- KhelSetu Database Schema - Initial Migration
-- PostgreSQL 14+ (Neon)
-- Version: 1.0.0

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- REUSABLE TRIGGER FUNCTION
-- ========================================

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- ENUM TYPES
-- ========================================

CREATE TYPE role_scope AS ENUM ('global', 'organization', 'tournament', 'match', 'overlay');
CREATE TYPE membership_role AS ENUM ('owner', 'admin', 'tournament_admin', 'scorer', 'coach', 'viewer', 'member');
CREATE TYPE tournament_status AS ENUM ('draft', 'registration_open', 'in_progress', 'completed', 'cancelled');
CREATE TYPE tournament_format AS ENUM ('league', 'knockout', 'group_knockout', 'round_robin', 'swiss');
CREATE TYPE tournament_team_status AS ENUM ('registered', 'confirmed', 'withdrawn', 'disqualified');

-- ========================================
-- SCHEMA MIGRATIONS TRACKING
-- ========================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(10) PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    hash VARCHAR(64) NOT NULL
);

-- ========================================
-- BASE TABLES (No organization_id - global)
-- ========================================

CREATE TABLE IF NOT EXISTS organizations (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    logo VARCHAR(500),
    description TEXT,
    website VARCHAR(255),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    address TEXT,
    settings JSONB DEFAULT NULL,
    metadata JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_deleted ON organizations(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_organizations_settings ON organizations USING GIN(settings);

CREATE TRIGGER trg_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS users (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100),
    phone VARCHAR(50),
    avatar VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    email_verified BOOLEAN DEFAULT FALSE,
    last_login_at TIMESTAMPTZ NULL,
    metadata JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_active ON users(is_active);
CREATE INDEX idx_users_deleted ON users(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_metadata ON users USING GIN(metadata);

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS sessions (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    refresh_token_hash VARCHAR(255) NOT NULL,
    device_info VARCHAR(500),
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX idx_sessions_refresh_hash ON sessions(refresh_token_hash);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TRIGGER trg_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- RBAC TABLES (IAM-like system)
-- ========================================

CREATE TABLE IF NOT EXISTS permissions (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(255),
    category VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_permissions_name ON permissions(name);
CREATE INDEX idx_permissions_category ON permissions(category);

CREATE TRIGGER trg_permissions_updated_at
    BEFORE UPDATE ON permissions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS roles (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255),
    scope role_scope DEFAULT 'organization',
    is_system BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_roles_name ON roles(name);
CREATE INDEX idx_roles_scope ON roles(scope);
CREATE INDEX idx_roles_deleted ON roles(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_roles_metadata ON roles USING GIN(metadata);

CREATE TRIGGER trg_roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS role_permissions (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE (role_id, permission_id)
);

CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission ON role_permissions(permission_id);

CREATE TABLE IF NOT EXISTS user_roles (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    tournament_id UUID,
    match_id UUID,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);
CREATE INDEX idx_user_roles_org ON user_roles(organization_id);
CREATE INDEX idx_user_roles_tournament ON user_roles(tournament_id);

CREATE TRIGGER trg_user_roles_updated_at
    BEFORE UPDATE ON user_roles
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- ORGANIZATION-SPECIFIC TABLES
-- ========================================

CREATE TABLE IF NOT EXISTS organization_members (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role membership_role DEFAULT 'member',
    is_active BOOLEAN DEFAULT TRUE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id),
    UNIQUE (organization_id, user_id)
);

CREATE INDEX idx_org_members_org ON organization_members(organization_id);
CREATE INDEX idx_org_members_user ON organization_members(user_id);
CREATE INDEX idx_org_members_deleted ON organization_members(deleted_at) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_org_members_updated_at
    BEFORE UPDATE ON organization_members
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS organization_invitations (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role membership_role DEFAULT 'member',
    token VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_org_invitations_org ON organization_invitations(organization_id);
CREATE INDEX idx_org_invitations_email ON organization_invitations(email);
CREATE INDEX idx_org_invitations_token ON organization_invitations(token);
CREATE INDEX idx_org_invitations_deleted ON organization_invitations(deleted_at) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_org_invitations_updated_at
    BEFORE UPDATE ON organization_invitations
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- SPORTS CONFIGURATION (Global)
-- ========================================

CREATE TABLE IF NOT EXISTS sports (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(50) NOT NULL UNIQUE,
    icon VARCHAR(255),
    description TEXT,
    rules JSONB NOT NULL,
    scoring_config JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_sports_slug ON sports(slug);
CREATE INDEX idx_sports_active ON sports(is_active);
CREATE INDEX idx_sports_deleted ON sports(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_sports_rules ON sports USING GIN(rules);
CREATE INDEX idx_sports_scoring_config ON sports USING GIN(scoring_config);

CREATE TRIGGER trg_sports_updated_at
    BEFORE UPDATE ON sports
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- TOURNAMENTS (organization-scoped)
-- ========================================

CREATE TABLE IF NOT EXISTS tournaments (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    sport_id UUID NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100),
    description TEXT,
    format tournament_format,
    status tournament_status DEFAULT 'draft',
    start_date DATE,
    end_date DATE,
    registration_deadline DATE,
    max_teams INT,
    min_teams INT,
    venue VARCHAR(255),
    rules JSONB DEFAULT NULL,
    settings JSONB DEFAULT NULL,
    metadata JSONB DEFAULT NULL,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_tournaments_org ON tournaments(organization_id);
CREATE INDEX idx_tournaments_sport ON tournaments(sport_id);
CREATE INDEX idx_tournaments_status ON tournaments(status);
CREATE INDEX idx_tournaments_dates ON tournaments(start_date, end_date);
CREATE INDEX idx_tournaments_deleted ON tournaments(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_tournaments_settings ON tournaments USING GIN(settings);
CREATE INDEX idx_tournaments_metadata ON tournaments USING GIN(metadata);

CREATE TRIGGER trg_tournaments_updated_at
    BEFORE UPDATE ON tournaments
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- TEAMS (organization-scoped)
-- ========================================

CREATE TABLE IF NOT EXISTS teams (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100),
    logo VARCHAR(500),
    description TEXT,
    home_venue VARCHAR(255),
    primary_color VARCHAR(20),
    secondary_color VARCHAR(20),
    metadata JSONB DEFAULT NULL,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_teams_org ON teams(organization_id);
CREATE INDEX idx_teams_slug ON teams(slug);
CREATE INDEX idx_teams_deleted ON teams(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_teams_metadata ON teams USING GIN(metadata);

CREATE TRIGGER trg_teams_updated_at
    BEFORE UPDATE ON teams
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- Team registrations for tournaments
CREATE TABLE IF NOT EXISTS tournament_teams (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    seed_number INT,
    status tournament_team_status DEFAULT 'registered',
    metadata JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id),
    UNIQUE (tournament_id, team_id)
);

CREATE INDEX idx_tournament_teams_tournament ON tournament_teams(tournament_id);
CREATE INDEX idx_tournament_teams_team ON tournament_teams(team_id);
CREATE INDEX idx_tournament_teams_status ON tournament_teams(status);
CREATE INDEX idx_tournament_teams_deleted ON tournament_teams(deleted_at) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_tournament_teams_updated_at
    BEFORE UPDATE ON tournament_teams
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ========================================
-- PLAYERS (organization-scoped)
-- ========================================

CREATE TABLE IF NOT EXISTS players (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(50),
    date_of_birth DATE,
    gender VARCHAR(20),
    photo VARCHAR(500),
    jersey_number INT CHECK (jersey_number IS NULL OR (jersey_number BETWEEN 1 AND 99)),
    position VARCHAR(100),
    metadata JSONB DEFAULT NULL,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id)
);

CREATE INDEX idx_players_org ON players(organization_id);
CREATE INDEX idx_players_name ON players(last_name, first_name);
CREATE INDEX idx_players_deleted ON players(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_players_metadata ON players USING GIN(metadata);

CREATE TRIGGER trg_players_updated_at
    BEFORE UPDATE ON players
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- Player-team relationships
CREATE TABLE IF NOT EXISTS player_teams (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'player',
    is_active BOOLEAN DEFAULT TRUE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    left_at TIMESTAMPTZ NULL,
    metadata JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    version INT DEFAULT 1,
    PRIMARY KEY (id),
    UNIQUE (player_id, team_id, deleted_at)
);

CREATE INDEX idx_player_teams_player ON player_teams(player_id);
CREATE INDEX idx_player_teams_team ON player_teams(team_id);
CREATE INDEX idx_player_teams_active ON player_teams(is_active);
CREATE INDEX idx_player_teams_deleted ON player_teams(deleted_at) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_player_teams_updated_at
    BEFORE UPDATE ON player_teams
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
