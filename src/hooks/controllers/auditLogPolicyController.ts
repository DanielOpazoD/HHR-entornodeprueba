import {
  hasMeaningfulAuditDetails,
  normalizeAuditDetails,
} from '@/services/admin/auditChangeUtils';
import { createScopedLogger } from '@/services/utils/loggerScope';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { AuditAction } from '@/types/auditActionTypes';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const auditHookLogger = createScopedLogger('AuditHook');

export interface AuditEventContext {
  userId: string;
  action: AuditAction;
  entityType: AuditLogEntry['entityType'];
  entityId: string;
}

/**
 * Surfaces a `failed` audit outcome through the structured logger so that
 * traceability rejections (e.g. clinical actions blocked by the actor policy)
 * are visible in operational telemetry instead of silently swallowed.
 *
 * Successful outcomes are intentionally a no-op: the audit log itself is the
 * primary record of success.
 */
export const reportAuditOutcome = (
  outcome: ApplicationOutcome<null>,
  context: AuditEventContext
): void => {
  if (outcome.status !== 'failed') return;
  auditHookLogger.warn('Audit event rejected', { ...context, issues: outcome.issues });
};

export interface PendingAuditEntry {
  timer: number;
  details: Record<string, unknown>;
  rut?: string;
  date?: string;
  authors?: string;
  /** Writes the coalesced event now (hidden tab, closed page, logout). */
  flush?: () => Promise<void>;
  /** Fields the burst changed; those back at their first value (A → B → A) go in `reverted`. */
  touched?: string[];
}

export const buildMeaningfulAuditDetails = (
  details: Record<string, unknown>
): Record<string, unknown> | null => {
  const normalizedDetails = normalizeAuditDetails(details);
  return hasMeaningfulAuditDetails(normalizedDetails) ? normalizedDetails : null;
};

export const buildDebouncedAuditKey = (action: string, entityId: string): string =>
  `${action}-${entityId}`;

export const mergeDebouncedAuditDetails = (
  pendingDetails: Record<string, unknown> | null,
  nextDetails: Record<string, unknown>
): Record<string, unknown> | null => {
  const normalizedNextDetails = buildMeaningfulAuditDetails(nextDetails);
  if (!normalizedNextDetails) {
    return null;
  }

  if (!pendingDetails || !normalizedNextDetails.changes) {
    return normalizedNextDetails;
  }

  const oldChanges = (pendingDetails.changes || {}) as Record<
    string,
    { old?: unknown; new?: unknown } | unknown
  >;
  const newChanges = (normalizedNextDetails.changes || {}) as Record<
    string,
    { old?: unknown; new?: unknown } | unknown
  >;
  const mergedChanges: Record<string, unknown> = { ...oldChanges };

  Object.keys(newChanges).forEach(field => {
    const previousValue = mergedChanges[field] as Record<string, unknown> | undefined;
    const nextValue = newChanges[field] as Record<string, unknown> | undefined;

    if (previousValue && typeof previousValue === 'object' && 'old' in previousValue) {
      mergedChanges[field] = {
        old: previousValue.old,
        new:
          nextValue && typeof nextValue === 'object' && 'new' in nextValue
            ? nextValue.new
            : newChanges[field],
      };
      return;
    }

    mergedChanges[field] = newChanges[field];
  });

  return buildMeaningfulAuditDetails({
    ...pendingDetails,
    ...normalizedNextDetails,
    changes: mergedChanges,
  });
};
