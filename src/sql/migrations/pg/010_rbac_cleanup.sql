-- Migration 010: RBAC Cleanup & Multi-Tenant Support
-- PostgreSQL 14+ (Neon)
-- Fixes schema mismatches, adds missing columns, enables multi-tenant features

-- ========================================
-- ROLES TABLE: Add missing columns
-- ========================================

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS organization_id UUID NULL REFERENCES organizations(id),
  ADD COLUMN IF NOT EXISTS created_by UUID NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by UUID NULL REFERENCES users(id);

-- ========================================
-- USER_ROLES TABLE: Add missing column
-- ========================================

ALTER TABLE user_roles
  ADD COLUMN IF NOT EXISTS updated_by UUID NULL REFERENCES users(id);

-- ========================================
-- PERMISSIONS TABLE: Add soft delete
-- ========================================

ALTER TABLE permissions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- ========================================
-- ROLE_PERMISSIONS TABLE: Add soft delete
-- ========================================

ALTER TABLE role_permissions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- ========================================
-- SUBSCRIPTIONS TABLE: Add soft delete
-- ========================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- ========================================
-- ORGANIZATIONS TABLE: Add status & feature flags
-- ========================================

CREATE TYPE org_status AS ENUM ('active', 'suspended', 'inactive');

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS status org_status DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS feature_flags JSONB DEFAULT '{}';

-- ========================================
-- USERS TABLE: Add must_change_password
-- ========================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;

-- ========================================
-- ROLE_NAVIGATION TABLE: Sidebar config per role
-- ========================================

CREATE TABLE IF NOT EXISTS role_navigation (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  role_name VARCHAR(50) NOT NULL UNIQUE,
  navigation JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
