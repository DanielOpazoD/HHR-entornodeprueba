import { useEffect } from 'react';
import type { ModuleType } from '@/constants/navigationConfig';

export type EventBridgeShiftType = 'day' | 'night';

const APP_CONTENT_MODULES: readonly ModuleType[] = [
  'CENSUS',
  'ANALYTICS',
  'CUDYR',
  'NURSING_HANDOFF',
  'AUDIT',
  'BACKUP_FILES',
  'PATIENT_MASTER_INDEX',
  'DATA_MAINTENANCE',
  'DIAGNOSTICS',
  'FUNCTIONS_TELEMETRY',
  'CONFIGURATION',
  'DATA',
  'COMMUNICATIONS',
  'ROLE_MANAGEMENT',
  'REMINDERS',
  'AUDIT_DOCUMENTS',
  'ADMISSION_AUDIT',
];

export const resolveEventBridgeModule = (detail: unknown): ModuleType | null =>
  typeof detail === 'string' && APP_CONTENT_MODULES.includes(detail as ModuleType)
    ? (detail as ModuleType)
    : null;

export const resolveEventBridgeShift = (detail: unknown): EventBridgeShiftType | null =>
  detail === 'day' || detail === 'night' ? detail : null;

interface UseAppContentEventBridgeParams {
  setCurrentModule: (module: ModuleType) => void;
  setSelectedShift: (shift: EventBridgeShiftType) => void;
}

export const useAppContentEventBridge = ({
  setCurrentModule,
  setSelectedShift,
}: UseAppContentEventBridgeParams): void => {
  useEffect(() => {
    const handleNavigateModule = (event: Event) => {
      const module = resolveEventBridgeModule((event as CustomEvent<unknown>).detail);
      if (module) {
        setCurrentModule(module);
      }
    };

    window.addEventListener('navigate-module', handleNavigateModule);
    return () => window.removeEventListener('navigate-module', handleNavigateModule);
  }, [setCurrentModule]);

  useEffect(() => {
    const handleSetShift = (event: Event) => {
      const shift = resolveEventBridgeShift((event as CustomEvent<unknown>).detail);
      if (shift) {
        setSelectedShift(shift);
      }
    };

    window.addEventListener('set-shift', handleSetShift);
    return () => window.removeEventListener('set-shift', handleSetShift);
  }, [setSelectedShift]);
};
