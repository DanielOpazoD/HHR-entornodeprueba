// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  normalizeCredentialSignInInput,
  validateCredentialSignInInput,
} from '@/application/auth/authSessionContracts';

describe('authSessionContracts', () => {
  it('normalizes credential sign-in input', () => {
    const normalized = normalizeCredentialSignInInput({
      email: '  ADMIN@Hospital.cl ',
      password: ' secret ',
    });

    expect(normalized).toEqual({
      email: 'admin@hospital.cl',
      password: ' secret ',
    });
  });

  it('returns validation issues for missing email and password', () => {
    const issues = validateCredentialSignInInput({
      email: '',
      password: '',
    });

    expect(issues.map(issue => issue.code)).toEqual([
      'auth/credential-missing-email',
      'auth/credential-missing-password',
    ]);
  });

  it('returns validation issue for invalid email format', () => {
    const issues = validateCredentialSignInInput({
      email: 'correo-sin-dominio',
      password: 'secret',
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('auth/credential-invalid-email');
  });

  it('returns no issues for valid credential input', () => {
    const issues = validateCredentialSignInInput({
      email: 'nurse@hospital.cl',
      password: 'secret',
    });

    expect(issues).toEqual([]);
  });
});
