import type { MovementProvenance } from '@/types/domain/movements';

export interface MovementProvenancePresentation {
  label: string;
  title: string;
  tone: 'teal' | 'slate' | 'amber';
  icon: 'verified' | 'manual' | 'reclassified' | 'unknown';
}

const formatStamp = (iso?: string): string => {
  const match = (iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return match ? `${match[3]}-${match[2]}-${match[1]} ${match[4]}:${match[5]}` : '';
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
      label: 'Rayen',
      title: withDetails('Confirmado por Gestión de Camas mediante Eloísa', provenance),
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
