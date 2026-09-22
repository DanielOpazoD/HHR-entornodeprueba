import { describe, expect, it } from 'vitest';
import {
  applyEgresoReport,
  type CensusImportDiff,
  type EgresoReportRow,
} from '@/features/rayen-import';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import {
  createReportEpisodeMatcher,
  selectReportRowsByEpisode,
} from '@/features/rayen-import/domain/egresoReportPolicy';

const patient = (rut: string, patientName = 'Paciente'): PatientData => ({
  ...EMPTY_PATIENT,
  patientName,
  rut,
  bedId: 'R2',
});

const makeRecord = (
  beds: DailyRecord['beds'] = {},
  movements: Partial<Pick<DailyRecord, 'discharges' | 'transfers' | 'cma'>> = {}
): DailyRecord => ({
  date: '2026-07-14',
  beds,
  discharges: movements.discharges ?? [],
  transfers: movements.transfers ?? [],
  cma: movements.cma ?? [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const makeDiff = (over: Partial<CensusImportDiff> = {}): CensusImportDiff => ({
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
  ...over,
});

const row = (over: Partial<EgresoReportRow>): EgresoReportRow => ({
  run: '',
  patientName: '',
  bedLabel: '',
  servicio: '',
  edad: '',
  destino: '',
  motivo: '',
  fechaEgreso: '14-07-2026  12:00',
  ...over,
});

import { selectEligibleEgresoRows } from '@/features/rayen-import/domain/egresoReportEligibility';

describe('typed identities in discharge reports', () => {
  it('matches the exact episode before an earlier same-identifier report row', () => {
    const selected = selectReportRowsByEpisode(
      [
        row({ run: '123456785', documentType: 'RUT', encounterId: 'OLDER' }),
        row({ run: '123456785', documentType: 'RUT', encounterId: 'ACTIVE' }),
      ],
      () => 'ACTIVE'
    );
    expect(createReportEpisodeMatcher(selected.primaryByRun)('123456785', 'ACTIVE', true)).toBe(
      true
    );
    expect(createReportEpisodeMatcher(selected.primaryByRun)('123456785')).toBe(false);
  });

  it('keeps legacy matching but does not infer an ambiguous numeric passport', () => {
    const legacy = selectReportRowsByEpisode([row({ run: '123456785' })], () => '');
    expect(createReportEpisodeMatcher(legacy.primaryByRun)('123456785')).toBe(true);
    const passport = selectReportRowsByEpisode(
      [row({ run: '123456785', documentType: 'Pasaporte' })],
      () => ''
    );
    expect(createReportEpisodeMatcher(passport.primaryByRun)('123456785')).toBe(false);
  });

  it('keeps episode-less rows with the same numeric code when their document types differ', () => {
    const selected = selectReportRowsByEpisode(
      [
        row({ run: '123456785', documentType: 'RUT', patientName: 'Paciente Rut' }),
        row({ run: '123456785', documentType: 'Pasaporte', patientName: 'Paciente Pasaporte' }),
      ],
      () => ''
    );

    expect([...selected.primaryByRun.values()]).toEqual([
      expect.objectContaining({ documentType: 'RUT', patientName: 'Paciente Rut' }),
      expect.objectContaining({ documentType: 'Pasaporte', patientName: 'Paciente Pasaporte' }),
    ]);
  });

  it('does not discard an episode-less passport because a same-looking RUT has an exact row', () => {
    const selected = selectReportRowsByEpisode(
      [
        row({ run: '123456785', documentType: 'RUT', encounterId: 'RUT-EPISODE' }),
        row({ run: '123456785', documentType: 'RUT' }),
        row({ run: '123456785', documentType: 'Pasaporte' }),
      ],
      (_run, documentType) => (documentType === 'RUT' ? 'RUT-EPISODE' : 'PASSPORT-EPISODE')
    );

    expect([...selected.primaryByRun.values()]).toEqual([
      expect.objectContaining({ documentType: 'RUT', encounterId: 'RUT-EPISODE' }),
      expect.objectContaining({ documentType: 'Pasaporte' }),
    ]);
  });

  it('applies an exact numeric-passport egreso without borrowing the same-looking RUT evidence', () => {
    const rutPatient = {
      ...patient('123456785', 'Paciente Rut'),
      documentType: 'RUT' as const,
      clinicalEpisodeId: 'RUT-EPISODE',
    };
    const passportPatient = {
      ...patient('123456785', 'Paciente Pasaporte'),
      bedId: 'R3',
      documentType: 'Pasaporte' as const,
      clinicalEpisodeId: 'PASSPORT-EPISODE',
    };
    const pendingBase = {
      signal: 'clinical-closure' as const,
      verification: {
        medicalEpicrisis: 'unknown' as const,
        nursingEpicrisis: 'unknown' as const,
        hospitalDischarge: 'not-detected' as const,
      },
    };
    const enriched = applyEgresoReport(
      makeDiff({
        pendingAdministrativeDischarges: [
          {
            ...pendingBase,
            bedId: 'R2',
            rut: rutPatient.rut,
            documentType: 'RUT',
            patientName: rutPatient.patientName,
            encounterId: 'RUT-EPISODE',
            verification: { ...pendingBase.verification, medicalEpicrisis: 'confirmed' },
          },
          {
            ...pendingBase,
            bedId: 'R3',
            rut: passportPatient.rut,
            documentType: 'Pasaporte',
            patientName: passportPatient.patientName,
            encounterId: 'PASSPORT-EPISODE',
          },
        ],
      }),
      [
        row({
          run: passportPatient.rut,
          documentType: 'Pasaporte',
          encounterId: 'PASSPORT-EPISODE',
          destino: 'Domicilio',
        }),
      ],
      makeRecord({ R2: rutPatient, R3: passportPatient })
    );

    expect(enriched.discharges).toEqual([
      expect.objectContaining({
        bedId: 'R3',
        encounterId: 'PASSPORT-EPISODE',
        patientName: 'Paciente Pasaporte',
        verification: expect.objectContaining({ medicalEpicrisis: 'unknown' }),
      }),
    ]);
  });
  it('preserves document type in an isolated report-row conflict', () => {
    const record: DailyRecord = {
      date: '2026-09-02',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const result = selectEligibleEgresoRows(
      makeDiff(),
      [
        {
          encounterId: '',
          run: 'P1234567',
          documentType: 'Pasaporte',
          patientName: 'Paciente Pasaporte',
          bedLabel: '',
          servicio: 'Medicina',
          edad: '50',
          destino: 'Domicilio',
          motivo: 'Alta hospitalaria',
          fechaEgreso: 'sin fecha',
        },
      ],
      record
    );

    expect(result.diff.conflicts[0]).toMatchObject({
      bedId: null,
      rut: 'P1234567',
      documentType: 'Pasaporte',
      scope: 'report-row-subject',
    });
  });
});
