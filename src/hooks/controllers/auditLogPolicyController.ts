import type { AuditLogEntry } from '@/types/auditLogTypes';
import {
  hasMeaningfulAuditDetails,
  normalizeAuditDetails,
} from '@/services/admin/auditChangeUtils';

export interface PendingAuditEntry {
  timer: number;
  details: Record<string, unknown>;
  rut?: string;
  date?: string;
  authors?: string;
  /** Writes the coalesced event now (hidden tab, closed page, logout). */
  flush?: () => Promise<void>;
  /** The burst reported changes; if they cancel out (A → B → A) nothing is written. */
  expectsChanges?: boolean;
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

export const buildAuditEntryInput = (
  userId: string,
  action: string,
  entityType: AuditLogEntry['entityType'],
  entityId: string,
  details: Record<string, unknown>,
  patientRut?: string,
  recordDate?: string,
  authors?: string
) => ({
  userId,
  action,
  entityType,
  entityId,
  details,
  patientRut,
  recordDate,
  authors,
});
