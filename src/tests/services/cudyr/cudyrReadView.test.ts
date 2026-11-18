import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readCudyrReadView, saveCudyrReadView } from '@/features/cudyr/report/cudyrReadView';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { reportInput } from './reportFixtures';
import {
  admitSyntheticSession,
  clearSyntheticSession,
  replaceStoredSessionOwner,
} from '@/tests/utils/syntheticSession';
const state = vi.hoisted(() => ({ reply: {}, call: vi.fn() }));
vi.mock('@/services/cudyr/cudyrFunctionsCall', () => ({
  callCudyrFunction: (...args: unknown[]) => state.call(...args),
}));
beforeEach(() => {
  admitSyntheticSession('a', '1');
  state.call.mockReset();
  state.call.mockImplementation(async (_endpoint, _request, guard) => {
    guard.check();
    return state.reply;
  });
});
afterEach(clearSyntheticSession);
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
it('never republishes official, incomplete or provisional view data', async () => {
  const report = fixture();
  await saveCudyrReadView({ ...report, readIncomplete: true });
  await saveCudyrReadView({ ...report, readViewSnapshot: 'saved' });
  await saveCudyrReadView({ ...report, officialSnapshot: { version: 'v', savedAt: 'saved' } });
  expect(state.call).not.toHaveBeenCalled();
});
it('checks the owner again after runtime setup and before dispatch', async () => {
  state.call.mockImplementation(async (_endpoint, _request, guard) => {
    replaceStoredSessionOwner('other');
    guard.check();
  });
  await expect(saveCudyrReadView(fixture())).rejects.toThrow(/sesión cambió/);
});
