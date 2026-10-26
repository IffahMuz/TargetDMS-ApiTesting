import { expect } from '@playwright/test';
import { config } from '../config';
import { GetCall, IDS } from './types';

export const userCalls: GetCall[] = [
  {
    name: 'Current user profile is the logged-in user',
    path: '/api/v1/User',
    check: (data) => {
      expect(data.userName.toLowerCase()).toBe(config.username.toLowerCase());
      expect(data.dealerId).toBe(IDS.dealerId);
      expect(Array.isArray(data.userRoles)).toBe(true);
    },
  },
  {
    name: 'User email status',
    path: '/api/v1/User/EmailStatus',
    query: { userId: IDS.userId },
    check: (data) => {
      expect(data).toHaveProperty('email');
      expect(typeof data.emailConfirmed).toBe('boolean');
    },
  },
  {
    name: 'Role permissions',
    path: '/api/v1/User/Permissions',
    query: { roleId: IDS.roleId },
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('permissionId');
      expect(data[0]).toHaveProperty('productFeatureName');
    },
  },
];
