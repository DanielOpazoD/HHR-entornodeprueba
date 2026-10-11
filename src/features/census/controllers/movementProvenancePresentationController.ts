import type { MovementProvenance } from '@/types/domain/movements';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';

export interface MovementProvenancePresentation {
  label: string;
  title: string;
  tone: 'teal' | 'slate' | 'amber';
  icon: 'verified' | 'manual' | 'reclassified' | 'unknown';
}

const formatStamp = (iso?: string): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const { iso: calendarDate, hhmm } = calendarStampInClinicalTimeZone(date);
  return `${calendarDate.split('-').reverse().join('-')} ${hhmm}`;
};

const withDetails = (base: string, provenance: MovementProvenance): string =>
  [base, provenance.classifiedBy, formatStamp(provenance.classifiedAt)].filter(Boolean).join(' · ');

const classificationLabel = (value?: MovementProvenance['previousClassification']): string => {
  if (value === 'discharge') return 'alta domicilio';
  if (value === 'transfer') return 'traslado';
  if (value === 'cma') return 'CMA';
  return 'clasificación anterior';
};

export const resolveMovementProvenancePresentation = (
  provenance?: MovementProvenance
): MovementProvenancePresentation => {
  if (!provenance) {
    return {
      label: '',
      title: 'Origen no registrado: movimiento anterior a la trazabilidad de egresos.',
      tone: 'slate',
      icon: 'unknown',
    };
  }
  if (provenance.source === 'gestion_camas') {
    return {
      label: 'Egreso estad.',
      title: 'Egreso estadístico confirmado en Eloísa',
      tone: 'teal',
      icon: 'verified',
    };
  }
  if (provenance.source === 'reclassified') {
    return {
      label: 'Reclasif.',
      title: withDetails(
        `Reclasificado desde ${classificationLabel(provenance.previousClassification)}`,
        provenance
      ),
      tone: 'amber',
      icon: 'reclassified',
    };
  }
  return {
    label: 'Manual',
    title: withDetails('Registrado manualmente en HHR', provenance),
    tone: 'slate',
    icon: 'manual',
  };
};
