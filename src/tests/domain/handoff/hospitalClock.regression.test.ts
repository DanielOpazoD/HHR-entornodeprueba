// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CensusManager } from '@/domain/CensusManager';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { buildMedicalPrimaryNoteFields } from '@/domain/handoff/patientEntryMutations';
import {
  resolveMedicalEntryMetadataViewModel,
  resolveMedicalHandoffValidityViewModel,
} from '@/domain/handoff/patientView';
import { resolveMedicalSpecialtyDailyStatus } from '@/domain/handoff/specialty';
import { resolveMedicalSpecialtyDailyStatus as resolveTabStatus } from '@/features/handoff/controllers/medicalSpecialtyHandoffController';
import { executeConfirmMedicalSpecialtyNoChanges } from '@/application/handoff/handoffManagementUseCases';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { MedicalSpecialtyHandoffNote } from '@/types/domain/dailyRecordMedicalHandoff';

const patient = () => ({
  ...createEmptyPatient('R1'),
  patientName: 'PACIENTE SINTETICO RELOJ',
  rut: '000000000',
});
const note: MedicalSpecialtyHandoffNote = {
  note: 'NOTA SINTETICA RELOJ',
  createdAt: '2026-10-25T01:00:00.000Z',
  updatedAt: '2026-10-25T01:00:00.000Z',
  author: {
    uid: 'synthetic-clock',
    displayName: 'ESPECIALISTA SINTETICO',
    email: 'clock@example.invalid',
  },
  version: 1,
};

afterEach(() => vi.useRealTimers());

describe('hospital clock across the UTC and mainland midnight boundaries', () => {
  it.each(['discharge', 'transfer', 'CMA'] as const)(
    'proposes %s at 23:30 hospital time',
    movement => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-25T04:30:00Z'));
      const proposed =
        movement === 'discharge'
          ? CensusManager.prepareDischarge(patient(), 'R1').time
          : movement === 'transfer'
            ? CensusManager.prepareTransfer(patient(), 'R1', {
                evacuation: 'Avión comercial',
                center: 'Hospital Salvador',
              }).time
            : CensusManager.formatCMAData(patient(), 'R1').dischargeTime;
      expect(proposed).toBe('23:30');
    }
  );

  it('does not keep an evening patient note current the following hospital day', () => {
    const { entry } = buildMedicalPrimaryNoteFields(
      patient(),
      'NOTA SINTETICA',
      null,
      '2026-10-24',
      '2026-10-25T02:30:00Z'
    );
    expect(resolveMedicalHandoffValidityViewModel(entry, '2026-10-24').isActiveToday).toBe(true);
    expect(resolveMedicalHandoffValidityViewModel(entry, '2026-10-25').isActiveToday).toBe(false);
  });

  it('recognizes an evening edit without an explicit current-status date', () => {
    const { entry } = buildMedicalPrimaryNoteFields(
      patient(),
      'NOTA SINTETICA',
      null,
      '2026-10-24',
      '2026-10-25T02:30:00Z'
    );
    delete entry.currentStatusDate;
    expect(resolveMedicalHandoffValidityViewModel(entry, '2026-10-24').statusLabel).toBe(
      'Nota vigente'
    );
  });

  it.each([
    ['2026-10-24', true],
    ['2026-10-25', false],
  ] as const)(
    'shows current-event metadata only on hospital day %s',
    (reportDate, showInfoButton) => {
      const { entry } = buildMedicalPrimaryNoteFields(
        patient(),
        'NOTA SINTETICA',
        null,
        '2026-10-24',
        '2026-10-25T02:30:00Z'
      );
      delete entry.currentStatusDate;
      entry.originalNoteAt = '2026-10-23T15:00:00Z';
      entry.originalNoteBy = {
        uid: 'synthetic-original',
        displayName: 'AUTOR SINTETICO',
        email: 'original@example.invalid',
      };
      entry.updatedBy = note.author;
      const metadata = resolveMedicalEntryMetadataViewModel(entry, reportDate);
      expect(metadata.showInfoButton).toBe(showInfoButton);
      expect(metadata.printLabel.includes('Vigente por:')).toBe(showInfoButton);
      if (showInfoButton) {
        expect(metadata.detailLines[1]).toContain('24-10-2026');
      } else {
        expect(metadata.detailLines).toEqual([]);
      }
    }
  );

  describe.each([
    ['domain', resolveMedicalSpecialtyDailyStatus],
    ['tab', resolveTabStatus],
  ] as const)('%s specialty status', (_name, resolveStatus) => {
    it.each([
      ['2026-10-24', 'updated_by_specialist'],
      ['2026-10-25', 'pending'],
    ] as const)('uses hospital day %s', (day, status) => {
      expect(resolveStatus(note, day)).toBe(status);
    });
  });

  it.each([
    ['2026-10-24', 'failed', 'already_updated_today'],
    ['2026-10-25', 'success', undefined],
  ] as const)(
    'permits continuity only after the specialist hospital day (%s)',
    async (date, status, reason) => {
      const saveRecord = vi.fn().mockResolvedValue(undefined);
      const record = DataFactory.createMockDailyRecord(date, {
        beds: {},
        medicalHandoffBySpecialty: { cirugia: note },
      });
      const outcome = await executeConfirmMedicalSpecialtyNoChanges({
        record,
        saveRecord,
        actor: note.author,
        specialty: 'cirugia',
      });
      expect(outcome.status).toBe(status);
      expect(outcome.reason).toBe(reason);
      expect(saveRecord).toHaveBeenCalledTimes(status === 'success' ? 1 : 0);
    }
  );
});
