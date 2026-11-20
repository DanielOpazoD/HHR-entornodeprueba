// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { reconstructHistoricalSnapshotAtClose } from '@/features/rayen-import/domain/historicalSnapshotReconstruction';
import { relevantHistoricalReportRows } from '@/features/rayen-import/domain/historicalAdministrativeEvidence';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import type {
  RayenCensusSnapshot,
  RayenEncounter,
} from '@/features/rayen-import/contracts/rayenSnapshot';
import { asStoredDailyRecordShape } from '@/tests/factories/DataFactory';

// A passport whose digits form the RUT of another person.
const PASSPORT = 'P123456785';
const RUT_WITH_SAME_DIGITS = '12.345.678-5';
const UNRELATED_RUT = '10.000.013-K';

const emptyRecord = { date: '2026-07-24', beds: {} } as DailyRecord;
const encounter = (encounterId: string, run: string, name: string): RayenEncounter => ({
  encounterId,
  run,
  firstGivenName: name,
  firstFamilyName: 'Prueba',
  admissionDatetime: '2026-07-24T11:00:00-06:00',
});
const live = (encounters: RayenEncounter[]): RayenCensusSnapshot => ({
  capturedAt: '2026-07-25T13:00:00-06:00',
  facilityId: 1342,
  isComplete: true,
  encounters,
});
const earlierCensusRow = (run: string) =>
  ({
    run,
    patientName: 'Fila Antigua',
    bedLabel: 'H2C1',
    fechaEgreso: '20-07-2026 10:00',
  }) as EgresoReportRow;
const reviewedNames = (conflicts: { patientName?: string }[]) =>
  conflicts.map(conflict => conflict.patientName).sort();

describe('historical reconstruction keeps a passport apart from the RUT its digits form', () => {
  it.each([RUT_WITH_SAME_DIGITS, UNRELATED_RUT])(
    'keeps one review item per patient when neither can be reconstructed (other RUT %s)',
    async otherRut => {
      const result = await reconstructHistoricalSnapshotAtClose(
        emptyRecord.date,
        live([encounter('900001', PASSPORT, 'Uno'), encounter('900002', otherRut, 'Dos')]),
        emptyRecord,
        [],
        { fetchReport: async () => ({ base64: '', error: 'sin informe' }) }
      );

      expect(result.snapshot.encounters).toEqual([]);
      expect(reviewedNames(result.conflicts)).toEqual(['Dos Prueba', 'Uno Prueba']);
    }
  );

  it.each([
    ['another person with the same digits', RUT_WITH_SAME_DIGITS, []],
    ['another person', UNRELATED_RUT, []],
    ['the same passport', 'p-123 456785', ['Fila Antigua']],
  ])(
    'an unlinked report row of an earlier census by %s blocks this day only when it is the patient',
    async (_label, rowDocument, expectedReviews) => {
      const oldRow = earlierCensusRow(rowDocument);

      const result = await reconstructHistoricalSnapshotAtClose(
        emptyRecord.date,
        live([encounter('900001', PASSPORT, 'Uno')]),
        emptyRecord,
        [oldRow],
        {
          fetchReport: async () => ({ base64: 'QQ==' }),
          extractText: async () =>
            `Flujo del Paciente Pasaporte: ${PASSPORT}\n24/07/2026 11:00:00 Servicio Estación Habitación 1 Básica C1`,
        }
      );

      expect(result.snapshot.encounters).toEqual([
        expect.objectContaining({
          encounterId: '900001',
          verifiedBedPlacement: expect.objectContaining({ bedId: 'H1C1' }),
        }),
      ]);
      expect(reviewedNames(result.conflicts)).toEqual(expectedReviews);
    }
  );

  const localBed = { bedId: 'H3C1', patientName: 'Local', rut: PASSPORT };
  const localCrib = {
    bedId: 'H3C1',
    patientName: 'Madre',
    rut: '11.111.111-1',
    clinicalCrib: { rut: PASSPORT, patientName: 'RN' },
  };
  it.each([
    ['local bed', RUT_WITH_SAME_DIGITS, localBed, 0],
    ['local bed', 'p-123 456785', localBed, 1],
    ['local crib', RUT_WITH_SAME_DIGITS, localCrib, 0],
    ['local crib', PASSPORT, localCrib, 1],
  ])(
    'a passport in a %s references the earlier-census row %s only when it is the same document',
    (_label, rowDocument, bed, referencedRows) => {
      const record = asStoredDailyRecordShape({ date: emptyRecord.date, beds: { H3C1: bed } });

      expect(
        relevantHistoricalReportRows([earlierCensusRow(rowDocument)], record.date, record, [])
      ).toHaveLength(referencedRows);
    }
  );
});
