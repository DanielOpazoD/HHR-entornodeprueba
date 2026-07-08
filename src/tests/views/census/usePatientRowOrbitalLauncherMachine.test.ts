import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CLOSE_RESET_DELAY_MS,
  usePatientRowOrbitalLauncherMachine,
} from '@/features/census/components/patient-row/usePatientRowOrbitalLauncherMachine';

describe('usePatientRowOrbitalLauncherMachine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides the trigger immediately while closing to avoid hover ghosts across rows', () => {
    const { result, rerender } = renderHook(
      ({ canRevealTrigger, isOpen }: { canRevealTrigger: boolean; isOpen: boolean }) =>
        usePatientRowOrbitalLauncherMachine({
          canRevealTrigger,
          isOpen,
          supportsHoverFine: true,
        }),
      {
        initialProps: {
          canRevealTrigger: true,
          isOpen: false,
        },
      }
    );

    expect(result.current.phase).toBe('armed');
    expect(result.current.showTrigger).toBe(true);

    rerender({ canRevealTrigger: false, isOpen: false });

    expect(result.current.phase).toBe('closing');
    expect(result.current.showTrigger).toBe(false);

    act(() => {
      vi.advanceTimersByTime(CLOSE_RESET_DELAY_MS);
    });

    expect(result.current.phase).toBe('idle');
    expect(result.current.showTrigger).toBe(false);
  });
});
