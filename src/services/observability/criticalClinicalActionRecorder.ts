import type {
  OperationalTelemetryCategory,
  OperationalTelemetryStatus,
} from '@/services/observability/operationalTelemetryTypes';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { maskRut } from '@/types/auditLogTypes';

interface CriticalClinicalActionInput {
  category: OperationalTelemetryCategory;
  action: string;
  outcome: OperationalTelemetryStatus;
  clinicalDate?: string;
  bedId?: string;
  patientRut?: string;
  patientRef?: string;
  documentId?: string;
  documentType?: string;
  exportType?: string;
  userId?: string;
  userRole?: string;
  issues?: string[];
  context?: Record<string, unknown>;
}

const compactContext = (context: Record<string, unknown>): Record<string, unknown> => {
  const nextContext: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined && value !== null && value !== '') {
      nextContext[key] = value;
    }
  }

  return nextContext;
};

export const recordCriticalClinicalAction = ({
  category,
  action,
  outcome,
  clinicalDate,
  bedId,
  patientRut,
  patientRef,
  documentId,
  documentType,
  exportType,
  userId,
  userRole,
  issues,
  context,
}: CriticalClinicalActionInput): void => {
  recordOperationalTelemetry(
    {
      category,
      operation: action,
      status: outcome,
      date: clinicalDate,
      issues,
      context: compactContext({
        criticalClinicalAction: true,
        bedId,
        patientRef: patientRef ?? (patientRut ? maskRut(patientRut) : undefined),
        documentId,
        documentType,
        exportType,
        userId,
        userRole,
        ...context,
      }),
    },
    { allowSuccess: true }
  );
};

export const __testing = {
  compactContext,
};
