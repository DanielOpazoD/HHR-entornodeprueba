import type { UseUIStateReturn } from '@/hooks/useUIState';
import type { AppContentRuntime } from '@/components/layout/app-content/useAppContentRuntime';

interface BuildAppContentOverlayStateOptions {
  ui: UseUIStateReturn;
  runtime: AppContentRuntime;
  onOpenCensusDate?: (isoDate: string) => void;
}

export interface AppContentOverlayState {
  shouldRenderCensusEmailConfigModal: boolean;
  shouldRenderPatientSearchModal: boolean;
  shouldRenderTestAgent: boolean;
  censusEmailModalProps: {
    isOpen: true;
    onClose: () => void;
    recipients: AppContentRuntime['censusEmail']['recipients'];
    onRecipientsChange: AppContentRuntime['censusEmail']['setRecipients'];
    recipientLists: AppContentRuntime['censusEmail']['recipientLists'];
    activeRecipientListId: AppContentRuntime['censusEmail']['activeRecipientListId'];
    onActiveRecipientListChange: AppContentRuntime['censusEmail']['setActiveRecipientListId'];
    onCreateRecipientList: AppContentRuntime['censusEmail']['createRecipientList'];
    onRenameRecipientList: AppContentRuntime['censusEmail']['renameActiveRecipientList'];
    onDeleteRecipientList: AppContentRuntime['censusEmail']['deleteRecipientList'];
    recipientsSource: AppContentRuntime['censusEmail']['recipientsSource'];
    isRecipientsSyncing: AppContentRuntime['censusEmail']['isRecipientsSyncing'];
    recipientsSyncError: AppContentRuntime['censusEmail']['recipientsSyncError'];
    message: AppContentRuntime['censusEmail']['message'];
    onMessageChange: AppContentRuntime['censusEmail']['onMessageChange'];
    onResetMessage: AppContentRuntime['censusEmail']['onResetMessage'];
    date: string;
    nursesSignature: string;
    isAdminUser: AppContentRuntime['censusEmail']['isAdminUser'];
    testModeEnabled: AppContentRuntime['censusEmail']['testModeEnabled'];
    onTestModeChange: AppContentRuntime['censusEmail']['setTestModeEnabled'];
    testRecipient: AppContentRuntime['censusEmail']['testRecipient'];
    onTestRecipientChange: AppContentRuntime['censusEmail']['setTestRecipient'];
  };
  testAgentProps: {
    isRunning: boolean;
    onComplete: () => void;
    currentRecord: AppContentRuntime['record'];
  };
  patientSearchModalProps: {
    isOpen: boolean;
    onClose: () => void;
    onNavigateToDate?: (isoDate: string) => void;
  };
}

export const buildAppContentOverlayState = ({
  ui,
  runtime,
  onOpenCensusDate,
}: BuildAppContentOverlayStateOptions): AppContentOverlayState => {
  const {
    censusEmail,
    dateNav: { currentDateString },
    nurseSignature,
    record,
  } = runtime;

  return {
    shouldRenderCensusEmailConfigModal: censusEmail.showEmailConfig,
    shouldRenderPatientSearchModal: ui.patientSearchModal.isOpen,
    shouldRenderTestAgent: ui.isTestAgentRunning,
    censusEmailModalProps: {
      isOpen: true,
      onClose: () => censusEmail.setShowEmailConfig(false),
      recipients: censusEmail.recipients,
      onRecipientsChange: censusEmail.setRecipients,
      recipientLists: censusEmail.recipientLists,
      activeRecipientListId: censusEmail.activeRecipientListId,
      onActiveRecipientListChange: censusEmail.setActiveRecipientListId,
      onCreateRecipientList: censusEmail.createRecipientList,
      onRenameRecipientList: censusEmail.renameActiveRecipientList,
      onDeleteRecipientList: censusEmail.deleteRecipientList,
      recipientsSource: censusEmail.recipientsSource,
      isRecipientsSyncing: censusEmail.isRecipientsSyncing,
      recipientsSyncError: censusEmail.recipientsSyncError,
      message: censusEmail.message,
      onMessageChange: censusEmail.onMessageChange,
      onResetMessage: censusEmail.onResetMessage,
      date: currentDateString,
      nursesSignature: nurseSignature,
      isAdminUser: censusEmail.isAdminUser,
      testModeEnabled: censusEmail.testModeEnabled,
      onTestModeChange: censusEmail.setTestModeEnabled,
      testRecipient: censusEmail.testRecipient,
      onTestRecipientChange: censusEmail.setTestRecipient,
    },
    testAgentProps: {
      isRunning: ui.isTestAgentRunning,
      onComplete: () => ui.setIsTestAgentRunning(false),
      currentRecord: record,
    },
    patientSearchModalProps: {
      isOpen: ui.patientSearchModal.isOpen,
      onClose: ui.patientSearchModal.close,
      onNavigateToDate: onOpenCensusDate,
    },
  };
};
