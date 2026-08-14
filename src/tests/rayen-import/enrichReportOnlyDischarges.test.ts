import { describe, expect, it, vi } from 'vitest';
import { enrichReportOnlyDischarges } from '@/features/rayen-import/domain/enrichReportOnlyDischarges';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';

const row: EgresoReportRow = {
  run: '8.260.364-6',
  patientName: 'Paciente de prueba',
  bedLabel: 'H4C2',
  servicio: 'Área Médico Quirúrgica',
  edad: '67 años',
  destino: 'Fallecido',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '13-08-2026 22:29',
  diagnostico: 'Diagnóstico de prueba',
};

const statisticalText = `
Informe Estadístico de Egreso Hospitalario
1.RUN:
8 2 6 0 3 6 4 - 6
24 INGRESO 1 4 - 0 4 1 3 - 0 8 - 2 6 Área Médico Quirúrgico Cuidados Medios 4 0 4
29 EGRESO 2 0 - 2 9 1 3 - 0 8 - 2 6 Domicilio 4 0 4
30 DÍAS ESTADIA 0 0 0 1 31 1) VIVO 2) FALLECIDO 2
`;

describe('report-only short-stay enrichment', () => {
  it('uses the range report only for discovery and persists the exact episode interval', async () => {
    const lookupEgresos = vi
      .fn()
      .mockResolvedValue([{ run: '82603646', encounterId: '143322', egreso: { id: 143322 } }]);
    const result = await enrichReportOnlyDischarges([row], '2026-08-13', {
      lookupEgresos,
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi.fn().mockResolvedValue(statisticalText),
    });

    expect(lookupEgresos).toHaveBeenCalledWith([
      { run: row.run, encounterId: '', dischargeDay: '2026-08-13' },
    ]);
    expect(result[0]).toMatchObject({
      encounterId: '143322',
      exactEpisodeVerification: 'verified',
      admissionDay: '2026-08-13',
      admissionTime: '14:04',
      correctedDay: '2026-08-13',
      correctedTime: '20:29',
      dischargeStatus: 'Fallecido',
    });
  });

  it('fails closed on an ambiguous lookup and preserves the original bulk evidence', async () => {
    const result = await enrichReportOnlyDischarges([row], '2026-08-13', {
      lookupEgresos: vi.fn().mockResolvedValue([]),
      fetchStatisticalDischarge: vi.fn(),
      extractText: vi.fn(),
    });

    expect(result).toEqual([{ ...row, exactEpisodeVerification: 'unverified' }]);
  });

  it('preserves the bulk evidence when the optional exact lookup is unavailable', async () => {
    const result = await enrichReportOnlyDischarges([row], '2026-08-13', {
      lookupEgresos: vi.fn().mockRejectedValue(new Error('Gestión de Camas no disponible')),
      fetchStatisticalDischarge: vi.fn(),
      extractText: vi.fn(),
    });

    expect(result).toEqual([{ ...row, exactEpisodeVerification: 'unverified' }]);
  });

  it('leaves duplicate RUN/day rows untouched because their episode is ambiguous', async () => {
    const duplicate = { ...row, bedLabel: 'H5C1', diagnostico: 'Otro episodio' };
    const lookupEgresos = vi.fn();
    const result = await enrichReportOnlyDischarges([row, duplicate], '2026-08-13', {
      lookupEgresos,
      fetchStatisticalDischarge: vi.fn(),
      extractText: vi.fn(),
    });

    expect(lookupEgresos).not.toHaveBeenCalled();
    expect(result).toEqual([
      { ...row, exactEpisodeVerification: 'unverified' },
      { ...duplicate, exactEpisodeVerification: 'unverified' },
    ]);
  });

  it('does not import genuine D+1 rows from the source compensation window', async () => {
    const lookupEgresos = vi
      .fn()
      .mockResolvedValue([{ run: '82603646', encounterId: '143323', egreso: { id: 143323 } }]);
    const result = await enrichReportOnlyDischarges(
      [{ ...row, fechaEgreso: '14-08-2026 01:00' }],
      '2026-08-13',
      {
        lookupEgresos,
        fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
        extractText: vi
          .fn()
          .mockResolvedValue(statisticalText.replaceAll('1 3 - 0 8', '1 4 - 0 8')),
      }
    );

    expect(lookupEgresos).toHaveBeenCalledOnce();
    expect(result[0].encounterId).toBeUndefined();
  });
});
