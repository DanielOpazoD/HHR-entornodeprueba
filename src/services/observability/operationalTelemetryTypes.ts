import type { OperationalRuntimeState } from '@/services/observability/operationalRuntimeState';

export type OperationalTelemetryCategory =
  | 'auth'
  | 'daily_record'
  | 'firestore'
  | 'sync'
  | 'indexeddb'
  | 'integration'
  | 'export'
  | 'backup'
  | 'reminders'
  | 'transfers'
  | 'clinical_document'
  | 'create_day'
  | 'handoff'
  | 'prescription';

export type OperationalTelemetryStatus = 'success' | 'partial' | 'degraded' | 'failed';

export interface OperationalTelemetryEvent {
  category: OperationalTelemetryCategory;
  status: OperationalTelemetryStatus;
  runtimeState?: OperationalRuntimeState;
  operation: string;
  timestamp: string;
  date?: string;
  issues?: string[];
  context?: Record<string, unknown>;
}
