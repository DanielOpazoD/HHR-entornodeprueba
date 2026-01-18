
import { groupLogs, mergeDetails } from '../../../services/admin/auditConsolidationService';
import { AuditLogEntry } from '../../../types/audit';

// Type helper for tests
interface AuditLogWithId extends AuditLogEntry {
    id: string;
}

const mockLog = (
    id: string,
    timestamp: string | number,
    action: string,
    entityId: string,
    details: any = {}
): AuditLogWithId => ({
    id,
    timestamp: timestamp as any,
    action,
    entityId,
    userId: 'user1',
    userEmail: 'user@test.com',
    details,
    metadata: {}
});

describe('Audit Consolidation Service', () => {
    describe('groupLogs', () => {
        it('should group logs that are within the time window', () => {
            const logs = [
                mockLog('1', '2023-01-01T10:00:00Z', 'UPDATE', 'bed1'),
                mockLog('2', '2023-01-01T10:02:00Z', 'UPDATE', 'bed1'), // +2 mins
                mockLog('3', '2023-01-01T10:04:00Z', 'UPDATE', 'bed1'), // +2 mins from prev, +4 from start. Should fit in 5 min window?
            ];

            const groups = groupLogs(logs, 5);
            expect(groups.size).toBe(1);

            const group = Array.from(groups.values())[0];
            expect(group.logs.length).toBe(3);
            expect(group.logs.map(l => l.id)).toEqual(['1', '2', '3']);
        });

        it('should split logs that are outside the time window', () => {
            const logs = [
                mockLog('1', '2023-01-01T10:00:00Z', 'UPDATE', 'bed1'),
                mockLog('2', '2023-01-01T10:06:00Z', 'UPDATE', 'bed1'), // +6 mins, outside 5 min window
            ];

            const groups = groupLogs(logs, 5);
            expect(groups.size).toBe(2);
        });

        it('should group separate entities separately', () => {
            const logs = [
                mockLog('1', '2023-01-01T10:00:00Z', 'UPDATE', 'bed1'),
                mockLog('2', '2023-01-01T10:01:00Z', 'UPDATE', 'bed2'), // Different entity
            ];

            const groups = groupLogs(logs, 5);
            expect(groups.size).toBe(2);
        });

        it('should handle sliding window correctly (chaining)', () => {
            // Log 1: 10:00
            // Log 2: 10:04 (Fits with 1)
            // Log 3: 10:08 (Fits with 2, but is 8 mins from 1. The implementation allows joining if close to LAST log)
            const logs = [
                mockLog('1', '2023-01-01T10:00:00Z', 'UPDATE', 'bed1'),
                mockLog('2', '2023-01-01T10:04:00Z', 'UPDATE', 'bed1'),
                mockLog('3', '2023-01-01T10:08:00Z', 'UPDATE', 'bed1'),
            ];

            const groups = groupLogs(logs, 5);
            // Based on implementation: abs(logTime - lastTime) <= windowMs
            // 08:00 - 04:00 = 4 mins <= 5 mins. So it should join.
            expect(groups.size).toBe(1);
            expect(Array.from(groups.values())[0].logs.length).toBe(3);
        });

        it('should sort logs internally before grouping', () => {
            const logs = [
                mockLog('2', '2023-01-01T10:02:00Z', 'UPDATE', 'bed1'),
                mockLog('1', '2023-01-01T10:00:00Z', 'UPDATE', 'bed1'),
            ];

            const groups = groupLogs(logs, 5);
            expect(groups.size).toBe(1);
            const group = Array.from(groups.values())[0];
            expect(group.logs[0].id).toBe('1'); // Should be sorted by time
            expect(group.logs[1].id).toBe('2');
        });
    });

    describe('mergeDetails', () => {
        it('should merge simple fields overwriting with latest', () => {
            const logs = [
                mockLog('1', '2023-01-01T10:00:00Z', 'UPDATE', 'bed1', { status: 'A', note: 'First' }),
                mockLog('2', '2023-01-01T10:01:00Z', 'UPDATE', 'bed1', { status: 'B' }) // note missing in second
            ];

            const merged = mergeDetails(logs);
            expect(merged.status).toBe('B');
            expect(merged.note).toBe('First'); // preserved if not overwritten
        });

        it('should merge "changes" object calculating net difference', () => {
            // Scenario:
            // 1. Change name: 'Old' -> 'Mid'
            // 2. Change name: 'Mid' -> 'New'
            // Result should be: name: { old: 'Old', new: 'New' }

            const logs = [
                mockLog('1', '2023-01-01T10:00:00Z', 'UPDATE', 'bed1', {
                    changes: {
                        name: { old: 'Old', new: 'Mid' },
                        age: { old: 20, new: 21 }
                    }
                }),
                mockLog('2', '2023-01-01T10:01:00Z', 'UPDATE', 'bed1', {
                    changes: {
                        name: { old: 'Mid', new: 'New' },
                        weight: { old: 70, new: 71 }
                    }
                })
            ];

            const merged = mergeDetails(logs);
            const changes = merged.changes as Record<string, any>;

            expect(changes.name).toEqual({ old: 'Old', new: 'New' });
            expect(changes.age).toEqual({ old: 20, new: 21 }); // From first only
            expect(changes.weight).toEqual({ old: 70, new: 71 }); // From second only
        });
    });
});
