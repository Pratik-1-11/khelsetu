import db from '../../../infrastructure/postgres/index.js';
import { NotFoundError, ForbiddenError } from '../../../core/errors/index.js';
import { v4 as uuidv4 } from 'uuid';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    interval: 'month',
    features: {
      tournaments: 5,
      teams: 10,
      players: 50,
      matches: 100,
      storage_mb: 100,
      users: 5
    }
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 999,
    interval: 'month',
    features: {
      tournaments: 20,
      teams: 50,
      players: 200,
      matches: 500,
      storage_mb: 500,
      users: 20
    }
  },
  {
    id: 'professional',
    name: 'Professional',
    price: 2999,
    interval: 'month',
    features: {
      tournaments: 100,
      teams: 200,
      players: 1000,
      matches: 2000,
      storage_mb: 2000,
      users: 50
    }
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 9999,
    interval: 'month',
    features: {
      tournaments: -1,
      teams: -1,
      players: -1,
      matches: -1,
      storage_mb: -1,
      users: -1
    }
  }
];

class BillingService {
  async getAvailablePlans() {
    return PLANS.map(p => ({
      id: p.id,
      name: p.name,
      price: p.price,
      interval: p.interval,
      features: p.features,
      is_free: p.price === 0
    }));
  }

  async getOrganizationSubscription(organizationId, userId) {
    const connection = await db.getConnection();
    try {
      const [orgCheck] = await connection.query(
        `SELECT om.role FROM organization_members om
         WHERE om.organization_id = ? AND om.user_id = ? AND om.is_active = TRUE`,
        [organizationId, userId]
      );
      if (!orgCheck.length) throw new ForbiddenError('Access denied');
      if (orgCheck[0].role !== 'admin') throw new ForbiddenError('Only admins can view billing');

      const [subscription] = await connection.query(
        `SELECT * FROM subscriptions WHERE organization_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
        [organizationId]
      );

      if (!subscription.length) {
        const plan = PLANS.find(p => p.id === 'free');
        return {
          status: 'active',
          plan: 'free',
          plan_details: plan,
          usage: await this.getUsageInternal(connection, organizationId, plan)
        };
      }

      const plan = PLANS.find(p => p.id === subscription[0].plan_id) || PLANS[0];
      return {
        ...subscription[0],
        plan_details: plan,
        usage: await this.getUsageInternal(connection, organizationId, plan)
      };
    } finally {
      connection.release();
    }
  }

  async getUsageInternal(connection, organizationId, plan) {
    const [[tournamentCount]] = await connection.query(
      `SELECT COUNT(*) as count FROM tournaments WHERE organization_id = ? AND deleted_at IS NULL`,
      [organizationId]
    );

    const [[teamCount]] = await connection.query(
      `SELECT COUNT(*) as count FROM teams WHERE organization_id = ? AND deleted_at IS NULL`,
      [organizationId]
    );

    const [[playerCount]] = await connection.query(
      `SELECT COUNT(*) as count FROM players WHERE organization_id = ? AND deleted_at IS NULL`,
      [organizationId]
    );

    const [[matchCount]] = await connection.query(
      `SELECT COUNT(*) as count FROM matches m
       JOIN tournaments t ON m.tournament_id = t.id
       WHERE t.organization_id = ? AND m.deleted_at IS NULL`,
      [organizationId]
    );

    return {
      tournaments: { current: tournamentCount.count, limit: plan.features.tournaments, exceeded: plan.features.tournaments !== -1 && tournamentCount.count >= plan.features.tournaments },
      teams: { current: teamCount.count, limit: plan.features.teams, exceeded: plan.features.teams !== -1 && teamCount.count >= plan.features.teams },
      players: { current: playerCount.count, limit: plan.features.players, exceeded: plan.features.players !== -1 && playerCount.count >= plan.features.players },
      matches: { current: matchCount.count, limit: plan.features.matches, exceeded: plan.features.matches !== -1 && matchCount.count >= plan.features.matches }
    };
  }

  async createSubscription(userId, data) {
    const connection = await db.getConnection();
    try {
      const [orgCheck] = await connection.query(
        `SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ? AND is_active = TRUE`,
        [data.organization_id, userId]
      );
      if (!orgCheck.length) throw new ForbiddenError('Access denied');
      if (orgCheck[0].role !== 'admin') throw new ForbiddenError('Only admins can create subscriptions');

      const plan = PLANS.find(p => p.id === data.plan_id);
      if (!plan) throw new NotFoundError('Plan not found');

      const existingSub = await connection.query(
        `SELECT id FROM subscriptions WHERE organization_id = ? AND status = 'active'`,
        [data.organization_id]
      );

      const subscriptionId = existingSub[0]?.length ? existingSub[0][0].id : uuidv4();
      const status = 'active';

      if (existingSub[0]?.length) {
        await connection.query(
          `UPDATE subscriptions SET plan_id = ?, status = ?, updated_at = NOW() WHERE id = ?`,
          [data.plan_id, status, subscriptionId]
        );
      } else {
        await connection.query(
          `INSERT INTO subscriptions (id, organization_id, plan_id, status, current_period_start, current_period_end)
           VALUES (?, ?, ?, ?, NOW(), NOW() + INTERVAL '1 month')`,
          [subscriptionId, data.organization_id, data.plan_id, status]
        );
      }

      return { id: subscriptionId, plan_id: data.plan_id, status, plan_details: plan };
    } finally {
      connection.release();
    }
  }

  async updateSubscription(subscriptionId, userId, data) {
    const connection = await db.getConnection();
    try {
      const [subscription] = await connection.query(
        `SELECT s.*, om.role FROM subscriptions s
         JOIN organization_members om ON s.organization_id = om.organization_id
         WHERE s.id = ? AND om.user_id = ? AND om.is_active = TRUE`,
        [subscriptionId, userId]
      );
      if (!subscription.length) throw new NotFoundError('Subscription not found');
      if (subscription[0].role !== 'admin') throw new ForbiddenError('Only admins can update subscriptions');

      const updates = [];
      const params = [];

      if (data.plan_id) {
        const plan = PLANS.find(p => p.id === data.plan_id);
        if (!plan) throw new NotFoundError('Plan not found');
        updates.push('plan_id = ?');
        params.push(data.plan_id);
      }

      if (data.status) {
        updates.push('status = ?');
        params.push(data.status);
      }

      if (updates.length > 0) {
        params.push(subscriptionId);
        await connection.query(
          `UPDATE subscriptions SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
          params
        );
      }

      const [updated] = await connection.query(`SELECT * FROM subscriptions WHERE id = ?`, [subscriptionId]);
      return updated[0];
    } finally {
      connection.release();
    }
  }

  async cancelSubscription(subscriptionId, userId) {
    const connection = await db.getConnection();
    try {
      const [subscription] = await connection.query(
        `SELECT s.*, om.role FROM subscriptions s
         JOIN organization_members om ON s.organization_id = om.organization_id
         WHERE s.id = ? AND om.user_id = ? AND om.is_active = TRUE`,
        [subscriptionId, userId]
      );
      if (!subscription.length) throw new NotFoundError('Subscription not found');
      if (subscription[0].role !== 'admin') throw new ForbiddenError('Only admins can cancel subscriptions');

      await connection.query(
        `UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE id = ?`,
        [subscriptionId]
      );

      return { message: 'Subscription cancelled successfully' };
    } finally {
      connection.release();
    }
  }

  async getInvoices(organizationId, userId, options = {}) {
    const { start_date, end_date, status, page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const connection = await db.getConnection();
    try {
      const [orgCheck] = await connection.query(
        `SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ? AND is_active = TRUE`,
        [organizationId, userId]
      );
      if (!orgCheck.length) throw new ForbiddenError('Access denied');
      if (orgCheck[0].role !== 'admin') throw new ForbiddenError('Only admins can view invoices');

      let whereClause = 'organization_id = ?';
      const params = [organizationId];

      if (start_date && end_date) {
        whereClause += ' AND created_at BETWEEN ? AND ?';
        params.push(start_date, end_date);
      }

      if (status) {
        whereClause += ' AND status = ?';
        params.push(status);
      }

      const [invoices] = await connection.query(
        `SELECT * FROM invoices WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      const [[total]] = await connection.query(
        `SELECT COUNT(*) as count FROM invoices WHERE ${whereClause}`,
        params
      );

      return {
        data: invoices,
        pagination: { page, limit, total: total.count, pages: Math.ceil(total.count / limit) }
      };
    } finally {
      connection.release();
    }
  }

  async getInvoice(invoiceId, userId) {
    const connection = await db.getConnection();
    try {
      const [invoice] = await connection.query(
        `SELECT i.*, om.role FROM invoices i
         JOIN organization_members om ON i.organization_id = om.organization_id
         WHERE i.id = ? AND om.user_id = ? AND om.is_active = TRUE`,
        [invoiceId, userId]
      );
      if (!invoice.length) throw new NotFoundError('Invoice not found');
      if (invoice[0].role !== 'admin') throw new ForbiddenError('Only admins can view invoices');
      return invoice[0];
    } finally {
      connection.release();
    }
  }

  async getUsage(organizationId, userId) {
    const connection = await db.getConnection();
    try {
      const [subscription] = await connection.query(
        `SELECT plan_id FROM subscriptions WHERE organization_id = ? AND status = 'active'`,
        [organizationId]
      );

      const plan = PLANS.find(p => p.id === (subscription[0]?.plan_id || 'free'));
      return await this.getUsageInternal(connection, organizationId, plan);
    } finally {
      connection.release();
    }
  }

  async getPaymentMethods(organizationId, userId) {
    const connection = await db.getConnection();
    try {
      const [orgCheck] = await connection.query(
        `SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ? AND is_active = TRUE`,
        [organizationId, userId]
      );
      if (!orgCheck.length) throw new ForbiddenError('Access denied');
      if (orgCheck[0].role !== 'admin') throw new ForbiddenError('Only admins can manage payment methods');

      const [methods] = await connection.query(
        `SELECT id, type, last_four, brand, is_default, created_at FROM payment_methods 
         WHERE organization_id = ? AND is_active = TRUE ORDER BY is_default DESC`,
        [organizationId]
      );

      return methods;
    } finally {
      connection.release();
    }
  }

  async addPaymentMethod(userId, data) {
    const connection = await db.getConnection();
    try {
      const [orgCheck] = await connection.query(
        `SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ? AND is_active = TRUE`,
        [data.organization_id, userId]
      );
      if (!orgCheck.length) throw new ForbiddenError('Access denied');
      if (orgCheck[0].role !== 'admin') throw new ForbiddenError('Only admins can add payment methods');

      const methodId = uuidv4();
      await connection.query(
        `INSERT INTO payment_methods (id, organization_id, type, token, last_four, brand, is_default)
         VALUES (?, ?, ?, ?, ?, ?, FALSE)`,
        [methodId, data.organization_id, data.type, data.token, data.last_four || null, data.brand || null]
      );

      return { id: methodId, type: data.type, last_four: data.last_four, brand: data.brand };
    } finally {
      connection.release();
    }
  }

  async removePaymentMethod(methodId, userId) {
    const connection = await db.getConnection();
    try {
      const [method] = await connection.query(
        `SELECT pm.*, om.role FROM payment_methods pm
         JOIN organization_members om ON pm.organization_id = om.organization_id
         WHERE pm.id = ? AND om.user_id = ? AND om.is_active = TRUE`,
        [methodId, userId]
      );
      if (!method.length) throw new NotFoundError('Payment method not found');
      if (method[0].role !== 'admin') throw new ForbiddenError('Only admins can remove payment methods');

      await connection.query(
        `UPDATE payment_methods SET is_active = FALSE WHERE id = ?`,
        [methodId]
      );

      return { message: 'Payment method removed' };
    } finally {
      connection.release();
    }
  }

  async handleWebhook(payload, headers) {
    const eventType = payload.type || headers['x-webhook-event'];
    
    switch (eventType) {
      case 'payment.succeeded':
        await this.handlePaymentSuccess(payload.data);
        break;
      case 'payment.failed':
        await this.handlePaymentFailure(payload.data);
        break;
      case 'subscription.created':
        await this.handleSubscriptionCreated(payload.data);
        break;
      case 'subscription.cancelled':
        await this.handleSubscriptionCancelled(payload.data);
        break;
      default:
        console.log('Unhandled webhook event:', eventType);
    }

    return { received: true };
  }

  async handlePaymentSuccess(data) {
    const connection = await db.getConnection();
    try {
      await connection.query(
        `UPDATE invoices SET status = 'paid', paid_at = NOW() WHERE external_id = ?`,
        [data.invoice_id]
      );
    } finally {
      connection.release();
    }
  }

  async handlePaymentFailure(data) {
    console.log('Payment failed:', data);
  }

  async handleSubscriptionCreated(data) {
    console.log('Subscription created:', data);
  }

  async handleSubscriptionCancelled(data) {
    const connection = await db.getConnection();
    try {
      await connection.query(
        `UPDATE subscriptions SET status = 'cancelled' WHERE external_id = ?`,
        [data.subscription_id]
      );
    } finally {
      connection.release();
    }
  }
}

export default new BillingService();