-- Migration 012: Seed RBAC Properly & Navigation Config
-- PostgreSQL 14+ (Neon)
-- Fixes super admin permissions, assigns super admin role, seeds navigation

-- ========================================
-- FIX: Assign ALL permissions to Super Admin role
-- ========================================

INSERT INTO role_permissions (id, role_id, permission_id)
SELECT gen_random_uuid(), r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Super Admin'
AND p.deleted_at IS NULL
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp
  WHERE rp.role_id = r.id AND rp.permission_id = p.id AND rp.deleted_at IS NULL
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ========================================
-- FIX: Assign Super Admin role to admin user (global scope)
-- ========================================

INSERT INTO user_roles (id, user_id, role_id, organization_id, created_by)
SELECT gen_random_uuid(), u.id, r.id, NULL, u.id
FROM users u, roles r
WHERE u.email = 'admin@khelsetu.com'
AND u.deleted_at IS NULL
AND r.name = 'Super Admin'
AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- ========================================
-- SEED: Role Navigation Config
-- ========================================

INSERT INTO role_navigation (id, role_name, navigation) VALUES
(gen_random_uuid(), 'owner', json_build_array(
  json_build_object('label','Dashboard','path','/dashboard','icon','home','key','nav_dashboard'),
  json_build_object('label','Organization','path','/org','icon','building','key','nav_org'),
  json_build_object('label','Teams','path','/teams','icon','users','key','nav_teams'),
  json_build_object('label','Players','path','/players','icon','user-plus','key','nav_players'),
  json_build_object('label','Tournaments','path','/tournaments','icon','trophy','key','nav_tournaments'),
  json_build_object('label','Matches','path','/matches','icon','calendar','key','nav_matches'),
  json_build_object('label','Members','path','/members','icon','user-cog','key','nav_members'),
  json_build_object('label','Billing','path','/billing','icon','credit-card','key','nav_billing'),
  json_build_object('label','Settings','path','/settings','icon','settings','key','nav_settings'),
  json_build_object('label','My Profile','path','/profile','icon','user','key','nav_profile')
)),
(gen_random_uuid(), 'admin', json_build_array(
  json_build_object('label','Dashboard','path','/dashboard','icon','home','key','nav_dashboard'),
  json_build_object('label','Teams','path','/teams','icon','users','key','nav_teams'),
  json_build_object('label','Players','path','/players','icon','user-plus','key','nav_players'),
  json_build_object('label','Tournaments','path','/tournaments','icon','trophy','key','nav_tournaments'),
  json_build_object('label','Matches','path','/matches','icon','calendar','key','nav_matches'),
  json_build_object('label','Members','path','/members','icon','user-cog','key','nav_members'),
  json_build_object('label','Settings','path','/settings','icon','settings','key','nav_settings'),
  json_build_object('label','My Profile','path','/profile','icon','user','key','nav_profile')
)),
(gen_random_uuid(), 'tournament_admin', json_build_array(
  json_build_object('label','Dashboard','path','/dashboard','icon','home','key','nav_dashboard'),
  json_build_object('label','Tournaments','path','/tournaments','icon','trophy','key','nav_tournaments'),
  json_build_object('label','Fixtures','path','/fixtures','icon','list','key','nav_fixtures'),
  json_build_object('label','Matches','path','/matches','icon','calendar','key','nav_matches'),
  json_build_object('label','Teams','path','/teams','icon','users','key','nav_teams'),
  json_build_object('label','Standings','path','/standings','icon','bar-chart','key','nav_standings'),
  json_build_object('label','My Profile','path','/profile','icon','user','key','nav_profile')
)),
(gen_random_uuid(), 'scorer', json_build_array(
  json_build_object('label','Dashboard','path','/dashboard','icon','home','key','nav_dashboard'),
  json_build_object('label','Matches','path','/matches','icon','calendar','key','nav_matches'),
  json_build_object('label','Live Scoring','path','/scoring','icon','edit','key','nav_scoring'),
  json_build_object('label','My Profile','path','/profile','icon','user','key','nav_profile')
)),
(gen_random_uuid(), 'coach', json_build_array(
  json_build_object('label','Dashboard','path','/dashboard','icon','home','key','nav_dashboard'),
  json_build_object('label','Teams','path','/teams','icon','users','key','nav_teams'),
  json_build_object('label','Players','path','/players','icon','user-plus','key','nav_players'),
  json_build_object('label','Match Analysis','path','/analysis','icon','bar-chart','key','nav_analysis'),
  json_build_object('label','Formations','path','/formations','icon','grid','key','nav_formations'),
  json_build_object('label','My Profile','path','/profile','icon','user','key','nav_profile')
)),
(gen_random_uuid(), 'viewer', json_build_array(
  json_build_object('label','Dashboard','path','/dashboard','icon','home','key','nav_dashboard'),
  json_build_object('label','Tournaments','path','/tournaments','icon','trophy','key','nav_tournaments'),
  json_build_object('label','Matches','path','/matches','icon','calendar','key','nav_matches'),
  json_build_object('label','Standings','path','/standings','icon','bar-chart','key','nav_standings'),
  json_build_object('label','My Profile','path','/profile','icon','user','key','nav_profile')
))
ON CONFLICT (role_name) DO NOTHING;
