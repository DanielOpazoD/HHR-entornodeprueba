import { gzipSync } from 'node:zlib';
import { beforeEach, expect, it, vi } from 'vitest';
import { readCudyrReadView, saveCudyrReadView } from '@/services/cudyr/cudyrReadView';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { reportInput } from './reportFixtures';
const state = vi.hoisted(() => ({ owner: 'a', generation: '1', reply: {}, call: vi.fn() }));
vi.mock('@/services/storage/sessionScopedStorageService', () => ({
  getStoredSessionOwnerKey: () => state.owner,
}));
vi.mock('@/services/storage/sessionStorageTransition', () => ({
  getSessionGeneration: () => state.generation,
}));
vi.mock('@/services/cudyr/cudyrSupplementService', () => ({
  callCudyrArchive: (...args: unknown[]) => state.call(...args),
}));
beforeEach(() => {
  state.owner = 'a';
  state.generation = '1';
  state.call.mockReset();
  state.call.mockImplementation(async (_endpoint, _request, check) => {
    check();
    return state.reply;
  });
});
const fixture = () => ({ ...buildCudyrReport(reportInput()), readIncomplete: false });
it('loads a display-only copy and rejects a different period', async () => {
  const report = fixture();
  state.reply = {
    state: 'ready',
    savedAt: 'saved',
    report: gzipSync(JSON.stringify(report)).toString('base64'),
  };
  const signal = new AbortController().signal;
  expect((await readCudyrReadView(report.from, report.to, signal))?.readViewSnapshot).toBe('saved');
  expect(await readCudyrReadView(report.from, '2026-10-01', signal)).toBeNull();
});
it('never republishes official, incomplete or provisional view data', () => {
  const report = fixture();
  saveCudyrReadView({ ...report, readIncomplete: true });
  saveCudyrReadView({ ...report, readViewSnapshot: 'saved' });
  saveCudyrReadView({ ...report, officialSnapshot: { version: 'v', savedAt: 'saved' } });
  expect(state.call).not.toHaveBeenCalled();
});
it('checks the owner again after runtime setup and before dispatch', async () => {
  state.call.mockImplementation(async (_endpoint, _request, check) => {
    state.owner = 'other';
    check();
  });
  await expect(saveCudyrReadView(fixture())).rejects.toThrow(/sesión cambió/);
});
