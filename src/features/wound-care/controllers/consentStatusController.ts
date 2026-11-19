/**
 * Consent Status Controller
 *
 * Pure logic for deriving consent display state.
 */

import type { WoundCareConsent } from '@/types/domain/woundCare';

export type ConsentDisplayState = 'none' | 'signed' | 'revoked';

/**
 * Derive the display state from a consent record (or absence thereof).
 *
 * Maps the raw consent status to a simplified UI enum used for badge
 * rendering and conditional logic in the wound care modal.
 */
export const deriveConsentDisplayState = (
  consent: WoundCareConsent | null | undefined
): ConsentDisplayState => {
  if (!consent) return 'none';
  if (consent.status === 'signed') return 'signed';
  if (consent.status === 'revoked') return 'revoked';
  return 'none';
};

export const consentStatusLabel: Record<ConsentDisplayState, string> = {
  none: 'Sin consentimiento',
  signed: 'Consentimiento firmado',
  revoked: 'Consentimiento revocado',
};

export const consentStatusColor: Record<ConsentDisplayState, string> = {
  none: 'text-amber-600 bg-amber-50 border-amber-200',
  signed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  revoked: 'text-red-600 bg-red-50 border-red-200',
};
