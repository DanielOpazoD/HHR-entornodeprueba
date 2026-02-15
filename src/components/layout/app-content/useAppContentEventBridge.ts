import { useEffect } from 'react';
import type { ModuleType } from '@/constants/navigationConfig';

type ShiftType = 'day' | 'night';

interface UseAppContentEventBridgeParams {
  setCurrentModule: (module: ModuleType) => void;
  setSelectedShift: (shift: ShiftType) => void;
}

const isShiftType = (value: unknown): value is ShiftType => value === 'day' || value === 'night';

export const useAppContentEventBridge = ({
  setCurrentModule,
  setSelectedShift,
}: UseAppContentEventBridgeParams): void => {
  useEffect(() => {
    const handleNavigateModule = (event: Event) => {
      const detail = (event as CustomEvent<ModuleType | undefined>).detail;
      if (detail) {
        setCurrentModule(detail);
      }
    };

    window.addEventListener('navigate-module', handleNavigateModule);
    return () => window.removeEventListener('navigate-module', handleNavigateModule);
  }, [setCurrentModule]);

  useEffect(() => {
    const handleSetShift = (event: Event) => {
      const detail = (event as CustomEvent<ShiftType | undefined>).detail;
      if (isShiftType(detail)) {
        setSelectedShift(detail);
      }
    };

    window.addEventListener('set-shift', handleSetShift);
    return () => window.removeEventListener('set-shift', handleSetShift);
  }, [setSelectedShift]);
};
