import { expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { decodeOfficialCudyrReport } from '@/services/cudyr/cudyrOfficialReport';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { confirmedReportInput } from './reportFixtures';
const envelope = (report: unknown) => ({
  state: 'ready' as const,
  sourceVersion: 'source',
  version: createHash('sha256')
    .update(JSON.stringify(['source', report]))
    .digest('hex'),
  savedAt: '2026-10-09T10:00:00Z',
  report: gzipSync(JSON.stringify(report)).toString('base64'),
});
it('rejects unapproved ordinary reports even when their bytes match', async () => {
  await expect(
    decodeOfficialCudyrReport(envelope(buildCudyrReport(confirmedReportInput())))
  ).rejects.toThrow(/incompleto/);
});
it('detects mismatched or corrupted payload before calling it official', async () => {
  const reply = envelope(buildCudyrReport(confirmedReportInput()));
  reply.version = 'wrong';
  await expect(decodeOfficialCudyrReport(reply)).rejects.toThrow(/integridad/);
});
it('loads an approved month and reuses its known version without decoding again', async () => {
  const report = buildCudyrReport(confirmedReportInput());
  report.from = '2026-08-01';
  report.to = '2026-08-31';
  report.rows = [];
  report.coverage = Array.from({ length: 31 }, (_, i) => ({
    date: '2026-08-' + String(i + 1).padStart(2, '0'),
    state: 'disponible',
    lastSyncedAt: '',
    runId: '',
    reconstructionApproval: {
      approvedAt: '2026-10-08T18:00:00Z',
      approvedBy: 'Synthetic',
      reason: 'Reviewed',
    },
  }));
  const reply = envelope(report);
  const decoded = await decodeOfficialCudyrReport(reply);
  expect(decoded?.officialSnapshot?.version).toBe(reply.version);
  const unchanged = await decodeOfficialCudyrReport(
    { ...reply, state: 'unchanged', report: undefined },
    decoded!
  );
  expect(unchanged?.rows).toEqual([]);
});

it('removes optional undefined fields before callable transport so approval hashes stay identical', async () => {
  const service = await import('@/services/cudyr/cudyrSupplementService');
  const { saveOfficialCudyrReport } = await import('@/services/cudyr/cudyrOfficialReport');
  const report = buildCudyrReport(confirmedReportInput());
  report.from = '2026-08-01';
  report.to = '2026-08-31';
  report.rows = [];
  report.coverage = Array.from({ length: 31 }, (_, i) => ({
    date: '2026-08-' + String(i + 1).padStart(2, '0'),
    state: 'disponible',
    lastSyncedAt: '',
    runId: '',
    censusVerification: undefined,
    reconstructionApproval: {
      approvedAt: '2026-10-08T18:00:00Z',
      approvedBy: 'Synthetic',
      reason: 'Reviewed',
    },
  }));
  const call = vi.spyOn(service, 'callCudyrArchive').mockResolvedValue({ persisted: false });
  await expect(saveOfficialCudyrReport(report, 'source-version')).rejects.toThrow('guardar');
  const sent = call.mock.calls[0][1] as { report: typeof report };
  expect('censusVerification' in sent.report.coverage[0]).toBe(false);
  expect(JSON.stringify(sent.report)).toBe(JSON.stringify(report));
  call.mockRestore();
});

it('bounds decompressed bytes before parsing a compact oversized payload', async () => {
  const reply = envelope({ padding: 'x'.repeat(8_000_001) });
  await expect(decodeOfficialCudyrReport(reply)).rejects.toThrow(/tamaño permitido/);
});
