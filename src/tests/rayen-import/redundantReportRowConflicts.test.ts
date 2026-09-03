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

  it('la fila del RN con RUN propio casa por el RUN de la cuna adjunta al egreso de la madre', () => {
    const record = makeRecord(true);
    record.beds.H5C1!.clinicalCrib!.rut = '27.999.999-9';
    const newbornConflict = unverifiedConflict({
      rut: '27.999.999-9',
      patientName: 'Rn De Tania Valencia',
    });
    const motherDischarge = discharge({
      associatedClinicalCrib: { ...attachedCrib, rut: '27.999.999-9' },
    });
    expect(
      dropRedundantUnverifiedReportConflicts(
        [unverifiedConflict(), newbornConflict],
        [motherDischarge],
        record
      )
    ).toEqual([]);
    // Sin cuna adjunta, el conflicto del RN se conserva aunque la madre egrese.
    expect(
      dropRedundantUnverifiedReportConflicts([newbornConflict], [discharge()], record)
    ).toEqual([newbornConflict]);
  });

  it('los conflictos de fila «sin episodio» y «anterior al ingreso» también son redundantes ante el egreso final', () => {
    const record = makeRecord(false);
    const episodeLess = unverifiedConflict({
      code: 'episode-less-report-row',
      reason:
        'El informe de Gestión de Camas no identifica el episodio activo de Tania Valencia; se requiere revisión antes de egresar.',
    });
    const predates = unverifiedConflict({
      code: 'report-predates-admission',
      reason:
        'El egreso informado para Tania Valencia es anterior a su ingreso activo; no se desocupó la cama.',
    });
    const bedConflict = unverifiedConflict({ code: 'occupied-local-bed', reason: 'ocupada' });
    expect(
      dropRedundantUnverifiedReportConflicts(
        [episodeLess, predates, bedConflict],
        [discharge()],
        record
      )
    ).toEqual([bedConflict]);
    // Sin egreso final para esa cama, se conservan.
    expect(dropRedundantUnverifiedReportConflicts([episodeLess, predates], [], record)).toEqual([
      episodeLess,
      predates,
    ]);
  });
});
