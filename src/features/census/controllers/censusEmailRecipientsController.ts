import {
  failWithCode,
  ok,
  type ControllerError,
  type ControllerResult,
} from '@/features/census/controllers/controllerResult';

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
