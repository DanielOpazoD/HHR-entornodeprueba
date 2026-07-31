/**
 * Shared professionals catalog domain types.
 */
export type ProfessionalSpecialty =
  | 'Medicina Interna'
  | 'Med Interna'
  | 'Cirugía'
  | 'Traumatología'
  | 'Ginecobstetricia'
  | 'Psiquiatría'
  | 'Pediatría'
  | 'Odontología'
  | 'Otro'
  | 'Anestesia'
  | 'Kinesiología';

export interface ProfessionalCatalogItem {
  name: string;
  phone: string;
  /** Undefined until HHR staff configures the physician → specialty association. */
  specialty?: ProfessionalSpecialty | string;
  /** Stable Rayen practitioner id. Preferred over display-name matching. */
  rayenPractitionerId?: string;
  source?: 'rayen' | 'manual';
  period?: string;
  lastUsed?: string;
}
