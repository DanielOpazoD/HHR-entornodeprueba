import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import { reconcileCensus, applyEgresoReport, applyCensusImportDiff } from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';

const newborn = {
  ...EMPTY_PATIENT,
  bedId: 'R4',
  patientName: 'RN sintético',
  clinicalEpisodeId: 'synthetic-newborn',
  bedMode: 'Cuna' as const,
  admissionDate: '2026-07-07',
  admissionTime: '10:05',
  handoffNoteNightShift: 'Nota propia del RN',
};
const mother = {
  ...EMPTY_PATIENT,
  bedId: 'R4',
  patientName: 'Madre sintética',
  rut: '14.470.055-4',
  clinicalEpisodeId: 'synthetic-mother',
  admissionDate: '2026-07-07',
  admissionTime: '10:00',
  clinicalCrib: newborn,
};
const row: EgresoReportRow = {
  encounterId: mother.clinicalEpisodeId,
  run: mother.rut,
  patientName: mother.patientName,
  bedLabel: 'R4',
  servicio: 'AMQI',
  edad: '30',
  destino: 'Domicilio',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '08-07-2026 14:00',
  correctedDay: '2026-07-08',
  correctedTime: '12:00',
};
const record = (): DailyRecord => ({
  date: '2026-07-08',
  lastUpdated: '',
  activeExtraBeds: [],
  beds: { R4: mother },
  transfers: [],
  cma: [],
  discharges: [
    {
      id: 'kept-maternal-discharge',
      clinicalEpisodeId: mother.clinicalEpisodeId,
      bedId: 'R4',
      bedName: 'R4',
      bedType: 'UTI',
      patientName: mother.patientName,
      rut: mother.rut,
      diagnosis: 'Diagnóstico materno conservado',
      specialty: mother.specialty,
      status: 'Vivo',
      movementDate: '2026-07-08',
      time: '11:47',
      originalData: { ...mother, clinicalCrib: undefined },
    },
  ],
});
const now = new Date('2026-07-08T22:00:00Z');

describe('previously recorded maternal discharge with missing associated RN', () => {
  it('does not infer the RN departure from an incomplete snapshot', () => {
    const current = record();
    const diff = applyEgresoReport(
      reconcileCensus(
        current,
        {
          capturedAt: now.toISOString(),
          facilityId: 1342,
          isComplete: false,
          encounters: [],
        },
        { reference: now }
      ),
      [row],
      current
    );
    const result = applyCensusImportDiff(current, diff, {
      now,
      idFactory: () => 'unused',
      syncRunId: 'synthetic',
    });
    expect(result.record.discharges).toEqual(current.discharges);
    expect(result.record.beds.R4.clinicalCrib?.clinicalEpisodeId).toBe(newborn.clinicalEpisodeId);
  });

  it('does not discharge a newborn still present in the complete source', () => {
    const current = record();
    const diff = applyEgresoReport(
      reconcileCensus(
        current,
        {
          capturedAt: now.toISOString(),
          facilityId: 1342,
          isComplete: true,
          encounters: [
            {
              encounterId: newborn.clinicalEpisodeId,
              run: '',
              firstGivenName: 'RN de Madre',
              firstFamilyName: 'Sintética',
              birthDate: '2026-07-07',
              service: 'AMQI',
              room: 'Cunas',
              bed: 'CR4',
              clinicalCribParentBedId: 'R4',
              admissionDatetime: '2026-07-07T10:05:00-06:00',
            },
          ],
        },
        { reference: now }
      ),
      [row],
      current
    );
    expect(diff.discharges.every(entry => !entry.associatedClinicalCrib)).toBe(true);
    const result = applyCensusImportDiff(current, diff, {
      now,
      idFactory: () => 'unused',
      syncRunId: 'synthetic',
    });
    expect(result.record.discharges).toEqual(current.discharges);
  });

  it('does not attach the historical RN to a later occupant of the same bed', () => {
    const current = record();
    current.beds.R4 = {
      ...EMPTY_PATIENT,
      bedId: 'R4',
      patientName: 'Otra paciente',
      rut: '12.345.678-5',
      clinicalEpisodeId: 'later-episode',
      admissionDate: '2026-07-08',
    };
    const diff = applyEgresoReport(
      reconcileCensus(
        current,
        {
          capturedAt: now.toISOString(),
          facilityId: 1342,
          isComplete: true,
          encounters: [],
        },
        { reference: now }
      ),
      [row],
      current
    );
    const result = applyCensusImportDiff(current, diff, {
      now,
      idFactory: () => 'unused',
      syncRunId: 'synthetic',
    });
    expect(result.record.beds.R4).toEqual(current.beds.R4);
    expect(result.record.discharges).toEqual(current.discharges);
  });

  it.each([false, true])(
    'adds the exact RN once with a maternal crib undo snapshot = %s',
    hasCribSnapshot => {
      const current = record();
      const keptMaternalMovement = record().discharges[0];
      if (hasCribSnapshot) current.discharges[0].originalData = { ...mother };
      const diff = applyEgresoReport(
        reconcileCensus(
          current,
          {
            capturedAt: now.toISOString(),
            facilityId: 1342,
            isComplete: true,
            encounters: [],
          },
          { reference: now }
        ),
        [row],
        current
      );
      const result = applyCensusImportDiff(current, diff, {
        now,
        idFactory: () => 'newborn-movement',
        syncRunId: 'synthetic',
      });
      expect(result.record.discharges).toHaveLength(2);
      expect(result.record.discharges[0]).toEqual(keptMaternalMovement);
      expect(result.record.discharges[1]).toMatchObject({
        clinicalEpisodeId: newborn.clinicalEpisodeId,
        isNested: true,
        time: '11:47',
        originalData: expect.objectContaining({ handoffNoteNightShift: 'Nota propia del RN' }),
      });
      expect(result.record.beds.R4?.patientName).toBeFalsy();
      const again = applyCensusImportDiff(result.record, diff, {
        now,
        idFactory: () => 'must-not-create',
        syncRunId: 'synthetic-repeat',
      });
      expect(again.record.discharges).toEqual(result.record.discharges);
    }
  );
});
