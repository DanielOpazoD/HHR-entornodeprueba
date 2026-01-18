#!/usr/bin/env npx ts-node
/**
 * Audit Log Consolidation Script
 * 
 * Consolidates duplicate audit logs in Firestore by merging entries
 * for the same patient/entity within a configurable time window.
 * 
 * Usage:
 *   npx ts-node scripts/consolidateAuditLogs.ts [--dry-run] [--window-minutes=5]
 * 
 * Options:
 *   --dry-run           Preview changes without modifying Firestore
 *   --window-minutes=N  Time window for consolidation (default: 5 minutes)
 *   --action=ACTION     Filter by specific action (e.g., PATIENT_MODIFIED)
 *   --date=YYYY-MM-DD   Process only logs from specific date
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// Configuration
// ============================================================================

const COLLECTION_NAME = 'audit_logs';
const DEFAULT_WINDOW_MINUTES = 5;

interface AuditLog {
    id: string;
    action: string;
    entityId: string;
    entityType: string;
    timestamp: Timestamp;
    details: Record<string, unknown>;
    userId?: string;
    patientRut?: string;
    recordDate?: string;
}

interface ConsolidationGroup {
    key: string;
    logs: AuditLog[];
    merged: Record<string, unknown>;
    keepId: string;
    deleteIds: string[];
}

// ============================================================================
// Helpers
// ============================================================================

function parseArgs(): { dryRun: boolean; windowMinutes: number; action?: string; date?: string } {
    const args = process.argv.slice(2);
    let dryRun = false;
    let windowMinutes = DEFAULT_WINDOW_MINUTES;
    let action: string | undefined;
    let date: string | undefined;

    args.forEach(arg => {
        if (arg === '--dry-run') dryRun = true;
        if (arg.startsWith('--window-minutes=')) windowMinutes = parseInt(arg.split('=')[1], 10);
        if (arg.startsWith('--action=')) action = arg.split('=')[1];
        if (arg.startsWith('--date=')) date = arg.split('=')[1];
    });

    return { dryRun, windowMinutes, action, date };
}

function initFirebase() {
    // Try to find service account in common locations
    const possiblePaths = [
        path.join(process.cwd(), 'serviceAccountKey.json'),
        path.join(process.cwd(), 'firebase-admin-key.json'),
        path.join(process.cwd(), 'functions', 'serviceAccountKey.json'),
    ];

    let serviceAccountPath: string | null = null;
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            serviceAccountPath = p;
            break;
        }
    }

    if (!serviceAccountPath) {
        console.error('❌ Service account key not found. Place serviceAccountKey.json in project root.');
        process.exit(1);
    }

    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

function mergeDetails(logs: AuditLog[]): Record<string, unknown> {
    // Sort by timestamp ascending (oldest first)
    const sorted = [...logs].sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis());

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
// Main Logic
// ============================================================================

async function consolidateLogs() {
    const { dryRun, windowMinutes, action, date } = parseArgs();

    console.log('🔧 Audit Log Consolidation Script');
    console.log('================================');
    console.log(`Mode: ${dryRun ? '🔍 DRY RUN (no changes)' : '💾 LIVE (will modify Firestore)'}`);
    console.log(`Window: ${windowMinutes} minutes`);
    if (action) console.log(`Action filter: ${action}`);
    if (date) console.log(`Date filter: ${date}`);
    console.log('');

    const db = initFirebase();
    const auditRef = db.collection(COLLECTION_NAME);

    // Build query
    const query = auditRef.orderBy('timestamp', 'desc').limit(5000);

    // Fetch logs
    console.log('📥 Fetching audit logs...');
    const snapshot = await query.get();
    console.log(`   Found ${snapshot.docs.length} logs`);

    // Convert to typed array
    const logs: AuditLog[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    } as AuditLog));

    // Filter by action and date if specified
    let filtered = logs;
    if (action) {
        filtered = filtered.filter(l => l.action === action);
    }
    if (date) {
        filtered = filtered.filter(l => l.recordDate === date);
    }

    console.log(`   After filters: ${filtered.length} logs`);

    // Group logs by action + entityId + user within time window
    const groups: Map<string, ConsolidationGroup> = new Map();
    const windowMs = windowMinutes * 60 * 1000;

    filtered.forEach(log => {
        const baseKey = `${log.action}-${log.entityId}-${log.userId || 'unknown'}`;

        // Find existing group within time window
        let foundGroup: ConsolidationGroup | undefined;

        groups.forEach((group, key) => {
            if (key.startsWith(baseKey)) {
                const lastLog = group.logs[group.logs.length - 1];
                const timeDiff = Math.abs(log.timestamp.toMillis() - lastLog.timestamp.toMillis());
                if (timeDiff <= windowMs) {
                    foundGroup = group;
                }
            }
        });

        if (foundGroup) {
            foundGroup.logs.push(log);
        } else {
            const key = `${baseKey}-${log.timestamp.toMillis()}`;
            groups.set(key, {
                key,
                logs: [log],
                merged: {},
                keepId: log.id,
                deleteIds: []
            });
        }
    });

    // Identify groups with duplicates
    const duplicateGroups = Array.from(groups.values()).filter(g => g.logs.length > 1);

    console.log('');
    console.log('📊 Analysis Results:');
    console.log(`   Total groups: ${groups.size}`);
    console.log(`   Groups with duplicates: ${duplicateGroups.length}`);

    if (duplicateGroups.length === 0) {
        console.log('');
        console.log('✅ No duplicate logs found. Nothing to consolidate.');
        return;
    }

    // Print duplicate groups
    console.log('');
    console.log('📋 Duplicate groups to consolidate:');
    duplicateGroups.forEach((group, idx) => {
        console.log(`   ${idx + 1}. ${group.logs[0].action} on ${group.logs[0].entityId}`);
        console.log(`      Logs: ${group.logs.length} entries over ${windowMinutes} min window`);
        console.log(`      First: ${group.logs[0].timestamp.toDate().toISOString()}`);
        console.log(`      Last:  ${group.logs[group.logs.length - 1].timestamp.toDate().toISOString()}`);

        // Prepare consolidation
        group.merged = mergeDetails(group.logs);
        group.keepId = group.logs[0].id; // Keep oldest
        group.deleteIds = group.logs.slice(1).map(l => l.id);
    });

    // Calculate stats
    const totalDuplicates = duplicateGroups.reduce((sum, g) => sum + g.logs.length - 1, 0);

    console.log('');
    console.log(`📈 Consolidation will:`);
    console.log(`   - Keep: ${duplicateGroups.length} consolidated logs`);
    console.log(`   - Delete: ${totalDuplicates} duplicate logs`);

    if (dryRun) {
        console.log('');
        console.log('🔍 DRY RUN complete. No changes made.');
        console.log('   Run without --dry-run to apply changes.');
        return;
    }

    // Apply consolidation
    console.log('');
    console.log('💾 Applying consolidation...');

    const batch = db.batch();
    let updateCount = 0;
    let deleteCount = 0;

    for (const group of duplicateGroups) {
        // Update the kept log with merged details
        const keepRef = auditRef.doc(group.keepId);
        batch.update(keepRef, {
            details: group.merged,
            consolidatedCount: group.logs.length
        });
        updateCount++;

        // Delete duplicates
        for (const deleteId of group.deleteIds) {
            batch.delete(auditRef.doc(deleteId));
            deleteCount++;
        }
    }

    await batch.commit();

    console.log('');
    console.log('✅ Consolidation complete!');
    console.log(`   Updated: ${updateCount} logs`);
    console.log(`   Deleted: ${deleteCount} duplicates`);
}

// Run
consolidateLogs().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
