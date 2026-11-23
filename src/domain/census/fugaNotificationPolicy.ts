import { removeAccents } from '@/utils/stringUtils';

export interface FugaNotificationPolicyInput {
  specialty?: string;
  manualRecipientsInput?: string;
  recipients?: string[];
  testMode?: boolean;
  testRecipient?: string;
  psychiatryRecipients?: string[];
}

export interface ResolvedFugaRecipients {
  mode: 'automatic' | 'manual' | 'test';
  recipients: string[];
  usesAutomaticPsychiatryRecipients: boolean;
  displayLabel: string;
}

export interface FugaNotificationValidationResult {
  isValid: boolean;
  error?: string;
  hasInvalidEmails: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeText = (value?: string): string =>
  removeAccents(String(value || ''))
    .trim()
    .toLowerCase();

export const isPsychiatrySpecialty = (value?: string): boolean => {
  const normalized = normalizeText(value);
  return normalized === 'psiquiatria' || normalized.includes('psiquiatr');
};

export const normalizeRecipientList = (input?: string | string[]): string[] => {
  if (Array.isArray(input)) {
    return input.map(value => value.trim().toLowerCase()).filter(Boolean);
  }

  return String(input || '')
    .split(/[;,\n\s]+/)
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
};

export const parseFugaRecipientConfig = (value?: string): string[] => normalizeRecipientList(value);

export const buildDefaultFugaAutomaticMessage = (input: {
  patientName: string;
  rut: string;
  time: string;
  bedName: string;
  diagnosis: string;
  specialty: string;
  recordDateLabel: string;
}): string =>
  [
    'Estimad@s,',
    '',
    `Se informa fuga del siguiente paciente ${input.patientName} (RUT: ${input.rut}) a las ${input.time}.`,
    '',
    `Cama: ${input.bedName}`,
    `Diagnóstico: ${input.diagnosis}`,
    `Especialidad: ${input.specialty || 'No especificada'}`,
    `Fecha de egreso: ${input.recordDateLabel}`,
    '',
    'Este reporte es automático desde el sistema de censo diario.',
  ].join('\n');

export const buildFugaNotificationBody = (input: {
  automaticMessage: string;
  nursesSignature?: string;
  note?: string;
}): string => {
  const automaticBlock = input.automaticMessage.trim();
  const trimmedNote = input.note?.trim();
  const trimmedNursesSignature = input.nursesSignature?.trim();

  const signatureBlock = [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    trimmedNursesSignature || '',
    'Enfermería - Servicio Hospitalizados',
    'Hospital Hanga Roa',
    'Anexo MINSAL 328388',
  ]
    .filter(Boolean)
    .join('\n');

  if (!trimmedNote) {
    return `${automaticBlock}\n\n${signatureBlock}`;
  }

  return `${automaticBlock}\n\nNota complementaria (ingresada por enfermería):\n${trimmedNote}\n\n${signatureBlock}`;
};

export const resolveFugaRecipients = (
  input: FugaNotificationPolicyInput
): ResolvedFugaRecipients => {
  const normalizedTestRecipient = normalizeRecipientList(input.testRecipient)[0];
  if (input.testMode) {
    const recipients = normalizedTestRecipient ? [normalizedTestRecipient] : [];
    return {
      mode: 'test',
      recipients,
      usesAutomaticPsychiatryRecipients: false,
      displayLabel: recipients[0] || 'correo de prueba',
    };
  }

  if (isPsychiatrySpecialty(input.specialty)) {
    const recipients = normalizeRecipientList(input.psychiatryRecipients);
    return {
      mode: 'automatic',
      recipients,
      usesAutomaticPsychiatryRecipients: true,
      displayLabel: 'destinatarios automáticos de Psiquiatría',
    };
  }

  const recipients = normalizeRecipientList(input.recipients || input.manualRecipientsInput);
  return {
    mode: 'manual',
    recipients,
    usesAutomaticPsychiatryRecipients: false,
    displayLabel: recipients.join(', '),
  };
};

interface ValidateFugaNotificationRequestInput {
  automaticMessage: string;
  resolvedRecipients: ResolvedFugaRecipients;
  requireAutomaticRecipients?: boolean;
}

export const validateFugaNotificationRequest = ({
  automaticMessage,
  resolvedRecipients,
  requireAutomaticRecipients = false,
}: ValidateFugaNotificationRequestInput): FugaNotificationValidationResult => {
  if (!automaticMessage.trim()) {
    return {
      isValid: false,
      error: 'El mensaje automático es obligatorio.',
      hasInvalidEmails: false,
    };
  }

  if (resolvedRecipients.mode === 'automatic') {
    if (!requireAutomaticRecipients) {
      return {
        isValid: true,
        hasInvalidEmails: false,
      };
    }

    if (resolvedRecipients.recipients.length === 0) {
      return {
        isValid: false,
        error: 'No hay destinatarios automáticos configurados para Psiquiatría.',
        hasInvalidEmails: false,
      };
    }
  }

  if (resolvedRecipients.recipients.length === 0) {
    return {
      isValid: false,
      error:
        resolvedRecipients.mode === 'test'
          ? 'Debes ingresar un correo de prueba válido.'
          : 'Debes ingresar al menos un correo destinatario para enviar la notificación.',
      hasInvalidEmails: false,
    };
  }

  const hasInvalidEmails = resolvedRecipients.recipients.some(email => !EMAIL_REGEX.test(email));

  if (hasInvalidEmails) {
    return {
      isValid: false,
      error: 'Uno o más correos ingresados no son válidos.',
      hasInvalidEmails: true,
    };
  }

  return {
    isValid: true,
    hasInvalidEmails: false,
  };
};
