import React from 'react';
import {
  findProfessionalByCatalogKey,
  professionalCatalogKey,
} from '@/services/staff/treatingPhysicianCatalog';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';

interface TreatingPhysicianSelectProps {
  bedId: string;
  currentPhysicianName?: string;
  professionals: ProfessionalCatalogItem[];
  value: string;
  onChange: (key: string, professional?: ProfessionalCatalogItem) => void;
}

/** Presentational selector for the Rayen-backed HHR physician catalog. */
export const TreatingPhysicianSelect: React.FC<TreatingPhysicianSelectProps> = ({
  bedId,
  currentPhysicianName,
  professionals,
  value,
  onChange,
}) => {
  const selectedIsMissing = value && !findProfessionalByCatalogKey(professionals, value);

  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-slate-600">Médico tratante</span>
      <select
        id={`clinical-block-physician-${bedId}`}
        name={`clinical-block-physician-${bedId}`}
        data-testid={`clinical-block-physician-${bedId}`}
        className="h-8 w-full rounded border border-slate-200 px-2 text-[12px] focus:border-medical-500 focus:outline-none focus:ring-2 focus:ring-medical-500/20"
        value={value}
        onChange={event => {
          const key = event.target.value;
          onChange(key, findProfessionalByCatalogKey(professionals, key));
        }}
      >
        <option value="">Sin médico asignado</option>
        {selectedIsMissing && (
          <option value={value}>{currentPhysicianName || 'Médico de Eloísa'}</option>
        )}
        {professionals.map(professional => (
          <option
            key={professionalCatalogKey(professional)}
            value={professionalCatalogKey(professional)}
          >
            {professional.name}
            {professional.specialty ? ` · ${professional.specialty}` : ' · especialidad pendiente'}
          </option>
        ))}
      </select>
    </label>
  );
};
