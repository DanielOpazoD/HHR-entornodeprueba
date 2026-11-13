import { describe, expect, it, vi } from 'vitest';
import { recoverHistoricalReportEpisodes } from '@/features/rayen-import/domain/historicalReportEpisodeRecovery';
import { enrichReportOnlyDischarges } from '@/features/rayen-import/domain/enrichReportOnlyDischarges';
import { associateClinicalCribsWithMothers } from '@/features/rayen-import/domain/clinicalCribMaternalAssociation';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import { encounter, newborn, REFERENCE } from './clinicalCribDischargePromotion.fixtures';

const row = (run: string): EgresoReportRow => ({
  run,
  patientName: 'Amalia Inventada',
  bedLabel: 'H3C1',
  servicio: 'Hospitalizados',
  edad: '40 años',
  destino: 'Domicilio',
  motivo: 'Alta',
  fechaEgreso: '21-09-2024 14:00',
  correctedDay: '2024-09-21',
  correctedTime: '14:00',
});
const dependencies = (run: string) => ({
  lookupHospitalizations: vi.fn().mockResolvedValue({
    ok: true,
    episodes: [
      {
        encId: '900001',
        patientName: 'Amalia Inventada',
        startDate: '2024-09-10',
        endDate: '2024-09-21',
        active: false,
      },
    ],
  }),
  lookupEgresos: vi
    .fn()
    .mockResolvedValue([{ run, encounterId: '900001', egreso: { id: '900001' } }]),
  fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
  extractText: vi.fn().mockResolvedValue(`Informe Estadístico de Egreso Hospitalario
1.RUN:
${run
  .replace(/[.-]/g, '')
  .replace(/(.)(.)$/, '$1-$2')
  .toUpperCase()
  .split('')
  .join(' ')}
24 INGRESO 0 1 - 0 0 1 0 - 0 9 - 2 4 Hospitalizados Cuidados Medios 4 0 4
29 EGRESO 1 4 - 0 0 2 1 - 0 9 - 2 4 Domicilio 4 0 4
30 DÍAS ESTADIA 0 0 1 1 31 1) VIVO 2) FALLECIDO 1`),
});
const pairs = [
  ['12A3456785', '12.345.678-5'],
  ['1234567A', '123.456-7'],
];
const runs = ['12.345.678-5', '123456785', '123.456-7', '1234567', '10.000.013-K', '10000013k'];

describe('history passport isolation', () => {
  it.each(pairs)(
    'does not share a cached episode between %s and %s in either order',
    async (passport, run) => {
      for (const passportFirst of [false, true]) {
        const h = dependencies(run);
        h.lookupHospitalizations.mockImplementation(async (value: string) =>
          value === passport
            ? { ok: false }
            : {
                ok: true,
                episodes: [
                  {
                    encId: '900001',
                    patientName: 'Amalia Inventada',
                    startDate: '2024-09-10',
                    endDate: '2024-09-21',
                    active: false,
                  },
                ],
              }
        );
        const source = passportFirst ? [row(passport), row(run)] : [row(run), row(passport)];
        const result = await recoverHistoricalReportEpisodes(source, '2024-09-15', h);
        expect(result.find(r => r.run === passport)).toEqual(row(passport));
        if (run === '12.345.678-5')
          expect(result.find(r => r.run === run)).toMatchObject({
            encounterId: '900001',
            exactEpisodeVerification: 'verified',
          });
        else expect(result.find(r => r.run === run)).toEqual(row(run));
        expect(h.lookupHospitalizations).toHaveBeenCalledExactlyOnceWith(run);
      }
    }
  );

  for (const exact of [false, true]) {
    it.each(pairs)(
      `does not enrich passport %s using RUN %s (exact=${exact})`,
      async (passport, run) => {
        const h = dependencies(run);
        const result = await enrichReportOnlyDischarges([row(passport)], '2024-09-21', {
          ...h,
          ...(exact
            ? {
                previousCensusCandidates: [
                  {
                    run: passport,
                    patientName: 'Amalia Inventada',
                    encounterId: '900001',
                    dischargeDay: '2024-09-21',
                    fromClinicalCrib: false,
                  },
                ],
              }
            : {}),
        });
        expect(result).toEqual([row(passport)]);
        expect(h.lookupEgresos).not.toHaveBeenCalled();
      }
    );
  }

  it.each(runs)(
    'preserves historical recovery and both enrichment routes for RUN %s',
    async run => {
      expect(
        await recoverHistoricalReportEpisodes([row(run)], '2024-09-15', dependencies(run))
      ).toEqual([
        run.replace(/[.-]/g, '') === '1234567'
          ? row(run)
          : expect.objectContaining({
              run,
              encounterId: '900001',
              exactEpisodeVerification: 'verified',
            }),
      ]);
      for (const exact of [false, true]) {
        expect(
          await enrichReportOnlyDischarges([row(run)], '2024-09-21', {
            ...dependencies(run),
            ...(exact
              ? {
                  previousCensusCandidates: [
                    {
                      run,
                      patientName: 'Amalia Inventada',
                      encounterId: '900001',
                      dischargeDay: '2024-09-21',
                      fromClinicalCrib: false,
                    },
                  ],
                }
              : {}),
          })
        ).toEqual([
          run.replace(/[.-]/g, '') === '1234567'
            ? { ...row(run), exactEpisodeVerification: 'unverified' }
            : expect.objectContaining({
                run,
                encounterId: '900001',
                exactEpisodeVerification: 'verified',
              }),
        ]);
      }
    }
  );

  it.each(['K', ' k ', 'P123456785', 'AB1234567'])(
    'retains existing passport rejection for %s',
    async run => {
      const h = dependencies(run);
      expect(await recoverHistoricalReportEpisodes([row(run)], '2024-09-15', h)).toEqual([
        row(run),
      ]);
      expect(await enrichReportOnlyDischarges([row(run)], '2024-09-21', h)).toEqual([row(run)]);
      expect(h.lookupHospitalizations).not.toHaveBeenCalled();
      expect(h.lookupEgresos).not.toHaveBeenCalled();
    }
  );
});

describe('crib association already distinguishes foreign letters on main', () => {
  it.each([...pairs, ...runs.map(run => [run, run])])(
    'compares maternal document %s with newborn %s',
    (document, run) => {
      const sources = [
        encounter({ run: document, firstGivenName: 'Amalia', firstFamilyName: 'Inventada' }),
        { ...newborn(), run, firstGivenName: 'RN de Otra', firstFamilyName: 'Sintetica' },
      ];
      const result = associateClinicalCribsWithMothers(
        sources.map(source => ({
          encounter: source,
          mapped: rayenToPatientData(source, REFERENCE),
        })),
        () => undefined,
        () => undefined
      );
      if (document === run && run.replace(/[.-]/g, '') !== '1234567')
        expect(result[1].usesMaternalRun).toBe(true);
      else expect(result[1].maternalAssociationConflict).toBe('unmatched');
    }
  );
});
