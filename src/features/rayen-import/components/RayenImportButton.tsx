import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useRayenImport } from '../hooks/useRayenImport';
import { requestRayenSnapshot } from '../bridge/rayenImportBridge';
import { RayenImportPreviewModal } from './RayenImportPreviewModal';

/**
 * "Importar desde Rayen" trigger for the census toolbar.
 *
 * Clicking asks the extension for a fresh snapshot; when it arrives, the hook either
 * opens the preview (default) or applies automatically (experimental mode). Renders the
 * preview modal and a short result note.
 */
export const RayenImportButton: React.FC = () => {
  const { mode, diff, isPreviewOpen, isBusy, result, error, confirm, cancel } = useRayenImport();

  return (
    <>
      <button
        type="button"
        onClick={requestRayenSnapshot}
        disabled={isBusy}
        title={
          mode === 'auto'
            ? 'Importar desde Rayen (modo automático experimental)'
            : 'Importar censo desde Rayen (con revisión)'
        }
        data-module="rayen-import"
        data-testid="rayen-import-button"
        className="inline-flex items-center gap-2 rounded-lg border border-teal-600 px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
      >
        <RefreshCw size={16} className={isBusy ? 'animate-spin' : ''} />
        Importar desde Rayen
        {mode === 'auto' && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700">
            Auto
          </span>
        )}
      </button>

      <RayenImportPreviewModal
        isOpen={isPreviewOpen}
        diff={diff}
        isBusy={isBusy}
        error={error}
        onConfirm={confirm}
        onCancel={cancel}
      />

      {result && !isPreviewOpen && (
        <span className="ml-2 text-xs text-gray-500" data-testid="rayen-import-result">
          Importado: {result.applied.admissions} ingresos, {result.applied.updates} act.,{' '}
          {result.applied.moves} mov., {result.applied.discharges} egresos
          {result.skipped.length > 0 && ` · ${result.skipped.length} omitidos`}
        </span>
      )}
    </>
  );
};
