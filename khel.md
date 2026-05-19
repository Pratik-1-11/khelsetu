# KhelSetu — PostgreSQL Migration & Platform Enhancement

## Project Overview

KhelSetu is a multi-tenant sports tournament management platform for Nepal. It supports Football, Cricket, Basketball, Volleyball, Badminton, and Table Tennis with real-time scoring, broadcast overlays, and tactical visualization.

**Current State**: MySQL 8.0 backend with no tenant isolation, duplicate table definitions, and an unused PostgreSQL connection.

**Target State**: Neon PostgreSQL backend with aggressive normalization, strict multi-tenant security, public portal with free-tier match creation, and fixed scoring edge cases.

---

## Architecture

```
khelsetu.com (single frontend domain)
├── /dashboard/*          → ALL pages require login (JWT)
├── /public/*             → Open access (no login)
├── /login, /register     → Auth pages (both user types)
│
Backend API:
├── /api/public/*         → No auth required
├── /api/auth/*           → No auth required (login/register)
├── /api/organizations/*  → JWT + org membership required
├── /api/tournaments/*    → JWT + org membership required
├── /api/matches/*        → JWT + org membership required
├── /api/scoring/*        → JWT + match:score permission required
├── /api/teams/*          → JWT + org membership required
├── /api/players/*        → JWT + org membership required
├── /api/rbac/*           → JWT + rbac:manage permission required
├── /api/billing/*        → JWT + org membership required
└── /api/admin/*          → JWT + owner/admin role required

Database: Neon PostgreSQL (single shared, org_id on every domain table)
```

---

## User Types

| Type | user_type | How Created | Access |
|------|-----------|-------------|--------|
| **Dashboard User** | `dashboard` | Created by tenant admin (invite) or org registration | Full org-scoped CRUD based on RBAC role |
| **Public User** | `public` | Self-registers on public portal | Read public data + create 5 free matches (auto-creates personal org) |
| **Tenant Admin** | `dashboard` + `owner` role | Creates the organization | Full org access, manages staff, billing, tournaments |

---

## Staff Roles (Assigned by Tenant Admin)

| Role | Scope | Permissions |
|------|-------|-------------|
| `owner` | Organization | Full access to everything in the org |
| `admin` | Organization | Full access except billing and org deletion |
| `tournament_admin` | Tournament | Manage specific tournament, fixtures, matches |
| `scorer` | Match | Live scoring only |
| `coach` | Team/Player | View team/player data, analytics, formations |
| `viewer` | Organization | Read-only access |

---

## Free Tier Limits

| Resource | Free Tier | Starter | Professional | Enterprise |
|----------|-----------|---------|--------------|------------|
| Tournaments per org | **5** | 20 | 100 | Unlimited |
| Teams per org | 10 | 50 | 200 | Unlimited |
| Players per org | 50 | 200 | 1000 | Unlimited |
| Matches per org | 100 | 500 | 2000 | Unlimited |
| Free matches per public user | **5** (lifetime) | N/A | N/A | N/A |

---

## Implementation Phases

### Phase 1: PostgreSQL Infrastructure
**Goal**: Replace MySQL connection layer with PostgreSQL

#### Step 1.1: Install Dependencies
- `npm install pg`
- `npm uninstall mysql2`

#### Step 1.2: Create `src/infrastructure/postgres/index.js`
- Connection pool using `DATABASE_URL` with SSL (required for Neon)
- `query(sql, params)` — auto-converts `?` placeholders to `$1, $2, $3...`
- `transaction(callback)` — proper PG transaction handling
- `healthCheck()` — `SELECT 1`
- `closePool()` — graceful shutdown

#### Step 1.3: Create `src/infrastructure/postgres/baseRepository.js`
- `findById(id, organizationId)` — uses `$1, $2` params
- `findAll(options)` — pagination with `$n` params
- `create(data)` — returns inserted row (PG `RETURNING *`)
- `update(id, data, organizationId)` — uses `rowCount` instead of `affectedRows`
- `softDelete(id, organizationId)` — sets `deleted_at`
- `hardDelete(id)` — permanent delete
- `exists(id)` — existence check
- `count(organizationId)` — row count

**Key differences from MySQL version**:
- `result.rowCount` instead of `result.affectedRows`
- `RETURNING *` on INSERT to get created row
- `JSONB` parameter handling (no `JSON.stringify` needed)
- UUID native type support

---

### Phase 2: Database Normalization + PostgreSQL Migrations
**Goal**: Convert all 12 MySQL migrations to PostgreSQL with aggressive normalization

#### Step 2.1: Create `src/sql/migrations/pg/` Directory

#### Step 2.2: Migration 001 — Initial Schema
**File**: `src/sql/migrations/pg/001_initial_schema.sql`

Changes from MySQL:
- `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` (for `gen_random_uuid()`)
- `CHAR(36)` → `UUID` type on all ID columns
- `JSON` → `JSONB` on all JSON columns
- `ENUM(...)` → `CREATE TYPE ... AS ENUM(...)` (reusable types)
- `TIMESTAMP` → `TIMESTAMPTZ` (timezone-aware)
- `TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` → `TIMESTAMPTZ DEFAULT NOW()` + trigger
- Inline `INDEX idx(col)` → `CREATE INDEX idx ON table(col)` after table
- Remove `ENGINE=InnoDB`, `CHARSET`, `COLLATE`, `FOREIGN_KEY_CHECKS`, `SET NAMES`
- Add `CREATE OR REPLACE FUNCTION trigger_set_updated_at()` — reusable trigger
- Add partial indexes: `CREATE INDEX ... WHERE deleted_at IS NULL`
- Add GIN indexes on JSONB columns: `CREATE INDEX ... USING GIN (metadata)`
- Add `schema_migrations` table for tracking applied migrations

Tables: `organizations`, `users`, `sessions`, `permissions`, `roles`, `role_permissions`, `user_roles`, `organization_members`, `organization_invitations`, `sports`, `tournaments`, `teams`, `tournament_teams`, `players`, `player_teams`

#### Step 2.3: Migration 002 — Matches and Scoring
**File**: `src/sql/migrations/pg/002_matches_and_scoring.sql`

Changes:
- UUID types, TIMESTAMPTZ, JSONB
- `CHECK (home_score >= 0 AND away_score >= 0)` on matches table
- `CHECK (sequence_number > 0)` on scoring_events
- Composite index: `(tournament_id, status)` on matches
- FK on `winner_id` → `teams(id) ON DELETE SET NULL`

Tables: `matches`, `match_officials`, `scoring_events`, `match_snapshots`, `standings`, `standings_snapshots`, `fixtures`

#### Step 2.4: Migration 003 — Audit, Sync, Notifications
**File**: `src/sql/migrations/pg/003_audit_sync_notifications.sql`

Changes:
- **Consolidated** — this is the ONLY `audit_logs` definition (removed duplicate from old 004)
- `CHECK (retry_count >= 0)` on sync_queue
- Partial index: `CREATE INDEX ... ON sync_queue(status) WHERE status = 'pending'`
- `CHECK (is_read IN (true, false))` on notifications

Tables: `audit_logs`, `sync_queue`, `devices`, `notifications`, `overlay_templates`, `live_overlays`, `formations`, `tactical_annotations`, `analytics_events`

#### Step 2.5: Migration 004 — Football Phase 1
**File**: `src/sql/migrations/pg/004_football_phase1.sql`

Changes:
- `CREATE TYPE period_type AS ENUM(...)` — reusable across tables
- `CREATE TYPE card_type AS ENUM(...)`
- `CREATE TYPE substitution_reason AS ENUM(...)`
- `CREATE TYPE action_type AS ENUM(...)` for score_audit_logs
- `football_match_periods`, `football_player_match_cards`, `football_match_lineups`, `football_substitution_events`, `football_team_substitution_limits`, `football_score_audit_logs`
- `ALTER TABLE matches ADD COLUMN state_version INT DEFAULT 0`
- `ALTER TABLE matches ADD COLUMN current_period_id UUID`
- `ALTER TABLE scoring_events ADD COLUMN period_type VARCHAR(50)`
- `ALTER TABLE scoring_events ADD COLUMN original_event_id UUID`
- `ALTER TABLE match_snapshots ADD COLUMN period_type VARCHAR(50)`

#### Step 2.6: Migration 005 — Analytics & Billing
**File**: `src/sql/migrations/pg/005_analytics_billing.sql`

Changes:
- Merged analytics + billing (was split across two MySQL migrations)
- **No duplicate audit_logs** (already in 003)
- `CHECK (price >= 0)` on plans
- `CHECK (amount >= 0)` on invoices
- `CREATE TYPE plan_interval AS ENUM('month', 'year')`
- `CREATE TYPE subscription_status AS ENUM(...)`
- `CREATE TYPE invoice_status AS ENUM(...)`
- `CREATE TYPE payment_method_type AS ENUM(...)`

Tables: `plans`, `subscriptions`, `invoices`, `payment_methods`

Seeds: permissions, roles, role_permissions (using `ON CONFLICT DO NOTHING`)

#### Step 2.7: Migration 006 — Football VAR & Penalty Phase 2
**File**: `src/sql/migrations/pg/006_football_var_penalty_phase2.sql`

Changes:
- `CREATE TYPE var_review_type AS ENUM(...)`
- `CREATE TYPE var_decision AS ENUM(...)`
- `CREATE TYPE penalty_result AS ENUM(...)`
- `CREATE TYPE correction_type AS ENUM(...)`
- `CREATE TYPE eligibility_status AS ENUM(...)`
- `football_var_reviews`, `football_penalty_shootouts`, `football_penalty_kicks`, `football_penalty_kick_orders`, `football_event_corrections`, `football_player_eligibility`
- `ALTER TABLE matches ADD COLUMN is_knockout BOOLEAN DEFAULT FALSE`
- `ALTER TABLE matches ADD COLUMN agg_home_score INT`
- `ALTER TABLE matches ADD COLUMN agg_away_score INT`
- `ALTER TABLE matches ADD COLUMN agg_winner_id UUID`

#### Step 2.8: Migration 007 — Cricket Engine
**File**: `src/sql/migrations/pg/007_cricket_engine.sql`

Changes:
- `CREATE TYPE innings_status AS ENUM(...)`
- `CREATE TYPE innings_type AS ENUM(...)`
- `CREATE TYPE delivery_type AS ENUM(...)`
- `CREATE TYPE wicket_type AS ENUM(...)`
- `CREATE TYPE powerplay_type AS ENUM(...)`
- `CREATE TYPE runs_from_delivery AS ENUM(...)`
- `cricket_innings`, `cricket_deliveries`, `cricket_partnerships`, `cricket_bowler_stats`, `cricket_batter_stats`, `cricket_match_snapshots`, `cricket_dls_schedules`, `cricket_powerplay_configs`
- `CHECK (total_runs >= 0)`, `CHECK (wickets_fallen >= 0)`, `CHECK (overs_bowled >= 0)`
- DLS seed data using `gen_random_uuid()` instead of `UUID()`
- Powerplay config seed data

#### Step 2.9: Migration 008 — Football Standings Phase 3
**File**: `src/sql/migrations/pg/008_football_standings_phase3.sql`

Changes:
- **RENAMED** to avoid collision with basketball tables:
  - `team_match_stats` → `football_team_match_stats`
  - `player_match_stats` → `football_player_match_stats`
- `CREATE TYPE progression_status AS ENUM(...)`
- Tables: `standings` (ALTER — add fair_play_points, home/away splits), `h2h_standings`, `football_team_match_stats`, `football_player_match_stats`, `tournament_progression`, `tournament_tie_breakers`, `league_table_snapshots`
- `CHECK (points >= 0)`, `CHECK (played >= 0)`

#### Step 2.10: Migration 009 — Cricket Enhanced Engine
**File**: `src/sql/migrations/pg/009_cricket_enhanced_engine.sql`

Changes:
- `CREATE TYPE review_decision AS ENUM(...)`
- `CREATE TYPE super_over_status AS ENUM(...)`
- `CREATE TYPE match_phase AS ENUM(...)`
- Tables: `cricket_dls_wicket_resources`, `cricket_player_reviews`, `cricket_review_configs`, `cricket_super_overs`, `cricket_super_over_deliveries`, `cricket_match_analytics`, `cricket_fallow_overs`, `cricket_followon_logs`
- `CHECK (resource_percentage BETWEEN 0 AND 100)`
- DLS wicket resource seed data

#### Step 2.11: Migration 010 — RBAC Cleanup
**File**: `src/sql/migrations/pg/010_rbac_cleanup.sql`

Changes:
- `ALTER TABLE roles ADD COLUMN organization_id UUID`
- `ALTER TABLE roles ADD COLUMN created_by UUID REFERENCES users(id)`
- `ALTER TABLE roles ADD COLUMN updated_by UUID REFERENCES users(id)`
- `ALTER TABLE user_roles ADD COLUMN updated_by UUID REFERENCES users(id)`
- `ALTER TABLE permissions ADD COLUMN deleted_at TIMESTAMPTZ`
- `ALTER TABLE role_permissions ADD COLUMN deleted_at TIMESTAMPTZ`
- `ALTER TABLE subscriptions ADD COLUMN deleted_at TIMESTAMPTZ`
- `ALTER TABLE organizations ADD COLUMN status VARCHAR(20) DEFAULT 'active'`
- `ALTER TABLE organizations ADD COLUMN feature_flags JSONB DEFAULT '{}'`
- `ALTER TABLE users ADD COLUMN must_change_password BOOLEAN DEFAULT FALSE`
- `CREATE TABLE role_navigation` with JSONB navigation config
- **Full FK constraints** on all `created_by`, `updated_by`, `reversed_by`, `corrected_by` columns

#### Step 2.12: Migration 011 — Basketball Engine
**File**: `src/sql/migrations/pg/011_basketball_engine.sql`

Changes:
- **RENAMED** to avoid collision with football tables:
  - `team_match_stats` → `basketball_team_match_stats`
  - `player_match_stats` → `basketball_player_match_stats`
- `CREATE TYPE shot_clock_event_type AS ENUM(...)`
- `CREATE TYPE foul_type AS ENUM(...)`
- `CREATE TYPE bonus_status AS ENUM(...)`
- `CREATE TYPE shot_type AS ENUM(...)`
- `CREATE TYPE timeout_type AS ENUM(...)`
- `CREATE TYPE jump_ball_type AS ENUM(...)`
- Tables: `match_possession`, `shot_clock_events`, `player_fouls`, `team_foul_counters`, `free_throw_sequences`, `timeout_events`, `jump_ball_events`, `basketball_player_match_stats`, `basketball_team_match_stats`, `clock_sync_log`
- `ALTER TABLE matches ADD COLUMN current_possession_team_id UUID`
- `ALTER TABLE matches ADD COLUMN shot_clock_seconds INT DEFAULT 24`
- `ALTER TABLE matches ADD COLUMN game_clock_seconds INT DEFAULT 720`
- `ALTER TABLE matches ADD COLUMN current_quarter INT DEFAULT 1`
- `ALTER TABLE matches ADD COLUMN overtime_count INT DEFAULT 0`
- `CHECK (quarter BETWEEN 1 AND 5)`, `CHECK (points >= 0)`

#### Step 2.13: Migration 012 — Seed RBAC Properly
**File**: `src/sql/migrations/pg/012_seed_rbac_properly.sql`

Changes:
- `INSERT ... ON CONFLICT DO NOTHING` instead of `INSERT IGNORE`
- `json_build_array()` and `json_build_object()` instead of `JSON_ARRAY()`/`JSON_OBJECT()`
- Seeds: Super Admin permissions, Super Admin role assignment, role navigation config for all 6 roles

#### Step 2.14: Migration 013 — Public Features
**File**: `src/sql/migrations/pg/013_public_features.sql`

New tables/columns:
- `ALTER TABLE users ADD COLUMN user_type VARCHAR(20) DEFAULT 'dashboard'`
- `CREATE TABLE user_free_matches` — tracks free match quota per public user
- `CREATE OR REPLACE FUNCTION fn_create_free_match_quota()` — auto-creates quota row on public user registration
- `CREATE TRIGGER trg_create_free_match_quota` — fires on INSERT to users

---

### Phase 3: Migration Runner
**Goal**: PostgreSQL migration runner with tracking

#### Step 3.1: Create `src/sql/migrations/pg-run.js`
- Connects via `DATABASE_URL`
- Creates `schema_migrations` table if not exists:
  ```sql
  CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(10) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW(),
      hash VARCHAR(64) NOT NULL
  )
  ```
- Reads all `.sql` files from `pg/` directory, sorts by version
- Skips already-applied migrations (checks `schema_migrations`)
- Calculates SHA-256 hash of each SQL file, stores it
- Executes migrations in order within a transaction
- Logs progress

---

### Phase 4: Multi-Tenant Security
**Goal**: Strict tenant isolation at middleware level

#### Step 4.1: Create `src/core/middleware/tenant.js`

```
resolveTenant() middleware flow:
1. Skip for public endpoints (/api/public/*, /api/auth/*, /health)
2. Try to resolve organization_id from:
   a. req.headers['x-organization-id']
   b. req.body.organization_id
   c. req.query.organization_id
   d. Derive from resource (match → tournament → org)
3. If no org_id found and endpoint requires it → 400
4. If user is authenticated:
   a. Check if user is a member of the organization
   b. If not → 403 Forbidden
5. Set req.tenant = { organizationId }
6. Call next()
```

#### Step 4.2: Update `src/core/middleware/requirePermission.js`
- Use `req.tenant.organizationId` instead of reading from body/query
- Check RBAC with org scope
- Fall back to global permissions if org-scoped not found

#### Step 4.3: Update `src/core/websocket/index.js`
- On `subscribe` event: verify user has access to resource
- Public matches: anyone can subscribe
- Private matches: only org members can subscribe
- Track subscriptions per socket, reject unauthorized

---

### Phase 5: Environment & App Configuration
**Goal**: Update all config files for PostgreSQL

#### Step 5.1: Update `src/core/env.js`
- Remove MySQL required vars (`MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_DATABASE`)
- Add `DATABASE_URL` as required
- Add PG pool config vars (optional with defaults)

#### Step 5.2: Update `src/app/index.js`
- Import from `../infrastructure/postgres/index.js` instead of `mysql`
- Use `db.createPool()` → PG pool init
- Add `tenantMiddleware` before route handlers
- Update health check to use PG health check

#### Step 5.3: Update `package.json`
- Remove `mysql2` from dependencies
- Add `pg` to dependencies
- Update `migrate` script: `node src/sql/migrations/pg-run.js`

#### Step 5.4: Update `.env`
- Remove `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`
- Keep `DATABASE_URL` (Neon Postgres connection)
- Keep `PG_POOL_MIN`, `PG_POOL_MAX`, `PG_POOL_IDLE_TIMEOUT`

#### Step 5.5: Update `.env.example`
- Same as above, with placeholder values

#### Step 5.6: Update `docker-compose.yml`
- Remove MySQL service (or comment out)
- No local DB needed — using Neon cloud

---

### Phase 6: Public Portal + Free Match Feature
**Goal**: Public user registration, login, and free match creation

#### Step 6.1: Update `src/core/auth/service.js`
- Add `registerPublicUser(data)` method:
  - Creates user with `user_type='public'`
  - Triggers `user_free_matches` row via DB trigger
  - Returns JWT pair
- Update `register(data)` to support `user_type` field
- Update JWT payload to include `user_type`

#### Step 6.2: Update `src/core/auth/routes.js`
- Add `POST /api/auth/register/public` — public user registration
- Existing `POST /api/auth/register` — dashboard user registration
- Existing `POST /api/auth/login` — works for both user types

#### Step 6.3: Create `src/domains/public/services/publicMatchService.js`

```
checkQuota(userId):
  → SELECT from user_free_matches WHERE user_id = ?
  → Returns { allocated, used, remaining }

createMatch(userId, data):
  1. Check quota (remaining > 0) → 403 if exceeded
  2. If first match (matches_used === 0):
     a. Auto-create org: "{username}-free-{random8chars}"
     b. Add user as 'owner' member
     c. Assign RBAC 'owner' role
     d. Update user_free_matches.first_match_org_id
  3. Create or find tournament under that org
  4. Create match under tournament
  5. Increment matches_used in user_free_matches
  6. Return { match, tournament, organization }
```

#### Step 6.4: Update `src/domains/public/routes.js`

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/public/tournaments` | GET | None | Browse tournaments (+ `?org_id=`, `?sport=` filters) |
| `/api/public/tournaments/:id` | GET | None | Tournament details |
| `/api/public/tournaments/:id/matches` | GET | None | Tournament matches |
| `/api/public/tournaments/:id/standings` | GET | None | Live standings |
| `/api/public/matches/:id` | GET | None | Match details |
| `/api/public/matches/:id/score` | GET | **None** | **Live score — no login** |
| `/api/public/sports` | GET | None | All active sports |
| `/api/public/search` | GET | None | Global search |
| `/api/public/users/register` | POST | None | Public user registration |
| `/api/public/users/login` | POST | None | Public user login |
| `/api/public/user/quota` | GET | JWT | Check free match quota |
| `/api/public/matches/create` | POST | JWT | Create free match |

---

### Phase 7: Update All Domain Files
**Goal**: Replace MySQL imports with PostgreSQL, fix MySQL-specific code

#### Step 7.1: Batch Import Replacement
In all 61 files that import from `infrastructure/mysql`:
```
import db from '../../../infrastructure/mysql/index.js'
→
import db from '../../../infrastructure/postgres/index.js'
```

#### Step 7.2: Fix `affectedRows` → `rowCount`
In 25 locations across repositories:
```
result.affectedRows > 0
→
result.rowCount > 0
```

Files affected:
- `src/domains/matches/repositories/matchRepository.js` (2)
- `src/domains/tournaments/repositories/tournamentRepository.js` (2)
- `src/domains/players/repositories/playerRepository.js` (2)
- `src/domains/teams/repositories/teamRepository.js` (1)
- `src/domains/scoring/services/scoringService.js` (1)
- `src/domains/visualization/repositories/tacticalRepository.js` (2)
- `src/domains/overlays/repositories/overlayRepository.js` (2)
- `src/domains/notifications/repositories/notificationRepository.js` (2)
- `src/domains/sync/repositories/deviceRepository.js` (1)
- `src/domains/sync/repositories/syncQueueRepository.js` (2)
- `src/domains/tournaments/repositories/sportRepository.js` (1)
- `src/domains/organizations/repositories/invitationRepository.js` (3)
- `src/domains/organizations/repositories/membershipRepository.js` (2)
- `src/domains/organizations/repositories/organizationRepository.js` (1)
- `src/domains/organizations/repositories/userRepository.js` (1)

#### Step 7.3: Fix `DATE_ADD` → PG Interval
In 3 locations:
```
DATE_ADD(NOW(), INTERVAL 1 MONTH)
→
NOW() + INTERVAL '1 month'
```

Files:
- `src/domains/admin/services/adminService.js` (2)
- `src/domains/billing/services/billingService.js` (1)

---

### Phase 8: Scoring Edge Cases + Bug Fixes
**Goal**: Fix scoring security, edge cases, and billing bugs

#### Step 8.1: Update `src/domains/scoring/services/scoringService.js`
- Add tenant check: verify user has `match:score` permission
- Fix `_matchIdContext` bug (remove broken `connection._matchIdContext` reference)
- `affectedRows` → `rowCount`
- Add rate limiting: max 30 events per minute per match

#### Step 8.2: Update `src/core/middleware/enforceLimits.js`
- Change free tier tournaments: `1` → `5`
- Fix typo: `tournements` → `tournaments` in comparison logic
- Add skip for public users creating their first org

#### Step 8.3: Update `src/domains/billing/services/billingService.js`
- Fix typo: `tournements` → `tournaments`
- Consolidate plan definitions (currently duplicated with enforceLimits.js)

---

### Phase 9: Cleanup
**Goal**: Remove all MySQL-related files

#### Step 9.1: Delete Files
```
src/infrastructure/mysql/index.js
src/infrastructure/mysql/baseRepository.js
src/core/database/pg.js (legacy unused file)
src/sql/migrations/001_initial_schema.sql
src/sql/migrations/002_matches_and_scoring.sql
src/sql/migrations/003_audit_sync_notifications.sql
src/sql/migrations/003_football_phase1.sql
src/sql/migrations/004_analytics_audit_billing.sql
src/sql/migrations/004_football_var_penalty_phase2.sql
src/sql/migrations/005_cricket_engine.sql
src/sql/migrations/005_football_standings_phase3.sql
src/sql/migrations/006_cricket_enhanced_engine.sql
src/sql/migrations/006_rbac_cleanup.sql
src/sql/migrations/007_basketball_engine.sql
src/sql/migrations/007_seed_rbac_properly.sql
```

---

## PostgreSQL vs MySQL Syntax Reference

| MySQL | PostgreSQL |
|-------|-----------|
| `CHAR(36)` | `UUID` |
| `JSON` | `JSONB` |
| `BOOLEAN` (TINYINT) | `BOOLEAN` (native) |
| `ENUM('a','b')` inline | `CREATE TYPE name AS ENUM('a','b')` |
| `TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` | `TIMESTAMPTZ DEFAULT NOW()` + trigger |
| `AUTO_INCREMENT` | `GENERATED ALWAYS AS IDENTITY` |
| `INDEX idx(col)` in CREATE TABLE | `CREATE INDEX idx ON table(col)` after |
| `ENGINE=InnoDB CHARSET=utf8mb4` | Remove |
| `FOREIGN_KEY_CHECKS = 0` | Remove |
| `SET NAMES utf8mb4` | Remove |
| `result.affectedRows` | `result.rowCount` |
| `INSERT IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` |
| `ON DUPLICATE KEY UPDATE` | `ON CONFLICT (...) DO UPDATE SET` |
| `UUID()` | `gen_random_uuid()` |
| `NOW()` | `NOW()` ✓ |
| `LIMIT ? OFFSET ?` | Same ✓ |
| `DATE_ADD(NOW(), INTERVAL 1 MONTH)` | `NOW() + INTERVAL '1 month'` |
| `IFNULL(a, b)` | `COALESCE(a, b)` |
| `JSON_ARRAY(...)` | `json_build_array(...)` |
| `JSON_OBJECT(...)` | `json_build_object(...)` |
| `?` placeholders | `$1, $2, $3...` |

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Migration SQL syntax errors | Medium | Test each migration individually against Neon DB |
| `affectedRows` → `rowCount` missed in some files | Medium | Grep for `affectedRows` after all changes |
| Tenant middleware breaks existing flows | High | Skip for public endpoints, test each route |
| Public user auto-create org conflicts | Low | Use unique slug with random suffix |
| WebSocket room authorization breaks real-time | Medium | Test with multiple clients simultaneously |
| `DATE_ADD` fix missed in some files | Low | Only 3 occurrences, easy to verify |

---

## Testing Checklist

After all phases complete:

- [ ] Run `npm run migrate` → all 13 migrations apply successfully
- [ ] Run `npm run seed` → seed data inserts without errors
- [ ] `GET /health` → returns healthy with PG connection
- [ ] Register public user → `user_type='public'`, `user_free_matches` row created
- [ ] Login as public user → JWT contains `user_type`
- [ ] Create free match as public user → org auto-created, match created, quota decremented
- [ ] Create 6th match → 403 "quota exceeded"
- [ ] Register dashboard user → `user_type='dashboard'`
- [ ] Create org as dashboard user → owner role assigned
- [ ] Invite staff member → role + permissions assigned
- [ ] Access /api/public/matches/:id/score → no auth required, returns score
- [ ] Access /api/tournaments without auth → 401 Unauthorized
- [ ] Access another org's data → 403 Forbidden
- [ ] WebSocket subscribe to match → authorized users receive events
- [ ] WebSocket subscribe to unauthorized match → rejected
- [ ] Score a live match → events created, score updated, broadcast sent
- [ ] Undo scoring event → score recalculated, audit log created
- [ ] Free tier: create 6th tournament → 403 "plan limit reached"
