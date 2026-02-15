import React, { useMemo } from 'react';
import { Mail } from 'lucide-react';
import { buildCensusEmailBody } from '@/constants/email';
import { BaseModal } from '@/components/shared/BaseModal';
import { useCensusEmailRecipientsEditor } from '@/features/census/hooks/useCensusEmailRecipientsEditor';
import {
  CensusEmailMessageSection,
  CensusEmailRecipientsSection,
  CensusEmailTestModeSection,
} from '@/features/census/components/email-config';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  recipients: string[];
  onRecipientsChange: (recipients: string[]) => void;
  message: string;
  onMessageChange: (message: string) => void;
  onResetMessage?: () => void;
  date: string;
  nursesSignature?: string;
  isAdminUser: boolean;
  testModeEnabled: boolean;
  onTestModeChange: (enabled: boolean) => void;
  testRecipient: string;
  onTestRecipientChange: (value: string) => void;
}

export const CensusEmailConfigModal: React.FC<Props> = ({
  isOpen,
  onClose,
  recipients,
  onRecipientsChange,
  message,
  onMessageChange,
  onResetMessage,
  date,
  nursesSignature,
  isAdminUser,
  testModeEnabled,
  onTestModeChange,
  testRecipient,
  onTestRecipientChange,
}) => {
  const {
    safeRecipients,
    visibleRecipients,
    hiddenRecipientsCount,
    maxVisibleRecipients,
    newRecipient,
    error,
    showBulkEditor,
    bulkRecipients,
    editingIndex,
    editingValue,
    showAllRecipients,
    setNewRecipient,
    setBulkRecipients,
    setEditingValue,
    addRecipient,
    toggleBulkEditor,
    saveBulkRecipients,
    cancelBulkEdit,
    startEditRecipient,
    saveEditedRecipient,
    cancelEditRecipient,
    removeRecipient,
    toggleShowAllRecipients,
  } = useCensusEmailRecipientsEditor({
    isOpen,
    recipients,
    onRecipientsChange,
  });

  const defaultMessage = useMemo(
    () => buildCensusEmailBody(date, nursesSignature),
    [date, nursesSignature]
  );

  const handleResetMessage = () => {
    if (onResetMessage) {
      onResetMessage();
      return;
    }

    onMessageChange(defaultMessage);
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div>
          <h2 className="text-lg font-bold text-slate-800">Envío de Correo</h2>
          <p className="text-xs text-slate-500 font-medium">
            Personaliza destinatarios y el mensaje antes de enviar el censo.
          </p>
        </div>
      }
      icon={<Mail size={20} />}
      size="full"
      headerIconColor="text-blue-600"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-4">
            <CensusEmailRecipientsSection
              safeRecipients={safeRecipients}
              visibleRecipients={visibleRecipients}
              hiddenRecipientsCount={hiddenRecipientsCount}
              maxVisibleRecipients={maxVisibleRecipients}
              showAllRecipients={showAllRecipients}
              showBulkEditor={showBulkEditor}
              bulkRecipients={bulkRecipients}
              newRecipient={newRecipient}
              editingIndex={editingIndex}
              editingValue={editingValue}
              error={error}
              onToggleShowAllRecipients={toggleShowAllRecipients}
              onToggleBulkEditor={toggleBulkEditor}
              onBulkRecipientsChange={setBulkRecipients}
              onBulkCancel={cancelBulkEdit}
              onBulkSave={saveBulkRecipients}
              onNewRecipientChange={setNewRecipient}
              onAddRecipient={addRecipient}
              onStartEditRecipient={startEditRecipient}
              onEditingValueChange={setEditingValue}
              onSaveEditedRecipient={saveEditedRecipient}
              onCancelEditRecipient={cancelEditRecipient}
              onRemoveRecipient={removeRecipient}
            />

            <CensusEmailTestModeSection
              isAdminUser={isAdminUser}
              testModeEnabled={testModeEnabled}
              onTestModeChange={onTestModeChange}
              testRecipient={testRecipient}
              onTestRecipientChange={onTestRecipientChange}
            />
          </div>

          <div className="flex flex-col h-full">
            <CensusEmailMessageSection
              message={message}
              onMessageChange={onMessageChange}
              onResetMessage={handleResetMessage}
            />
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-100 pt-3">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-black transition-all active:scale-95 shadow-md shadow-slate-200"
          >
            Confirmar y Cerrar
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
