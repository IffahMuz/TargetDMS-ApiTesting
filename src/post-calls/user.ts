import { expect } from '@playwright/test';
import { PostCall } from './types';

// POST /User/CheckEmail is a read-only lookup. The whole User controller is rate limited to 5 calls per 3 minutes per path, so keep this at 3 calls.
// POST /User/RegisterEmail is deliberately NOT tested (a valid call would register an email / send mail).
const path = '/api/v1/User/CheckEmail';

export const userPostCalls: PostCall[] = [
  {
    name: 'Check email returns the email with isValid and isDuplicate flags',
    path,
    body: { email: 'iffahmuzaffar110@gmail.com' },
    check: (data) => {
      expect(data.email).toBe('iffahmuzaffar110@gmail.com');
      expect(data.isValid).toBe(true);
      expect(typeof data.isDuplicate).toBe('boolean');
    },
  },
  {
    name: 'Malformed email is rejected with 400',
    path,
    body: { email: 'not-an-email' },
    expectStatus: [400],
    check: (body) => expect(JSON.stringify(body)).toContain('Email must be a valid email address'),
  },
  {
    name: 'Missing email is rejected with 400',
    path,
    body: {},
    expectStatus: [400],
    check: (body) => expect(JSON.stringify(body)).toContain('Email is required'),
  },
];
