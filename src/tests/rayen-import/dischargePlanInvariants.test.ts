import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { CensusImportDiff } from '@/features/rayen-import';
import {
  dedupeDischargesByBed,
  resolveReportedOccupant,
} from '@/features/rayen-import/domain/dischargePlanInvariants';
import {
  occupiedBedsByRun,
  occupiedClinicalCribsByRun,
} from '@/features/rayen-import/domain/egresoReportPolicy';
import type { DailyRecord } from '@/types/domain/dailyRecord';

type Discharge = CensusImportDiff['discharges'][number];

const RUN = '28.106.852-0';

const record: DailyRecord = {
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
      clinicalCrib: {
        ...EMPTY_PATIENT,
        bedId: 'H5C1',
        bedMode: 'Cuna',
        patientName: 'Rn De Tania Valencia',
        rut: RUN,
        clinicalEpisodeId: '1002',
        admissionDate: '2026-08-31',
      },
    },
  },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
};

const occupied = occupiedBedsByRun(record);
const occupiedCribs = occupiedClinicalCribsByRun(record);

const discharge = (overrides: Partial<Discharge>): Discharge => ({
  bedId: 'H5C1',
  rut: RUN,
  patientName: 'Tania Valencia',
  kind: 'alta',
  status: 'Vivo',
  reason: 'administrative-discharge',
  encounterId: '1001',
  ...overrides,
});

describe('resolveReportedOccupant', () => {
  it('el episodio exacto de la madre resuelve su cama', () => {
    expect(resolveReportedOccupant(occupied, occupiedCribs, RUN, '1001')?.bedId).toBe('H5C1');
  });

  it('el episodio exacto de la CUNA no cae al RUN de la madre (era el origen del alta duplicada)', () => {
    expect(resolveReportedOccupant(occupied, occupiedCribs, RUN, '1002')).toBeUndefined();
  });

  it('sin episodio o con un episodio desconocido, conserva la resolución por RUN', () => {
    expect(resolveReportedOccupant(occupied, occupiedCribs, RUN, '')?.bedId).toBe('H5C1');
    expect(resolveReportedOccupant(occupied, occupiedCribs, RUN, undefined)?.bedId).toBe('H5C1');
    expect(resolveReportedOccupant(occupied, occupiedCribs, RUN, '9999')?.bedId).toBe('H5C1');
    expect(resolveReportedOccupant(occupied, occupiedCribs, '11.111.111-1', '')).toBeUndefined();
  });
});

describe('dedupeDischargesByBed', () => {
  it('conserva el primer egreso de cada cama y descarta un segundo para la misma cama', () => {
    const first = discharge({});
    const duplicate = discharge({ encounterId: '1002' });
    const other = discharge({ bedId: 'H5C2', rut: '11.111.111-1', encounterId: '2001' });
    expect(dedupeDischargesByBed([first, duplicate, other])).toEqual([first, other]);
    expect(dedupeDischargesByBed([])).toEqual([]);
  });
});
