import { useState, useEffect, useCallback } from 'react';
import { useConfirmDialog } from '@/context/UIContext';
import { DailyRecord } from '@/types';
import { buildCensusEmailBody, CENSUS_DEFAULT_RECIPIENTS } from '@/constants/email';
import {
  formatDate,
  getMonthRecordsFromFirestore,
  triggerCensusEmail,
  initializeDay,
  getAppSetting,
  saveAppSetting,
} from '@/services';
import { buildCensusMasterWorkbook } from '@/services/exporters/censusMasterWorkbook';
import { uploadCensus } from '@/services/backup/censusStorageService';
import { isAdmin } from '@/utils/permissions';
import { CensusAccessRole } from '@/types/censusAccess';

interface UseCensusEmailParams {
  record: DailyRecord | null;
  currentDateString: string;
  nurseSignature: string;
  selectedYear: number;
  selectedMonth: number;
  selectedDay: number;
  user: { uid?: string; email?: string | null; role?: string } | null;
  role: string;
}

export interface UseCensusEmailReturn {
  // Config modal state
  showEmailConfig: boolean;
  setShowEmailConfig: (show: boolean) => void;

  // Recipients
  recipients: string[];
  setRecipients: (recipients: string[]) => void;

  // Message
  message: string;
  onMessageChange: (value: string) => void;
  onResetMessage: () => void;

  // Send state
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;

  // Actions
  resetStatus: () => void;
  sendEmail: () => Promise<void>;
  sendEmailWithLink: (role?: CensusAccessRole) => Promise<void>;
  generateShareLink: (role?: CensusAccessRole) => Promise<string | null>;
  copyShareLink: (role?: CensusAccessRole) => Promise<void>;

  // Test mode
  testModeEnabled: boolean;
  setTestModeEnabled: (value: boolean) => void;
  testRecipient: string;
  setTestRecipient: (value: string) => void;
  isAdminUser: boolean;
}

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const normalizeEmail = (value: string) => value.trim().toLowerCase();

/**
 * Hook to manage census email configuration and sending.
 * Extracts email handling logic from App.tsx for cleaner separation of concerns.
 */
export const useCensusEmail = ({
  record,
  currentDateString,
  nurseSignature,
  selectedYear,
  selectedMonth,
  selectedDay,
  user,
  role,
}: UseCensusEmailParams): UseCensusEmailReturn => {
  const { confirm, alert } = useConfirmDialog();
  const isAdminUser = isAdmin(role);

  // ========== RECIPIENTS STATE ==========
  const [recipients, setRecipients] = useState<string[]>(CENSUS_DEFAULT_RECIPIENTS);

  // Load recipients from IndexedDB on mount
  useEffect(() => {
    const loadRecipients = async () => {
      const stored = await getAppSetting<string[] | null>('censusEmailRecipients', null);
      if (stored && Array.isArray(stored) && stored.length > 0) {
        setRecipients(stored);
      } else {
        // Fallback to legacy localStorage migration
        if (typeof localStorage !== 'undefined') {
          const legacy = localStorage.getItem('censusEmailRecipients');
          if (legacy) {
            try {
              const parsed = JSON.parse(legacy);
              if (Array.isArray(parsed) && parsed.length > 0) {
                setRecipients(parsed);
                await saveAppSetting('censusEmailRecipients', parsed);
                localStorage.removeItem('censusEmailRecipients');
              }
            } catch (_) { /* ignore */ }
          }
        }
      }
    };
    loadRecipients();
  }, []);

  // ========== MESSAGE STATE ==========
  // Message is always generated dynamically based on date and nurses
  // No localStorage persistence to ensure it always reflects current data
  const [message, setMessage] = useState<string>(() => {
    return buildCensusEmailBody(currentDateString, nurseSignature);
  });

  // Track if user has manually edited the message in this session
  const [messageEdited, setMessageEdited] = useState(false);

  // ========== TEST MODE (ADMIN) ==========
  const [testModeEnabled, setTestModeEnabled] = useState(false);
  const [testRecipient, setTestRecipient] = useState('');

  // ========== UI STATE ==========
  const [showEmailConfig, setShowEmailConfig] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Reset status when navigating between days to avoid locking the button for other dates
  useEffect(() => {
    setStatus('idle');
    setError(null);
  }, [currentDateString]);

  useEffect(() => {
    if (!isAdminUser) {
      setTestModeEnabled(false);
      setTestRecipient('');
    }
  }, [isAdminUser]);

  // ========== PERSISTENCE EFFECTS ==========
  useEffect(() => {
    saveAppSetting('censusEmailRecipients', recipients);
  }, [recipients]);

  // Auto-update message when date/signature changes (if not manually edited in this session)
  useEffect(() => {
    if (!messageEdited) {
      setMessage(buildCensusEmailBody(currentDateString, nurseSignature));
    }
  }, [currentDateString, nurseSignature, messageEdited]);

  // Reset messageEdited when date changes (so new date gets fresh message)
  useEffect(() => {
    setMessageEdited(false);
  }, [currentDateString]);

  // ========== HANDLERS ==========
  const onMessageChange = useCallback((value: string) => {
    setMessage(value);
    setMessageEdited(true);
  }, []);

  const onResetMessage = useCallback(() => {
    setMessage(buildCensusEmailBody(currentDateString, nurseSignature));
    setMessageEdited(false);
  }, [currentDateString, nurseSignature]);

  const resetStatus = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  const sendEmail = useCallback(async () => {
    if (!record) {
      alert('No hay datos del censo para enviar.');
      return;
    }

    if (status === 'loading' || status === 'success') return;

    const shouldUseTestMode = isAdminUser && testModeEnabled;

    let resolvedRecipients = recipients.filter(r => r.trim()).length > 0
      ? recipients.map(r => normalizeEmail(r)).filter(Boolean)
      : CENSUS_DEFAULT_RECIPIENTS;

    if (shouldUseTestMode) {
      const normalizedTestRecipient = normalizeEmail(testRecipient);
      if (!normalizedTestRecipient || !isValidEmail(normalizedTestRecipient)) {
        const errorMessage = 'Ingresa un correo de prueba válido para el modo prueba.';
        setError(errorMessage);
        alert(errorMessage, 'Modo prueba');
        return;
      }
      resolvedRecipients = [normalizedTestRecipient];
    }

    const confirmationText = [
      `Enviar correo de censo del ${formatDate(currentDateString)}?`,
      `Destinatarios: ${resolvedRecipients.join(', ')}`,
      shouldUseTestMode ? '(Modo prueba activo - solo se enviará al destinatario indicado)' : '',
      '',
      '¿Confirmas el envío?'
    ].filter(Boolean).join('\n');

    const confirmed = await confirm({
      title: 'Confirmar Envío de Censo',
      message: confirmationText,
      confirmText: 'Aceptar',
      cancelText: 'Cancelar',
      variant: 'info'
    });
    if (!confirmed) return;

    setError(null);
    setStatus('loading');

    try {
      // 1. Ensure all days of the month up to the selected day are initialized
      // This is CRITICAL to ensure the report is complete and carries over patients correctly
      const ensureAllDaysInitialized = async () => {
        const [year, month] = currentDateString.split('-').map(Number);
        const dayNum = parseInt(selectedDay.toString(), 10);

        // console.info(`[useCensusEmail] Starting month integrity check up to ${currentDateString}`);

        for (let d = 1; d <= dayNum; d++) {
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          // Check if day exists (either in provided month records or is the current one)
          // Note: we'll re-fetch below, but here we ensure they exist in DB
          try {
            await initializeDay(dateStr, d > 1 ? `${year}-${String(month).padStart(2, '0')}-${String(d - 1).padStart(2, '0')}` : undefined);
          } catch (e) {
            console.warn(`[useCensusEmail] Failed to initialize day ${dateStr}:`, e);
          }
        }
      };

      await ensureAllDaysInitialized();

      const finalMessage = message?.trim() ? message : buildCensusEmailBody(currentDateString, nurseSignature);
      const monthRecords = await getMonthRecordsFromFirestore(selectedYear, selectedMonth);
      const limitDate = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;

      const filteredRecords = monthRecords
        .filter(r => r.date <= limitDate)
        .sort((a, b) => a.date.localeCompare(b.date));

      if (!filteredRecords.some(r => r.date === currentDateString) && record) {
        filteredRecords.push(record);
      }

      if (filteredRecords.length === 0) {
        throw new Error('No hay registros del mes para generar el Excel maestro.');
      }

      filteredRecords.sort((a, b) => a.date.localeCompare(b.date));
      await triggerCensusEmail({
        date: currentDateString,
        records: filteredRecords,
        recipients: resolvedRecipients,
        nursesSignature: nurseSignature || undefined,
        body: finalMessage,
        userEmail: user?.email,
        userRole: user?.role || role
      });

      // 2. BACKUP TO STORAGE (Cloud Archive)
      try {
        // console.info(`[useCensusEmail] Starting cloud backup for ${currentDateString}...`);
        const workbook = await buildCensusMasterWorkbook(filteredRecords);
        const buffer = await workbook.xlsx.writeBuffer();
        const excelBlob = new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        await uploadCensus(excelBlob, currentDateString);
        // console.info(`[useCensusEmail] Cloud backup successful for ${currentDateString}`);
      } catch (backupErr) {
        console.error('[useCensusEmail] Cloud backup failed (but email was sent):', backupErr);
        // Don't fail the whole operation if backup fails, as long as email was sent
      }

      setStatus('success');
      // Button stays in 'success' state (disabled) for this date session
    } catch (err: unknown) {
      const error = err as { message?: string };
      console.error('Error enviando correo de censo', err);
      const errorMessage = error?.message || 'No se pudo enviar el correo.';
      setError(errorMessage);
      setStatus('error');
      alert(errorMessage, 'Error al enviar');
    }
  }, [
    record,
    status,
    recipients,
    currentDateString,
    message,
    nurseSignature,
    selectedYear,
    selectedMonth,
    selectedDay,
    user,
    role,
    testModeEnabled,
    testRecipient,
    isAdminUser,
    alert,
    confirm
  ]);

  const generateShareLink = useCallback(async (_accessRole: CensusAccessRole = 'viewer'): Promise<string | null> => {
    try {
      // Simple URL without Firestore dependency
      // Users will login with Google and be validated against local authorized emails list
      const baseUrl = window.location.origin;
      const shareUrl = `${baseUrl}/censo-compartido`;

      return shareUrl;
    } catch (err) {
      console.error('Error generating share link', err);
      alert('No se pudo generar el link de acceso.');
      return null;
    }
  }, [alert]);

  const sendEmailWithLink = useCallback(async (accessRole: CensusAccessRole = 'viewer') => {
    if (!record) {
      alert('No hay datos del censo para enviar.');
      return;
    }

    if (status === 'loading' || status === 'success') return;

    // 1. Ask for confirmation
    const confirmed = await confirm({
      title: 'Enviar Link de Acceso',
      message: `¿Estás seguro de enviar un link de acceso seguro a los destinatarios configurados?\n\nEsto permitirá a los usuarios visualizar el censo sin necesidad de archivos Excel.`,
      confirmText: 'Aceptar',
      cancelText: 'Cancelar',
      variant: 'info'
    });
    if (!confirmed) return;

    setStatus('loading');
    setError(null);

    try {
      // 2. Generate the link
      const shareLink = await generateShareLink(accessRole);
      if (!shareLink) throw new Error('No se pudo generar el link.');

      // 3. Trigger email with link
      const resolvedRecipients = recipients.filter(r => r.trim()).length > 0
        ? recipients.map(r => normalizeEmail(r)).filter(Boolean)
        : CENSUS_DEFAULT_RECIPIENTS;

      await triggerCensusEmail({
        date: currentDateString,
        records: [record], // Just metadata needed for the mail function usually
        recipients: resolvedRecipients,
        nursesSignature: nurseSignature || undefined,
        body: message,
        shareLink,
        userEmail: user?.email,
        userRole: user?.role || role
      });

      setStatus('success');
    } catch (err: unknown) {
      console.error('Error sending email with link', err);
      const errorMessage = (err as Error).message || 'Error al enviar link.';
      setError(errorMessage);
      setStatus('error');
      alert(errorMessage || 'No se pudo enviar el link de acceso.');
    }
  }, [
    record,
    status,
    generateShareLink,
    recipients,
    currentDateString,
    nurseSignature,
    message,
    user,
    role,
    alert,
    confirm
  ]);

  const copyShareLink = useCallback(async (accessRole: CensusAccessRole = 'viewer') => {
    const link = await generateShareLink(accessRole);
    if (link) {
      try {
        await navigator.clipboard.writeText(link);
        alert('Copiado al portapapeles: ' + link, 'Link Copiado');
      } catch (err) {
        console.error('Clipboard error', err);
        alert('No se pudo copiar el link. Intenta manualmente: ' + link);
      }
    }
  }, [generateShareLink, alert]);

  return {
    showEmailConfig,
    setShowEmailConfig,
    recipients,
    setRecipients,
    message,
    onMessageChange,
    onResetMessage,
    status,
    error,
    resetStatus,
    sendEmail,
    sendEmailWithLink,
    generateShareLink,
    copyShareLink,
    testModeEnabled,
    setTestModeEnabled,
    testRecipient,
    setTestRecipient,
    isAdminUser,
  };
};
