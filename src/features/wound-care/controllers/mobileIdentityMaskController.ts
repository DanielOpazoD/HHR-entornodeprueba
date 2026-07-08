/**
 * Pure helpers that mask the patient identity shown on the wound-care
 * mobile QR upload screen until the clinician explicitly confirms the
 * person they intend to photograph matches the QR's session.
 *
 * Closes the frontend slice of `wound-care-mobile-qr` (product item):
 * the screen now reveals a partial preview only — first initial of
 * each name token + the last four digits of the RUT — so an
 * unauthorised peek at the device cannot read the full identity. Full
 * name and RUT only become visible once the clinician taps the
 * confirmation button.
 *
 * The functions/** side of the activo (App Check enforcement,
 * uploadCount cap, validateSession audit log, TTL reduction) requires
 * a coordinated functions deploy and is intentionally not handled
 * here.
 */

const collapseSpaces = (value: string): string => value.replace(/\s+/g, ' ').trim();

const tokeniseName = (name: string): string[] =>
  collapseSpaces(name)
    .split(' ')
    .filter(token => token.length > 0);

export const maskPatientName = (fullName: string): string => {
  const tokens = tokeniseName(fullName);
  if (tokens.length === 0) return '—';
  return tokens.map(token => `${token.charAt(0).toUpperCase()}.`).join(' ');
};

const stripRutFormatting = (rut: string): string => rut.replace(/[^0-9kK]/g, '').toUpperCase();

export const maskPatientRut = (rut: string): string => {
  const compact = stripRutFormatting(rut);
  if (compact.length === 0) return '—';
  if (compact.length <= 4) return `••••-${compact}`;
  const tail = compact.slice(-4);
  return `••••-${tail}`;
};

export interface MaskedPatientIdentity {
  maskedName: string;
  maskedRut: string;
}

export const buildMaskedPatientIdentity = (input: {
  patientName: string;
  patientRut: string;
}): MaskedPatientIdentity => ({
  maskedName: maskPatientName(input.patientName),
  maskedRut: maskPatientRut(input.patientRut),
});
