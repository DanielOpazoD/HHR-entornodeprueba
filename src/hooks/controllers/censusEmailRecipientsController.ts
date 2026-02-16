import { CENSUS_DEFAULT_RECIPIENTS } from '@/constants/email';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (value: string): string => value.trim().toLowerCase();

export const isValidEmail = (value: string): boolean => EMAIL_REGEX.test(value);

export const resolveStoredRecipients = (stored: unknown): string[] | null => {
  if (!Array.isArray(stored) || stored.length === 0) {
    return null;
  }

  const recipients = stored.filter((item): item is string => typeof item === 'string');
  return recipients.length > 0 ? recipients : null;
};

export const resolveLegacyRecipients = (legacyRaw: string | null): string[] | null => {
  if (!legacyRaw) {
    return null;
  }

  try {
    const parsed = JSON.parse(legacyRaw);
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

const normalizeRecipientsList = (recipients: string[]): string[] =>
  recipients.map(normalizeEmail).filter(Boolean);

export const resolveSendingRecipients = ({
  recipients,
  shouldUseTestMode,
  testRecipient,
}: ResolveSendingRecipientsParams): ResolveSendingRecipientsResult => {
  if (shouldUseTestMode) {
    const normalizedTestRecipient = normalizeEmail(testRecipient);
    if (!normalizedTestRecipient || !isValidEmail(normalizedTestRecipient)) {
      return {
        ok: false,
        error: 'Ingresa un correo de prueba válido para el modo prueba.',
      };
    }

    return { ok: true, recipients: [normalizedTestRecipient] };
  }

  const normalizedRecipients = normalizeRecipientsList(recipients);
  if (normalizedRecipients.length > 0) {
    return { ok: true, recipients: normalizedRecipients };
  }

  return { ok: true, recipients: CENSUS_DEFAULT_RECIPIENTS };
};
