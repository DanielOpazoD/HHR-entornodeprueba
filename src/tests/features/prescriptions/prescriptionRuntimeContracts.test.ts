import { describe, expect, it } from 'vitest';

import {
  parsePrescriptionRecord,
  safeParsePrescriptionRecord,
} from '@/schemas/prescriptionSchemas';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';

const validRecord = (overrides: Partial<PrescriptionRecord> = {}): PrescriptionRecord => ({
  id: 'rx-1',
  hospitalId: 'hhr',
  prescriptionType: 'comun',
  bedId: 'H5C1',
  patientName: 'Paciente Test',
  patientRut: '11.111.111-1',
  notes: undefined,
  image: {
    storagePath: 'hospitals/hhr/prescriptions/rx-1/full.jpg',
    thumbnailStoragePath: 'hospitals/hhr/prescriptions/rx-1/thumb.jpg',
    byteSize: 184_000,
    width: 1200,
    height: 900,
    contentType: 'image/jpeg',
  },
  uploader: {
    source: 'authenticated',
    uid: 'u1',
    email: 'enf.turno@hospital.cl',
    displayName: 'Enfermería turno noche',
  },
  createdAt: '2026-05-04T13:30:00.000Z',
  expiresAt: '2026-06-03T13:30:00.000Z',
  ...overrides,
});

describe('parsePrescriptionRecord', () => {
  it('accepts a fully populated authenticated upload', () => {
    expect(() => parsePrescriptionRecord(validRecord())).not.toThrow();
  });

  it('accepts a QR-PIN upload without uid/email', () => {
    expect(() =>
      parsePrescriptionRecord(
        validRecord({
          uploader: { source: 'qr_pin', displayName: 'Estación QR sala' },
          bedId: undefined,
          patientName: undefined,
          patientRut: undefined,
        })
      )
    ).not.toThrow();
  });

  it('accepts Stock de Hospitalizados as a non-patient assignment category', () => {
    expect(() =>
      parsePrescriptionRecord(
        validRecord({
          assignmentScope: 'hospitalized_stock',
          bedId: undefined,
          patientName: undefined,
          patientRut: undefined,
        })
      )
    ).not.toThrow();
  });

  it('accepts Firestore null patient fields for Stock de Hospitalizados reads', () => {
    const parsed = parsePrescriptionRecord(
      validRecord({
        assignmentScope: 'hospitalized_stock',
        bedId: null as never,
        patientName: null as never,
        patientRut: null as never,
      })
    );

    expect(parsed).toMatchObject({
      id: 'rx-1',
      assignmentScope: 'hospitalized_stock',
    });
    expect(parsed.bedId).toBeUndefined();
    expect(parsed.patientName).toBeUndefined();
    expect(parsed.patientRut).toBeUndefined();
  });

  it('rejects an unsupported prescription type', () => {
    expect(() =>
      parsePrescriptionRecord(validRecord({ prescriptionType: 'antibioticos' as never }))
    ).toThrow();
  });

  it('rejects an unsupported assignment category', () => {
    expect(() =>
      parsePrescriptionRecord(validRecord({ assignmentScope: 'ward_stock' as never }))
    ).toThrow();
  });

  it('rejects a record with mismatched contentType (must be image/jpeg)', () => {
    expect(() =>
      parsePrescriptionRecord(
        validRecord({
          image: { ...validRecord().image, contentType: 'image/png' as never },
        })
      )
    ).toThrow();
  });

  it('rejects negative byteSize', () => {
    expect(() =>
      parsePrescriptionRecord(
        validRecord({
          image: { ...validRecord().image, byteSize: -1 },
        })
      )
    ).toThrow();
  });
});

describe('safeParsePrescriptionRecord', () => {
  it('returns the parsed record when input is valid', () => {
    expect(safeParsePrescriptionRecord(validRecord())).toMatchObject({ id: 'rx-1' });
  });

  it('returns null for invalid input instead of throwing', () => {
    expect(safeParsePrescriptionRecord({ id: 'broken' })).toBeNull();
  });

  it('accepts legacy records missing uploader source', () => {
    expect(
      safeParsePrescriptionRecord(
        validRecord({
          uploader: {
            uid: 'legacy-user',
            email: 'legacy@hospital.cl',
          } as never,
        })
      )
    ).toMatchObject({
      uploader: { source: 'authenticated' },
    });
  });

  it('accepts legacy records with non-jpeg contentType metadata', () => {
    expect(
      safeParsePrescriptionRecord(
        validRecord({
          image: { ...validRecord().image, contentType: 'image/png' as never },
        })
      )
    ).toMatchObject({
      image: { contentType: 'image/jpeg' },
    });
  });
});
