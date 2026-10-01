import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type { SyncStatus } from '@/context/dailyRecordContextContracts';

type ExportBlockReason = 'saving' | 'save_failed' | 'date_changed' | 'no_record';
export type ExportReadiness =
  | { status: 'ready'; check: () => ExportBlockReason | null }
  | { status: 'blocked'; reason: ExportBlockReason };

interface ExportState {
  selectedDate: string;
  recordDate?: string;
  syncStatus: SyncStatus;
}

const getBlockReason = (expectedDate: string, state: ExportState): ExportBlockReason | null => {
  if (
    state.selectedDate !== expectedDate ||
    (state.recordDate && state.recordDate !== expectedDate)
  ) {
    return 'date_changed';
  }
  if (state.syncStatus === 'error') return 'save_failed';
  return state.syncStatus === 'saving' ? 'saving' : null;
};

// UI mutation completion permits a local copy; it does not certify remote persistence.
export const waitForExportReadiness = async ({
  expectedDate,
  readState,
  now,
  wait,
}: {
  expectedDate: string;
  readState: () => ExportState;
  now: () => number;
  wait: (ms: number) => Promise<unknown>;
}): Promise<ExportReadiness> => {
  const startedAt = now();
  let observedSaving = false;
  const check = () => getBlockReason(expectedDate, readState());
  while (now() - startedAt < 2500) {
    const reason = check();
    if (reason && reason !== 'saving') return { status: 'blocked', reason };
    if (reason === 'saving') observedSaving = true;
    else if (observedSaving || now() - startedAt > 150) return { status: 'ready', check };
    await wait(50);
  }
  return { status: 'blocked', reason: check() ?? 'saving' };
};

const blockMessages: Record<ExportBlockReason, string> = {
  saving: 'El censo sigue guardándose. Espera a que termine y vuelve a intentar.',
  save_failed: 'El último guardado falló. Revisa el censo antes de exportar o respaldar.',
  date_changed:
    'Cambió el día del censo. Vuelve a iniciar la acción en el día que quieres exportar.',
  no_record:
    'No hay un censo disponible para este día. Revisa el día antes de exportar o respaldar.',
};

export const prepareRecordExport = async ({
  expectedDate,
  flushBeforeExport,
  readRecord,
  readDate,
  warning,
  allowEmptyRecord = false,
}: {
  expectedDate: string;
  flushBeforeExport?: () => Promise<ExportReadiness>;
  readRecord: () => DailyRecord | null;
  readDate?: () => string;
  warning: (title: string, message: string) => void;
  // A monthly workbook reads a date range, including earlier days when today is empty.
  allowEmptyRecord?: boolean;
}) => {
  const block = (reason: ExportBlockReason) => {
    warning('No se inició la exportación', blockMessages[reason]);
    return false as const;
  };
  let readiness: ExportReadiness;
  try {
    readiness = (await flushBeforeExport?.()) ?? { status: 'ready', check: () => null };
  } catch {
    block('save_failed');
    return null;
  }
  if (readiness.status === 'blocked') {
    block(readiness.reason);
    return null;
  }
  const record = readRecord();
  const check = () =>
    readDate && readDate() !== expectedDate ? ('date_changed' as const) : readiness.check();
  const reason = check();
  if (reason || (!record && !allowEmptyRecord) || (record && record.date !== expectedDate)) {
    block(reason ?? (record ? 'date_changed' : 'no_record'));
    return null;
  }
  return {
    record,
    canPrint: () => {
      const reason = check();
      const latestRecord = readRecord();
      if (reason || !latestRecord || latestRecord.date !== expectedDate) {
        return block(reason ?? 'date_changed');
      }
      return true;
    },
  };
};
