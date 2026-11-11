import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { useDailyRecordStaff } from '@/context/DailyRecordContext';
import { useUI } from '@/context/UIContext';
import { resolveShiftNurseSignature } from '@/services/staff/dailyRecordStaffing';
import { sendFugaNotification } from '@/services/integrations/fugaNotificationService';
import {
  buildDefaultFugaAutomaticMessage,
  resolveFugaRecipients,
  validateFugaNotificationRequest,
} from '@/features/census/controllers/fugaNotificationPolicyController';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import type { DischargeData } from '@/types/domain/movements';

interface UseFugaNotificationModalModelParams {
  isOpen: boolean;
  onClose: () => void;
  dischargeItem: DischargeData;
  recordDate: string;
}

export const useFugaNotificationModalModel = ({
  isOpen,
  onClose,
  dischargeItem,
  recordDate,
}: UseFugaNotificationModalModelParams) => {
  const { role } = useAuth();
  const staffRecord = useDailyRecordStaff();
  const { confirm } = useUI();
  const nursesSignature = useMemo(
    () => resolveShiftNurseSignature(staffRecord || undefined, 'night'),
    [staffRecord]
  );
  const specialty = String(dischargeItem.specialty || '');
  const isAdminUser = role === 'admin';
  const [manualRecipients, setManualRecipients] = useState('');
  const [testMode, setTestMode] = useState(false);
  const [testRecipient, setTestRecipient] = useState('');
  const [note, setNote] = useState('');
  const [automaticMessage, setAutomaticMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setAutomaticMessage(
      buildDefaultFugaAutomaticMessage({
        patientName: dischargeItem.patientName,
        rut: dischargeItem.rut,
        diagnosis: dischargeItem.diagnosis,
        bedName: dischargeItem.bedName,
        specialty,
        recordDateLabel: formatDateDDMMYYYY(dischargeItem.movementDate || recordDate),
        time: dischargeItem.time,
      })
    );
    setManualRecipients('');
    setTestMode(false);
    setTestRecipient('');
    setNote('');
    setError(null);
  }, [dischargeItem, isOpen, recordDate, specialty]);

  const resolvedRecipients = useMemo(
    () =>
      resolveFugaRecipients({
        specialty,
        manualRecipientsInput: manualRecipients,
        testMode: isAdminUser ? testMode : false,
        testRecipient,
      }),
    [isAdminUser, manualRecipients, specialty, testMode, testRecipient]
  );

  const validation = useMemo(
    () =>
      validateFugaNotificationRequest({
        automaticMessage,
        resolvedRecipients,
        requireAutomaticRecipients: false,
      }),
    [automaticMessage, resolvedRecipients]
  );

  const handleSend = async () => {
    setError(null);

    if (!validation.isValid) {
      setError(validation.error || 'No se pudo validar la notificación.');
      return;
    }

    const isConfirmed = await confirm({
      title: 'Confirmar envío de fuga',
      message: `Se enviará la notificación a: ${resolvedRecipients.displayLabel}${resolvedRecipients.mode === 'test' ? ' (modo prueba)' : ''}.`,
      confirmText: 'Enviar',
      cancelText: 'Cancelar',
      variant: 'info',
    });

    if (!isConfirmed) {
      return;
    }

    setIsSending(true);

    try {
      await sendFugaNotification({
        patientName: dischargeItem.patientName,
        rut: dischargeItem.rut,
        diagnosis: dischargeItem.diagnosis,
        bedName: dischargeItem.bedName,
        specialty,
        recordDate: dischargeItem.movementDate || recordDate,
        time: dischargeItem.time,
        nursesSignature,
        automaticMessage: automaticMessage.trim(),
        note: note.trim() || undefined,
        recipients:
          resolvedRecipients.mode === 'automatic' ? undefined : resolvedRecipients.recipients,
        testMode: resolvedRecipients.mode === 'test',
        testRecipient:
          resolvedRecipients.mode === 'test' ? resolvedRecipients.recipients[0] : undefined,
      });

      onClose();
      setManualRecipients('');
      setNote('');
      setTestMode(false);
      setTestRecipient('');
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'No se pudo enviar el correo.'
      );
    } finally {
      setIsSending(false);
    }
  };

  return {
    isAdminUser,
    specialty,
    manualRecipients,
    testMode,
    testRecipient,
    note,
    automaticMessage,
    isSending,
    error,
    resolvedRecipients,
    isPsychiatry: resolvedRecipients.usesAutomaticPsychiatryRecipients,
    hasInvalidEmails: validation.hasInvalidEmails,
    setManualRecipients,
    setTestMode,
    setTestRecipient,
    setNote,
    setAutomaticMessage,
    handleSend,
  };
};
