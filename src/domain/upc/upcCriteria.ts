/**
 * UPC classification criteria as defined by the Hospital Hanga Roa protocol
 * "Criterios de Clasificación UPC" (April 2026), with the requested
 * September 2026 combined vasoactive criterion and FiO₂ ≥ 50% threshold.
 *
 * UCI = soporte vital avanzado (VMI, vasoactivos, inotrópicos).
 * UTI = monitorización estrecha o soporte no invasivo sin criterios UCI.
 *
 * Each criterion has a stable `id` (persisted in Firestore) and a
 * human-readable `label` shown in the checklist UI.
 */

export interface UpcCriterion {
  readonly id: string;
  readonly label: string;
}

// ── UCI criteria (at least 1 → UPC-UCI) ─────────────────────────

export const UPC_UCI_CRITERIA: readonly UpcCriterion[] = [
  { id: 'uci_vmi', label: 'Ventilación mecánica invasiva (VMI)' },
  { id: 'uci_vasoactivos', label: 'Drogas vasopresoras o inotrópicas en infusión continua' },
] as const;

// ── UTI criteria (at least 1, without UCI → UPC-UTI) ────────────

export const UPC_UTI_CRITERIA: readonly UpcCriterion[] = [
  {
    id: 'uti_mon_cardiaca',
    label:
      'Monitorización cardíaca continua por riesgo arrítmico, inestabilidad eléctrica o hemodinámica',
  },
  {
    id: 'uti_mon_respiratoria',
    label:
      'Monitorización respiratoria continua o soporte no invasivo hospitalario (VMNI, CNAF, FiO₂ ≥ 50%)',
  },
  {
    id: 'uti_mon_neurologica',
    label:
      'Monitorización neurológica seriada (≥c/4h) por condición neurológica aguda con riesgo de deterioro',
  },
  {
    id: 'uti_controles_frecuentes',
    label:
      'Controles clínicos o hemodinámicos frecuentes (c/1-3h) por inestabilidad activa o riesgo de deterioro',
  },
  {
    id: 'uti_infusion_alto_riesgo',
    label:
      'Infusión EV continua de fármacos de alto riesgo con titulación activa o vigilancia estrecha',
  },
  {
    id: 'uti_materno_fetal',
    label:
      'Monitorización materno-fetal continua por patología obstétrica aguda con riesgo de deterioro materno y/o fetal',
  },
] as const;

// ── Derived helpers ──────────────────────────────────────────────

// Keep historical inotrope records valid; normalize only when opening an editable draft.
const ALL_UCI_IDS = new Set([...UPC_UCI_CRITERIA.map(c => c.id), 'uci_inotropicos']);
const ALL_UTI_IDS = new Set(UPC_UTI_CRITERIA.map(c => c.id));

export const isValidUciCriterionId = (id: string): boolean => ALL_UCI_IDS.has(id);
export const isValidUtiCriterionId = (id: string): boolean => ALL_UTI_IDS.has(id);

export const normalizeUciCriterionId = (id: string): string =>
  id === 'uci_inotropicos' ? 'uci_vasoactivos' : id;

/**
 * Strip criterion IDs that are no longer defined in the protocol.
 * Prevents stale/corrupted Firestore data from leaking into the UI.
 */
export const sanitizeCriterionIds = (
  ids: readonly string[] | undefined | null,
  validator: (id: string) => boolean
): string[] => (ids ?? []).filter(validator);
