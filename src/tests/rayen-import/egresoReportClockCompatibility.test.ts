import { describe, expect, it, vi } from 'vitest';
import { enrichReportOnlyDischarges } from '@/features/rayen-import/domain/enrichReportOnlyDischarges';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';

const row: EgresoReportRow = {
  run: '11.111.111-1',
  patientName: 'Paciente Sintético',
  bedLabel: 'R2',
  servicio: 'Área Médico Quirúrgica',
  edad: '40 años',
  destino: 'Domicilio',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '13-08-2026 08:30',
};
const morningReport = `
1.RUN:
1 1 1 1 1 1 1 1 - 1
24 INGRESO 1 2 - 0 0 1 2 - 0 8 - 2 6 Área Médico Quirúrgico Cuidados Medios 4 0 4
29 EGRESO 0 8 - 3 0 1 3 - 0 8 - 2 6 Domicilio 4 0 4
`;

describe('unzoned administrative report clock', () => {
  it.each(['13-08-2026 08:30', '13-08-2026 10:30'])(
    'confirms the same official episode clock when the bulk cell says %s',
    async fechaEgreso => {
      const lookupEgresos = vi
        .fn()
        .mockResolvedValue([{ run: row.run, encounterId: '880001', egreso: { id: 880001 } }]);
      const result = await enrichReportOnlyDischarges([{ ...row, fechaEgreso }], '2026-08-13', {
        lookupEgresos,
        fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
        extractText: vi.fn().mockResolvedValue(morningReport),
      });

      expect(lookupEgresos).toHaveBeenCalledWith([
        { run: row.run, encounterId: '', dischargeDay: '2026-08-13' },
      ]);
      expect(result[0]).toMatchObject({
        fechaEgreso,
        encounterId: '880001',
        exactEpisodeVerification: 'verified',
        correctedDay: '2026-08-13',
        correctedTime: '08:30',
      });
    }
  );

  it('does not confirm an ambiguous bulk clock without exact episode evidence', async () => {
    const result = await enrichReportOnlyDischarges([row], '2026-08-13', {
      lookupEgresos: vi.fn().mockResolvedValue([]),
      fetchStatisticalDischarge: vi.fn(),
    });

    expect(result).toEqual([{ ...row, exactEpisodeVerification: 'unverified' }]);
  });

  it('does not use the additional candidate day to select another discharge at a different time', async () => {
    const result = await enrichReportOnlyDischarges([row], '2026-08-13', {
      lookupEgresos: vi
        .fn()
        .mockResolvedValue([{ run: row.run, encounterId: '880002', egreso: { id: 880002 } }]),
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi
        .fn()
        .mockResolvedValue(morningReport.replace('29 EGRESO 0 8 - 3 0', '29 EGRESO 1 3 - 3 0')),
    });

    expect(result).toEqual([{ ...row, exactEpisodeVerification: 'unverified' }]);
  });
});
