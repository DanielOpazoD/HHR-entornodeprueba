import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  buildMedicalHandoffSummary,
  resolveMedicalSpecialtyDailyStatus,
} from '@/features/handoff/controllers/medicalSpecialtyHandoffController';

describe('medicalSpecialtyHandoffController', () => {
  it('resolves specialty status from same-day update', () => {
    expect(
      resolveMedicalSpecialtyDailyStatus(
        {
          note: 'Paciente estable',
          createdAt: '2026-03-01T08:00:00.000Z',
          updatedAt: '2026-03-03T10:00:00.000Z',
          author: {
            uid: '1',
            displayName: 'Dr. Test',
            email: 'test@hospitalhangaroa.cl',
          },
          version: 1,
        },
        '2026-03-03'
      )
    ).toBe('updated_by_specialist');
  });

  it('builds a legacy-compatible summary from specialty notes', () => {
    const record = {
      date: '2026-03-03',
      medicalHandoffNovedades: '',
      medicalHandoffBySpecialty: {
        cirugia: {
          note: 'Paciente sin cambios.',
          createdAt: '2026-03-02T08:00:00.000Z',
          updatedAt: '2026-03-02T08:00:00.000Z',
          author: {
            uid: '1',
            displayName: 'Dr. Cirugía',
            email: 'cirugia@hospitalhangaroa.cl',
            specialty: 'cirugia',
          },
          version: 1,
          dailyContinuity: {
            '2026-03-03': {
              status: 'confirmed_no_changes',
              comment: 'Condición actual sin cambios.',
            },
          },
        },
      },
    } as Pick<DailyRecord, 'date' | 'medicalHandoffNovedades' | 'medicalHandoffBySpecialty'>;

    const summary = buildMedicalHandoffSummary(record);

    expect(summary).toContain('Cirugía');
    expect(summary).toContain('Paciente sin cambios.');
    expect(summary).toContain('Condición actual sin cambios.');
  });
});

// ===========================================================================
// Branch coverage backfill for the daily status the summary depends on.
// ===========================================================================
describe('medicalSpecialtyHandoffController — branch coverage backfill', () => {
  describe('resolveMedicalSpecialtyDailyStatus', () => {
    it('returns "pending" when the note is undefined', () => {
      expect(resolveMedicalSpecialtyDailyStatus(undefined, '2026-05-03')).toBe('pending');
    });

    it('returns "pending" when neither updatedAt nor continuity matches the date', () => {
      const note = {
        note: 'X',
        updatedAt: '2026-04-30T12:00:00Z',
        dailyContinuity: { '2026-05-02': { status: 'updated_by_specialist' } },
      } as unknown as Parameters<typeof resolveMedicalSpecialtyDailyStatus>[0];
      expect(resolveMedicalSpecialtyDailyStatus(note, '2026-05-03')).toBe('pending');
    });

    it('returns "confirmed_no_changes" when continuity for the date confirms it', () => {
      const note = {
        note: 'X',
        updatedAt: '2026-04-30T12:00:00Z',
        dailyContinuity: { '2026-05-03': { status: 'confirmed_no_changes' } },
      } as unknown as Parameters<typeof resolveMedicalSpecialtyDailyStatus>[0];
      expect(resolveMedicalSpecialtyDailyStatus(note, '2026-05-03')).toBe('confirmed_no_changes');
    });

    it('returns "updated_by_specialist" via continuity when updatedAt is on a different date', () => {
      const note = {
        note: 'X',
        updatedAt: '2026-04-30T12:00:00Z',
        dailyContinuity: { '2026-05-03': { status: 'updated_by_specialist' } },
      } as unknown as Parameters<typeof resolveMedicalSpecialtyDailyStatus>[0];
      expect(resolveMedicalSpecialtyDailyStatus(note, '2026-05-03')).toBe('updated_by_specialist');
    });

    it('returns "pending" when updatedAt is missing and no continuity exists', () => {
      const note = { note: 'X' } as Parameters<typeof resolveMedicalSpecialtyDailyStatus>[0];
      expect(resolveMedicalSpecialtyDailyStatus(note, '2026-05-03')).toBe('pending');
    });
  });
});
