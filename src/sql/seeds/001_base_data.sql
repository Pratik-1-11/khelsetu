-- KhelSetu Seed Data - Base Configuration
-- MySQL 8.0+

SET NAMES utf8mb4;

-- ========================================
-- SPORTS
-- ========================================

INSERT IGNORE INTO sports (id, name, slug, icon, description, rules, scoring_config, is_active) VALUES
(UUID(), 'Football', 'football', '⚽', 'Association Football', '{"periods": 2, "period_duration": 45, "extra_time": true, "penalty_shootout": true}', '{"win": 3, "draw": 1, "loss": 0}', true),
(UUID(), 'Cricket', 'cricket', '🏏', 'Limited Overs Cricket', '{"overs": 20, "bowlers_per_over": 1, "max_balls": 120}', '{"win": 2, "loss": 0}', true),
(UUID(), 'Basketball', 'basketball', '🏀', 'Basketball', '{"quarters": 4, "quarter_duration": 10, "overtime": true}', '{"win": 2, "loss": 0}', true),
(UUID(), 'Volleyball', 'volleyball', '🏐', 'Volleyball', '{"sets": 5, "points_per_set": 25, "win_by_2": true}', '{"win": 3, "loss": 0}', true),
(UUID(), 'Badminton', 'badminton', '🏸', 'Badminton', '{"sets": 3, "points_per_set": 21, "win_by_2": true}', '{"win": 1, "loss": 0}', true),
(UUID(), 'Table Tennis', 'table_tennis', '🏓', 'Table Tennis', '{"sets": 5, "points_per_set": 11, "win_by_2": true}', '{"win": 1, "loss": 0}', true);

-- ========================================
-- PERMISSIONS (Dynamic RBAC)
-- ========================================

INSERT IGNORE INTO permissions (id, name, description, category) VALUES
(UUID(), 'org:create', 'Create new organization', 'organization'),
(UUID(), 'org:read', 'View organization details', 'organization'),
(UUID(), 'org:update', 'Update organization settings', 'organization'),
(UUID(), 'org:delete', 'Delete organization', 'organization'),
(UUID(), 'org:invite', 'Invite members to organization', 'organization'),
(UUID(), 'tournament:create', 'Create new tournament', 'tournament'),
(UUID(), 'tournament:read', 'View tournament details', 'tournament'),
(UUID(), 'tournament:update', 'Update tournament settings', 'tournament'),
(UUID(), 'tournament:delete', 'Delete tournament', 'tournament'),
(UUID(), 'tournament:publish', 'Publish tournament', 'tournament'),
(UUID(), 'match:create', 'Create matches', 'match'),
(UUID(), 'match:read', 'View match details', 'match'),
(UUID(), 'match:update', 'Update match', 'match'),
(UUID(), 'match:delete', 'Delete match', 'match'),
(UUID(), 'match:schedule', 'Schedule match', 'match'),
(UUID(), 'match:start', 'Start match', 'match'),
(UUID(), 'match:end', 'End match', 'match'),
(UUID(), 'score:update', 'Update scores', 'scoring'),
(UUID(), 'score:undo', 'Undo scoring event', 'scoring'),
(UUID(), 'team:create', 'Create team', 'team'),
(UUID(), 'team:read', 'View team details', 'team'),
(UUID(), 'team:update', 'Update team', 'team'),
(UUID(), 'team:delete', 'Delete team', 'team'),
(UUID(), 'player:create', 'Add player', 'player'),
(UUID(), 'player:read', 'View player details', 'player'),
(UUID(), 'player:update', 'Update player', 'player'),
(UUID(), 'player:delete', 'Delete player', 'player'),
(UUID(), 'overlay:create', 'Create broadcast overlay', 'overlay'),
(UUID(), 'overlay:read', 'View overlay', 'overlay'),
(UUID(), 'overlay:update', 'Update overlay', 'overlay'),
(UUID(), 'overlay:delete', 'Delete overlay', 'overlay'),
(UUID(), 'analytics:read', 'View analytics', 'analytics'),
(UUID(), 'audit:read', 'View audit logs', 'audit');

-- ========================================
-- ROLES (Dynamic)
-- ========================================

-- Super Admin (global scope)
INSERT IGNORE INTO roles (id, name, description, scope, is_system) VALUES
(UUID(), 'Super Admin', 'Full system access', 'global', true);

-- Organization-level roles
INSERT IGNORE INTO roles (id, name, description, scope, is_system) VALUES
(UUID(), 'Organization Admin', 'Full organization access', 'organization', true),
(UUID(), 'Tournament Admin', 'Manage tournaments and matches', 'tournament', true),
(UUID(), 'Scorer', 'Update match scores', 'tournament', true),
(UUID(), 'Viewer', 'Read-only access', 'organization', true);

-- ========================================
-- ROLE-PERMISSION MAPPINGS
-- ========================================

-- Super Admin gets all permissions
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id FROM roles r, permissions p WHERE r.name = 'Super Admin';

-- Organization Admin gets org, team, player permissions
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Organization Admin'
AND p.name LIKE 'org:%';

INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Organization Admin'
AND p.name IN ('tournament:create', 'tournament:read', 'tournament:update', 'team:create', 'team:read', 'team:update', 'team:delete', 'player:create', 'player:read', 'player:update', 'player:delete', 'analytics:read');

-- Tournament Admin
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Tournament Admin'
AND p.name IN ('tournament:read', 'tournament:update', 'tournament:publish', 'match:create', 'match:read', 'match:update', 'match:schedule', 'match:start', 'match:end', 'score:update', 'score:undo', 'team:read', 'player:read', 'overlay:create', 'overlay:read', 'overlay:update', 'analytics:read');

-- Scorer
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Scorer'
AND p.name IN ('match:read', 'score:update', 'score:undo', 'player:read');

-- Viewer
INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
SELECT UUID(), r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Viewer'
AND p.name IN ('tournament:read', 'match:read', 'team:read', 'player:read');