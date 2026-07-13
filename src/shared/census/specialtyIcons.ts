/**
 * Emoji representation of each clinical specialty for the census "Esp" column (rediseño 2026).
 * The census shows the icon; the full name stays available as the cell's title/tooltip and in the
 * editor. Values match the `Specialty` enum strings (see types/domain/patientClassification.ts).
 */

const SPECIALTY_ICONS: Record<string, string> = {
  Pediatría: '👶',
  Ginecobstetricia: '🤰',
  Traumatología: '🦴',
  'Med Interna': '🩺',
  Psiquiatría: '🧠',
  Cirugía: '🩹',
  Odontología: '🦷',
};

/** Icon for a specialty value; ❓ for "Otro" / no specialty (No especificado). */
export const specialtyIcon = (specialty?: string): string =>
  (specialty && SPECIALTY_ICONS[specialty]) || '❓';
