import {
  failWithCode,
  ok,
  type ControllerError,
  type ControllerResult,
} from '@/shared/contracts/controllerResult';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailRecipientsErrorCode =
  | 'EMPTY_EMAIL'
  | 'INVALID_EMAIL'
  | 'DUPLICATE_EMAIL'
  | 'EMPTY_RECIPIENTS'
  | 'INVALID_INDEX';

type EmailRecipientsError = ControllerError<EmailRecipientsErrorCode>;
type EmailRecipientsResult<TValue> = ControllerResult<
  TValue,
  EmailRecipientsErrorCode,
  EmailRecipientsError
>;

export const normalizeEmail = (value: string): string => value.trim().toLowerCase();

export const isValidEmail = (value: string): boolean => EMAIL_REGEX.test(value);

export const resolveSafeRecipients = (recipients: string[] | null | undefined): string[] => {
  if (!Array.isArray(recipients)) {
    return [];
  }

  return recipients
    .filter((recipient): recipient is string => typeof recipient === 'string')
    .map(normalizeEmail)
    .filter(Boolean);
};

export const resolveStoredRecipients = (value: unknown): string[] | null => {
  const recipients = resolveSafeRecipients(Array.isArray(value) ? value : null);
  return recipients.length > 0 ? recipients : null;
};

export const resolveLegacyRecipients = (value: string | null | undefined): string[] | null => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return resolveStoredRecipients(parsed);
  } catch {
    return null;
  }
};

interface ResolveSendingRecipientsParams {
  recipients: string[];
  shouldUseTestMode: boolean;
  testRecipient: string;
}

type ResolveSendingRecipientsResult =
  | { ok: true; recipients: string[] }
  | { ok: false; error: string };

export const resolveSendingRecipients = ({
  recipients,
  shouldUseTestMode,
  testRecipient,
}: ResolveSendingRecipientsParams): ResolveSendingRecipientsResult => {
  if (shouldUseTestMode) {
    const normalizedTestRecipient = normalizeEmail(testRecipient);
    if (!normalizedTestRecipient || !isValidEmail(normalizedTestRecipient)) {
      return { ok: false, error: 'Ingresa un correo válido para modo prueba.' };
    }

    return { ok: true, recipients: [normalizedTestRecipient] };
  }

  const normalizedRecipients = resolveSafeRecipients(recipients).filter(isValidEmail);
  if (normalizedRecipients.length === 0) {
    return { ok: false, error: 'Agrega al menos un destinatario válido.' };
  }

  return { ok: true, recipients: Array.from(new Set(normalizedRecipients)) };
};

interface ResolveAddRecipientParams {
  recipients: string[];
  input: string;
}

export const resolveAddRecipient = ({
  recipients,
  input,
}: ResolveAddRecipientParams): EmailRecipientsResult<{ recipients: string[] }> => {
  const normalized = normalizeEmail(input);

  if (!normalized) {
    return failWithCode('EMPTY_EMAIL', 'Ingresa un correo válido.');
  }

  if (!isValidEmail(normalized)) {
    return failWithCode('INVALID_EMAIL', 'Ingresa un correo válido.');
  }

  if (recipients.includes(normalized)) {
    return failWithCode('DUPLICATE_EMAIL', 'Ese destinatario ya está agregado.');
  }

  return ok({
    recipients: [...recipients, normalized],
  });
};

interface ResolveBulkRecipientsParams {
  rawInput: string;
}

export const resolveBulkRecipients = ({
  rawInput,
}: ResolveBulkRecipientsParams): EmailRecipientsResult<{ recipients: string[] }> => {
  const entries = rawInput
    .split(/[\n,]+/)
    .map(normalizeEmail)
    .filter(Boolean);

  const uniqueRecipients = Array.from(new Set(entries));

  if (uniqueRecipients.length === 0) {
    return failWithCode('EMPTY_RECIPIENTS', 'Agrega al menos un correo válido.');
  }

  const invalid = uniqueRecipients.find(email => !isValidEmail(email));
  if (invalid) {
    return failWithCode('INVALID_EMAIL', `Correo inválido: ${invalid}`);
  }

  return ok({
    recipients: uniqueRecipients,
  });
};

interface ResolveUpdateRecipientParams {
  recipients: string[];
  index: number;
  input: string;
}

export const resolveUpdateRecipient = ({
  recipients,
  index,
  input,
}: ResolveUpdateRecipientParams): EmailRecipientsResult<{ recipients: string[] }> => {
  if (index < 0 || index >= recipients.length) {
    return failWithCode('INVALID_INDEX', 'No se pudo actualizar el destinatario seleccionado.');
  }

  const normalized = normalizeEmail(input);

  if (!normalized) {
    return failWithCode('EMPTY_EMAIL', 'Ingresa un correo válido.');
  }

  if (!isValidEmail(normalized)) {
    return failWithCode('INVALID_EMAIL', 'Ingresa un correo válido.');
  }

  if (
    recipients.some((email, recipientIndex) => recipientIndex !== index && email === normalized)
  ) {
    return failWithCode('DUPLICATE_EMAIL', 'Ese destinatario ya está agregado.');
  }

  const updatedRecipients = [...recipients];
  updatedRecipients[index] = normalized;

  return ok({
    recipients: updatedRecipients,
  });
};

interface ResolveRemoveRecipientParams {
  recipients: string[];
  index: number;
}

export const resolveRemoveRecipient = ({
  recipients,
  index,
}: ResolveRemoveRecipientParams): EmailRecipientsResult<{ recipients: string[] }> => {
  if (index < 0 || index >= recipients.length) {
    return failWithCode('INVALID_INDEX', 'No se pudo eliminar el destinatario seleccionado.');
  }

  return ok({
    recipients: recipients.filter((_, recipientIndex) => recipientIndex !== index),
  });
};

interface ResolveVisibleRecipientsParams {
  recipients: string[];
  showAll: boolean;
  maxVisible: number;
}

export const resolveVisibleRecipients = ({
  recipients,
  showAll,
  maxVisible,
}: ResolveVisibleRecipientsParams): { visibleRecipients: string[]; hiddenCount: number } => {
  const visibleRecipients = showAll ? recipients : recipients.slice(0, maxVisible);
  const hiddenCount = Math.max(0, recipients.length - visibleRecipients.length);

  return {
    visibleRecipients,
    hiddenCount,
  };
};
