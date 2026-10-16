import { describe, expect, it, vi } from 'vitest';
import { enrichReportOnlyDischarges } from '@/features/rayen-import/domain/enrichReportOnlyDischarges';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';

const row: EgresoReportRow = {
  run: '12.345.678-5',
  patientName: 'Paciente Sintético',
  bedLabel: 'H3C1',
  servicio: 'Hospitalizados',
  edad: '40 años',
  destino: 'Domicilio',
  motivo: 'Alta',
  fechaEgreso: '21-09-2030 09:14',
};
const episode = {
  encId: '300',
  patientName: 'PACIENTE SINTETICO',
  startDate: '2030-09-20',
  endDate: '2030-09-21',
  active: false,
};
const pdf = (admission = '2 0 - 0 9 - 3 0', discharge = '2 1 - 0 9 - 3 0') => `
Informe Estadístico de Egreso Hospitalario
1.RUN:
1 2 3 4 5 6 7 8 - 5
24 INGRESO 0 1 - 0 0 ${admission} Hospitalizados Cuidados Medios 4 0 4
29 EGRESO 0 9 - 1 4 ${discharge} Domicilio 4 0 4
30 DÍAS ESTADIA 0 0 0 1 31 1) VIVO 2) FALLECIDO 1
`;
const harness = () => ({
  allReportDays: true,
  lookupEgresos: vi.fn(async (targets: Array<{ encounterId: string }>) =>
    targets.map(t => ({
      run: row.run,
      encounterId: t.encounterId,
      egreso: t.encounterId ? { id: t.encounterId } : undefined,
    }))
  ),
  lookupHospitalizations: vi.fn().mockResolvedValue({ ok: true, episodes: [episode] }),
  fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
  extractText: vi.fn().mockResolvedValue(pdf()),
});

describe('historical administrative rows resolved through the report index', () => {
  it('omits a uniquely identified episode admitted after the selected night, without PDF work', async () => {
    const h = harness();
    const original = structuredClone(row);
    expect(await enrichReportOnlyDischarges([row], '2030-09-15', h)).toEqual([]);
    expect(h.fetchStatisticalDischarge).not.toHaveBeenCalled();
    expect(row).toEqual(original);
  });

  it('recovers an exact episode when the bulk clock assigns its discharge to the previous census', async () => {
    const h = harness();
    h.lookupHospitalizations.mockResolvedValue({
      ok: true,
      episodes: [{ ...episode, startDate: '2030-09-10' }],
    });
    h.extractText.mockResolvedValue(pdf('1 0 - 0 9 - 3 0'));
    const [result] = await enrichReportOnlyDischarges([row], '2030-09-15', h);
    expect(h.lookupEgresos).toHaveBeenLastCalledWith([{ run: row.run, encounterId: '300' }]);
    expect(result).toMatchObject({
      encounterId: '300',
      exactEpisodeVerification: 'verified',
      admissionDay: '2030-09-10',
      correctedDay: '2030-09-21',
      correctedTime: '09:14',
    });
  });

  it('keeps an admission in the next dawn belonging to the requested night', async () => {
    const h = harness();
    h.lookupHospitalizations.mockResolvedValue({
      ok: true,
      episodes: [{ ...episode, startDate: '2030-09-16' }],
    });
    h.extractText.mockResolvedValue(pdf('1 6 - 0 9 - 3 0'));
    expect(await enrichReportOnlyDischarges([row], '2030-09-15', h)).toEqual([
      expect.objectContaining({
        encounterId: '300',
        admissionDay: '2030-09-16',
        admissionTime: '01:00',
      }),
    ]);
  });

  it('does not replace a mother with her newborn sharing RUN and discharge day', async () => {
    const h = harness();
    h.lookupHospitalizations.mockResolvedValue({
      ok: true,
      episodes: [{ ...episode, patientName: 'RN de Paciente Sintetico' }],
    });
    expect(await enrichReportOnlyDischarges([row], '2030-09-15', h)).toEqual([
      { ...row, exactEpisodeVerification: 'unverified' },
    ]);
    expect(h.fetchStatisticalDischarge).not.toHaveBeenCalled();
  });

  it('can dismiss a future own-RUN discovery whose bulk name omits only the last surname', async () => {
    const h = harness();
    const partial = { ...row, patientName: 'Paciente Sintetico Perez' };
    h.lookupHospitalizations.mockResolvedValue({
      ok: true,
      episodes: [
        {
          ...episode,
          patientName: 'Paciente Sintetico Perez Gonzalez',
          identifierType: 2,
        },
      ],
    });
    expect(await enrichReportOnlyDischarges([partial], '2030-09-15', h)).toEqual([]);
    expect(h.fetchStatisticalDischarge).not.toHaveBeenCalled();
  });

  it.each(['maternal', 'past', 'ambiguous', 'short-name', 'crib'])(
    'never uses a partial name for uncertain identity or reconstruction: %s',
    async kind => {
      const h = harness();
      const partial = { ...row, patientName: 'Paciente Sintetico Perez' };
      const candidate = {
        ...episode,
        patientName: 'Paciente Sintetico Perez Gonzalez',
        identifierType: 2,
      };
      if (kind === 'maternal') candidate.identifierType = 4;
      if (kind === 'past') candidate.startDate = '2030-09-10';
      if (kind === 'short-name') {
        partial.patientName = 'Paciente Sintetico';
        candidate.patientName = 'Paciente Sintetico Perez';
      }
      if (kind === 'crib') partial.bedLabel = 'Cuna H3C1';
      h.lookupHospitalizations.mockResolvedValue({
        ok: true,
        episodes: kind === 'ambiguous' ? [candidate, { ...candidate, encId: '301' }] : [candidate],
      });
      expect(await enrichReportOnlyDischarges([partial], '2030-09-15', h)).toEqual([
        { ...partial, exactEpisodeVerification: 'unverified' },
      ]);
      expect(h.fetchStatisticalDischarge).not.toHaveBeenCalled();
    }
  );

  it.each(['Cuna H3C1', 'C-H3C1', 'CH3C1', 'C-R2', 'C-NEO1'])(
    'keeps an older RN in %s for maternal-link verification',
    async bedLabel => {
      const h = harness();
      h.lookupHospitalizations.mockResolvedValue({
        ok: true,
        episodes: [{ ...episode, startDate: '2030-09-10' }],
      });
      const crib = { ...row, bedLabel };
      expect(await enrichReportOnlyDischarges([crib], '2030-09-15', h)).toEqual([
        { ...crib, exactEpisodeVerification: 'unverified' },
      ]);
      expect(h.fetchStatisticalDischarge).not.toHaveBeenCalled();
    }
  );

  it('keeps ambiguity when two exact-name episodes share the reported discharge date', async () => {
    const h = harness();
    h.lookupHospitalizations.mockResolvedValue({
      ok: true,
      episodes: [episode, { ...episode, encId: '301' }],
    });
    expect(await enrichReportOnlyDischarges([row], '2030-09-15', h)).toEqual([
      { ...row, exactEpisodeVerification: 'unverified' },
    ]);
  });

  it.each([
    { ok: false, error: 'Session unavailable' },
    { ok: true, episodes: [] },
    { ok: true, episodes: [{ ...episode, patientName: undefined }] },
    { ok: true, episodes: [{ ...episode, startDate: '' }] },
    { ok: true, episodes: [{ ...episode, startDate: '2030-02-30' }] },
    { ok: true, episodes: [{ ...episode, endDate: '2030-09-22' }] },
  ])(
    'preserves unverified rows for incomplete, legacy or contradictory index evidence: %j',
    async result => {
      const h = harness();
      h.lookupHospitalizations.mockResolvedValue(result);
      expect(await enrichReportOnlyDischarges([row], '2030-09-15', h)).toEqual([
        { ...row, exactEpisodeVerification: 'unverified' },
      ]);
    }
  );

  it('keeps the row when the optional index rejects instead of failing other verified work', async () => {
    const h = harness();
    h.lookupHospitalizations.mockRejectedValue(new Error('Unavailable'));
    expect(await enrichReportOnlyDischarges([row], '2030-09-15', h)).toEqual([
      { ...row, exactEpisodeVerification: 'unverified' },
    ]);
  });

  it.each(['wrong-run', 'wrong-episode', 'pdf-identity', 'pdf-interval'])(
    'does not trust mismatching exact evidence: %s',
    async kind => {
      const h = harness();
      h.lookupHospitalizations.mockResolvedValue({
        ok: true,
        episodes: [{ ...episode, startDate: '2030-09-10' }],
      });
      h.extractText.mockResolvedValue(pdf('1 0 - 0 9 - 3 0'));
      if (kind === 'wrong-run')
        h.lookupEgresos.mockResolvedValue([
          { run: '11.111.111-1', encounterId: '300', egreso: { id: '300' } },
        ]);
      if (kind === 'wrong-episode')
        h.lookupEgresos.mockResolvedValue([
          { run: row.run, encounterId: '301', egreso: { id: '301' } },
        ]);
      if (kind === 'pdf-identity')
        h.extractText.mockResolvedValue(
          pdf().replace('1 2 3 4 5 6 7 8 - 5', '1 1 1 1 1 1 1 1 - 1')
        );
      if (kind === 'pdf-interval')
        h.extractText.mockResolvedValue(pdf('1 0 - 0 9 - 3 0', '2 2 - 0 9 - 3 0'));
      expect(await enrichReportOnlyDischarges([row], '2030-09-15', h)).toEqual([
        { ...row, exactEpisodeVerification: 'unverified' },
      ]);
    }
  );

  it('never converts a passport into a numeric RUN for either lookup', async () => {
    const h = harness();
    const passport = { ...row, run: 'A12345678' };
    expect(await enrichReportOnlyDischarges([passport], '2030-09-15', h)).toEqual([passport]);
    expect(h.lookupEgresos).not.toHaveBeenCalled();
    expect(h.lookupHospitalizations).not.toHaveBeenCalled();
  });

  it('does not add historical index reads to a current-day import', async () => {
    const h = { ...harness(), allReportDays: false };
    await enrichReportOnlyDischarges([row], '2030-09-21', h);
    expect(h.lookupHospitalizations).not.toHaveBeenCalled();
  });

  it('coalesces index reads for repeated rows of the same identity', async () => {
    const h = harness();
    expect(
      await enrichReportOnlyDischarges(
        [row, { ...row, diagnostico: 'Other diagnosis' }],
        '2030-09-15',
        h
      )
    ).toEqual([]);
    expect(h.lookupHospitalizations).toHaveBeenCalledTimes(1);
  });
});
