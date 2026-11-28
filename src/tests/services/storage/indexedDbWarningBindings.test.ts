// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { attachIndexedDbWarningBindings } from '@/services/storage/indexeddb/indexedDbWarningBindings';
import { recordIndexedDbRecoveryNotice } from '@/services/storage/indexeddb/indexedDbRecoveryController';

vi.mock('@/services/storage/indexeddb/indexedDbRecoveryController', () => ({
  recordIndexedDbRecoveryNotice: vi.fn(),
}));

it('reports a blocked database and a real unexpected close once per recovery', () => {
  const events = new Map<string, () => void>();
  let usingMemory = true;
  attachIndexedDbWarningBindings(
    { on: (event, handler) => events.set(event, handler) },
    () => usingMemory,
    new Set()
  );
  events.get('close')!();
  events.get('blocked')!();
  events.get('blocked')!();
  expect(
    vi.mocked(recordIndexedDbRecoveryNotice).mock.calls.map(([operation]) => operation)
  ).toEqual(['indexeddb_blocked']);
  usingMemory = false;
  events.get('close')!();
  events.get('close')!();
  expect(
    vi.mocked(recordIndexedDbRecoveryNotice).mock.calls.map(([operation]) => operation)
  ).toEqual(['indexeddb_blocked', 'indexeddb_unexpected_close']);
});
