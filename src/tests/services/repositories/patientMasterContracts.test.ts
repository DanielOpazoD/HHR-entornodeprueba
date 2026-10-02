// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  createBulkUpsertPatientsCommand,
  createUpsertPatientCommand,
  normalizeMasterPatientRut,
  normalizePatientSearchTerm,
  sanitizePatientQueryLimit,
} from '@/services/repositories/contracts/patientMasterContracts';
import type { MasterPatient } from '@/types/domain/patientMaster';

const buildPatient = (rut: string, fullName: string): MasterPatient => ({
  rut,
  fullName,
  createdAt: 1,
  updatedAt: 1,
});

describe('patientMasterContracts', () => {
  it('normalizes valid RUT', () => {
    expect(normalizeMasterPatientRut('12345678-5')).toBe('12.345.678-5');
  });

  it('returns null for invalid RUT', () => {
    expect(normalizeMasterPatientRut('invalid')).toBeNull();
  });

  it('sanitizes query limit within allowed range', () => {
    expect(sanitizePatientQueryLimit(0)).toBe(20);
    expect(sanitizePatientQueryLimit(5000)).toBe(1000);
    expect(sanitizePatientQueryLimit(50)).toBe(50);
  });

  it('builds upsert command only for valid RUT', () => {
    expect(createUpsertPatientCommand({ rut: '12345678-5' })).toEqual({
      rut: '12.345.678-5',
    });
    expect(createUpsertPatientCommand({ rut: 'invalid' })).toBeNull();
  });

  it('filters invalid patients during bulk command build', () => {
    const result = createBulkUpsertPatientsCommand([
      buildPatient('12345678-5', 'Paciente A'),
      buildPatient('invalid', 'Paciente B'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].rut).toBe('12.345.678-5');
  });

  it('normalizes search term to title case after trimming', () => {
    expect(normalizePatientSearchTerm('  ana  ')).toBe('Ana');
  });
});
