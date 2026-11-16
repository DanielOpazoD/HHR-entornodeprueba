// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveIndexedDbOpenWaitAction } from '@/services/storage/indexeddb/indexedDbOpenWaitController';

describe('indexedDbOpenWaitController', () => {
  it('returns immediately when a concurrent open resolved or switched to mock fallback', () => {
    expect(resolveIndexedDbOpenWaitAction('opened')).toBe('return');
    expect(resolveIndexedDbOpenWaitAction('mock')).toBe('return');
  });

  it('falls back only when the concurrent open stalls', () => {
    expect(resolveIndexedDbOpenWaitAction('stalled')).toBe('fallback');
  });

  it('continues normal recovery when the concurrent open has already settled without readiness', () => {
    expect(resolveIndexedDbOpenWaitAction('settled')).toBe('continue');
  });
});
