import { describe, expect, it } from 'vitest';
import {
  rebaseLocalProjectionOntoNewerRecord,
  shouldPublishAuthoritativeConflictRecord,
  shouldRollbackOptimisticDailyRecord,
} from '@/hooks/controllers/dailyRecordLocalProjectionController';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('dailyRecordLocalProjectionController', () => {
  it('keeps newer remote clinical data while restoring pending local fields', () => {
    const date = '2026-08-29';
    const buildRecord = (
      lastUpdated: string,
      pathology: string,
      specialty: string,
      devices: string[]
    ) =>
      DataFactory.createMockDailyRecord(date, {
        lastUpdated,
        beds: {
          R1: DataFactory.createMockPatient('R1', {
            clinicalEpisodeId: 'parent-episode',
            pathology,
            specialty: specialty as never,
            clinicalCrib: DataFactory.createMockPatient('R1', {
              bedMode: 'Cuna',
              clinicalEpisodeId: 'crib-episode',
              patientName: 'RN confirmado',
              devices,
            }),
          }),
        },
      });
    const confirmed = buildRecord(
      '2026-08-29T10:00:00.000Z',
      'Diagnóstico remoto anterior',
      'Medicina',
      ['VVP']
    );
    const projection = buildRecord(
      '2099-01-01T00:00:00.000Z',
      'Diagnóstico local pendiente',
      'Medicina',
      ['VVP']
    );
    const newer = buildRecord('2026-08-29T10:01:00.000Z', 'Diagnóstico remoto nuevo', 'Cirugía', [
      'CVC',
    ]);

    const result = rebaseLocalProjectionOntoNewerRecord(confirmed, projection, newer);

    expect(result.lastUpdated).toBe(newer.lastUpdated);
    expect(result.beds.R1.pathology).toBe('Diagnóstico local pendiente');
    expect(result.beds.R1.specialty).toBe(newer.beds.R1.specialty);
    expect(result.beds.R1.clinicalCrib?.devices).toEqual(['CVC']);
  });

  it('does not roll an optimistic mutation back over a different realtime revision', () => {
    const optimistic = DataFactory.createMockDailyRecord('2026-08-29', {
      lastUpdated: '2026-08-29T10:00:00.000Z',
    });
    const newerRealtime = DataFactory.createMockDailyRecord('2026-08-29', {
      lastUpdated: '2026-08-29T10:01:00.000Z',
    });

    expect(shouldRollbackOptimisticDailyRecord(optimistic, optimistic)).toBe(true);
    expect(shouldRollbackOptimisticDailyRecord(newerRealtime, optimistic)).toBe(false);
  });

  it('does not project fields from an old occupant onto a replacement patient', () => {
    const date = '2026-08-29';
    const confirmed = DataFactory.createMockDailyRecord(date, {
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: 'patient-a',
          pathology: 'Dato remoto de A',
        }),
      },
    });
    const projection = DataFactory.createMockDailyRecord(date, {
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: 'patient-a',
          pathology: 'Dato local pendiente de A',
        }),
      },
    });
    const replacement = DataFactory.createMockDailyRecord(date, {
      lastUpdated: '2026-08-29T10:01:00.000Z',
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: 'patient-b',
          pathology: 'Dato vigente de B',
        }),
      },
    });

    const result = rebaseLocalProjectionOntoNewerRecord(confirmed, projection, replacement);

    expect(result.beds.R1.clinicalEpisodeId).toBe('patient-b');
    expect(result.beds.R1.pathology).toBe('Dato vigente de B');
  });

  it('does not project fields from an old crib episode onto its replacement', () => {
    const date = '2026-08-29';
    const buildRecord = (cribEpisode: string, pathology: string, lastUpdated?: string) =>
      DataFactory.createMockDailyRecord(date, {
        ...(lastUpdated ? { lastUpdated } : {}),
        beds: {
          R1: DataFactory.createMockPatient('R1', {
            clinicalEpisodeId: 'same-parent',
            clinicalCrib: DataFactory.createMockPatient('R1', {
              bedMode: 'Cuna',
              clinicalEpisodeId: cribEpisode,
              pathology,
            }),
          }),
        },
      });
    const confirmed = buildRecord('crib-a', 'Dato remoto de A');
    const projection = buildRecord('crib-a', 'Dato local pendiente de A');
    const replacement = buildRecord('crib-b', 'Dato vigente de B', '2026-08-29T10:01:00.000Z');

    const result = rebaseLocalProjectionOntoNewerRecord(confirmed, projection, replacement);

    expect(result.beds.R1.clinicalCrib?.clinicalEpisodeId).toBe('crib-b');
    expect(result.beds.R1.clinicalCrib?.pathology).toBe('Dato vigente de B');
  });

  it('requires matching admission anchors for identity-less provisional episodes', () => {
    const date = '2026-08-29';
    const buildAnonymousRecord = (admissionDate: string, pathology: string) =>
      DataFactory.createMockDailyRecord(date, {
        beds: {
          R1: DataFactory.createMockPatient('R1', {
            clinicalEpisodeId: undefined,
            patientName: '',
            rut: '',
            firstSeenDate: undefined,
            admissionDate,
            pathology,
          }),
        },
      });
    const confirmed = buildAnonymousRecord('2026-08-28', 'Dato remoto anterior');
    const projection = buildAnonymousRecord('2026-08-28', 'Dato local pendiente');
    const replacement = buildAnonymousRecord('2026-08-29', 'Dato vigente nuevo');

    const result = rebaseLocalProjectionOntoNewerRecord(confirmed, projection, replacement);

    expect(result.beds.R1.admissionDate).toBe('2026-08-29');
    expect(result.beds.R1.pathology).toBe('Dato vigente nuevo');
  });

  it('does not replace a newer realtime cache with an older conflict preflight read', () => {
    const optimistic = DataFactory.createMockDailyRecord('2026-08-29', {
      lastUpdated: '2099-01-01T00:00:00.000Z',
    });
    const authoritative = DataFactory.createMockDailyRecord('2026-08-29', {
      lastUpdated: '2026-08-29T10:01:00.000Z',
    });
    const newerRealtime = DataFactory.createMockDailyRecord('2026-08-29', {
      lastUpdated: '2026-08-29T10:02:00.000Z',
    });

    expect(shouldPublishAuthoritativeConflictRecord(optimistic, optimistic, authoritative)).toBe(
      true
    );
    expect(shouldPublishAuthoritativeConflictRecord(newerRealtime, optimistic, authoritative)).toBe(
      false
    );
  });
});
