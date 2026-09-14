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

  it('no paga lookup ni PDF por un alta ya aplicada en HHR', async () => {
    const applied = { ...row, run: '11.111.111-1', patientName: 'Ya Egresado' };
    const lookupEgresos = vi
      .fn()
      .mockResolvedValue([{ run: '82603646', encounterId: '143322', egreso: { id: 143322 } }]);
    const result = await enrichReportOnlyDischarges([applied, row], '2026-08-13', {
      lookupEgresos,
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi.fn().mockResolvedValue(statisticalText),
      alreadyApplied: candidate => candidate.patientName === 'Ya Egresado',
    });

    // Solo la fila nueva llega al lookup; la aplicada queda 'unverified' y la
    // elegibilidad la descarta como historia sin exigir revisión.
    expect(lookupEgresos).toHaveBeenCalledWith([
      { run: row.run, encounterId: '', dischargeDay: '2026-08-13' },
    ]);
    expect(result[0]).toMatchObject({ exactEpisodeVerification: 'unverified' });
    expect(result[1]).toMatchObject({ exactEpisodeVerification: 'verified' });
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

  it('resolves mother and newborn rows sharing RUN/day through exact D-1 episodes', async () => {
    const newborn = {
      ...row,
      patientName: 'Rn De Paciente De Prueba',
      bedLabel: 'H4C2 RN',
      edad: '0 días',
    };
    const lookupEgresos = vi.fn().mockResolvedValue([
      { run: '82603646', encounterId: '143322', egreso: { id: 143322 } },
      { run: '82603646', encounterId: '143323', egreso: { id: 143323 } },
    ]);
    const result = await enrichReportOnlyDischarges([row, newborn], '2026-08-13', {
      lookupEgresos,
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi.fn().mockResolvedValue(statisticalText),
      previousCensusCandidates: [
        {
          run: row.run,
          patientName: row.patientName,
          encounterId: '143322',
          dischargeDay: '2026-08-13',
          fromClinicalCrib: false,
        },
        {
          run: newborn.run,
          patientName: newborn.patientName,
          encounterId: '143323',
          dischargeDay: '2026-08-13',
          fromClinicalCrib: true,
        },
      ],
    });

    expect(lookupEgresos).toHaveBeenCalledWith([
      expect.objectContaining({ encounterId: '143322' }),
      expect.objectContaining({ encounterId: '143323' }),
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        encounterId: '143322',
        exactEpisodeVerification: 'verified',
      }),
      expect.objectContaining({
        encounterId: '143323',
        exactEpisodeVerification: 'verified',
        fromClinicalCrib: true,
      }),
    ]);
  });

  it('accepts exact D-1 episode + day when the neonatal PDF layout cannot be parsed', async () => {
    const lookupEgresos = vi.fn().mockResolvedValue([
      {
        run: row.run,
        encounterId: '143322',
        egreso: { id: '143322', endPeriod: '2026-08-13T22:29:00-03:00' },
      },
    ]);
    const result = await enrichReportOnlyDischarges([row], '2026-08-13', {
      lookupEgresos,
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi.fn().mockResolvedValue('Formato neonatal sin RUN parseable'),
      previousCensusCandidates: [
        {
          run: row.run,
          patientName: row.patientName,
          encounterId: '143322',
          dischargeDay: '2026-08-13',
          fromClinicalCrib: true,
        },
      ],
    });

    expect(result[0]).toMatchObject({
      encounterId: '143322',
      exactEpisodeVerification: 'verified',
      correctedDay: '2026-08-13',
      correctedTime: '19:29',
      fromClinicalCrib: true,
    });
  });

  it('never lets a generic shared-RUN result replace a failed exact mother candidate', async () => {
    const newborn = { ...row, patientName: 'Rn De Paciente De Prueba' };
    const result = await enrichReportOnlyDischarges([row, newborn], '2026-08-13', {
      lookupEgresos: vi.fn().mockResolvedValue([
        { run: newborn.run, encounterId: '143323', egreso: { id: '143323' } },
        { run: row.run, encounterId: '', egreso: null },
      ]),
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi.fn().mockResolvedValue(statisticalText),
      previousCensusCandidates: [
        {
          run: row.run,
          patientName: row.patientName,
          encounterId: '143322',
          dischargeDay: '2026-08-13',
          fromClinicalCrib: false,
        },
      ],
    });

    expect(result[0]).toEqual({ ...row, exactEpisodeVerification: 'unverified' });
    expect(result[1]).toMatchObject({
      patientName: newborn.patientName,
      encounterId: '143323',
      exactEpisodeVerification: 'verified',
    });
  });

  it('rejects an explicit administrative false even when a discharge timestamp exists', async () => {
    const result = await enrichReportOnlyDischarges([row], '2026-08-13', {
      lookupEgresos: vi.fn().mockResolvedValue([
        {
          run: row.run,
          encounterId: '143322',
          egreso: {
            id: '143322',
            endPeriod: '2026-08-13T22:29:00-03:00',
            hasAdministrativeDischarge: false,
          },
        },
      ]),
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi.fn().mockResolvedValue(statisticalText),
      previousCensusCandidates: [
        {
          run: row.run,
          patientName: row.patientName,
          encounterId: '143322',
          dischargeDay: '2026-08-13',
          fromClinicalCrib: false,
        },
      ],
    });

    expect(result).toEqual([{ ...row, exactEpisodeVerification: 'unverified' }]);
  });

  it('rejects a parsed PDF that contradicts the expected RUN instead of falling back', async () => {
    const result = await enrichReportOnlyDischarges([row], '2026-08-13', {
      lookupEgresos: vi.fn().mockResolvedValue([
        {
          run: row.run,
          encounterId: '143322',
          egreso: { id: '143322', endPeriod: '2026-08-13T22:29:00-03:00' },
        },
      ]),
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi
        .fn()
        .mockResolvedValue(statisticalText.replace('8 2 6 0 3 6 4 - 6', '1 9 3 3 8 5 4 1 - 9')),
      previousCensusCandidates: [
        {
          run: row.run,
          patientName: row.patientName,
          encounterId: '143322',
          dischargeDay: '2026-08-13',
          fromClinicalCrib: false,
        },
      ],
    });

    expect(result).toEqual([{ ...row, exactEpisodeVerification: 'unverified' }]);
  });

  it('rejects an exact episode whose administrative discharge belongs to another day', async () => {
    const result = await enrichReportOnlyDischarges([row], '2026-08-13', {
      lookupEgresos: vi.fn().mockResolvedValue([
        {
          run: row.run,
          encounterId: '143322',
          egreso: { id: '143322', endPeriod: '2026-08-14T22:29:00-03:00' },
        },
      ]),
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi.fn().mockResolvedValue('Formato no parseable'),
      previousCensusCandidates: [
        {
          run: row.run,
          patientName: row.patientName,
          encounterId: '143322',
          dischargeDay: '2026-08-13',
          fromClinicalCrib: false,
        },
      ],
    });

    expect(result).toEqual([{ ...row, exactEpisodeVerification: 'unverified' }]);
  });

  it('fails closed when an exact D-1 candidate is not confirmed by the lookup', async () => {
    const earlyRow = { ...row, fechaEgreso: '13-08-2026 10:00' };
    const result = await enrichReportOnlyDischarges([earlyRow], '2026-08-13', {
      lookupEgresos: vi.fn().mockResolvedValue([]),
      fetchStatisticalDischarge: vi.fn(),
      previousCensusCandidates: [
        {
          run: earlyRow.run,
          patientName: earlyRow.patientName,
          encounterId: '143322',
          dischargeDay: '2026-08-12',
          fromClinicalCrib: false,
        },
      ],
    });

    expect(result).toEqual([{ ...earlyRow, exactEpisodeVerification: 'unverified' }]);
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
