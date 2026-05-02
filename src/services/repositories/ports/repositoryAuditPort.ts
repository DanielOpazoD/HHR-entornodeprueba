import { executeWriteAuditEvent } from '@/application/audit/writeAuditEventUseCase';
import { getCurrentUserEmail } from '@/services/admin/utils/auditUtils';

export interface ConflictAuditDetails {
  changedPaths: string[];
  policyVersion: string;
  entryCount: number;
  strategyBreakdown: Record<string, number>;
  winnerBreakdown: Record<string, number>;
  reasonBreakdown: Record<string, number>;
  samplePaths: string[];
  assessment: {
    riskLevel: 'low' | 'medium' | 'high';
    reviewRecommended: boolean;
    reviewReasons: string[];
    localDominantPaths: string[];
    remoteProtectedPaths: string[];
  };
}

type ConflictLoggerFn = (date: string, details: ConflictAuditDetails) => Promise<void>;

let customConflictLogger: ConflictLoggerFn | null = null;

export const setRepositoryConflictLogger = (logger: ConflictLoggerFn | null): void => {
  customConflictLogger = logger;
};

export const logRepositoryConflictAutoMerged = async (
  date: string,
  details: ConflictAuditDetails
): Promise<void> => {
  if (customConflictLogger) {
    await customConflictLogger(date, details);
    return;
  }

  await executeWriteAuditEvent({
    userId: getCurrentUserEmail(),
    action: 'CONFLICT_AUTO_MERGED',
    entityType: 'dailyRecord',
    entityId: date,
    details: details as unknown as Record<string, unknown>,
    recordDate: date,
  });
};
