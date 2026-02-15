import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmptyBedActivation } from '@/features/census/components/useEmptyBedActivation';

describe('useEmptyBedActivation', () => {
    const updatePatient = vi.fn();
    const focusSpy = vi.spyOn(HTMLInputElement.prototype, 'focus').mockImplementation(() => { });

    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '<div data-bed-id="R2"><input name="patientName" value="placeholder" /></div>';
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback): number => {
            callback(0);
            return 1;
        });
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('initializes empty bed and focuses patient name input', () => {
        const { result } = renderHook(() => useEmptyBedActivation({ updatePatient }));

        act(() => {
            result.current.activateEmptyBed('R2');
        });

        const input = document.querySelector('[data-bed-id="R2"] input[name="patientName"]') as HTMLInputElement;

        expect(updatePatient).toHaveBeenCalledWith('R2', 'patientName', ' ');
        expect(input.value).toBe('');
        expect(focusSpy).toHaveBeenCalled();
    });

    it('does not throw when input is not present', () => {
        document.body.innerHTML = '';
        const { result } = renderHook(() => useEmptyBedActivation({ updatePatient }));

        expect(() => {
            act(() => {
                result.current.activateEmptyBed('R9');
            });
        }).not.toThrow();

        expect(updatePatient).toHaveBeenCalledWith('R9', 'patientName', ' ');
    });

    it('falls back when requestAnimationFrame is unavailable', () => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => {
            throw new Error('raf missing');
        });

        const { result } = renderHook(() => useEmptyBedActivation({ updatePatient }));
        act(() => {
            result.current.activateEmptyBed('R2');
        });

        const input = document.querySelector('[data-bed-id="R2"] input[name="patientName"]') as HTMLInputElement;
        expect(input.value).toBe('');
        expect(focusSpy).toHaveBeenCalled();
    });
});
