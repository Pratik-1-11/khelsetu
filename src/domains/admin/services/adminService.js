import db from '../../../infrastructure/postgres/index.js';
import userRepository from '../../organizations/repositories/userRepository.js';
import organizationRepository from '../../organizations/repositories/organizationRepository.js';
import membershipRepository from '../../organizations/repositories/membershipRepository.js';
import rbacService from '../../rbac/services/rbacService.js';
import { NotFoundError, ConflictError } from '../../../core/errors/index.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import logger from '../../../core/logger/index.js';

class AdminService {

  // ─── USER MANAGEMENT ───

  async createUser(data, adminUserId) {
    const existing = await userRepository.findByEmail(data.email);
    if (existing) throw new ConflictError('Email already exists');

    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await userRepository.create({
      email: data.email,
      password_hash: passwordHash,
      first_name: data.first_name,
      last_name: data.last_name || null,
      phone: data.phone || null,
      is_active: true,
      must_change_password: data.must_change_password !== false,
      metadata: { created_by: adminUserId, created_via: 'admin' }
    });

    return userRepository.findById(user.id);
  }

  async listUsers(options = {}) {
    return userRepository.findAll(options);
  }

  async getUser(userId, adminUserId) {
    const user = await userRepository.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    const orgs = await userRepository.getUserOrganizations(userId);
    const roles = await rbacService.getUserRoles(userId);

    return { ...user, organizations: orgs, roles };
  }

  async updateUser(userId, data, adminUserId) {
    const allowed = ['first_name', 'last_name', 'phone', 'is_active'];
    const updateData = {};
    for (const f of allowed) {
      if (data[f] !== undefined) updateData[f] = data[f];
    }
    return userRepository.update(userId, updateData);
  }

  async resetPassword(userId, newPassword, adminUserId) {
    const hash = await bcrypt.hash(newPassword, 12);
    await userRepository.updatePassword(userId, hash);
    await userRepository.update(userId, { must_change_password: true });
  }

  async toggleUser(userId, adminUserId) {
    const user = await userRepository.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    const newStatus = !user.is_active;
    await userRepository.update(userId, { is_active: newStatus });
    return { ...user, is_active: newStatus };
  }

  // ─── TENANT ONBOARDING ───

  async onboardTenant(data, adminUserId) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Step 1: Create or find owner user
      let ownerUser = await userRepository.findByEmail(data.owner.email);
      if (!ownerUser) {
        const hash = await bcrypt.hash(data.owner.password, 12);
        const newUser = await userRepository.create({
          email: data.owner.email,
          password_hash: hash,
          first_name: data.owner.first_name,
          last_name: data.owner.last_name || null,
          phone: data.owner.phone || null,
          is_active: true,
          must_change_password: true,
          metadata: { created_by: adminUserId, created_via: 'tenant_onboarding' }
        });
        ownerUser = newUser;
      } else if (!ownerUser.is_active) {
        await userRepository.update(ownerUser.id, { is_active: true });
      }

      // Step 2: Create organization
      const slug = data.org.slug || this._generateSlug(data.org.name);
      const existingOrg = await organizationRepository.findBySlug(slug);
      if (existingOrg) throw new ConflictError('Organization slug already exists');

      const org = await organizationRepository.create({
        name: data.org.name,
        slug,
        description: data.org.description || null,
        website: data.org.website || null,
        contact_email: data.org.contact_email || data.owner.email,
        contact_phone: data.org.contact_phone || null,
        settings: data.org.settings || {},
        feature_flags: data.org.feature_flags || {},
        metadata: { created_by: adminUserId, created_via: 'admin_onboarding' }
      });

      // Step 3: Add owner to organization_members
      await membershipRepository.create({
        organization_id: org.id,
        user_id: ownerUser.id,
        role: 'owner',
        is_active: true
      });

      // Step 4: Assign RBAC 'owner' role
      const ownerRole = await this._getRoleByName('owner');
      if (ownerRole) {
        await rbacService.assignRoleToUser(ownerUser.id, adminUserId, {
          role_id: ownerRole.id,
          organization_id: org.id
        });
      }

      // Step 5: Create subscription with assigned plan
      const planId = data.subscription?.plan_id || 'free';
      const periodMonths = data.subscription?.period_months || 1;
      const trialDays = data.subscription?.trial_days || 0;
      const startDate = new Date();
      if (trialDays > 0) {
        startDate.setDate(startDate.getDate() + trialDays);
      }
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + periodMonths);

      await connection.query(
        `INSERT INTO subscriptions (id, organization_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, $3, 'active', $4, $5)`,
        [uuidv4(), org.id, planId, startDate, endDate]
      );

      await connection.commit();

      const { password_hash, ...sanitizedOwner } = ownerUser;

      return {
        organization: org,
        owner: sanitizedOwner,
        subscription: {
          plan_id: planId,
          status: 'active',
          trial_days: trialDays,
          current_period_start: startDate,
          current_period_end: endDate,
        },
        login_url: (process.env.CLIENT_URL || 'http://localhost:5173') + '/login',
        credentials_sent: data.send_invitation !== false
      };

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async listTenants(options = {}) {
    const { page = 1, limit = 20, status, search } = options;
    const offset = (page - 1) * limit;

    let where = '1=1';
    const params = [];

    if (status) { where += ' AND o.status = ?'; params.push(status); }
    if (search) { where += ' AND (o.name LIKE ? OR o.slug LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const [orgs] = await db.query(
      `SELECT o.*,
         (SELECT COUNT(*) FROM organization_members om WHERE om.organization_id = o.id AND om.is_active = TRUE) as member_count,
         (SELECT s.plan_id FROM subscriptions s WHERE s.organization_id = o.id AND s.status = 'active' ORDER BY s.created_at DESC LIMIT 1) as active_plan
       FROM organizations o
       WHERE ${where} AND o.deleted_at IS NULL
       ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[total]] = await db.query(
      `SELECT COUNT(*) as count FROM organizations WHERE ${where} AND deleted_at IS NULL`,
      params
    );

    return {
      data: orgs,
      pagination: { page, limit, total: total.count, totalPages: Math.ceil(total.count / limit) }
    };
  }

  async getTenant(orgId, adminUserId) {
    const org = await organizationRepository.findById(orgId);
    if (!org) throw new NotFoundError('Tenant not found');

    const [members] = await db.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, om.role, om.joined_at
       FROM organization_members om JOIN users u ON om.user_id = u.id
       WHERE om.organization_id = ? AND om.is_active = TRUE`,
      [orgId]
    );

    const [subscription] = await db.query(
      `SELECT * FROM subscriptions WHERE organization_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
      [orgId]
    );

    const usage = await this._getUsage(orgId);

    return { ...org, members, subscription: subscription[0] || null, usage };
  }

  async updateTenant(orgId, data, adminUserId) {
    const allowed = ['name', 'description', 'status', 'feature_flags', 'settings'];
    const updateData = {};
    for (const f of allowed) {
      if (data[f] !== undefined) updateData[f] = f === 'feature_flags' || f === 'settings' ? JSON.stringify(data[f]) : data[f];
    }
    return organizationRepository.update(orgId, updateData);
  }

  async suspendTenant(orgId, adminUserId) {
    return organizationRepository.update(orgId, { status: 'suspended' });
  }

  async activateTenant(orgId, adminUserId) {
    return organizationRepository.update(orgId, { status: 'active' });
  }

  async assignSubscription(orgId, data, adminUserId) {
    const planId = data.plan_id;
    const periodMonths = data.period_months || 1;
    const startDate = data.start_date ? new Date(data.start_date) : new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + periodMonths);

    const [existing] = await db.query(
      `SELECT id FROM subscriptions WHERE organization_id = $1 AND status = 'active'`,
      [orgId]
    );

    if (existing.length) {
      await db.query(`UPDATE subscriptions SET plan_id = $1, status = 'active', current_period_start = $2, current_period_end = $3, updated_at = NOW() WHERE id = $4`, [planId, startDate, endDate, existing[0].id]);
      return { id: existing[0].id, plan_id: planId, status: 'active', current_period_start: startDate, current_period_end: endDate };
    }

    const subId = uuidv4();
    await db.query(
      `INSERT INTO subscriptions (id, organization_id, plan_id, status, current_period_start, current_period_end)
       VALUES ($1, $2, $3, 'active', $4, $5)`,
      [subId, orgId, planId, startDate, endDate]
    );
    return { id: subId, plan_id: planId, status: 'active', current_period_start: startDate, current_period_end: endDate };
  }

  async getTenantUsage(orgId, adminUserId) {
    return this._getUsage(orgId);
  }

  async getDashboard() {
    const [[tenantStats]] = await db.query(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
         SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended,
         SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactive
       FROM organizations WHERE deleted_at IS NULL`
    );

    const [[userStats]] = await db.query(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) as active
       FROM users WHERE deleted_at IS NULL`
    );

    const [[revenue]] = await db.query(
      `SELECT COALESCE(SUM(p.price), 0) as monthly_recurring
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.status = 'active' AND s.deleted_at IS NULL`
    );

    const [planDist] = await db.query(
      `SELECT s.plan_id, COUNT(*) as count
       FROM subscriptions s
       WHERE s.status = 'active' AND s.deleted_at IS NULL
       GROUP BY s.plan_id`
    );

    const [recentTenants] = await db.query(
      `SELECT id, name, slug, status, created_at FROM organizations
       WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 10`
    );

    return {
      tenants: tenantStats,
      users: userStats,
      revenue: { monthly_recurring: Number(revenue.monthly_recurring) },
      plan_distribution: planDist,
      recent_tenants: recentTenants
    };
  }

  // ─── HELPERS ───

  _generateSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + uuidv4().substring(0, 8);
  }

  async _getRoleByName(name) {
    const [rows] = await db.query(`SELECT id FROM roles WHERE name = ? AND deleted_at IS NULL`, [name]);
    return rows[0] || null;
  }

  async _getUsage(orgId) {
    const [[tournamentCount]] = await db.query(
      `SELECT COUNT(*) as count FROM tournaments WHERE organization_id = ? AND deleted_at IS NULL`,
      [orgId]
    );
    const [[teamCount]] = await db.query(
      `SELECT COUNT(*) as count FROM teams WHERE organization_id = ? AND deleted_at IS NULL`,
      [orgId]
    );
    const [[playerCount]] = await db.query(
      `SELECT COUNT(*) as count FROM players WHERE organization_id = ? AND deleted_at IS NULL`,
      [orgId]
    );
    const [[matchCount]] = await db.query(
      `SELECT COUNT(*) as count FROM matches m JOIN tournaments t ON m.tournament_id = t.id WHERE t.organization_id = ? AND m.deleted_at IS NULL`,
      [orgId]
    );

    const [sub] = await db.query(
      `SELECT plan_id FROM subscriptions WHERE organization_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
      [orgId]
    );

    const plans = {
      free: { tournaments: 5, teams: 10, players: 50, matches: 100 },
      starter: { tournaments: 20, teams: 50, players: 200, matches: 500 },
      professional: { tournaments: 100, teams: 200, players: 1000, matches: 2000 },
      enterprise: { tournaments: -1, teams: -1, players: -1, matches: -1 }
    };

    const plan = plans[sub[0]?.plan_id || 'free'];

    return {
      tournaments: { current: tournamentCount.count, limit: plan.tournaments, exceeded: plan.tournaments !== -1 && tournamentCount.count >= plan.tournaments },
      teams: { current: teamCount.count, limit: plan.teams, exceeded: plan.teams !== -1 && teamCount.count >= plan.teams },
      players: { current: playerCount.count, limit: plan.players, exceeded: plan.players !== -1 && playerCount.count >= plan.players },
      matches: { current: matchCount.count, limit: plan.matches, exceeded: plan.matches !== -1 && matchCount.count >= plan.matches }
    };
  }
}

export default new AdminService();
