// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BEDS } from '@/constants/beds';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { DataFactory } from '@/tests/factories/DataFactory';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import {
  resolveAddDischargeMovement,
  resolveAddTransferMovement,
} from '@/features/census/controllers/patientMovementCreationController';
import { resolveUndoPatientMovement } from '@/features/census/controllers/patientMovementUndoController';
import {
  resolveApplyUndoDischargeRecord,
  resolveApplyUndoTransferRecord,
} from '@/features/census/controllers/patientMovementUndoMutationController';
import { getActiveMovements } from '@/domain/movements/movementTombstonePolicy';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DischargeData, TransferData } from '@/types/domain/movements';

// Old records gave the newborn the mother's document; saving then derived the same legacy episode
// for both. Mother and newborn are still two people (ID-03): undoing one never retires the other.
const DATE = '2026-07-08';
const MOTHER = 'Madre Sintética';
const NEWBORN = 'RN de Madre Sintética';
const save = (record: DailyRecord, previous?: DailyRecord): DailyRecord =>
  structuredClone(prepareDailyRecordForPersistence(record, DATE, previous));

const dyad = (episodes: 'derived-on-save' | 'newborn-without-episode'): DailyRecord => {
  const shared = { rut: '12.345.678-5', admissionDate: DATE, admissionTime: '11:05' };
  const record = DataFactory.createMockDailyRecord(DATE, {
    beds: {
      R1: DataFactory.createMockPatient('R1', {
        ...shared,
        patientName: MOTHER,
        clinicalCrib: DataFactory.createMockPatient('R1', {
          ...shared,
          bedMode: 'Cuna',
          patientName: NEWBORN,
          neonatalMaternalRut: shared.rut,
        }),
      }),
    },
  });
  if (episodes === 'derived-on-save') return save(record);
  record.beds.R1.clinicalEpisodeId = 'ep-mother';
  return record;
};

type Kind = 'discharges' | 'transfers';

const leave = (record: DailyRecord, kind: Kind): DailyRecord => {
  let n = 0;
  const common = {
    record,
    bedId: 'R1',
    bedsCatalog: BEDS,
    createEmptyPatient,
    createId: () => `row-${++n}`,
  };
  const result =
    kind === 'discharges'
      ? resolveAddDischargeMovement({
          ...common,
          payload: { dischargeTarget: 'both', status: 'Vivo', cribStatus: 'Vivo', time: '12:00' },
        })
      : resolveAddTransferMovement({
          ...common,
          payload: {
            evacuationMethod: 'Ambulancia',
            receivingCenter: 'Otro',
            receivingCenterOther: 'Centro sintético',
            transferEscort: '',
            time: '12:00',
          },
        });
  if (!result.ok) throw new Error(result.error.message);
  return save(result.value.updatedRecord, record);
};

const undo = (record: DailyRecord, kind: Kind, row: DischargeData | TransferData): DailyRecord => {
  const resolution = resolveUndoPatientMovement({
    bedData: record.beds.R1,
    bedId: 'R1',
    isNested: row.isNested,
    originalData: row.originalData,
    createEmptyPatient,
  });
  if (!resolution.ok) throw new Error(resolution.error.message);
  const input = { record, bedId: 'R1', updatedBed: resolution.value.updatedBed };
  const next =
    kind === 'discharges'
      ? resolveApplyUndoDischargeRecord({ ...input, dischargeId: row.id })
      : resolveApplyUndoTransferRecord({ ...input, transferId: row.id });
  return save(next, record);
};

const activeNames = (record: DailyRecord, kind: Kind): string[] =>
  getActiveMovements<DischargeData | TransferData>(record[kind]).map(row => row.patientName);

describe('undoing a mother and newborn who share the maternal document', () => {
  for (const kind of ['discharges', 'transfers'] as const) {
    for (const episodes of ['derived-on-save', 'newborn-without-episode'] as const) {
      it(`${kind}, ${episodes}: the newborn row survives the mother's undo and restores the crib`, () => {
        const moved = leave(dyad(episodes), kind);
        const [motherRow, newbornRow] = moved[kind];
        expect(activeNames(moved, kind)).toEqual([MOTHER, NEWBORN]);

        const motherBack = undo(moved, kind, motherRow);
        expect(motherBack.beds.R1.patientName).toBe(MOTHER);
        expect(motherBack.beds.R1.clinicalCrib?.patientName ?? '').toBe('');
        expect(activeNames(motherBack, kind)).toEqual([NEWBORN]);

        const bothBack = undo(motherBack, kind, newbornRow);
        expect(bothBack.beds.R1.patientName).toBe(MOTHER);
        expect(bothBack.beds.R1.clinicalCrib?.patientName).toBe(NEWBORN);
        expect(activeNames(bothBack, kind)).toEqual([]);
      });
    }
  }
});
