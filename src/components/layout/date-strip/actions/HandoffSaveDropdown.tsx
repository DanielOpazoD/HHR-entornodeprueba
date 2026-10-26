import React from 'react';
import { FileDown, Loader2, Plus, Save, CheckCircle } from 'lucide-react';
import clsx from 'clsx';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';
import { resolveSaveButtonUiState } from './dateStripActionStateController';
import { DateStripDropdownPanel } from './DateStripDropdownPanel';
import { DateStripActionItem } from './DateStripActionItem';
import type { HandoffSaveDropdownProps } from './types';

export const HandoffSaveDropdown: React.FC<HandoffSaveDropdownProps> = ({
  onExportPDF,
  onPrintWithBrowserOptions,
  onBackupPDF,
  isArchived = false,
  isBackingUp,
  showFirebaseBackupOption = true,
}) => {
  const { isOpen, menuRef, toggle, close } = useDropdownMenu({
    closeOnOutsideClick: false,
    closeOnEscape: false,
  });
  const panelId = React.useId();

  const handleAction = async (action: 'pdf' | 'print-options' | 'backup') => {
    close();

    if (action === 'pdf') {
      await onExportPDF?.();
      await onBackupPDF?.(true);
      return;
    }

    if (action === 'print-options') {
      await onPrintWithBrowserOptions?.();
      return;
    }

    await onBackupPDF?.(false);
  };

  if (!onExportPDF && !onPrintWithBrowserOptions && !onBackupPDF) {
    return null;
  }

  const uiState = resolveSaveButtonUiState({
    isArchived,
    isBackingUp,
    variant: 'handoff',
  });

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={toggle}
        disabled={isBackingUp}
        className={clsx(
          'hhr-toolbar-control btn !px-2 !py-0 flex items-center justify-center transition-all',
          uiState.buttonClassName,
          uiState.widthClassName
        )}
        title="Opciones de guardado (PDF/Nube)"
        aria-label={uiState.label}
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        data-save-status={isBackingUp ? 'loading' : isArchived ? 'archived' : 'idle'}
      >
        {uiState.iconKind === 'loading' && (
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        )}
        {uiState.iconKind === 'archived' && <CheckCircle size={14} aria-hidden="true" />}
        {uiState.iconKind === 'default' && <Save size={14} aria-hidden="true" />}
      </button>

      {isOpen && (
        <DateStripDropdownPanel
          id={panelId}
          anchorRef={menuRef}
          onClose={close}
          title="Opciones de guardado"
          widthClassName="w-60"
          headerAction={
            onPrintWithBrowserOptions ? (
              <button
                type="button"
                onClick={() => void handleAction('print-options')}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-sky-100 bg-sky-50 text-sky-700 transition-colors hover:bg-sky-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600"
                title="Imprimir con opciones: escala, margenes y papel"
                aria-label="Imprimir con opciones de Chrome"
              >
                <Plus size={12} strokeWidth={2.4} aria-hidden="true" />
              </button>
            ) : undefined
          }
        >
          <DateStripActionItem
            onClick={() => void handleAction('pdf')}
            icon={FileDown}
            title="Descargar PDF"
            subtitle="Exportacion local"
            colorClassName="bg-emerald-50 text-emerald-600"
            iconHoverColorClassName="group-hover:bg-emerald-100"
          />

          {showFirebaseBackupOption && (
            <DateStripActionItem
              onClick={() => void handleAction('backup')}
              icon={Save}
              title="Respaldo en Firebase"
              subtitle="Respaldo seguro en Firebase"
              colorClassName="bg-amber-50 text-amber-600"
              iconHoverColorClassName="group-hover:bg-amber-100"
            />
          )}
        </DateStripDropdownPanel>
      )}
    </div>
  );
};
