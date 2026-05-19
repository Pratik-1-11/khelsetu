import bcrypt from 'bcryptjs';
import userRepository from '../../domains/organizations/repositories/userRepository.js';
import sessionRepository from './sessionRepository.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from './jwt.js';
import { ValidationError, UnauthorizedError, ConflictError } from '../errors/index.js';
import logger from '../logger/index.js';

export class AuthService {
  async register(data) {
    const { email, password, first_name, last_name, phone } = data;

    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      throw new ConflictError('Email already registered');
    }

    const password_hash = await bcrypt.hash(password, 12);

    const user = await userRepository.create({
      email,
      password_hash,
      first_name,
      last_name,
      phone,
      metadata: {}
    });

    const accessToken = generateAccessToken({ userId: user.id, email: user.email });
    const refreshToken = generateRefreshToken({ userId: user.id, email: user.email });

    await sessionRepository.create({
      user_id: user.id,
      token_hash: this.hashToken(accessToken),
      refresh_token_hash: this.hashToken(refreshToken),
      device_info: data.device_info || 'Unknown',
      ip_address: data.ip_address || null,
      user_agent: data.user_agent || null,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    logger.info('User registered', { userId: user.id, email: user.email });

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken
    };
  }

  async login(data) {
    const { email, password, device_info, ip_address, user_agent } = data;

    const user = await userRepository.findByEmail(email);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    if (!user.is_active) {
      throw new UnauthorizedError('Account is disabled');
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      throw new UnauthorizedError('Invalid email or password');
    }

    await userRepository.update(user.id, { last_login_at: new Date() });

    const accessToken = generateAccessToken({ userId: user.id, email: user.email });
    const refreshToken = generateRefreshToken({ userId: user.id, email: user.email });

    await sessionRepository.create({
      user_id: user.id,
      token_hash: this.hashToken(accessToken),
      refresh_token_hash: this.hashToken(refreshToken),
      device_info: device_info || 'Unknown',
      ip_address: ip_address || null,
      user_agent: user_agent || null,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    logger.info('User logged in', { userId: user.id, email: user.email });

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken
    };
  }

  async refresh(refreshToken) {
    try {
      const decoded = verifyRefreshToken(refreshToken);
      const session = await sessionRepository.findByRefreshToken(this.hashToken(refreshToken));

      if (!session || !session.is_active) {
        throw new UnauthorizedError('Invalid refresh token');
      }

      if (new Date(session.expires_at) < new Date()) {
        throw new UnauthorizedError('Refresh token expired');
      }

      const user = await userRepository.findById(decoded.userId);
      if (!user || !user.is_active) {
        throw new UnauthorizedError('User not found or disabled');
      }

      const newAccessToken = generateAccessToken({ userId: user.id, email: user.email });
      const newRefreshToken = generateRefreshToken({ userId: user.id, email: user.email });

      await sessionRepository.update(session.id, {
        token_hash: this.hashToken(newAccessToken),
        refresh_token_hash: this.hashToken(newRefreshToken),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      });

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      };
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      throw new UnauthorizedError('Invalid refresh token');
    }
  }

  async logout(token) {
    if (token) {
      await sessionRepository.deactivateByToken(this.hashToken(token));
    }
    logger.info('User logged out');
    return { success: true };
  }

  async getProfile(userId) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedError('User not found');
    }
    return this.sanitizeUser(user);
  }

  async updateProfile(userId, data) {
    const allowedFields = ['first_name', 'last_name', 'phone', 'avatar', 'metadata'];
    const updateData = {};

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }

    const user = await userRepository.update(userId, updateData);
    return this.sanitizeUser(user);
  }

  async changePassword(userId, currentPassword, newPassword) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) {
      throw new ValidationError('Current password is incorrect');
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    await userRepository.updatePassword(userId, newPasswordHash);

    await sessionRepository.deactivateAllUserSessions(userId);

    logger.info('Password changed', { userId });
    return { success: true };
  }

  hashToken(token) {
    return bcrypt.hashSync(token, 10);
  }

  sanitizeUser(user) {
    const { password_hash, ...sanitized } = user;
    return sanitized;
  }
}

export default new AuthService();