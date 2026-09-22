import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import {
  formatOfficialPatientIdentifier,
  inferOfficialPatientDocumentType,
  normalizeOfficialPatientIdentifier,
  officialPatientIdentifiersEqual,
  officialPatientIdentityKey,
} from '@/features/rayen-import/domain/officialPatientIdentifier';
import { diffSyncablePatientFields } from '@/features/rayen-import/domain/patientSyncPolicy';

describe('official patient identifiers', () => {
  it('keeps foreign letters in the canonical identity and never collides A with B', () => {
    expect(normalizeOfficialPatientIdentifier(' a-123456 ')).toBe('A-123456');
    expect(normalizeOfficialPatientIdentifier('B123456')).toBe('B123456');
    expect(officialPatientIdentifiersEqual('A-123456', 'A123456')).toBe(false);
    expect(officialPatientIdentifiersEqual('A-123456', 'B123456')).toBe(false);
    expect(normalizeOfficialPatientIdentifier('A123456785')).toBe('A123456785');
    expect(normalizeOfficialPatientIdentifier('B123456785')).toBe('B123456785');
    expect(officialPatientIdentifiersEqual('A123456785', '123456785')).toBe(false);
  });

  it('classifies a valid Chilean RUT and an unequivocal alphanumeric passport', () => {
    expect(inferOfficialPatientDocumentType('12.345.678-5')).toBeUndefined();
    expect(inferOfficialPatientDocumentType('12.345.678-5', 'RUT')).toBe('RUT');
    expect(inferOfficialPatientDocumentType('P1234567')).toBe('Pasaporte');
    expect(formatOfficialPatientIdentifier('123456785', 'RUT')).toBe('12.345.678-5');
    expect(formatOfficialPatientIdentifier('p1234567')).toBe('P1234567');
    expect(inferOfficialPatientDocumentType('A123456785', 'RUT')).toBe('Pasaporte');
    expect(inferOfficialPatientDocumentType('12345678K', 'RUT')).toBe('RUT');
    expect(inferOfficialPatientDocumentType('12345678K')).toBe('RUT');
  });

  it('requires explicit metadata before classifying a numeric foreign identifier', () => {
    expect(inferOfficialPatientDocumentType('83001234')).toBeUndefined();
    expect(inferOfficialPatientDocumentType('83001234', 'Pasaporte')).toBe('Pasaporte');
  });

  it('namespaces the same numeric code by its proven document class', () => {
    expect(officialPatientIdentityKey('123456785', 'RUT')).toBe('RUT:123456785');
    expect(officialPatientIdentityKey('123456785', 'Pasaporte')).toBe('PAS:123456785');
    expect(officialPatientIdentityKey('123456785')).toBe('LEGACY:123456785');
    expect(officialPatientIdentityKey('12345678-5', 'Pasaporte')).toBe('PAS:12345678-5');
  });

  it('does not use NN placeholders as a clinical identity', () => {
    expect(normalizeOfficialPatientIdentifier('NN')).toBe('');
    expect(normalizeOfficialPatientIdentifier('SIN-RUT')).toBe('');
    expect(inferOfficialPatientDocumentType('NN', 'RUT')).toBeUndefined();
  });

  it('preserves a reviewed passport classification when an older bridge omits metadata', () => {
    const current = {
      ...EMPTY_PATIENT,
      bedId: 'R2',
      patientName: 'Paciente Extranjero',
      rut: 'P1234567',
      documentType: 'Pasaporte' as const,
    };
    const incoming = { ...current, documentType: undefined };

    expect(diffSyncablePatientFields(current, incoming)).not.toContainEqual(
      expect.objectContaining({ field: 'documentType' })
    );
  });
});
