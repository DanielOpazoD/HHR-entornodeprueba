import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markSystemHealthReported,
  readLastSystemHealthReportAt,
  shouldReportSystemHealthNow,
} from '@/hooks/controllers/systemHealthReporterController';

const INTERVAL = 2 * 60 * 1000;
const uid = 'user-1';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('system health reporting cadence', () => {
  it('reports the first time a user is seen', () => {
    expect(readLastSystemHealthReportAt(uid)).toBe(0);
    expect(shouldReportSystemHealthNow(1_000, 0, INTERVAL, false)).toBe(true);
  });

  it('does not repeat the collection and write on a quick reload', () => {
    markSystemHealthReported(uid, 10_000);
    expect(readLastSystemHealthReportAt(uid)).toBe(10_000);
    expect(shouldReportSystemHealthNow(10_000 + INTERVAL - 1, 10_000, INTERVAL, false)).toBe(false);
  });

  it('reports again once the existing cadence elapses', () => {
    expect(shouldReportSystemHealthNow(10_000 + INTERVAL, 10_000, INTERVAL, false)).toBe(true);
  });

  it('still reports immediately when the version state actually changes', () => {
    expect(shouldReportSystemHealthNow(10_001, 10_000, INTERVAL, true)).toBe(true);
  });

  it('keeps each user independent', () => {
    markSystemHealthReported(uid, 10_000);
    expect(readLastSystemHealthReportAt('user-2')).toBe(0);
  });

  it('falls back to reporting when storage is unreadable or corrupted', () => {
    localStorage.setItem('hhr_system_health_last_report:user-3', 'no-es-un-numero');
    expect(readLastSystemHealthReportAt('user-3')).toBe(0);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(readLastSystemHealthReportAt(uid)).toBe(0);
  });

  it('never breaks the session when storage rejects writes', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(() => markSystemHealthReported(uid, 1)).not.toThrow();
  });
});
