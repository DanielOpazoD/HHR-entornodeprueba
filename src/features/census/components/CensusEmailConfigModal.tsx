import React, { useMemo } from 'react';
import { Mail } from 'lucide-react';
import { buildCensusEmailBody } from '@/constants/email';
import { BaseModal } from '@/components/shared/BaseModal';
import { useCensusEmailRecipientsEditor } from '@/features/census/hooks/useCensusEmailRecipientsEditor';
import { CensusEmailRecipientsSection } from '@/features/census/components/email-config/CensusEmailRecipientsSection';
import { CensusEmailMessageSection } from '@/features/census/components/email-config/CensusEmailMessageSection';
import { CensusEmailTestModeSection } from '@/features/census/components/email-config/CensusEmailTestModeSection';
import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  recipients: string[];
  onRecipientsChange: (recipients: string[]) => void;
  recipientLists: GlobalEmailRecipientList[];
  activeRecipientListId: string;
  onActiveRecipientListChange: (listId: string) => void;
  onCreateRecipientList: (name: string) => Promise<void>;
  onRenameRecipientList: (name: string) => Promise<void>;
  onDeleteRecipientList: (listId: string) => Promise<void>;
  recipientsSource: 'firebase' | 'local' | 'default';
  isRecipientsSyncing: boolean;
  recipientsSyncError: string | null;
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
  recipientLists,
  activeRecipientListId,
  onActiveRecipientListChange,
  onCreateRecipientList,
  onRenameRecipientList,
  onDeleteRecipientList,
  recipientsSource,
  isRecipientsSyncing,
  recipientsSyncError,
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
          <span className="block text-lg font-bold text-slate-800">Envío de Correo</span>
          <p className="text-xs text-slate-500 font-medium">
            Personaliza destinatarios y el mensaje antes de enviar el censo.
          </p>
        </div>
      }
      icon={<Mail size={20} />}
      size="5xl"
      headerIconColor="text-blue-600"
      scrollableBody={false}
      bodyClassName="p-4 space-y-3"
      className="max-w-[88vw]"
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-3">
          <div className="space-y-3">
            <CensusEmailRecipientsSection
              safeRecipients={safeRecipients}
              visibleRecipients={visibleRecipients}
              hiddenRecipientsCount={hiddenRecipientsCount}
              maxVisibleRecipients={maxVisibleRecipients}
              showAllRecipients={showAllRecipients}
              showBulkEditor={showBulkEditor}
              recipientLists={recipientLists}
              activeRecipientListId={activeRecipientListId}
              onActiveRecipientListChange={onActiveRecipientListChange}
              onCreateRecipientList={onCreateRecipientList}
              onRenameRecipientList={onRenameRecipientList}
              onDeleteRecipientList={onDeleteRecipientList}
              recipientsSource={recipientsSource}
              isRecipientsSyncing={isRecipientsSyncing}
              recipientsSyncError={recipientsSyncError}
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

        <div className="flex justify-end border-t border-slate-100 pt-2">
          <button
            onClick={onClose}
            className="px-5 py-1.5 rounded-xl bg-slate-900 text-white text-[11px] font-bold hover:bg-black transition-all active:scale-95 shadow-md shadow-slate-200"
          >
            Confirmar y Cerrar
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
