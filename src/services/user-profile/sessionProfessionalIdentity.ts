import * as z from 'zod';
import { formatRut, isValidRut } from '@/utils/rutUtils';

const professionalIdentitySchema = z
  .object({
    uid: z
      .string()
      .min(1)
      .max(128)
      .refine(value => value.trim().length > 0),
    name: z.string().trim().max(160),
    rut: z
      .string()
      .trim()
      .max(16)
      .refine(value => /^[\d.]+-?[\dkK]$/.test(value) && isValidRut(value))
      .transform(formatRut),
  })
  .strict();

export type SessionProfessionalIdentity = z.infer<typeof professionalIdentitySchema>;

let pendingIdentity: SessionProfessionalIdentity | null = null;

const storageKey = (uid: string): string =>
  `hhr_professional_identity_v1.${encodeURIComponent(uid)}`;

/** Editable prefilling hint only; neither authorization nor a professional credential. */
export const captureSessionProfessionalIdentity = (identity: {
  uid: string;
  name: string;
  rut: unknown;
}): void => {
  if (pendingIdentity?.uid !== identity.uid) pendingIdentity = null;
  const parsed = professionalIdentitySchema.safeParse(identity);
  if (parsed.success) pendingIdentity = parsed.data;
};

export const clearPendingProfessionalIdentity = (): void => {
  pendingIdentity = null;
};

/** Call from an already admitted session, after its storage reconciliation has completed. */
export const readSessionProfessionalIdentity = (
  uid: string
): SessionProfessionalIdentity | null => {
  if (!uid || !uid.trim()) return null;
  if (pendingIdentity?.uid !== uid) pendingIdentity = null;
  if (pendingIdentity) {
    const identity = pendingIdentity;
    pendingIdentity = null;
    try {
      sessionStorage.setItem(storageKey(uid), JSON.stringify(identity));
    } catch {
      // A denied session store must not prevent using the in-memory prefilling hint.
    }
    return { ...identity };
  }
  try {
    const raw = sessionStorage.getItem(storageKey(uid));
    if (!raw) return null;
    const stored: unknown = JSON.parse(raw);
    const parsed = professionalIdentitySchema.safeParse(stored);
    if (parsed.success && parsed.data.uid === uid) return parsed.data;
    sessionStorage.removeItem(storageKey(uid));
  } catch {
    // Storage and corrupt hints are optional; the document remains manually editable.
  }
  return null;
};
