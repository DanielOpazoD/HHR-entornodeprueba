import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { StabilityRules } from '@/hooks/useStabilityRules';
import {
  resolveDischargeCommand,
  resolveMoveOrCopyCommand,
  resolveTransferCommand,
} from '@/features/census/controllers/censusActionExecutionController';
import {
  ActionState,
  DischargeState,
  TransferState,
} from '@/features/census/types/censusActionTypes';
import {
  EVACUATION_METHOD_OTHER,
  RECEIVING_CENTER_OTHER,
  DEFAULT_DISCHARGE_STATUS,
  DEFAULT_EVACUATION_METHOD,
  DEFAULT_RECEIVING_CENTER,
  DEFAULT_TRANSFER_ESCORT,
} from '@/constants';

const unlockedRules: StabilityRules = {
  isDateLocked: false,
  isDayShiftLocked: false,
  isNightShiftLocked: false,
  canEditField: () => true,
  canPerformActions: true,
};

describe('censusActionExecutionController', () => {
  it('returns explicit error when move/copy runs without record', () => {
    const actionState: ActionState = { type: 'move', sourceBedId: 'R1', targetBedId: 'R2' };
    const result = resolveMoveOrCopyCommand({ actionState, record: null });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RECORD_NOT_AVAILABLE');
    }
  });

  it('resolves copy-to-date command when target date is provided', () => {
    const record = DataFactory.createMockDailyRecord('2026-02-12', {
      beds: {
        R1: DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' }),
        R2: DataFactory.createMockPatient('R2', { patientName: '' }),
      },
    });
    const actionState: ActionState = { type: 'copy', sourceBedId: 'R1', targetBedId: 'R2' };

    const result = resolveMoveOrCopyCommand({ actionState, record, targetDate: '2026-02-13' });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'copyToDate',
        sourceBedId: 'R1',
        targetBedId: 'R2',
        targetDate: '2026-02-13',
      },
    });
  });

  it('resolves move command when move state is valid', () => {
    const record = DataFactory.createMockDailyRecord('2026-02-12', {
      beds: {
        R1: DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' }),
        R2: DataFactory.createMockPatient('R2', { patientName: '' }),
      },
    });
    const actionState: ActionState = { type: 'move', sourceBedId: 'R1', targetBedId: 'R2' };

    const result = resolveMoveOrCopyCommand({ actionState, record });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'moveOrCopy',
        movementType: 'move',
        sourceBedId: 'R1',
        targetBedId: 'R2',
      },
    });
  });

  it('returns locked error when discharge create is blocked by stability rules', () => {
    const dischargeState: DischargeState = {
      bedId: 'R1',
      isOpen: true,
      status: DEFAULT_DISCHARGE_STATUS,
    };

    const result = resolveDischargeCommand({
      dischargeState,
      stabilityRules: { ...unlockedRules, canPerformActions: false, lockReason: 'Bloqueado' },
      nowTime: '10:30',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACTIONS_LOCKED');
      expect(result.error.message).toBe('Bloqueado');
    }
  });

  it('resolves discharge update command in edit mode', () => {
    const dischargeState: DischargeState = {
      bedId: null,
      recordId: 'd-1',
      isOpen: true,
      status: DEFAULT_DISCHARGE_STATUS,
      time: '11:05',
    };

    const result = resolveDischargeCommand({
      dischargeState,
      data: { status: 'Fallecido' },
      stabilityRules: unlockedRules,
      nowTime: '10:30',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'updateDischarge',
        id: 'd-1',
        payload: {
          status: 'Fallecido',
          type: undefined,
          typeOther: undefined,
          time: '11:05',
          movementDate: undefined,
        },
      },
    });
  });

  it('resolves transfer add command and propagates state payload', () => {
    const transferState: TransferState = {
      bedId: 'R2',
      isOpen: true,
      evacuationMethod: DEFAULT_EVACUATION_METHOD,
      evacuationMethodOther: '',
      receivingCenter: DEFAULT_RECEIVING_CENTER,
      receivingCenterOther: '',
      transferEscort: DEFAULT_TRANSFER_ESCORT,
    };

    const result = resolveTransferCommand({
      transferState,
      data: { time: '12:20' },
      stabilityRules: unlockedRules,
      nowTime: '10:30',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'addTransfer',
        bedId: 'R2',
        payload: {
          evacuationMethod: DEFAULT_EVACUATION_METHOD,
          receivingCenter: DEFAULT_RECEIVING_CENTER,
          receivingCenterOther: '',
          transferEscort: DEFAULT_TRANSFER_ESCORT,
          time: '12:20',
          movementDate: undefined,
        },
      },
    });
  });

  it('returns invalid time error when discharge time is malformed', () => {
    const dischargeState: DischargeState = {
      bedId: 'R1',
      isOpen: true,
      status: DEFAULT_DISCHARGE_STATUS,
    };

    const result = resolveDischargeCommand({
      dischargeState,
      data: { status: 'Vivo', time: '2500' },
      stabilityRules: unlockedRules,
      nowTime: '10:30',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TIME_FORMAT');
      expect(result.error.field).toBe('time');
    }
  });

  it('requires details when discharge type is "Otra"', () => {
    const dischargeState: DischargeState = {
      bedId: 'R1',
      isOpen: true,
      status: DEFAULT_DISCHARGE_STATUS,
    };

    const result = resolveDischargeCommand({
      dischargeState,
      data: { status: 'Vivo', type: 'Otra', typeOther: '   ' },
      stabilityRules: unlockedRules,
      nowTime: '10:30',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DISCHARGE_TYPE_OTHER_REQUIRED');
      expect(result.error.field).toBe('typeOther');
    }
  });

  it('requires receiving center details when transfer center is "Otro"', () => {
    const transferState: TransferState = {
      bedId: 'R2',
      isOpen: true,
      evacuationMethod: DEFAULT_EVACUATION_METHOD,
      evacuationMethodOther: '',
      receivingCenter: RECEIVING_CENTER_OTHER,
      receivingCenterOther: '   ',
      transferEscort: DEFAULT_TRANSFER_ESCORT,
    };

    const result = resolveTransferCommand({
      transferState,
      data: { time: '12:20' },
      stabilityRules: unlockedRules,
      nowTime: '10:30',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TRANSFER_RECEIVING_CENTER_OTHER_REQUIRED');
      expect(result.error.field).toBe('receivingCenterOther');
    }
  });

  it('requires evacuation method details when transfer method is "Otro"', () => {
    const transferState: TransferState = {
      bedId: 'R2',
      isOpen: true,
      evacuationMethod: EVACUATION_METHOD_OTHER,
      evacuationMethodOther: '   ',
      receivingCenter: DEFAULT_RECEIVING_CENTER,
      receivingCenterOther: '',
      transferEscort: DEFAULT_TRANSFER_ESCORT,
    };

    const result = resolveTransferCommand({
      transferState,
      data: { time: '12:20' },
      stabilityRules: unlockedRules,
      nowTime: '10:30',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TRANSFER_EVACUATION_METHOD_OTHER_REQUIRED');
    }
  });
});
