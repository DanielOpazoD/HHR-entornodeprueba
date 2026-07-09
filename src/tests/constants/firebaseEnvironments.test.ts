import { describe, expect, it } from 'vitest';
import {
  BETA_ENVIRONMENT,
  canReadFrom,
  canWriteTo,
  validateWriteOperation,
} from '@/constants/firebaseEnvironments';

describe('firebaseEnvironments', () => {
  it('keeps HHR-entornodeprueba isolated to the old testing Firebase project', () => {
    expect(BETA_ENVIRONMENT.projectId).toBe('hhr-pruebas');
    expect(canReadFrom('hhr-pruebas')).toBe(true);
    expect(canWriteTo('hhr-pruebas')).toBe(true);
    expect(canReadFrom('hospital-hanga-roa')).toBe(false);
    expect(canWriteTo('hospital-hanga-roa')).toBe(false);
    expect(() => validateWriteOperation('hospital-hanga-roa')).toThrow(/No se puede escribir/);
  });
});
