// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildTopObservedOperationalKey,
  createRecordedOperationalTelemetryEvent,
  isObservedOperationalTelemetryStatus,
  normalizeOperationalTelemetryIssues,
  sanitizeOperationalTelemetryContext,
  sanitizePersistedOperationalTelemetryEvent,
  trimOperationalTelemetryEvents,
} from '@/services/observability/operationalTelemetrySupport';

describe('operationalTelemetrySupport', () => {
  it('normalizes issues and context deterministically', () => {
    expect(normalizeOperationalTelemetryIssues([' Error ', '', '2'])).toEqual(['Error', '2']);
    expect(
      sanitizeOperationalTelemetryContext({
        keep: 1,
        nested: { retry: true },
        omit: undefined,
      })
    ).toEqual({
      keep: 1,
      nested: JSON.stringify({ retry: true }),
    });
  });

  it('sanitizes persisted events and drops malformed ones', () => {
    expect(
      sanitizePersistedOperationalTelemetryEvent({
        category: 'sync',
        status: 'failed',
        runtimeState: 'blocked',
        operation: 'sync_daily_record',
        timestamp: '2026-03-06T20:00:00.000Z',
        issues: [' Error '],
        context: { nested: { reason: 'timeout' } },
      })
    ).toEqual({
      category: 'sync',
      status: 'failed',
      runtimeState: 'blocked',
      operation: 'sync_daily_record',
      timestamp: '2026-03-06T20:00:00.000Z',
      issues: ['Error'],
      context: { nested: JSON.stringify({ reason: 'timeout' }) },
    });
    expect(
      sanitizePersistedOperationalTelemetryEvent({
        category: 'sync',
        status: 'unknown',
        operation: 'broken',
        timestamp: '2026-03-06T20:00:00.000Z',
      })
    ).toBeNull();
  });

  it('builds and trims recorded events', () => {
    const event = createRecordedOperationalTelemetryEvent({
      category: 'backup',
      status: 'partial',
      runtimeState: 'recoverable',
      operation: 'backup_handoff_pdf',
      issues: [' warn '],
      context: { attempt: 2 },
    });

    expect(event.issues).toEqual(['warn']);
    expect(event.context).toEqual({ attempt: 2 });
    expect(event.runtimeState).toBe('recoverable');
    expect(typeof event.timestamp).toBe('string');
    expect(trimOperationalTelemetryEvents(Array.from({ length: 205 }, () => event))).toHaveLength(
      200
    );
  });

  it('resolves observed statuses and top keys', () => {
    expect(isObservedOperationalTelemetryStatus('failed')).toBe(true);
    expect(isObservedOperationalTelemetryStatus('success')).toBe(false);
    expect(buildTopObservedOperationalKey(['a', 'b', 'a'])).toBe('a');
  });
});
