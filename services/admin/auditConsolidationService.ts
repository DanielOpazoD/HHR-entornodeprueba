/**
 * Audit Consolidation Service
 * Consolidates duplicate audit logs in Firestore by merging entries
 * for the same patient/entity within a configurable time window.
 * 
 * Web-based version that runs in the browser using the user's credentials.
 */

import {
    collection,
    getDocs,
    query,
    orderBy,
    limit,
    writeBatch,
    doc
} from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { AuditLogEntry } from '@/types/audit';

// ============================================================================
// Configuration
// ============================================================================

const COLLECTION_NAME = 'audit_logs';
const DEFAULT_WINDOW_MINUTES = 5;
const MAX_BATCH_SIZE = 500; // Firestore batch limit

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

interface AuditLogWithId extends AuditLogEntry {
    id: string;
}

interface ConsolidationGroup {
    key: string;
    logs: AuditLogWithId[];
    merged: Record<string, unknown>;
    keepId: string;
    deleteIds: string[];
}

// ============================================================================
// Helpers
// ============================================================================

function mergeDetails(logs: AuditLogWithId[]): Record<string, unknown> {
    // Sort by timestamp ascending (oldest first)
    const sorted = [...logs].sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Start with first log's details
    const merged: Record<string, unknown> = { ...sorted[0].details };
    const mergedChanges: Record<string, { old: unknown; new: unknown }> =
        (merged.changes as Record<string, { old: unknown; new: unknown }>) || {};

    // Merge subsequent logs
    for (let i = 1; i < sorted.length; i++) {
        const log = sorted[i];
        const changes = (log.details.changes || {}) as Record<string, { old: unknown; new: unknown }>;

        Object.entries(changes).forEach(([field, change]) => {
            if (mergedChanges[field]) {
                // Keep original 'old', update 'new'
                mergedChanges[field] = {
                    old: mergedChanges[field].old,
                    new: change.new
                };
            } else {
                mergedChanges[field] = change;
            }
        });

        // Copy other details (patientName, etc.)
        Object.entries(log.details).forEach(([key, value]) => {
            if (key !== 'changes') {
                merged[key] = value;
            }
        });
    }

    merged.changes = mergedChanges;
    merged.consolidatedFrom = logs.map(l => l.id);
    merged.consolidatedAt = new Date().toISOString();

    return merged;
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Preview what will be consolidated without making changes
 */
export async function previewConsolidation(
    windowMinutes: number = DEFAULT_WINDOW_MINUTES,
    actionFilter?: string
): Promise<ConsolidationPreview> {
    const auditRef = collection(db, COLLECTION_NAME);
    const q = query(auditRef, orderBy('timestamp', 'desc'), limit(5000));

    const snapshot = await getDocs(q);
    const logs: AuditLogWithId[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    } as AuditLogWithId));

    // Filter by action if specified
    let filtered = logs;
    if (actionFilter) {
        filtered = filtered.filter(l => l.action === actionFilter);
    }

    // Group logs
    const groups = groupLogs(filtered, windowMinutes);
    const duplicateGroups = Array.from(groups.values()).filter(g => g.logs.length > 1);

    return {
        totalLogs: filtered.length,
        duplicateGroups: duplicateGroups.map(g => ({
            action: g.logs[0].action,
            entityId: g.logs[0].entityId,
            count: g.logs.length,
            firstTimestamp: g.logs[0].timestamp,
            lastTimestamp: g.logs[g.logs.length - 1].timestamp
        })),
        estimatedDeletions: duplicateGroups.reduce((sum, g) => sum + g.logs.length - 1, 0)
    };
}

/**
 * Execute consolidation
 */
export async function executeConsolidation(
    windowMinutes: number = DEFAULT_WINDOW_MINUTES,
    actionFilter?: string,
    onProgress?: (message: string) => void
): Promise<ConsolidationResult> {
    const result: ConsolidationResult = {
        success: false,
        totalLogs: 0,
        groupsFound: 0,
        logsConsolidated: 0,
        logsDeleted: 0,
        errors: []
    };

    try {
        onProgress?.('Cargando logs de auditoría...');

        const auditRef = collection(db, COLLECTION_NAME);
        const q = query(auditRef, orderBy('timestamp', 'desc'), limit(5000));
        const snapshot = await getDocs(q);

        const logs: AuditLogWithId[] = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as AuditLogWithId));

        result.totalLogs = logs.length;

        // Filter by action if specified
        let filtered = logs;
        if (actionFilter) {
            filtered = filtered.filter(l => l.action === actionFilter);
        }

        onProgress?.(`Analizando ${filtered.length} logs...`);

        // Group logs
        const groups = groupLogs(filtered, windowMinutes);
        const duplicateGroups = Array.from(groups.values()).filter(g => g.logs.length > 1);

        result.groupsFound = duplicateGroups.length;

        if (duplicateGroups.length === 0) {
            onProgress?.('No se encontraron duplicados');
            result.success = true;
            return result;
        }

        onProgress?.(`Consolidando ${duplicateGroups.length} grupos...`);

        // Process in batches due to Firestore limits
        for (let i = 0; i < duplicateGroups.length; i += MAX_BATCH_SIZE) {
            const batch = writeBatch(db);
            const batchGroups = duplicateGroups.slice(i, i + MAX_BATCH_SIZE);

            for (const group of batchGroups) {
                // Prepare merged details
                group.merged = mergeDetails(group.logs);
                group.keepId = group.logs[0].id;
                group.deleteIds = group.logs.slice(1).map(l => l.id);

                // Update the kept log
                const keepRef = doc(db, COLLECTION_NAME, group.keepId);
                batch.update(keepRef, {
                    details: group.merged,
                    consolidatedCount: group.logs.length
                });
                result.logsConsolidated++;

                // Delete duplicates
                for (const deleteId of group.deleteIds) {
                    batch.delete(doc(db, COLLECTION_NAME, deleteId));
                    result.logsDeleted++;
                }
            }

            await batch.commit();
            onProgress?.(`Procesado batch ${Math.floor(i / MAX_BATCH_SIZE) + 1}...`);
        }

        result.success = true;
        onProgress?.('Consolidación completada!');

    } catch (error) {
        console.error('[AuditConsolidation] Error:', error);
        result.errors.push(error instanceof Error ? error.message : 'Error desconocido');
    }

    return result;
}

/**
 * Group logs by action + entityId + user within time window
 */
function groupLogs(logs: AuditLogWithId[], windowMinutes: number): Map<string, ConsolidationGroup> {
    const groups: Map<string, ConsolidationGroup> = new Map();
    const windowMs = windowMinutes * 60 * 1000;

    logs.forEach(log => {
        const baseKey = `${log.action}-${log.entityId}-${log.userId || 'unknown'}`;
        const logTime = new Date(log.timestamp).getTime();

        // Find existing group within time window
        let foundGroup: ConsolidationGroup | undefined;

        groups.forEach((group) => {
            if (group.key.startsWith(baseKey)) {
                const lastLog = group.logs[group.logs.length - 1];
                const lastTime = new Date(lastLog.timestamp).getTime();
                const timeDiff = Math.abs(logTime - lastTime);

                if (timeDiff <= windowMs) {
                    foundGroup = group;
                }
            }
        });

        if (foundGroup) {
            foundGroup.logs.push(log);
        } else {
            const key = `${baseKey}-${logTime}`;
            groups.set(key, {
                key,
                logs: [log],
                merged: {},
                keepId: log.id,
                deleteIds: []
            });
        }
    });

    return groups;
}
