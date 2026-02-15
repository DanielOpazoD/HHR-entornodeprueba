import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { StabilityRules } from '@/hooks/useStabilityRules';
import {
    executeDischargeController,
    executeMoveOrCopyController,
    executeTransferController
} from '@/features/census/controllers/censusActionRuntimeController';
import type {
    ActionState,
    DischargeState,
    TransferState
} from '@/features/census/types/censusActionTypes';
import {
    DEFAULT_DISCHARGE_STATUS,
    DEFAULT_EVACUATION_METHOD,
    DEFAULT_RECEIVING_CENTER,
    DEFAULT_TRANSFER_ESCORT
} from '@/constants';

const unlockedRules: StabilityRules = {
    isDateLocked: false,
    isDayShiftLocked: false,
    isNightShiftLocked: false,
    canEditField: () => true,
    canPerformActions: true
};

describe('censusActionRuntimeController', () => {
    it('executes move command and returns reset state', async () => {
        const record = DataFactory.createMockDailyRecord('2026-02-13', {
            beds: {
                R1: DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' }),
                R2: DataFactory.createMockPatient('R2', { patientName: '' })
            }
        });
        const actionState: ActionState = { type: 'move', sourceBedId: 'R1', targetBedId: 'R2' };
        const moveOrCopyPatient = vi.fn();
        const copyPatientToDate = vi.fn().mockResolvedValue(undefined);

        const result = await executeMoveOrCopyController({
            actionState,
            record,
            actions: { moveOrCopyPatient, copyPatientToDate }
        });

        expect(result).toEqual({
            ok: true,
            value: {
                nextActionState: {
                    type: null,
                    sourceBedId: null,
                    targetBedId: null
                }
            }
        });
        expect(moveOrCopyPatient).toHaveBeenCalledWith('move', 'R1', 'R2');
        expect(copyPatientToDate).not.toHaveBeenCalled();
    });

    it('executes copy-to-date command and returns reset state', async () => {
        const record = DataFactory.createMockDailyRecord('2026-02-13', {
            beds: {
                R1: DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' }),
                R2: DataFactory.createMockPatient('R2', { patientName: '' })
            }
        });
        const actionState: ActionState = { type: 'copy', sourceBedId: 'R1', targetBedId: 'R2' };
        const moveOrCopyPatient = vi.fn();
        const copyPatientToDate = vi.fn().mockResolvedValue(undefined);

        const result = await executeMoveOrCopyController({
            actionState,
            record,
            targetDate: '2026-02-14',
            actions: { moveOrCopyPatient, copyPatientToDate }
        });

        expect(result.ok).toBe(true);
        expect(copyPatientToDate).toHaveBeenCalledWith('R1', '2026-02-14', 'R2');
        expect(moveOrCopyPatient).not.toHaveBeenCalled();
    });

    it('returns explicit error when copy-to-date persistence fails', async () => {
        const record = DataFactory.createMockDailyRecord('2026-02-13', {
            beds: {
                R1: DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' }),
                R2: DataFactory.createMockPatient('R2', { patientName: '' })
            }
        });
        const actionState: ActionState = { type: 'copy', sourceBedId: 'R1', targetBedId: 'R2' };

        const result = await executeMoveOrCopyController({
            actionState,
            record,
            targetDate: '2026-02-14',
            actions: {
                moveOrCopyPatient: vi.fn(),
                copyPatientToDate: vi.fn().mockRejectedValue(new Error('persistence error'))
            }
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('COPY_TO_DATE_FAILED');
        }
    });

    it('executes discharge add and returns modal close patch', () => {
        const dischargeState: DischargeState = {
            bedId: 'R1',
            isOpen: true,
            status: DEFAULT_DISCHARGE_STATUS
        };
        const addDischarge = vi.fn();
        const updateDischarge = vi.fn();

        const result = executeDischargeController({
            dischargeState,
            data: { status: 'Vivo', time: '11:20' },
            stabilityRules: unlockedRules,
            nowTime: '10:00',
            actions: { addDischarge, updateDischarge }
        });

        expect(result).toEqual({
            ok: true,
            value: {
                closeModalPatch: {
                    isOpen: false
                }
            }
        });
        expect(addDischarge).toHaveBeenCalledWith(
            'R1',
            'Vivo',
            undefined,
            undefined,
            undefined,
            '11:20',
            undefined
        );
        expect(updateDischarge).not.toHaveBeenCalled();
    });

    it('propagates discharge validation field when time is invalid', () => {
        const dischargeState: DischargeState = {
            bedId: 'R1',
            isOpen: true,
            status: DEFAULT_DISCHARGE_STATUS
        };

        const result = executeDischargeController({
            dischargeState,
            data: { status: 'Vivo', time: '2360' },
            stabilityRules: unlockedRules,
            nowTime: '10:00',
            actions: { addDischarge: vi.fn(), updateDischarge: vi.fn() }
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('INVALID_TIME_FORMAT');
            expect(result.error.field).toBe('time');
        }
    });

    it('executes transfer update and returns modal close patch', () => {
        const transferState: TransferState = {
            bedId: null,
            recordId: 'tr-1',
            isOpen: true,
            evacuationMethod: DEFAULT_EVACUATION_METHOD,
            evacuationMethodOther: '',
            receivingCenter: DEFAULT_RECEIVING_CENTER,
            receivingCenterOther: '',
            transferEscort: DEFAULT_TRANSFER_ESCORT
        };
        const addTransfer = vi.fn();
        const updateTransfer = vi.fn();

        const result = executeTransferController({
            transferState,
            data: { time: '09:45' },
            stabilityRules: unlockedRules,
            nowTime: '10:00',
            actions: { addTransfer, updateTransfer }
        });

        expect(result).toEqual({
            ok: true,
            value: {
                closeModalPatch: {
                    isOpen: false
                }
            }
        });
        expect(updateTransfer).toHaveBeenCalledWith('tr-1', {
            evacuationMethod: DEFAULT_EVACUATION_METHOD,
            receivingCenter: DEFAULT_RECEIVING_CENTER,
            receivingCenterOther: '',
            transferEscort: DEFAULT_TRANSFER_ESCORT,
            time: '09:45'
        });
        expect(addTransfer).not.toHaveBeenCalled();
    });
});
