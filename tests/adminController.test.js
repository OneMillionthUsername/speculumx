/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockDb = {
  getAdminByUsername: jest.fn(),
  updateAdminLoginSuccess: jest.fn(),
  updateAdminLoginFailure: jest.fn(),
  updateAdminStatus: jest.fn(),
};
const mockBcryptCompare = jest.fn();

jest.unstable_mockModule('../databases/mariaDB.js', () => ({
  DatabaseService: mockDb,
}));
jest.unstable_mockModule('bcrypt', () => ({
  default: { compare: mockBcryptCompare },
}));
jest.unstable_mockModule('../utils/logger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { default: adminController } = await import('../controllers/adminController.js');
const { AdminAccountLockedException, AdminControllerException } = await import('../models/customExceptions.js');
const { Admin } = await import('../models/adminModel.js');

// Minimal valid admin data satisfying the Joi schema
const makeAdmin = (overrides = {}) => ({
  id: 1,
  username: 'testadmin',
  password_hash: '$2b$10$hashedpassword_long_enough',
  email: 'admin@example.com',
  full_name: 'Test Admin',
  role: 'admin',
  active: true,
  locked_until: null,
  created_at: new Date('2024-01-01'),
  updated_at: new Date('2024-01-01'),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.updateAdminLoginSuccess.mockResolvedValue(true);
  mockDb.updateAdminLoginFailure.mockResolvedValue(true);
});

describe('adminController', () => {
  describe('getAdminByUsername', () => {
    it('throws (wrapped) when username is empty', async () => {
      await expect(adminController.getAdminByUsername(''))
        .rejects.toThrow('Valid username is required');
      await expect(adminController.getAdminByUsername(null))
        .rejects.toThrow(AdminControllerException);
    });

    it('throws (wrapped) when admin not found', async () => {
      mockDb.getAdminByUsername.mockResolvedValue(null);
      await expect(adminController.getAdminByUsername('nobody'))
        .rejects.toThrow('Admin not found');
    });

    it('throws (wrapped) when DB data fails Joi validation', async () => {
      mockDb.getAdminByUsername.mockResolvedValue({ username: 'x', role: 'admin' }); // missing password_hash, created_at
      await expect(adminController.getAdminByUsername('x'))
        .rejects.toThrow('Validation failed:');
    });

    it('returns an Admin instance for valid data', async () => {
      mockDb.getAdminByUsername.mockResolvedValue(makeAdmin());
      const result = await adminController.getAdminByUsername('testadmin');
      expect(result).toBeInstanceOf(Admin);
      expect(result.username).toBe('testadmin');
      expect(result.role).toBe('admin');
    });

    it('throws (wrapped) when DB throws', async () => {
      mockDb.getAdminByUsername.mockRejectedValue(new Error('Connection refused'));
      await expect(adminController.getAdminByUsername('testadmin'))
        .rejects.toThrow(AdminControllerException);
    });
  });

  describe('authenticateAdmin', () => {
    it('throws directly (not wrapped) for empty username', async () => {
      await expect(adminController.authenticateAdmin('', 'password'))
        .rejects.toThrow('Username and password are required');
    });

    it('throws directly (not wrapped) for short password', async () => {
      // password.length < 3 triggers the guard
      await expect(adminController.authenticateAdmin('admin', 'ab'))
        .rejects.toThrow('Username and password are required');
    });

    it('returns null when admin not found', async () => {
      mockDb.getAdminByUsername.mockResolvedValue(null);
      const result = await adminController.authenticateAdmin('nobody', 'password123');
      expect(result).toBeNull();
    });

    it('throws AdminAccountLockedException (not wrapped) for inactive account', async () => {
      mockDb.getAdminByUsername.mockResolvedValue(makeAdmin({ active: false }));
      const attempt = adminController.authenticateAdmin('testadmin', 'password123');
      await expect(attempt).rejects.toThrow(AdminAccountLockedException);
      await expect(attempt).rejects.toThrow('Admin account is inactive or locked');
    });

    it('throws AdminAccountLockedException (not wrapped) for locked account', async () => {
      const futureDate = new Date(Date.now() + 3600_000).toISOString();
      mockDb.getAdminByUsername.mockResolvedValue(makeAdmin({ locked_until: futureDate }));
      await expect(adminController.authenticateAdmin('testadmin', 'password123'))
        .rejects.toThrow(AdminAccountLockedException);
      expect(mockBcryptCompare).not.toHaveBeenCalled();
    });

    it('returns null and records failure on wrong password', async () => {
      mockDb.getAdminByUsername.mockResolvedValue(makeAdmin());
      mockBcryptCompare.mockResolvedValue(false);
      const result = await adminController.authenticateAdmin('testadmin', 'wrongpassword');
      expect(result).toBeNull();
      expect(mockDb.updateAdminLoginFailure).toHaveBeenCalledWith(1);
    });

    it('returns admin payload and records success on correct password', async () => {
      mockDb.getAdminByUsername.mockResolvedValue(makeAdmin());
      mockBcryptCompare.mockResolvedValue(true);
      const result = await adminController.authenticateAdmin('testadmin', 'correctpassword');
      expect(result).toEqual({
        id: 1,
        username: 'testadmin',
        role: 'admin',
        email: 'admin@example.com',
        full_name: 'Test Admin',
      });
      expect(mockDb.updateAdminLoginSuccess).toHaveBeenCalledWith(1);
      expect(mockDb.updateAdminLoginFailure).not.toHaveBeenCalled();
    });

    it('does not include password_hash in returned payload', async () => {
      mockDb.getAdminByUsername.mockResolvedValue(makeAdmin());
      mockBcryptCompare.mockResolvedValue(true);
      const result = await adminController.authenticateAdmin('testadmin', 'password123');
      expect(result).not.toHaveProperty('password_hash');
    });
  });

  describe('updateAdminLoginSuccess', () => {
    it('returns the DB result on success', async () => {
      mockDb.updateAdminLoginSuccess.mockResolvedValue(true);
      expect(await adminController.updateAdminLoginSuccess(1)).toBe(true);
    });

    it('throws (wrapped) when DB returns falsy', async () => {
      mockDb.updateAdminLoginSuccess.mockResolvedValue(null);
      await expect(adminController.updateAdminLoginSuccess(1))
        .rejects.toThrow('Failed to update admin login success');
    });

    it('throws (wrapped) when DB throws', async () => {
      mockDb.updateAdminLoginSuccess.mockRejectedValue(new Error('DB error'));
      await expect(adminController.updateAdminLoginSuccess(1))
        .rejects.toThrow(AdminControllerException);
    });
  });

  describe('updateAdminLoginFailure', () => {
    it('returns the DB result on success', async () => {
      mockDb.updateAdminLoginFailure.mockResolvedValue(true);
      expect(await adminController.updateAdminLoginFailure(1)).toBe(true);
    });

    it('throws (wrapped) when DB returns falsy', async () => {
      mockDb.updateAdminLoginFailure.mockResolvedValue(null);
      await expect(adminController.updateAdminLoginFailure(1))
        .rejects.toThrow('Failed to update admin login failure');
    });
  });

  describe('updateAdminStatus', () => {
    it('returns the DB result on success', async () => {
      mockDb.updateAdminStatus.mockResolvedValue(true);
      expect(await adminController.updateAdminStatus(1, { active: false })).toBe(true);
    });

    it('throws (wrapped) when DB returns falsy', async () => {
      mockDb.updateAdminStatus.mockResolvedValue(null);
      await expect(adminController.updateAdminStatus(1, { active: false }))
        .rejects.toThrow('Failed to update admin status');
    });
  });
});
