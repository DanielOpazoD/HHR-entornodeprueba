import { describe, expect, it, vi } from 'vitest';
import { reconstructHistoricalSnapshotAtClose } from '@/features/rayen-import/domain/historicalSnapshotReconstruction';
import type { RayenCensusSnapshot } from '@/features/rayen-import/contracts/rayenSnapshot';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import { resolveClinicalDayBounds } from '@/utils/clinicalDayScheduleUtils';

describe('multi-day historical reconstruction after a synchronization gap', () => {
  it('reconstructs four missed census days from exact flow evidence without copying the final bed backwards', async () => {
    const delayedSnapshot: RayenCensusSnapshot = {
      capturedAt: '2026-09-22T13:00:00-06:00',
      facilityId: 1342,
      isComplete: true,
      encounters: [],
    };
    const delayedDischarge: EgresoReportRow = {
      run: '11.111.111-1',
      encounterId: '142040',
      patientName: 'Caso sintético',
      bedLabel: 'H2C2',
      servicio: 'AMQI',
      edad: '40 años',
      destino: 'Domicilio',
      motivo: 'Alta',
      fechaEgreso: '21-09-2026 16:00',
    };
    const delayedFlow = `
Flujo del Paciente RUN: 111111111
16/09/2026 10:00:00 Servicio Estación Habitación 1 Básica C1
19/09/2026 10:00:00 Servicio Estación Habitación 2 Básica C2
`;
    const fetchReport = vi.fn(async () => ({ base64: 'QQ==' }));
    // Each selected census closes the following morning. The 19/09 10:00 move is after the
    // 18/09 census closes on Saturday at 09:00, but before the 19/09 census closes on Sunday.
    expect(resolveClinicalDayBounds('2026-09-18')).toMatchObject({
      nextDay: '2026-09-19',
      nightEnd: '09:00',
    });
    expect(resolveClinicalDayBounds('2026-09-19')).toMatchObject({
      nextDay: '2026-09-20',
      nightEnd: '09:00',
    });
    const expectedBeds = [
      ['2026-09-17', 'H1C1'],
      ['2026-09-18', 'H1C1'],
      ['2026-09-19', 'H2C2'],
      ['2026-09-20', 'H2C2'],
    ] as const;

    for (const [day, bedId] of expectedBeds) {
      const result = await reconstructHistoricalSnapshotAtClose(
        day,
        delayedSnapshot,
        { date: day, beds: {} } as DailyRecord,
        [delayedDischarge],
        { fetchReport, extractText: async () => delayedFlow }
      );
      expect(result.conflicts).toEqual([]);
      expect(result.snapshot.encounters).toEqual([
        expect.objectContaining({
          encounterId: '142040',
          verifiedBedPlacement: expect.objectContaining({ bedId }),
        }),
      ]);
    }
    const dischargeDay = await reconstructHistoricalSnapshotAtClose(
      '2026-09-21',
      delayedSnapshot,
      { date: '2026-09-21', beds: {} } as DailyRecord,
      [delayedDischarge],
      { fetchReport, extractText: async () => delayedFlow }
    );
    expect(dischargeDay.conflicts).toEqual([]);
    expect(dischargeDay.snapshot.encounters).toEqual([]);
    expect(fetchReport).toHaveBeenCalledTimes(expectedBeds.length);
  });
});
