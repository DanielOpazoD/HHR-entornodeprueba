// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  GENERAL_LOGIN_ROLES,
  MANAGED_ASSIGNABLE_ROLES,
} = require('../../../functions/lib/auth/authConfig.js');

describe('functions authConfig', () => {
  it('keeps doctor_specialist inside general login roles', () => {
    expect(GENERAL_LOGIN_ROLES.has('doctor_specialist')).toBe(true);
  });

  it('keeps viewer as a supported general login role', () => {
    expect(GENERAL_LOGIN_ROLES.has('viewer')).toBe(true);
  });

  it('allows only managed web roles in assignable roles set', () => {
    expect(MANAGED_ASSIGNABLE_ROLES.has('viewer')).toBe(true);
    expect(MANAGED_ASSIGNABLE_ROLES.has('doctor_specialist')).toBe(true);
    expect(MANAGED_ASSIGNABLE_ROLES.has('editor')).toBe(false);
  });
});
