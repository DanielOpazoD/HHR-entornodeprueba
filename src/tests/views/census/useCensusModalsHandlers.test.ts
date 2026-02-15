import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCensusModalsHandlers } from '@/features/census/hooks/useCensusModalsHandlers';
import {
    createInitialActionState,
    createInitialDischargeState,
    createInitialTransferState
} from '@/features/census/types/censusActionTypes';

describe('useCensusModalsHandlers', () => {
    it('handles move/copy close and target updates', () => {
        const setActionState = vi.fn();
        const setDischargeState = vi.fn();
        const setTransferState = vi.fn();

        const { result } = renderHook(() =>
            useCensusModalsHandlers({
                setActionState,
                setDischargeState,
                setTransferState
            })
        );

        act(() => {
            result.current.closeMoveCopy();
            result.current.setMoveCopyTarget('R9');
        });

        expect(setActionState).toHaveBeenCalledWith(createInitialActionState());

        const targetUpdater = setActionState.mock.calls[1][0] as (previous: ReturnType<typeof createInitialActionState>) => ReturnType<typeof createInitialActionState>;
        expect(targetUpdater({
            type: 'move',
            sourceBedId: 'R1',
            targetBedId: null
        })).toEqual({
            type: 'move',
            sourceBedId: 'R1',
            targetBedId: 'R9'
        });
    });

    it('handles discharge updates and ignores undefined target patches', () => {
        const setActionState = vi.fn();
        const setDischargeState = vi.fn();
        const setTransferState = vi.fn();

        const { result } = renderHook(() =>
            useCensusModalsHandlers({
                setActionState,
                setDischargeState,
                setTransferState
            })
        );

        act(() => {
            result.current.updateDischargeStatus('Fallecido');
            result.current.updateDischargeClinicalCribStatus('Vivo');
            result.current.updateDischargeTarget(undefined);
            result.current.closeDischarge();
        });

        expect(setDischargeState).toHaveBeenCalledTimes(3);

        const statusUpdater = setDischargeState.mock.calls[0][0] as (previous: ReturnType<typeof createInitialDischargeState>) => ReturnType<typeof createInitialDischargeState>;
        expect(statusUpdater(createInitialDischargeState()).status).toBe('Fallecido');

        const cribUpdater = setDischargeState.mock.calls[1][0] as (previous: ReturnType<typeof createInitialDischargeState>) => ReturnType<typeof createInitialDischargeState>;
        expect(cribUpdater(createInitialDischargeState()).clinicalCribStatus).toBe('Vivo');

        const closeUpdater = setDischargeState.mock.calls[2][0] as (previous: ReturnType<typeof createInitialDischargeState>) => ReturnType<typeof createInitialDischargeState>;
        expect(closeUpdater({
            ...createInitialDischargeState(),
            isOpen: true
        }).isOpen).toBe(false);
    });

    it('handles transfer updates and close', () => {
        const setActionState = vi.fn();
        const setDischargeState = vi.fn();
        const setTransferState = vi.fn();

        const { result } = renderHook(() =>
            useCensusModalsHandlers({
                setActionState,
                setDischargeState,
                setTransferState
            })
        );

        act(() => {
            result.current.updateTransfer('transferEscort', 'TENS');
            result.current.closeTransfer();
        });

        const updateUpdater = setTransferState.mock.calls[0][0] as (previous: ReturnType<typeof createInitialTransferState>) => ReturnType<typeof createInitialTransferState>;
        expect(updateUpdater(createInitialTransferState()).transferEscort).toBe('TENS');

        const closeUpdater = setTransferState.mock.calls[1][0] as (previous: ReturnType<typeof createInitialTransferState>) => ReturnType<typeof createInitialTransferState>;
        expect(closeUpdater({
            ...createInitialTransferState(),
            isOpen: true
        }).isOpen).toBe(false);
    });
});
