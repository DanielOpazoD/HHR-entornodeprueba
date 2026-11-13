import { describe, expect, it, vi } from 'vitest';
import { recoverHistoricalReportEpisodes } from '@/features/rayen-import/domain/historicalReportEpisodeRecovery';
import { enrichReportOnlyDischarges } from '@/features/rayen-import/domain/enrichReportOnlyDischarges';
import { associateClinicalCribsWithMothers } from '@/features/rayen-import/domain/clinicalCribMaternalAssociation';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import { applyEgresoReport } from '@/features/rayen-import/domain/applyEgresoReport';
import { createEmptyCensusImportDiff } from '@/features/rayen-import/domain/censusImportDiffFactory';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
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
      `never looks passport %s up by the digits of RUN %s (own census episode=${exact})`,
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
        if (exact) {
          // The census's own episode for this person is asked by episode, as before. The
          // statistical report of the seven-digit pair does not confirm it, as before too.
          expect(result).toEqual([
            passport === '12A3456785'
              ? expect.objectContaining({
                  run: passport,
                  encounterId: '900001',
                  exactEpisodeVerification: 'verified',
                })
              : { ...row(passport), exactEpisodeVerification: 'unverified' },
          ]);
          expect(h.lookupEgresos.mock.calls.flat(2)).toEqual([
            expect.objectContaining({ run: passport, encounterId: '900001' }),
          ]);
        } else {
          // Never looked up by its digits, and still waiting for review.
          expect(result).toEqual([{ ...row(passport), exactEpisodeVerification: 'unverified' }]);
          expect(h.lookupEgresos).not.toHaveBeenCalled();
        }
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

describe('rows that never needed the review mark', () => {
  it.each([
    ['already carries its exact episode', { encounterId: '900001' }],
    ['belongs to pavilion recovery', { bedLabel: 'PR1' }],
  ])('leaves a middle-letter row untouched when it %s', async (_label, overrides) => {
    const untouched = { ...row('12A3456785'), ...overrides };
    const h = dependencies('12.345.678-5');
    expect(await enrichReportOnlyDischarges([untouched], '2024-09-21', h)).toEqual([untouched]);
    expect(h.lookupEgresos).not.toHaveBeenCalled();
  });
});

describe('a report row whose document has a letter in the middle, once applied', () => {
  const DAY = '2026-07-08';
  const occupant = (rut: string, givenName: string, episode?: string): PatientData => ({
    ...rayenToPatientData(
      {
        encounterId: episode ?? 'X',
        run: rut,
        firstGivenName: givenName,
        firstFamilyName: 'INVENTADA',
        birthDate: '1980-01-01',
        service: 'Área Médico Quirúrgica Indiferenciada',
        room: 'H5',
        bed: 'C1',
        admissionDatetime: '2026-07-05T10:00:00-06:00',
      },
      new Date('2026-07-08T20:00:00Z')
    ).patient,
    clinicalEpisodeId: episode,
  });
  const reportRow = (run: string): EgresoReportRow => ({
    ...row(run),
    patientName: 'AMALIA INVENTADA',
    bedLabel: 'H5C1',
    fechaEgreso: '08-07-2026 14:00',
    correctedDay: DAY,
  });
  const apply = async (run: string, bed: PatientData | undefined, foundEpisodeOf?: string) => {
    const lookup = foundEpisodeOf
      ? dependencies(foundEpisodeOf)
      : {
          ...dependencies(run),
          lookupEgresos: vi.fn(async (targets: { run: string }[]) =>
            targets.map(target => ({ run: target.run, encounterId: '', error: 'not found' }))
          ),
        };
    const rows = await enrichReportOnlyDischarges([reportRow(run)], DAY, lookup);
    const record = {
      date: DAY,
      beds: bed ? { H5C1: bed } : {},
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    } as unknown as DailyRecord;
    const diff = applyEgresoReport(createEmptyCensusImportDiff(true), rows, record);
    return {
      episodes: rows.map(enriched => enriched.encounterId),
      discharges: diff.discharges.map(discharge => discharge.rut),
      conflicts: diff.conflicts.map(conflict => conflict.rut),
    };
  };

  it.each([
    ['in her own bed', occupant('12A3456785', 'AMALIA', '700001'), undefined],
    ['in her own bed, stored without an episode', occupant('12A3456785', 'AMALIA'), undefined],
    ['with the RUT patient in that bed', occupant('12.345.678-5', 'BRUNO', '700002'), undefined],
    [
      'with the RUT patient in that bed and an episode found for that RUT',
      occupant('12.345.678-5', 'BRUNO', '700002'),
      '12.345.678-5',
    ],
    ['with nobody in that bed', undefined, undefined],
    ['stored earlier as digits only', occupant('123456785', 'AMALIA', '700001'), undefined],
  ] as const)(
    'never discharges and stays visible for review: %s',
    async (_label, bed, foundEpisodeOf) => {
      expect(await apply('12A3456785', bed, foundEpisodeOf)).toEqual({
        episodes: [undefined],
        discharges: [],
        conflicts: ['12A3456785'],
      });
    }
  );

  it('keeps the policy of a document that starts as a passport and of a plain RUN', async () => {
    expect(await apply('P123456785', occupant('P123456785', 'AMALIA', '700001'))).toEqual({
      episodes: [undefined],
      discharges: ['P123456785'],
      conflicts: [],
    });
    expect(await apply('12.345.678-5', occupant('12.345.678-5', 'AMALIA', '700001'))).toEqual({
      episodes: [undefined],
      discharges: [],
      conflicts: ['12.345.678-5'],
    });
  });
});
