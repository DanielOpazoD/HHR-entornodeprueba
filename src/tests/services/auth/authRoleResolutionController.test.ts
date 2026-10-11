// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { resolveAllowedRoleForEmail } from '@/services/auth/authRoleResolutionController';

describe('authRoleResolutionController', () => {
  const createDependencies = () => ({
    getDynamicRoleForEmail: vi.fn().mockResolvedValue(null),
  });

  it('returns the dynamic Firestore role when present', async () => {
    const dependencies = createDependencies();
    dependencies.getDynamicRoleForEmail.mockResolvedValue('doctor_specialist');

    const result = await resolveAllowedRoleForEmail('test@hospital.cl', dependencies);

    expect(result).toEqual({ role: 'doctor_specialist', source: 'dynamic' });
  });

  it('returns none when no lookup resolves a role', async () => {
    const dependencies = createDependencies();

    const result = await resolveAllowedRoleForEmail('test@hospital.cl', dependencies);

    expect(result).toEqual({ role: null, source: 'none' });
  });
});
