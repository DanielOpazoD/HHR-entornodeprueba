// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildRuntimeOperationStatusSnapshot,
  getRuntimeOperationSeverity,
  isBlockingRuntimeStatus,
  isInFlightRuntimeStatus,
  isTerminalRuntimeStatus,
  type RuntimeOperationSeverity,
  type RuntimeOperationStatus,
} from '@/shared/contracts/runtimeOperationStatus';

// Every status exactly once: `satisfies` stops compiling if the union gains or loses one.
const RUNTIME_OPERATION_STATUSES = Object.keys({
  ready: true,
  saving: true,
  pending: true,
  conflict: true,
  blocked: true,
  offline: true,
  degraded: true,
  failed: true,
} satisfies Record<RuntimeOperationStatus, true>) as RuntimeOperationStatus[];

describe('getRuntimeOperationSeverity', () => {
  const cases: Array<[RuntimeOperationStatus, RuntimeOperationSeverity]> = [
    ['ready', 'ok'],
    ['saving', 'ok'],
    ['pending', 'warning'],
    ['conflict', 'warning'],
    ['blocked', 'warning'],
    ['offline', 'warning'],
    ['degraded', 'warning'],
    ['failed', 'error'],
  ];

  it.each(cases)('maps %s to severity %s', (status, severity) => {
    expect(getRuntimeOperationSeverity(status)).toBe(severity);
  });

  it('covers every canonical status (no missing entry)', () => {
    for (const status of RUNTIME_OPERATION_STATUSES) {
      expect(['ok', 'warning', 'error']).toContain(getRuntimeOperationSeverity(status));
    }
  });
});

describe('runtime status classifiers', () => {
  it('marks ready and failed as terminal, others as non-terminal', () => {
    for (const status of RUNTIME_OPERATION_STATUSES) {
      const expected = status === 'ready' || status === 'failed';
      expect(isTerminalRuntimeStatus(status)).toBe(expected);
    }
  });

  it('marks saving and pending as in-flight', () => {
    for (const status of RUNTIME_OPERATION_STATUSES) {
      const expected = status === 'saving' || status === 'pending';
      expect(isInFlightRuntimeStatus(status)).toBe(expected);
    }
  });

  it('marks conflict, blocked and failed as blocking the user', () => {
    for (const status of RUNTIME_OPERATION_STATUSES) {
      const expected = status === 'conflict' || status === 'blocked' || status === 'failed';
      expect(isBlockingRuntimeStatus(status)).toBe(expected);
    }
  });
});

describe('buildRuntimeOperationStatusSnapshot', () => {
  it('produces a fully-derived snapshot for ready', () => {
    expect(buildRuntimeOperationStatusSnapshot('ready')).toEqual({
      status: 'ready',
      severity: 'ok',
      inFlight: false,
      terminal: true,
      blocking: false,
    });
  });

  it('produces a fully-derived snapshot for conflict', () => {
    expect(buildRuntimeOperationStatusSnapshot('conflict')).toEqual({
      status: 'conflict',
      severity: 'warning',
      inFlight: false,
      terminal: false,
      blocking: true,
    });
  });

  it('produces a fully-derived snapshot for failed', () => {
    expect(buildRuntimeOperationStatusSnapshot('failed')).toEqual({
      status: 'failed',
      severity: 'error',
      inFlight: false,
      terminal: true,
      blocking: true,
    });
  });

  it('produces a fully-derived snapshot for saving', () => {
    expect(buildRuntimeOperationStatusSnapshot('saving')).toEqual({
      status: 'saving',
      severity: 'ok',
      inFlight: true,
      terminal: false,
      blocking: false,
    });
  });
});
