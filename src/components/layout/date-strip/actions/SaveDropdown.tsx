import React from 'react';
import { FileSpreadsheet, ChevronDown, Loader2, Save, CheckCircle } from 'lucide-react';
import clsx from 'clsx';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';
import { resolveSaveButtonUiState } from './dateStripActionStateController';
import { DateStripDropdownPanel } from './DateStripDropdownPanel';
import { DateStripActionItem } from './DateStripActionItem';
import type { SaveDropdownProps } from './types';

export const SaveDropdown: React.FC<SaveDropdownProps> = ({
  onExportExcel,
  onBackupExcel,
  isArchived = false,
  isBackingUp,
}) => {
  const { isOpen, menuRef, toggle, close } = useDropdownMenu();

  const handleAction = async (action: 'excel' | 'backup') => {
    close();
    if (action === 'excel') {
      onExportExcel?.();
      return;
    }

    await onBackupExcel?.();
  };

  if (!onExportExcel && !onBackupExcel) {
    return null;
  }

  const uiState = resolveSaveButtonUiState({
    isArchived,
    isBackingUp,
    variant: 'census',
  });

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={toggle}
        disabled={isBackingUp}
        className={clsx(
          'btn !px-3 !py-1.5 text-[10px] flex items-center gap-1.5 transition-all',
          uiState.buttonClassName
        )}
        title="Opciones de guardado"
      >
        {uiState.iconKind === 'loading' && <Loader2 size={14} className="animate-spin" />}
        {uiState.iconKind === 'archived' && <CheckCircle size={14} />}
        {uiState.iconKind === 'default' && <Save size={14} />}
        <span className="font-bold">{uiState.label}</span>
        <ChevronDown size={14} className={clsx('transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <DateStripDropdownPanel title="Opciones de Guardado" widthClassName="w-52">
          <DateStripActionItem
            onClick={() => void handleAction('backup')}
            icon={Save}
            title="Respaldo en Firebase"
            subtitle="Respaldo seguro en Firebase"
            colorClassName="bg-amber-50 text-amber-600"
            iconHoverColorClassName="group-hover:bg-amber-100"
          />

          <DateStripActionItem
            onClick={() => void handleAction('excel')}
            icon={FileSpreadsheet}
            title="Descargar Local"
            subtitle="Exportar planilla Excel"
            colorClassName="bg-green-50 text-green-600"
            iconHoverColorClassName="group-hover:bg-green-100"
          />
        </DateStripDropdownPanel>
      )}
    </div>
  );
};
