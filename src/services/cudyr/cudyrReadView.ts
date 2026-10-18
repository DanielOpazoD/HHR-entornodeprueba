import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import { callCudyrArchive } from './cudyrSupplementService';

const sessionGuard = (signal?: AbortSignal) => {
  const generation = getSessionGeneration(),
    owner = getStoredSessionOwnerKey();
  return () => {
    signal?.throwIfAborted();
    if (!owner || generation !== getSessionGeneration() || owner !== getStoredSessionOwnerKey())
      throw new Error('La sesión cambió.');
  };
};

/** This copy is presentation-only. The caller must continue an authoritative Firebase read. */
export const readCudyrReadView = async (from: string, to: string, signal: AbortSignal) => {
  const check = sessionGuard(signal);
  const reply = await callCudyrArchive<{ state: string; savedAt?: string; report?: string }>(
    'readCudyrHistory',
    { kind: 'read-view', from, to },
    check
  );
  check();
  if (reply.state !== 'ready' || !reply.report || reply.report.length > 900_000) return null;
  const bytes = Uint8Array.from(atob(reply.report), c => c.charCodeAt(0));
  const reader = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip')).getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8_000_000) throw new Error('Copia CUDYR demasiado grande.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const unpacked = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    unpacked.set(chunk, offset);
    offset += chunk.length;
  }
  const report = JSON.parse(new TextDecoder().decode(unpacked)) as CudyrReportDataset;
  if (
    report.schemaVersion !== 1 ||
    report.from !== from ||
    report.to !== to ||
    report.readIncomplete !== false ||
    report.officialSnapshot ||
    ![
      'rows',
      'coverage',
      'issues',
      'observations',
      'captures',
      'corrections',
      'dischargeAudit',
    ].every(k => Array.isArray(report[k as keyof CudyrReportDataset]))
  )
    return null;
  return { ...report, readViewSnapshot: reply.savedAt || report.generatedAt };
};
export const saveCudyrReadView = (report: CudyrReportDataset) => {
  if (report.readIncomplete !== false || report.officialSnapshot || report.readViewSnapshot) return;
  return callCudyrArchive(
    'archiveCudyrHistory',
    {
      kind: 'save-read-view',
      from: report.from,
      to: report.to,
      report: JSON.parse(JSON.stringify(report)),
    },
    sessionGuard()
  );
};
