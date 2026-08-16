import type { ModuleType } from '@/constants/navigationConfig';

export type EventBridgeShiftType = 'day' | 'night';

const APP_CONTENT_MODULES: readonly ModuleType[] = [
  'CENSUS',
  'ANALYTICS',
  'CUDYR',
  'NURSING_HANDOFF',
  'MEDICAL_HANDOFF',
  'AUDIT',
  'WHATSAPP',
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
];

export const resolveEventBridgeModule = (detail: unknown): ModuleType | null =>
  typeof detail === 'string' && APP_CONTENT_MODULES.includes(detail as ModuleType)
    ? (detail as ModuleType)
    : null;

export const resolveEventBridgeShift = (detail: unknown): EventBridgeShiftType | null =>
  detail === 'day' || detail === 'night' ? detail : null;
