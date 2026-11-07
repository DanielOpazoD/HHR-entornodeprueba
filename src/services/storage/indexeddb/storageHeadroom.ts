import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

/**
 * Chrome sizes a site's storage quota from the disk's free space: 10.7 GB with 52 GB free on the
 * owner's Mac. On 2026-11-07 that disk was full and IndexedDB kept closing, which looked like a
 * sync fault. Below this quota the disk is close to full and local saves are at risk.
 */
export const STORAGE_QUOTA_LOW_MB = 1024;
const RECHECK_AFTER_MS = 10 * 60 * 1000;

let lastCheckAt: number | undefined;
const toMb = (bytes = 0) => Math.round(bytes / 1_048_576);

/**
 * Reports `storage_headroom_low` when this device's browser storage is close to full. Runs at
 * startup and after IndexedDB trouble, at most once every ten minutes. Measurement only: it never
 * throws and never warns the person.
 */
export const checkStorageHeadroom = async (now = Date.now()): Promise<void> => {
  if (lastCheckAt !== undefined && now - lastCheckAt < RECHECK_AFTER_MS) return;
  lastCheckAt = now;
  try {
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    if (!estimate?.quota) return;
    const storageQuotaMb = toMb(estimate.quota);
    if (storageQuotaMb >= STORAGE_QUOTA_LOW_MB) return;
    recordOperationalTelemetry({
      category: 'indexeddb',
      status: 'degraded',
      runtimeState: 'degraded',
      operation: 'storage_headroom_low',
      issues: ['Queda poco espacio en el disco de este equipo.'],
      context: { storageQuotaMb, storageUsedMb: toMb(estimate.usage) },
    });
  } catch {
    // Measurement only.
  }
};

export const resetStorageHeadroomCheckForTests = (): void => {
  lastCheckAt = undefined;
};
