import organizationRepository from '../repositories/organizationRepository.js';
import membershipRepository from '../repositories/membershipRepository.js';
import invitationRepository from '../repositories/invitationRepository.js';
import userRepository from '../repositories/userRepository.js';
import rbacService from '../../rbac/services/rbacService.js';
import { ValidationError, NotFoundError, ConflictError, ForbiddenError } from '../../../core/errors/index.js';
import logger from '../../../core/logger/index.js';
import { generateUUID } from '../../../core/utils/index.js';
import db from '../../../infrastructure/postgres/index.js';

function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + generateUUID().substring(0, 8);
}

function generateToken() {
  return generateUUID().replace(/-/g, '');
}

const MEMBERSHIP_TO_RBAC = {
  owner: 'owner',
  admin: 'admin',
  tournament_admin: 'tournament_admin',
  scorer: 'scorer',
  coach: 'coach',
  viewer: 'viewer',
  member: 'viewer'
};

async function getRbacRoleByName(name) {
  const [rows] = await db.query(`SELECT id FROM roles WHERE name = ? AND deleted_at IS NULL`, [name]);
  return rows[0] || null;
}

async function assignRbacRole(userId, membershipRole, organizationId, assignedBy) {
  const rbacRoleName = MEMBERSHIP_TO_RBAC[membershipRole] || 'viewer';
  const rbacRole = await getRbacRoleByName(rbacRoleName);
  if (!rbacRole) return;

  const [existing] = await db.query(
    `SELECT id FROM user_roles WHERE user_id = ? AND role_id = ? AND organization_id = ? AND deleted_at IS NULL`,
    [userId, rbacRole.id, organizationId]
  );
  if (existing.length) return;

  await rbacService.assignRoleToUser(userId, assignedBy, {
    role_id: rbacRole.id,
    organization_id: organizationId
  });
}

async function removeRbacRole(userId, membershipRole, organizationId, removedBy) {
  const rbacRoleName = MEMBERSHIP_TO_RBAC[membershipRole] || 'viewer';
  const rbacRole = await getRbacRoleByName(rbacRoleName);
  if (!rbacRole) return;

  await db.query(
    `UPDATE user_roles SET deleted_at = NOW() WHERE user_id = ? AND role_id = ? AND organization_id = ? AND deleted_at IS NULL`,
    [userId, rbacRole.id, organizationId]
  );
}

export class OrganizationService {
  async create(data, creatorUserId) {
    const existing = await organizationRepository.findBySlug(data.slug || generateSlug(data.name));
    if (existing) {
      throw new ConflictError('Organization slug already exists');
    }

    const org = await organizationRepository.create({
      name: data.name,
      slug: data.slug || generateSlug(data.name),
      logo: data.logo,
      description: data.description,
      website: data.website,
      contact_email: data.contact_email,
      contact_phone: data.contact_phone,
      address: data.address,
      settings: data.settings || {},
      metadata: {}
    });

    await membershipRepository.create({
      organization_id: org.id,
      user_id: creatorUserId,
      role: 'owner',
      is_active: true
    });

    await assignRbacRole(creatorUserId, 'owner', org.id, creatorUserId);

    logger.info('Organization created', { orgId: org.id, creatorUserId });
    return org;
  }

  async getById(id, userId) {
    const org = await organizationRepository.findById(id);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    const isMember = await organizationRepository.isMember(userId, id);
    if (!isMember) {
      throw new ForbiddenError('Access denied');
    }

    return org;
  }

  async update(id, userId, data) {
    const isMember = await organizationRepository.isMember(userId, id);
    if (!isMember) {
      throw new ForbiddenError('Access denied');
    }

    const memberRole = await organizationRepository.getMemberRole(userId, id);
    if (memberRole !== 'owner' && memberRole !== 'admin') {
      throw new ForbiddenError('Insufficient permissions');
    }

    if (data.slug) {
      const existing = await organizationRepository.findBySlug(data.slug);
      if (existing && existing.id !== id) {
        throw new ConflictError('Organization slug already exists');
      }
    }

    return organizationRepository.update(id, data);
  }

  async delete(id, userId) {
    const isMember = await organizationRepository.isMember(userId, id);
    if (!isMember) {
      throw new ForbiddenError('Access denied');
    }

    const memberRole = await organizationRepository.getMemberRole(userId, id);
    if (memberRole !== 'owner') {
      throw new ForbiddenError('Only owner can delete organization');
    }

    return organizationRepository.softDelete(id);
  }

  async getAll(options = {}, userId) {
    if (userId) {
      const userOrgs = await userRepository.getUserOrganizations(userId);
      return { data: userOrgs.map(o => ({ ...o, member_role: o.member_role })), pagination: { page: 1, limit: 100, total: userOrgs.length } };
    }
    return organizationRepository.findAll(options);
  }

  async getMembers(organizationId, userId, options = {}) {
    const isMember = await organizationRepository.isMember(userId, organizationId);
    if (!isMember) {
      throw new ForbiddenError('Access denied');
    }
    return membershipRepository.findByOrganization(organizationId, options);
  }

  async invite(organizationId, userId, data) {
    const isMember = await organizationRepository.isMember(userId, organizationId);
    if (!isMember) {
      throw new ForbiddenError('Access denied');
    }

    const memberRole = await organizationRepository.getMemberRole(userId, organizationId);
    if (memberRole !== 'owner' && memberRole !== 'admin') {
      throw new ForbiddenError('Insufficient permissions to invite');
    }

    const existingUser = await userRepository.findByEmail(data.email);
    if (existingUser) {
      const alreadyMember = await organizationRepository.isMember(existingUser.id, organizationId);
      if (alreadyMember) {
        throw new ConflictError('User is already a member');
      }
    }

    const existingInvitation = await invitationRepository.findByEmailAndOrg(data.email, organizationId);
    if (existingInvitation) {
      throw new ConflictError('Invitation already sent to this email');
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invitation = await invitationRepository.create({
      organization_id: organizationId,
      email: data.email,
      role: data.role || 'member',
      token: generateToken(),
      expires_at: expiresAt,
      created_by: userId
    });

    logger.info('Invitation sent', { orgId: organizationId, email: data.email });
    return invitation;
  }

  async acceptInvitation(token, userId) {
    const invitation = await invitationRepository.findByToken(token);
    if (!invitation) {
      throw new NotFoundError('Invalid invitation token');
    }

    if (new Date(invitation.expires_at) < new Date()) {
      throw new ValidationError('Invitation has expired');
    }

    if (invitation.accepted_at) {
      throw new ValidationError('Invitation already used');
    }

    const existingMember = await membershipRepository.findByUserAndOrg(userId, invitation.organization_id);
    if (existingMember) {
      throw new ConflictError('You are already a member of this organization');
    }

    await membershipRepository.create({
      organization_id: invitation.organization_id,
      user_id: userId,
      role: invitation.role,
      is_active: true
    });

    await assignRbacRole(userId, invitation.role, invitation.organization_id, userId);

    await invitationRepository.accept(invitation.id);

    logger.info('Invitation accepted', { orgId: invitation.organization_id, userId });
    return organizationRepository.findById(invitation.organization_id);
  }

  async removeMember(organizationId, userId, targetUserId) {
    const isMember = await organizationRepository.isMember(userId, organizationId);
    if (!isMember) {
      throw new ForbiddenError('Access denied');
    }

    const memberRole = await organizationRepository.getMemberRole(userId, organizationId);
    if (memberRole !== 'owner' && memberRole !== 'admin') {
      throw new ForbiddenError('Insufficient permissions');
    }

    const targetMember = await membershipRepository.findByUserAndOrg(targetUserId, organizationId);
    if (!targetMember) {
      throw new NotFoundError('Member not found');
    }

    if (targetMember.role === 'owner') {
      throw new ForbiddenError('Cannot remove organization owner');
    }

    await removeRbacRole(targetUserId, targetMember.role, organizationId, userId);

    return membershipRepository.removeUser(targetUserId, organizationId);
  }

  async updateMemberRole(organizationId, userId, targetUserId, newRole) {
    const isMember = await organizationRepository.isMember(userId, organizationId);
    if (!isMember) {
      throw new ForbiddenError('Access denied');
    }

    const memberRole = await organizationRepository.getMemberRole(userId, organizationId);
    if (memberRole !== 'owner') {
      throw new ForbiddenError('Only owner can change roles');
    }

    const targetMember = await membershipRepository.findByUserAndOrg(targetUserId, organizationId);
    if (!targetMember) {
      throw new NotFoundError('Member not found');
    }

    await removeRbacRole(targetUserId, targetMember.role, organizationId, userId);
    const result = await membershipRepository.update(targetMember.id, { role: newRole });
    await assignRbacRole(targetUserId, newRole, organizationId, userId);

    return result;
  }
}

export default new OrganizationService();