import { expect } from '@playwright/test';
import { GetCall } from './types';

export const authCalls: GetCall[] = [
  {
    name: 'Pre-login token is returned',
    path: '/api/v1/Auth/PreLoginToken',
    check: (data) => {
      expect(typeof data).toBe('string');
      expect(data.length).toBeGreaterThan(10);
    },
  },
  {
    name: 'Current bearer token validates as true',
    path: '/api/v1/Auth/ValidateToken',
    query: ({ token }) => ({ token }),
    check: (data) => expect(data).toBe(true),
  },
];
