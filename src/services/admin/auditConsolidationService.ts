/**
 * Audit Consolidation Service
 * Consolidates duplicate audit logs in Firestore by merging entries
 * for the same patient/entity within a configurable time window.
 */

import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import type {
  AuditLogWithId,
  ConsolidationGroup,
  PreparedConsolidationGroup,
} from './auditConsolidationPolicy';
import {
  createConsolidationBatches,
  getConsolidationOperationCount,
  groupLogs,
  mergeDetails,
  prepareConsolidationGroups,
} from './auditConsolidationPolicy';

const getAuditCollectionPath = () => `hospitals/${getActiveHospitalId()}/auditLogs`;
const DEFAULT_WINDOW_MINUTES = 5;

export interface ConsolidationResult {
  success: boolean;
  totalLogs: number;
  groupsFound: number;
  logsConsolidated: number;
  logsDeleted: number;
  errors: string[];
}

export interface ConsolidationPreview {
  totalLogs: number;
  duplicateGroups: Array<{
    action: string;
    entityId: string;
    count: number;
    firstTimestamp: string;
    lastTimestamp: string;
  }>;
  estimatedDeletions: number;
}

const filterLogsByAction = (logs: AuditLogWithId[], actionFilter?: string) =>
  actionFilter ? logs.filter(log => log.action === actionFilter) : logs;

const selectDuplicateGroups = (
  logs: AuditLogWithId[],
  windowMinutes: number
): ConsolidationGroup[] =>
  Array.from(groupLogs([...logs].reverse(), windowMinutes).values()).filter(
    group => group.logs.length > 1
  );

const buildPreview = (groups: ConsolidationGroup[], totalLogs: number): ConsolidationPreview => ({
  totalLogs,
  duplicateGroups: groups.map(group => ({
    action: group.logs[0].action,
    entityId: group.logs[0].entityId,
    count: group.logs.length,
    firstTimestamp: group.logs[0].timestamp,
    lastTimestamp: group.logs[group.logs.length - 1].timestamp,
  })),
  estimatedDeletions: groups.reduce((sum, group) => sum + group.logs.length - 1, 0),
});

export const createAuditConsolidationService = (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
) => {
  const fetchAuditLogs = async (): Promise<AuditLogWithId[]> => {
    const auditRef = collection(runtime.getDb(), getAuditCollectionPath());
    const auditQuery = query(auditRef, orderBy('timestamp', 'desc'), limit(5000));
    const snapshot = await getDocs(auditQuery);

    return snapshot.docs.map(
      currentDoc =>
        ({
          id: currentDoc.id,
          ...currentDoc.data(),
        }) as AuditLogWithId
    );
  };

  const previewConsolidation = async (
    windowMinutes: number = DEFAULT_WINDOW_MINUTES,
    actionFilter?: string
  ): Promise<ConsolidationPreview> => {
    const logs = filterLogsByAction(await fetchAuditLogs(), actionFilter);
    const duplicateGroups = selectDuplicateGroups(logs, windowMinutes);
    return buildPreview(duplicateGroups, logs.length);
  };

  // Deprecated: auditLogs are append-only in Firestore rules (deny update/delete).
  // Preserved as a no-op to avoid breaking imports. Duplicate suppression now
  // happens at source via per-session throttling in the audit pipeline.
  const executeConsolidation = async (
    _windowMinutes: number = DEFAULT_WINDOW_MINUTES,
    _actionFilter?: string,
    onProgress?: (message: string) => void
  ): Promise<ConsolidationResult> => {
    onProgress?.('Consolidación deshabilitada: el registro es append-only.');
    return {
      success: true,
      totalLogs: 0,
      groupsFound: 0,
      logsConsolidated: 0,
      logsDeleted: 0,
      errors: [
        'Consolidación deshabilitada: auditLogs es append-only. La agrupación de duplicados ahora es read-time.',
      ],
    };
  };

  return {
    previewConsolidation,
    executeConsolidation,
  };
};

const defaultAuditConsolidationService = createAuditConsolidationService();

export const previewConsolidation = defaultAuditConsolidationService.previewConsolidation;
export const executeConsolidation = defaultAuditConsolidationService.executeConsolidation;

export {
  createConsolidationBatches,
  getConsolidationOperationCount,
  groupLogs,
  mergeDetails,
  prepareConsolidationGroups,
};
export type { AuditLogWithId, ConsolidationGroup, PreparedConsolidationGroup };
