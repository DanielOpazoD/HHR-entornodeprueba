// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BEDS } from '@/constants/beds';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { DataFactory } from '@/tests/factories/DataFactory';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import { preparePatchedRecordPersistence } from '@/services/repositories/dailyRecordPatchPersistenceController';
import { buildCmaEpisodeMovementFields } from '@/application/census/cmaEpisodeMovementFields';
import { buildUndoCmaPatch } from '@/application/census/cmaUndoPatchUseCase';
import { buildDischarge } from '@/features/rayen-import/domain/applyCensusImportDiff';
import {
  resolveAddDischargeMovement,
  resolveAddTransferMovement,
} from '@/application/census/controllers/patientMovementCreationController';
import { resolveUndoPatientMovement } from '@/application/census/controllers/patientMovementUndoController';
import {
  resolveApplyUndoDischargeRecord,
  resolveApplyUndoTransferRecord,
} from '@/application/census/controllers/patientMovementUndoMutationController';
import { getActiveMovements } from '@/domain/movements/movementTombstonePolicy';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DischargeData, TransferData } from '@/types/domain/movements';
import type { DischargeAddCommandPayload } from '@/types/movements';

// Undoing a manual movement restores what main restored. Every step saves through the real
// persistence preparation; the newborn's discharge from an earlier stay must survive every undo.
const DATE = '2026-07-08';
const PREVIOUS_DAY = '2026-07-07';
const MOTHER_RUT = '12.345.678-5';
const save = (record: DailyRecord, previous?: DailyRecord): DailyRecord =>
  structuredClone(prepareDailyRecordForPersistence(record, DATE, previous));

const motherWithReadmittedCrib = (earlierStay: 'with-episode' | 'without-episode' | 'none') => {
  const newborn = (admissionDate: string, admissionTime: string, clinicalEpisodeId?: string) =>
    DataFactory.createMockPatient('R1', {
      patientName: 'RN Sintético',
      rut: '11.111.111-1',
      bedMode: 'Cuna',
      admissionDate,
      admissionTime,
      clinicalEpisodeId,
    });
  const record = DataFactory.createMockDailyRecord(DATE, {
    beds: {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'Madre Sintética',
        rut: MOTHER_RUT,
        clinicalEpisodeId: 'ep_mother',
        admissionDate: DATE,
        clinicalCrib: newborn(DATE, '11:00', 'ep_readmission_crib'),
      }),
    },
  });
  if (earlierStay !== 'none') {
    const earlier = newborn(
      PREVIOUS_DAY,
      '08:00',
      earlierStay === 'with-episode' ? 'ep_first_crib' : undefined
    );
    record.discharges = [
      buildDischarge(
        earlier,
        {
          kind: 'alta',
          bedId: 'R1',
          rut: earlier.rut,
          patientName: earlier.patientName,
          status: 'Vivo',
          correctedDay: DATE,
          correctedCalendarDay: DATE,
          correctedTime: '09:00',
        } as Parameters<typeof buildDischarge>[1],
        record,
        {
          idFactory: () => 'earlier-crib',
          now: new Date(`${DATE}T12:00:00Z`),
          actor: 'synthetic',
          syncRunId: 'synthetic',
        },
        true
      ),
    ];
  }
  return save(record);
};

/** Mother and newborn sharing the maternal document and the episode derived on save. */
const sharedDocumentDyad = (): DailyRecord => {
  const shared = { rut: MOTHER_RUT, admissionDate: DATE, admissionTime: '11:05' };
  return save(
    DataFactory.createMockDailyRecord(DATE, {
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          ...shared,
          patientName: 'Madre Sintética',
          clinicalCrib: DataFactory.createMockPatient('R1', {
            ...shared,
            bedMode: 'Cuna',
            patientName: 'RN Sintético',
            neonatalMaternalRut: MOTHER_RUT,
          }),
        }),
      },
    })
  );
};

type Kind = 'discharges' | 'transfers';
type Step = { record: DailyRecord; code: string };

const leave = (
  record: DailyRecord,
  kind: Kind,
  target: DischargeAddCommandPayload['dischargeTarget'] = 'both'
): DailyRecord => {
  let n = 0;
  const common = {
    record,
    bedId: 'R1',
    bedsCatalog: BEDS,
    createEmptyPatient,
    createId: () => `${kind}-${target}-${++n}`,
  };
  const result =
    kind === 'discharges'
      ? resolveAddDischargeMovement({
          ...common,
          payload: { dischargeTarget: target, status: 'Vivo', cribStatus: 'Vivo', time: '13:00' },
        })
      : resolveAddTransferMovement({
          ...common,
          payload: {
            evacuationMethod: 'Ambulancia',
            receivingCenter: 'Otro',
            receivingCenterOther: 'Centro sintético',
            transferEscort: '',
            time: '13:00',
          },
        });
  if (!result.ok) throw new Error(result.error.message);
  return save(result.value.updatedRecord, record);
};

const undo = (record: DailyRecord, kind: Kind, nested: boolean): Step => {
  const row = getActiveMovements<DischargeData | TransferData>(record[kind]).find(
    movement => movement.id !== 'earlier-crib' && Boolean(movement.isNested) === nested
  );
  if (!row) return { record, code: 'NO_ROW' };
  const resolution = resolveUndoPatientMovement({
    bedData: record.beds.R1,
    bedId: 'R1',
    isNested: row.isNested,
    originalData: row.originalData,
    createEmptyPatient,
  });
  if (!resolution.ok) return { record, code: resolution.error.code };
  const input = { record, bedId: 'R1', updatedBed: resolution.value.updatedBed };
  const next =
    kind === 'discharges'
      ? resolveApplyUndoDischargeRecord({ ...input, dischargeId: row.id })
      : resolveApplyUndoTransferRecord({ ...input, transferId: row.id });
  return { record: save(next, record), code: 'OK' };
};

const undoMotherCma = (record: DailyRecord): Step => {
  const mother = record.beds.R1;
  const item = DataFactory.createMockCMA({
    id: 'cma-mother',
    originalBedId: 'R1',
    bedName: 'R1',
    patientName: mother.patientName,
    rut: mother.rut,
    ...buildCmaEpisodeMovementFields({}, mother),
  });
  const away = save({ ...record, beds: { R1: createEmptyPatient('R1') }, cma: [item] }, record);
  const patch = buildUndoCmaPatch(away, away.cma[0]);
  if (!patch) return { record: away, code: 'NO_PATCH' };
  return {
    record: save(preparePatchedRecordPersistence(away, DATE, patch).record, away),
    code: 'OK',
  };
};

const view = ({ record, code }: Step) => ({
  code,
  bed: record.beds.R1.patientName,
  crib: record.beds.R1.clinicalCrib?.patientName ?? '',
  discharges: getActiveMovements(record.discharges).map(row => row.patientName),
  transfers: getActiveMovements(record.transfers).map(row => row.patientName),
  cma: getActiveMovements(record.cma).map(row => row.patientName),
});

const scenarios: Record<string, () => ReturnType<typeof view>[]> = {};
for (const earlier of ['with-episode', 'without-episode', 'none'] as const) {
  scenarios[`discharge mother only, earlier stay ${earlier}`] = () => {
    const left = leave(motherWithReadmittedCrib(earlier), 'discharges', 'mother');
    return [view(undo(left, 'discharges', false))];
  };
  scenarios[`discharge crib only, earlier stay ${earlier}`] = () => {
    const left = leave(motherWithReadmittedCrib(earlier), 'discharges', 'baby');
    return [view(undo(left, 'discharges', true))];
  };
  for (const kind of ['discharges', 'transfers'] as const) {
    scenarios[`${kind} mother with crib, earlier stay ${earlier}`] = () => {
      const left = leave(motherWithReadmittedCrib(earlier), kind);
      const motherBack = undo(left, kind, false);
      return [view(motherBack), view(undo(motherBack.record, kind, true))];
    };
  }
  scenarios[`CMA of the mother, earlier stay ${earlier}`] = () => [
    view(undoMotherCma(motherWithReadmittedCrib(earlier))),
  ];
}
for (const kind of ['discharges', 'transfers'] as const) {
  scenarios[`${kind} mother with crib sharing her document`] = () => {
    const left = leave(sharedDocumentDyad(), kind);
    const motherBack = undo(left, kind, false);
    return [view(motherBack), view(undo(motherBack.record, kind, true))];
  };
}

// Measured on main 7e133068c with this same file (PRINT_UNDO_PARITY=1 prints the observed values).
const MAIN: Record<string, ReturnType<typeof view>[]> = {
  'discharge mother only, earlier stay with-episode': [
    {
      code: 'MAIN_BED_OCCUPIED',
      bed: 'RN Sintético',
      crib: '',
      discharges: ['RN Sintético', 'Madre Sintética'],
      transfers: [],
      cma: [],
    },
  ],
  'discharge crib only, earlier stay with-episode': [
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: 'RN Sintético',
      discharges: ['RN Sintético'],
      transfers: [],
      cma: [],
    },
  ],
  'discharges mother with crib, earlier stay with-episode': [
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: '',
      discharges: ['RN Sintético', 'RN Sintético'],
      transfers: [],
      cma: [],
    },
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: 'RN Sintético',
      discharges: ['RN Sintético'],
      transfers: [],
      cma: [],
    },
  ],
  'transfers mother with crib, earlier stay with-episode': [
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: '',
      discharges: ['RN Sintético'],
      transfers: ['RN Sintético'],
      cma: [],
    },
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: 'RN Sintético',
      discharges: ['RN Sintético'],
      transfers: [],
      cma: [],
    },
  ],
  'CMA of the mother, earlier stay with-episode': [
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: 'RN Sintético',
      discharges: ['RN Sintético'],
      transfers: [],
      cma: [],
    },
  ],
  'discharge mother only, earlier stay without-episode': [
    {
      code: 'MAIN_BED_OCCUPIED',
      bed: 'RN Sintético',
      crib: '',
      discharges: ['RN Sintético', 'Madre Sintética'],
      transfers: [],
      cma: [],
    },
  ],
  'discharge crib only, earlier stay without-episode': [
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: 'RN Sintético',
      discharges: ['RN Sintético'],
      transfers: [],
      cma: [],
    },
  ],
  'discharges mother with crib, earlier stay without-episode': [
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: '',
      discharges: ['RN Sintético', 'RN Sintético'],
      transfers: [],
      cma: [],
    },
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: 'RN Sintético',
      discharges: ['RN Sintético'],
      transfers: [],
      cma: [],
    },
  ],
  'transfers mother with crib, earlier stay without-episode': [
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: '',
      discharges: ['RN Sintético'],
      transfers: ['RN Sintético'],
      cma: [],
    },
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: 'RN Sintético',
      discharges: ['RN Sintético'],
      transfers: [],
      cma: [],
    },
  ],
  'CMA of the mother, earlier stay without-episode': [
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: 'RN Sintético',
      discharges: ['RN Sintético'],
      transfers: [],
      cma: [],
    },
  ],
  'discharge mother only, earlier stay none': [
    {
      code: 'MAIN_BED_OCCUPIED',
      bed: 'RN Sintético',
      crib: '',
      discharges: ['Madre Sintética'],
      transfers: [],
      cma: [],
    },
  ],
  'discharge crib only, earlier stay none': [
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: 'RN Sintético',
      discharges: [],
      transfers: [],
      cma: [],
    },
  ],
  'discharges mother with crib, earlier stay none': [
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: '',
      discharges: ['RN Sintético'],
      transfers: [],
      cma: [],
    },
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: 'RN Sintético',
      discharges: [],
      transfers: [],
      cma: [],
    },
  ],
  'transfers mother with crib, earlier stay none': [
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: '',
      discharges: [],
      transfers: ['RN Sintético'],
      cma: [],
    },
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: 'RN Sintético',
      discharges: [],
      transfers: [],
      cma: [],
    },
  ],
  'CMA of the mother, earlier stay none': [
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: 'RN Sintético',
      discharges: [],
      transfers: [],
      cma: [],
    },
  ],
  'discharges mother with crib sharing her document': [
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: 'RN Sintético',
      discharges: [],
      transfers: [],
      cma: [],
    },
    {
      code: 'NO_ROW',
      bed: 'Madre Sintética',
      crib: 'RN Sintético',
      discharges: [],
      transfers: [],
      cma: [],
    },
  ],
  'transfers mother with crib sharing her document': [
    {
      code: 'OK',
      bed: 'Madre Sintética',
      crib: 'RN Sintético',
      discharges: [],
      transfers: [],
      cma: [],
    },
    {
      code: 'NO_ROW',
      bed: 'Madre Sintética',
      crib: 'RN Sintético',
      discharges: [],
      transfers: [],
      cma: [],
    },
  ],
};

describe('manual movement undo matches main', () => {
  it.each(Object.keys(scenarios))('%s', name => {
    const observed = scenarios[name]();
    if (process.env.PRINT_UNDO_PARITY) console.log('PARITY', JSON.stringify({ [name]: observed }));
    expect(observed).toEqual(MAIN[name]);
  });
});
