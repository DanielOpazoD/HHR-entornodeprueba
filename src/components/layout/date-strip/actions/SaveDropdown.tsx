import { SaveButton } from '../DateStripButtonControls';
import React from 'react';
import { FileSpreadsheet, Save } from 'lucide-react';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';
import { DateStripDropdownPanel } from './DateStripDropdownPanel';
import { DateStripActionItem } from './DateStripActionItem';
import type { SaveDropdownProps } from './types';

export const SaveDropdown: React.FC<SaveDropdownProps> = ({
  onExportExcel,
  onBackupExcel,
  isArchived = false,
  isBackingUp,
  showFirebaseBackupOption = true,
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

  return (
    <div className="relative" ref={menuRef}>
      <SaveButton onClick={toggle} isBackingUp={isBackingUp} isArchived={isArchived} />

      {isOpen && (
        <DateStripDropdownPanel title="Opciones de Guardado" widthClassName="w-52">
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

          <DateStripActionItem
            onClick={() => void handleAction('excel')}
            icon={FileSpreadsheet}
            title="Descargar Excel"
            subtitle="Exportación local inmediata"
            colorClassName="bg-green-50 text-green-600"
            iconHoverColorClassName="group-hover:bg-green-100"
          />
        </DateStripDropdownPanel>
      )}
    </div>
  );
};
