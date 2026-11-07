import { describe, expect, it } from 'vitest';
import { sanitizeOperationalTelemetryEvent } from '@/services/observability/operationalTelemetryPrivacy';

// On 2026-11-07 a full disk closed IndexedDB every 30 minutes and production could not count it:
// these names reached the server as other_operation.
const INDEXED_DB_FAILURES = [
  'indexeddb_unexpected_close',
  'indexeddb_database_closed',
  'indexeddb_open_stalled',
  'indexeddb_blocked',
  'indexeddb_initial_open_failed',
  'indexeddb_save_record',
  'indexeddb_recovery_stopped',
];

describe('IndexedDB failures reach the server by name', () => {
  it.each(INDEXED_DB_FAILURES)('keeps %s', operation => {
    const event = sanitizeOperationalTelemetryEvent({
      category: 'indexeddb',
      status: 'degraded',
      operation,
      timestamp: '2026-11-07T04:04:00.000Z',
    });
    expect(event).toMatchObject({ operation });
  });

  it('says a failed local save ran out of space, without the raw message', () => {
    const event = sanitizeOperationalTelemetryEvent({
      category: 'indexeddb',
      status: 'failed',
      operation: 'indexeddb_save_record',
      timestamp: '2026-11-07T04:04:00.000Z',
      issues: ['QuotaExceededError: The quota has been exceeded.'],
      context: { errorName: 'QuotaExceededError' },
    });
    expect(event).toMatchObject({
      operation: 'indexeddb_save_record',
      issues: ['persistence_issue'],
      context: { errorName: 'QuotaExceededError' },
    });
  });
});
