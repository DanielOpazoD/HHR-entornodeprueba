import type { MovementProvenance } from '@/types/domain/movements';

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
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}-${month}-${year} ${hours}:${minutes}`;
};

const withDetails = (base: string, provenance: MovementProvenance): string => {
  const details = [provenance.classifiedBy, formatStamp(provenance.classifiedAt)].filter(Boolean);
  return details.length > 0 ? `${base} · ${details.join(' · ')}` : base;
};

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
      title: withDetails(
        'Confirmado por el informe de Alta Administrativa de Gestión de Camas de Eloísa',
        provenance
      ),
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
