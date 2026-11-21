// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CensusManager } from '@/domain/CensusManager';
import { createEmptyPatient } from '@/domain/patient/patientFactory';
import { resolveMedicalSpecialtyDailyStatus } from '@/domain/handoff/specialty';
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

  describe('specialty status', () => {
    it.each([
      ['2026-10-24', 'updated_by_specialist'],
      ['2026-10-25', 'pending'],
    ] as const)('uses hospital day %s', (day, status) => {
      expect(resolveMedicalSpecialtyDailyStatus(note, day)).toBe(status);
    });
  });
});
