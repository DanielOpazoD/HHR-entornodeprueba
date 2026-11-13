// Synthetic regressions through the public structural planner.
import { expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import { replanRayenStructure } from '@/features/rayen-import/hooks/replanRayenStructure';

const occ = (bedId: string, rut: string, name: string, ep?: string) =>
  ({
    ...EMPTY_PATIENT,
    bedId,
    patientName: name,
    rut,
    clinicalEpisodeId: ep,
    admissionDate: '2026-08-30',
    admissionTime: '09:00',
  }) as DailyRecord['beds'][string];
const rec = (beds: DailyRecord['beds']): DailyRecord =>
  ({
    date: '2026-09-02',
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-09-02T10:00:00.000Z',
  }) as DailyRecord;
const row = (run: string, ep?: string): EgresoReportRow => ({
  ...(ep ? { encounterId: ep, exactEpisodeVerification: 'verified' as const } : {}),
  run,
  patientName: 'Reporte',
  bedLabel: 'H4C1',
  servicio: 'Medicina',
  edad: '60',
  destino: 'Domicilio',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '02-09-2026 10:00',
});
const run = (record: DailyRecord, rows: EgresoReportRow[]) =>
  replanRayenStructure(
    record,
    {
      sourceSnapshot: {
        capturedAt: '2026-09-02T12:00:00-06:00',
        facilityId: 1342,
        encounters: [],
        isComplete: true,
      },
      egresoRows: rows,
      reportDate: '2026-09-02',
      isHistoricalDay: false,
      invalidEpisodeIds: new Set<string>(),
    },
    {
      dailyRecord: {
        getForDate: vi.fn().mockResolvedValue(null),
        getAuthoritativeForDate: vi.fn().mockResolvedValue(null),
      } as unknown as DailyRecordRepositoryPort,
      isAdmin: false,
      fetchPatientFlowReport: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
      lookupEgresos: vi.fn().mockResolvedValue([]),
    }
  );
it(
  'discharges the exact episode despite a legacy document or another digit collision',
  { timeout: 120000 },
  async () => {
    const cases: Record<string, [DailyRecord, EgresoReportRow[]]> = {
      crossNoEp: [rec({ H4C1: occ('H4C1', '12.345.678-5', 'Rut') }), [row('P123456785')]],
      crossEp: [rec({ H4C1: occ('H4C1', '12.345.678-5', 'Rut', '777') }), [row('P123456785')]],
      legacyEp: [
        rec({ H4C1: occ('H4C1', '123.456-7', 'Legado', '777') }),
        [row('1234567A', '777')],
      ],
      passportEpWithOtherRut: [
        rec({
          H4C1: occ('H4C1', 'P123456785', 'Pasaporte', '777'),
          H4C2: occ('H4C2', '12.345.678-5', 'Rut', '888'),
        }),
        [row('P123456785', '777')],
      ],
    };
    for (const [name, [record, rows]] of Object.entries(cases)) {
      const result = await run(record, rows);
      if (name.startsWith('cross')) {
        expect(result.discharges, name).toEqual([]);
        expect(result.conflicts, name).toHaveLength(1);
      } else {
        expect(result.discharges, name).toMatchObject([{ bedId: 'H4C1', encounterId: '777' }]);
        expect(result.conflicts, name).toEqual([]);
      }
    }
  }
);
