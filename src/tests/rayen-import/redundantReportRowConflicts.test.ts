import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { CensusImportDiff } from '@/features/rayen-import';
import { dropRedundantUnverifiedReportConflicts } from '@/features/rayen-import/domain/redundantReportRowConflicts';
import type { DailyRecord } from '@/types/domain/dailyRecord';

type Conflict = CensusImportDiff['conflicts'][number];
type Discharge = CensusImportDiff['discharges'][number];

const RUN = '28.106.852-0';

const makeRecord = (withCrib: boolean): DailyRecord => ({
  date: '2026-09-02',
  beds: {
    H5C1: {
      ...EMPTY_PATIENT,
      bedId: 'H5C1',
      patientName: 'Tania Valencia',
      rut: RUN,
      clinicalEpisodeId: '1001',
      admissionDate: '2026-08-31',
      admissionTime: '10:00',
      clinicalCrib: withCrib
        ? {
            ...EMPTY_PATIENT,
            bedId: 'H5C1',
            bedMode: 'Cuna',
            patientName: 'Rn De Tania Valencia',
            rut: RUN,
            clinicalEpisodeId: '1002',
            admissionDate: '2026-08-31',
          }
        : undefined,
    },
  },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const unverifiedConflict = (overrides: Partial<Conflict> = {}): Conflict => ({
  bedId: 'H5C1',
  rut: RUN,
  patientName: 'Tania Valencia',
  code: 'unverified-report-row',
  reason:
    'El alta administrativa de Tania Valencia no pudo vincularse a un episodio clínico exacto; no se aplicó.',
  ...overrides,
});

const discharge = (overrides: Partial<Discharge> = {}): Discharge => ({
  bedId: 'H5C1',
  rut: RUN,
  patientName: 'Tania Valencia',
  kind: 'alta',
  status: 'Vivo',
  reason: 'administrative-discharge',
  encounterId: '1001',
  ...overrides,
});

const attachedCrib = {
  clinicalEpisodeId: '1002',
  patientName: 'Rn De Tania Valencia',
  rut: RUN,
};

describe('dropRedundantUnverifiedReportConflicts', () => {
  it('descarta la revisión cuando el egreso de esa cama y RUN ya existe y la cuna sale adjunta', () => {
    const kept = dropRedundantUnverifiedReportConflicts(
      [unverifiedConflict()],
      [discharge({ associatedClinicalCrib: attachedCrib })],
      makeRecord(true)
    );
    expect(kept).toEqual([]);
  });

  it('sin cuna en la cama basta con que exista el egreso, sea alta o traslado', () => {
    expect(
      dropRedundantUnverifiedReportConflicts(
        [unverifiedConflict()],
        [discharge()],
        makeRecord(false)
      )
    ).toEqual([]);
    expect(
      dropRedundantUnverifiedReportConflicts(
        [unverifiedConflict()],
        [discharge({ kind: 'traslado', status: 'Vivo' })],
        makeRecord(false)
      )
    ).toEqual([]);
  });

  it('con cuna ocupada, un egreso que no la adjunta (traslado, fallecido, snapshot incompleto) conserva la revisión', () => {
    const record = makeRecord(true);
    const conflict = unverifiedConflict();
    expect(
      dropRedundantUnverifiedReportConflicts(
        [conflict],
        [discharge({ kind: 'traslado', status: 'Vivo' })],
        record
      )
    ).toEqual([conflict]);
    expect(dropRedundantUnverifiedReportConflicts([conflict], [discharge()], record)).toEqual([
      conflict,
    ]);
  });

  it('no toca conflictos sin etiqueta, sin cama, de otro RUN o de otra cama', () => {
    const record = makeRecord(false);
    const untagged = unverifiedConflict({ code: undefined });
    const bedless = unverifiedConflict({ bedId: null });
    const otherRun = unverifiedConflict({ rut: '11.111.111-1' });
    const otherBed = unverifiedConflict({ bedId: 'H5C2' });
    expect(
      dropRedundantUnverifiedReportConflicts(
        [untagged, bedless, otherRun, otherBed],
        [discharge()],
        record
      )
    ).toEqual([untagged, bedless, otherRun, otherBed]);
  });
});
