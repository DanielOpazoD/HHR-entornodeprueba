// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DISCHARGE_STATUS,
  DEFAULT_EVACUATION_METHOD,
  DEFAULT_RECEIVING_CENTER,
  DEFAULT_TRANSFER_ESCORT,
} from '@/constants/clinicalMovementConstants';
import {
  createInitialActionState,
  createInitialDischargeState,
  createInitialTransferState,
  type DischargeState,
  type TransferState,
} from '@/domain/censusActionContracts';
import { buildCensusActionDependenciesModelParams } from '@/features/census/hooks/useCensusActionDependencies';
import {
  getDischargeErrorTitle,
  getMoveOrCopyErrorTitle,
  getTransferErrorTitle,
} from '@/features/census/controllers/censusActionNotificationController';
import { buildCensusActionRuntimeRefsParams } from '@/features/census/hooks/useCensusActionsProviderModel';
import {
  buildDischargeEditState,
  buildTransferEditState,
} from '@/features/census/hooks/useCensusActionStateStore';
import { buildRowActionRuntimeActions } from '@/features/census/hooks/useCensusRowActionCommand';
import {
  removeDeviceHistoryRecord,
  updateDeviceHistoryRecord,
} from '@/features/census/components/patient-row/useDeviceHistoryEditor';
import { resolveDischargeRowViewModel } from '@/features/census/components/DischargeRow';
import { resolveTransferRowViewModel } from '@/features/census/components/TransferRow';
import {
  executeDischargeRuntimeCommand,
  executeTransferRuntimeCommand,
} from '@/features/census/controllers/censusActionRuntimeController';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DeviceInstance } from '@/types/domain/devices';

describe('buildCensusActionDependenciesModelParams', () => {
  it('maps context values into dependency builder params', () => {
    const clearPatient = vi.fn();
    const moveOrCopyPatient = vi.fn();
    const copyPatientToDate = vi.fn();
    const addDischarge = vi.fn();
    const updateDischarge = vi.fn();
    const addTransfer = vi.fn();
    const updateTransfer = vi.fn();
    const addCMA = vi.fn();
    const confirm = vi.fn();
    const error = vi.fn();

    const result = buildCensusActionDependenciesModelParams({
      dailyRecordData: {
        record: null,
        stabilityRules: {
          isDateLocked: false,
          isDayShiftLocked: false,
          isNightShiftLocked: false,
          canEditField: () => true,
          canPerformActions: true,
        },
      },
      bedActions: {
        clearPatient,
        moveOrCopyPatient,
        copyPatientToDate,
      },
      movementActions: {
        addDischarge,
        updateDischarge,
        addTransfer,
        updateTransfer,
        addCMA,
      },
      confirmDialog: { confirm },
      notification: { error },
    });

    expect(result.runtime.clearPatient).toBe(clearPatient);
    expect(result.runtime.moveOrCopyPatient).toBe(moveOrCopyPatient);
    expect(result.runtime.copyPatientToDate).toBe(copyPatientToDate);
    expect(result.runtime.addDischarge).toBe(addDischarge);
    expect(result.runtime.updateDischarge).toBe(updateDischarge);
    expect(result.runtime.addTransfer).toBe(addTransfer);
    expect(result.runtime.updateTransfer).toBe(updateTransfer);
    expect(result.runtime.addCMA).toBe(addCMA);
    expect(result.ui.confirm).toBe(confirm);
    expect(result.ui.notifyError).toBe(error);
  });
});

describe('census action error title presentation', () => {
  it('returns specific move/copy title for copy persistence failures', () => {
    expect(getMoveOrCopyErrorTitle('COPY_TO_DATE_FAILED')).toBe('No se pudo copiar');
    expect(getMoveOrCopyErrorTitle('RECORD_NOT_AVAILABLE')).toBe('No se pudo mover/copiar');
  });

  it('returns contextual title for discharge validation and lock errors', () => {
    expect(getDischargeErrorTitle('INVALID_TIME_FORMAT')).toBe('Datos de alta incompletos');
    expect(getDischargeErrorTitle('ACTIONS_LOCKED')).toBe('Alta bloqueada');
    expect(getDischargeErrorTitle('DISCHARGE_TARGET_MISSING')).toBe('No se pudo registrar el alta');
  });

  it('returns contextual title for transfer validation and lock errors', () => {
    expect(getTransferErrorTitle('TRANSFER_RECEIVING_CENTER_OTHER_REQUIRED')).toBe(
      'Datos de traslado incompletos'
    );
    expect(getTransferErrorTitle('ACTIONS_LOCKED')).toBe('Traslado bloqueado');
    expect(getTransferErrorTitle('TRANSFER_TARGET_MISSING')).toBe(
      'No se pudo registrar el traslado'
    );
  });
});

describe('buildCensusActionRuntimeRefsParams', () => {
  it('maps provider state + dependencies to runtime refs hook params', () => {
    const clearPatient = vi.fn();
    const moveOrCopyPatient = vi.fn();
    const addDischarge = vi.fn();
    const updateDischarge = vi.fn();
    const addTransfer = vi.fn();
    const updateTransfer = vi.fn();
    const addCMA = vi.fn();
    const copyPatientToDate = vi.fn();
    const confirm = vi.fn();
    const notifyError = vi.fn();

    const params = buildCensusActionRuntimeRefsParams({
      state: {
        actionState: createInitialActionState(),
        dischargeState: createInitialDischargeState(),
        transferState: createInitialTransferState(),
      },
      dependencies: {
        record: null,
        stabilityRules: {
          isDateLocked: false,
          isDayShiftLocked: false,
          isNightShiftLocked: false,
          canEditField: () => true,
          canPerformActions: true,
        },
        clearPatient,
        moveOrCopyPatient,
        addDischarge,
        updateDischarge,
        addTransfer,
        updateTransfer,
        addCMA,
        copyPatientToDate,
        confirm,
        notifyError,
      },
    });

    expect(params.actionState).toEqual(createInitialActionState());
    expect(params.dischargeState).toEqual(createInitialDischargeState());
    expect(params.transferState).toEqual(createInitialTransferState());
    expect(params.clearPatient).toBe(clearPatient);
    expect(params.moveOrCopyPatient).toBe(moveOrCopyPatient);
    expect(params.addDischarge).toBe(addDischarge);
    expect(params.updateDischarge).toBe(updateDischarge);
    expect(params.addTransfer).toBe(addTransfer);
    expect(params.updateTransfer).toBe(updateTransfer);
    expect(params.addCma).toBe(addCMA);
    expect(params.copyPatientToDate).toBe(copyPatientToDate);
    expect(params.confirm).toBe(confirm);
    expect(params.notifyError).toBe(notifyError);
  });
});

describe('census movement edit state builders', () => {
  it('builds discharge edit state with expected mapping', () => {
    const result = buildDischargeEditState({
      id: 'd-1',
      bedName: 'R1',
      bedId: 'R1',
      bedType: 'Básica',
      patientName: 'Paciente 1',
      rut: '1-9',
      diagnosis: 'DX',
      time: '10:15',
      status: 'Vivo',
      dischargeType: 'Otra',
      dischargeTypeOther: 'Detalle',
    });

    expect(result).toEqual({
      bedId: null,
      recordId: 'd-1',
      isOpen: true,
      status: 'Vivo',
      type: 'Otra',
      typeOther: 'Detalle',
      time: '10:15',
      movementDate: undefined,
      diagnosis: 'DX',
    });
  });

  it('builds transfer edit state with defaults for optional fields', () => {
    const result = buildTransferEditState({
      id: 't-1',
      bedName: 'R2',
      bedId: 'R2',
      bedType: 'Básica',
      patientName: 'Paciente 2',
      rut: '2-7',
      diagnosis: 'DX',
      time: '12:00',
      evacuationMethod: 'NOA',
      receivingCenter: 'HBM',
    });

    expect(result).toEqual({
      bedId: null,
      recordId: 't-1',
      isOpen: true,
      evacuationMethod: DEFAULT_EVACUATION_METHOD,
      evacuationMethodOther: '',
      receivingCenter: DEFAULT_RECEIVING_CENTER,
      receivingCenterOther: '',
      transferEscort: DEFAULT_TRANSFER_ESCORT,
      time: '12:00',
      movementDate: undefined,
      diagnosis: 'DX',
    });
  });
});

describe('buildRowActionRuntimeActions', () => {
  it('maps clear/cma/movement actions directly', () => {
    const clearPatient = vi.fn();
    const addCMA = vi.fn();
    const setActionState = vi.fn();
    const setDischargeState = vi.fn();
    const setTransferState = vi.fn();
    const actions = buildRowActionRuntimeActions({
      clearPatient,
      addCMA,
      markInvalidEpisode: vi.fn(),
      cleanInvalidEpisodePreviousDay: vi.fn().mockResolvedValue(null),
      setActionState,
      setDischargeState,
      setTransferState,
    });

    actions.clearPatient('R1');
    actions.addCMA({
      bedName: 'R1',
      patientName: 'Paciente',
      rut: '1-9',
      age: '30',
      diagnosis: 'Dx',
      specialty: 'Cirugía',
      interventionType: 'Cirugía Mayor Ambulatoria',
    });
    actions.setMovement({ type: 'move', sourceBedId: 'R1', targetBedId: 'R2' });

    expect(clearPatient).toHaveBeenCalledWith('R1');
    expect(addCMA).toHaveBeenCalledTimes(1);
    expect(setActionState).toHaveBeenCalledWith({
      type: 'move',
      sourceBedId: 'R1',
      targetBedId: 'R2',
    });
  });

  it('applies discharge and transfer patches through state updaters', () => {
    const setActionState = vi.fn();
    const setDischargeState = vi.fn();
    const setTransferState = vi.fn();
    const actions = buildRowActionRuntimeActions({
      clearPatient: vi.fn(),
      addCMA: vi.fn(),
      markInvalidEpisode: vi.fn(),
      cleanInvalidEpisodePreviousDay: vi.fn().mockResolvedValue(null),
      setActionState,
      setDischargeState,
      setTransferState,
    });

    actions.openDischarge({ bedId: 'R1', isOpen: true });
    actions.openTransfer({ bedId: 'R2', isOpen: true, transferEscort: 'Matrona' });

    const dischargeUpdater = setDischargeState.mock.calls[0][0] as (
      previous: DischargeState
    ) => DischargeState;
    const transferUpdater = setTransferState.mock.calls[0][0] as (
      previous: TransferState
    ) => TransferState;
    const previousDischarge: DischargeState = {
      bedId: null,
      isOpen: false,
      status: DEFAULT_DISCHARGE_STATUS,
    };
    const previousTransfer: TransferState = {
      bedId: null,
      isOpen: false,
      evacuationMethod: DEFAULT_EVACUATION_METHOD,
      evacuationMethodOther: '',
      receivingCenter: DEFAULT_RECEIVING_CENTER,
      receivingCenterOther: '',
      transferEscort: DEFAULT_TRANSFER_ESCORT,
    };

    expect(dischargeUpdater(previousDischarge)).toEqual({
      bedId: 'R1',
      isOpen: true,
      status: DEFAULT_DISCHARGE_STATUS,
    });
    expect(transferUpdater(previousTransfer)).toEqual({
      bedId: 'R2',
      isOpen: true,
      evacuationMethod: DEFAULT_EVACUATION_METHOD,
      evacuationMethodOther: '',
      receivingCenter: DEFAULT_RECEIVING_CENTER,
      receivingCenterOther: '',
      transferEscort: 'Matrona',
    });
    expect(setActionState).not.toHaveBeenCalled();
  });
});

describe('device history record editor helpers', () => {
  const BASE_HISTORY: DeviceInstance[] = [
    {
      id: '1',
      type: 'CVC',
      installationDate: '2026-02-14',
      status: 'Active',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: '2',
      type: 'CUP',
      installationDate: '2026-02-14',
      status: 'Removed',
      removalDate: '2026-02-15',
      createdAt: 2,
      updatedAt: 2,
    },
  ];

  it('removes a device record by id', () => {
    const result = removeDeviceHistoryRecord(BASE_HISTORY, '1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('updates record fields and refreshes updatedAt', () => {
    const result = updateDeviceHistoryRecord({
      history: BASE_HISTORY,
      id: '2',
      updates: { location: 'Brazo derecho' },
      updatedAt: 100,
    });

    const updated = result.find(item => item.id === '2');
    expect(updated?.location).toBe('Brazo derecho');
    expect(updated?.updatedAt).toBe(100);
  });

  it('does not mutate non-target records', () => {
    const result = updateDeviceHistoryRecord({
      history: BASE_HISTORY,
      id: '2',
      updates: { location: 'Brazo derecho' },
      updatedAt: 100,
    });

    expect(result.find(item => item.id === '1')).toEqual(BASE_HISTORY[0]);
  });
});

describe('resolveDischargeRowViewModel', () => {
  it('builds discharge row view model with labels and actions', () => {
    const discharge = DataFactory.createMockDischarge({
      id: 'd-1',
      status: 'Vivo',
      dischargeType: 'Domicilio (Habitual)',
    });
    const undoDischarge = vi.fn();
    const viewClinicalDocuments = vi.fn();
    const openHospitalizationReports = vi.fn();
    const editDischarge = vi.fn();
    const deleteDischarge = vi.fn();
    const convertDischargeToCma = vi.fn();

    const viewModel = resolveDischargeRowViewModel(discharge, {
      undoDischarge,
      viewClinicalDocuments,
      openHospitalizationReports,
      editDischarge,
      deleteDischarge,
      convertDischargeToCma,
    });

    expect(viewModel.kind).toBe('discharge');
    expect(viewModel.id).toBe('d-1');
    expect(viewModel.statusLabel).toBe('Vivo');
    expect(viewModel.dischargeTypeLabel).toBe('Domicilio (Habitual)');
    expect(viewModel.statusBadgeClassName).toContain('bg-green');
    expect(viewModel.actions).toHaveLength(6);

    viewModel.actions[0]?.onClick();
    viewModel.actions[1]?.onClick();
    viewModel.actions[2]?.onClick();
    viewModel.actions[3]?.onClick();
    viewModel.actions[4]?.onClick();
    viewModel.actions[5]?.onClick();

    expect(undoDischarge).toHaveBeenCalledWith('d-1');
    expect(editDischarge).toHaveBeenCalledWith(discharge);
    expect(deleteDischarge).toHaveBeenCalledWith('d-1');
    expect(viewClinicalDocuments).toHaveBeenCalledWith(discharge);
    expect(openHospitalizationReports).toHaveBeenCalledWith(discharge);
    expect(convertDischargeToCma).toHaveBeenCalledWith('d-1');
  });

  it('labels a Cuna RN departure as associated and normalizes its historical bed label', () => {
    const discharge = DataFactory.createMockDischarge({
      isNested: true,
      bedName: 'H4C1 (Cuna clínica)',
    });
    const noop = vi.fn();
    const viewModel = resolveDischargeRowViewModel(discharge, {
      undoDischarge: noop,
      viewClinicalDocuments: noop,
      openHospitalizationReports: noop,
      editDischarge: noop,
      deleteDischarge: noop,
      convertDischargeToCma: noop,
    });

    expect(viewModel.isAssociatedClinicalCrib).toBe(true);
    expect(viewModel.bedName).toBe('C-H4C1');
    expect(viewModel.dischargeTypeLabel).toBe('Alta asociada');
  });

  it.each(['R3', 'C-R3'])('keeps a standalone crib distinct after discharge: %s', bedName => {
    const discharge = DataFactory.createMockDischarge({
      bedId: 'R3',
      bedName,
      isNested: false,
      originalData: DataFactory.createMockPatient('R3', { bedMode: 'Cuna' }),
    });
    const noop = vi.fn();
    const handlers = {
      undoDischarge: noop,
      viewClinicalDocuments: noop,
      openHospitalizationReports: noop,
      editDischarge: noop,
      deleteDischarge: noop,
      convertDischargeToCma: noop,
    };
    const viewModel = resolveDischargeRowViewModel(discharge, handlers);
    expect(viewModel.bedName).toBe('C-R3');
    expect(viewModel.dischargeTypeLabel).toBe('Alta en cuna');
    viewModel.actions[0].onClick();
    expect(noop).toHaveBeenCalledWith(discharge.id);
    expect(discharge.isNested).toBe(false);
    expect(
      resolveDischargeRowViewModel(
        {
          ...discharge,
          bedName: 'R3',
          bedType: 'Media',
          originalData: { ...discharge.originalData!, bedMode: 'Cama' },
        },
        handlers
      ).bedName
    ).toBe('R3');
  });
});

describe('resolveTransferRowViewModel', () => {
  it('builds transfer row view model with center/escort labels and actions', () => {
    const transfer = DataFactory.createMockTransfer({
      id: 't-1',
      evacuationMethod: 'Ambulancia',
      receivingCenter: 'Otro',
      receivingCenterOther: 'Clinica X',
      transferEscort: 'Enfermera Y',
    });
    const undoTransfer = vi.fn();
    const editTransfer = vi.fn();
    const deleteTransfer = vi.fn();

    const viewModel = resolveTransferRowViewModel(transfer, {
      undoTransfer,
      editTransfer,
      deleteTransfer,
    });

    expect(viewModel.kind).toBe('transfer');
    expect(viewModel.id).toBe('t-1');
    expect(viewModel.receivingCenterLabel).toBe('Clinica X');
    expect(viewModel.transferEscortLabel).toContain('Enfermera Y');
    expect(viewModel.actions).toHaveLength(3);

    viewModel.actions[0]?.onClick();
    viewModel.actions[1]?.onClick();
    viewModel.actions[2]?.onClick();

    expect(undoTransfer).toHaveBeenCalledWith('t-1');
    expect(editTransfer).toHaveBeenCalledWith(transfer);
    expect(deleteTransfer).toHaveBeenCalledWith('t-1');
  });

  it('normalizes the retired Cuna clínica label in historical transfers', () => {
    const noop = vi.fn();
    const transfer = DataFactory.createMockTransfer({ bedName: 'H4C1 (Cuna clínica)' });

    const viewModel = resolveTransferRowViewModel(transfer, {
      undoTransfer: noop,
      editTransfer: noop,
      deleteTransfer: noop,
    });

    expect(viewModel.bedName).toBe('H4C1 (Cuna RN)');
  });
});

describe('patient movement runtime commands', () => {
  it('routes update discharge command to updateDischarge action', () => {
    const actions = { addDischarge: vi.fn(), updateDischarge: vi.fn() };

    executeDischargeRuntimeCommand(
      {
        kind: 'updateDischarge',
        id: 'd-1',
        payload: {
          status: 'Fallecido',
          type: undefined,
          typeOther: undefined,
          time: '12:00',
          diagnosis: 'Neumonía basal derecha',
        },
      },
      actions
    );

    expect(actions.addDischarge).not.toHaveBeenCalled();
    expect(actions.updateDischarge).toHaveBeenCalledWith(
      'd-1',
      'Fallecido',
      undefined,
      undefined,
      '12:00',
      undefined,
      undefined,
      'Neumonía basal derecha'
    );
  });

  it('routes add discharge command to addDischarge action', () => {
    const actions = { addDischarge: vi.fn(), updateDischarge: vi.fn() };

    executeDischargeRuntimeCommand(
      {
        kind: 'addDischarge',
        bedId: 'R1',
        payload: {
          status: 'Vivo',
          cribStatus: 'Vivo',
          type: 'Domicilio (Habitual)',
          typeOther: '',
          time: '09:30',
          movementDate: '2026-02-15',
          dischargeTarget: 'both',
        },
      },
      actions
    );

    expect(actions.updateDischarge).not.toHaveBeenCalled();
    expect(actions.addDischarge).toHaveBeenCalledWith('R1', {
      status: 'Vivo',
      cribStatus: 'Vivo',
      type: 'Domicilio (Habitual)',
      typeOther: '',
      time: '09:30',
      movementDate: '2026-02-15',
      dischargeTarget: 'both',
    });
  });

  it('routes update transfer command to updateTransfer action', () => {
    const actions = { addTransfer: vi.fn(), updateTransfer: vi.fn() };

    executeTransferRuntimeCommand(
      {
        kind: 'updateTransfer',
        id: 't-1',
        payload: {
          evacuationMethod: 'Avión comercial',
          receivingCenter: 'Hospital Salvador',
          receivingCenterOther: '',
          transferEscort: 'TENS',
          time: '14:10',
          diagnosis: 'Neumonía basal derecha',
        },
      },
      actions
    );

    expect(actions.addTransfer).not.toHaveBeenCalled();
    expect(actions.updateTransfer).toHaveBeenCalledWith('t-1', {
      evacuationMethod: 'Avión comercial',
      receivingCenter: 'Hospital Salvador',
      receivingCenterOther: '',
      transferEscort: 'TENS',
      time: '14:10',
      movementDate: undefined,
      diagnosis: 'Neumonía basal derecha',
    });
  });

  it('routes add transfer command to addTransfer action', () => {
    const actions = { addTransfer: vi.fn(), updateTransfer: vi.fn() };

    executeTransferRuntimeCommand(
      {
        kind: 'addTransfer',
        bedId: 'R2',
        payload: {
          evacuationMethod: 'Avión comercial',
          receivingCenter: 'Hospital Salvador',
          receivingCenterOther: '',
          transferEscort: 'Médico',
          time: '16:20',
          movementDate: '2026-02-15',
        },
      },
      actions
    );

    expect(actions.updateTransfer).not.toHaveBeenCalled();
    expect(actions.addTransfer).toHaveBeenCalledWith('R2', {
      evacuationMethod: 'Avión comercial',
      receivingCenter: 'Hospital Salvador',
      receivingCenterOther: '',
      transferEscort: 'Médico',
      time: '16:20',
      movementDate: '2026-02-15',
    });
  });
});
