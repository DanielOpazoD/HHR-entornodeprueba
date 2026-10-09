import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import { callCudyrArchive } from './cudyrSupplementService';
import { cudyrArchiveCoverage } from './cudyrArchiveCoverage';

interface Reply {
  state: 'missing' | 'ready' | 'unchanged';
  sourceVersion: string;
  version?: string;
  savedAt?: string;
  report?: string;
}
export const isOfficialCudyrMonth = (data: CudyrReportDataset) => {
  const last = new Date(Date.UTC(Number(data.from.slice(0, 4)), Number(data.from.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
  return (
    data.from.endsWith('-01') &&
    data.to === last &&
    !data.issues.length &&
    !data.rows.some(row => row.eligibility === 'por_revisar') &&
    data.coverage.length === Number(last.slice(-2)) &&
    data.coverage.every(day => day.state === 'disponible' && day.reconstructionApproval) &&
    cudyrArchiveCoverage(data).every(day => day.state === 'complete')
  );
};
export const probeOfficialCudyrReport = (
  month: string,
  cached?: CudyrReportDataset,
  episodes?: string[]
) =>
  callCudyrArchive<Reply>('readCudyrHistory', {
    kind: 'official-report',
    month,
    ...(cached?.officialSnapshot ? { knownVersion: cached.officialSnapshot.version } : {}),
    ...(episodes ? { episodes } : {}),
  });
export const decodeOfficialCudyrReport = async (reply: Reply, cached?: CudyrReportDataset) => {
  let result = cached;
  const packed = reply.state === 'unchanged' ? cached?.officialSnapshot?.packed : reply.report;
  if (packed) {
    if (packed.length > 900_000) throw new Error('El informe guardado excede su tamaño permitido.');
    const bytes = Uint8Array.from(atob(packed), c => c.charCodeAt(0));
    const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8_000_000) {
        await reader.cancel();
        throw new Error('El informe guardado excede su tamaño permitido.');
      }
      chunks.push(value);
    }
    const unpacked = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      unpacked.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder().decode(unpacked);
    result = JSON.parse(text) as CudyrReportDataset;
    const bytesToVerify = new TextEncoder().encode(JSON.stringify([reply.sourceVersion, result]));
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytesToVerify)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    if (digest !== reply.version)
      throw new Error('No se pudo verificar la integridad del informe oficial.');
  }
  if (!packed || !result || !reply.version || !reply.savedAt || !isOfficialCudyrMonth(result))
    throw new Error('El informe oficial guardado está incompleto.');
  return {
    ...result,
    officialSnapshot: {
      version: reply.version,
      savedAt: reply.savedAt,
      packed,
    },
  };
};
export const saveOfficialCudyrReport = async (
  report: CudyrReportDataset,
  sourceVersion: string,
  signal?: AbortSignal
) => {
  if (!isOfficialCudyrMonth(report)) return report;
  const month = report.from.slice(0, 7);
  signal?.throwIfAborted();
  const receipt = await callCudyrArchive<{
    persisted: boolean;
    version: string;
    savedAt: string;
    sourceVersion: string;
    report: string;
  }>('archiveCudyrHistory', {
    kind: 'save-official-report',
    schemaVersion: 1,
    month,
    // Callable encoding turns undefined object properties into null. Preserve the
    // JSON representation that was fingerprinted and approved before transport.
    report: JSON.parse(JSON.stringify(report)) as CudyrReportDataset,
    sourceVersion,
  });
  signal?.throwIfAborted();
  if (!receipt.persisted) throw new Error('No se pudo guardar el informe oficial.');
  return (await decodeOfficialCudyrReport({ ...receipt, state: 'ready' }))!;
};
