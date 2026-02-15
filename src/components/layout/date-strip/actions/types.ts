export type EmailStatus = 'idle' | 'loading' | 'success' | 'error';

export interface ActionButtonsProps {
  onExportPDF?: () => void;
  onExportExcel?: () => void;
  onBackupExcel?: () => Promise<void>;
  isArchived?: boolean;
  onSendEmail?: () => void;
  onGenerateShareLink?: () => void;
  onCopyShareLink?: () => void;
  onConfigureEmail?: () => void;
  emailStatus?: EmailStatus;
  emailErrorMessage?: string | null;
}

export interface SaveDropdownProps {
  onExportExcel?: () => void;
  onBackupExcel?: () => Promise<void>;
  isArchived?: boolean;
  isBackingUp: boolean;
}

export interface HandoffSaveDropdownProps {
  onExportPDF?: () => void;
  onBackupPDF?: (skipConfirmation?: boolean) => Promise<void>;
  isArchived?: boolean;
  isBackingUp: boolean;
}

export interface EmailDropdownProps {
  onSendEmail?: () => void;
  onCopyShareLink?: () => void;
  onConfigureEmail?: () => void;
  emailStatus?: EmailStatus;
  emailErrorMessage?: string | null;
}
