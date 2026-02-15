import React from 'react';
import { Bed } from 'lucide-react';
import type {
  BedTypesById,
  DiagnosisMode,
  OccupiedBedRow,
} from '@/features/census/types/censusTableTypes';
import type { BedDefinition, PatientData } from '@/types';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import { EmptyBedRow } from '@/features/census/components/EmptyBedRow';
import { PatientRow } from '@/features/census/components/PatientRow';

interface CensusTableBodyProps {
  occupiedRows: OccupiedBedRow[];
  emptyBeds: BedDefinition[];
  currentDateString: string;
  readOnly: boolean;
  diagnosisMode: DiagnosisMode;
  bedTypes: BedTypesById;
  onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
  onActivateEmptyBed: (bedId: string) => void;
}

export const CensusTableBody: React.FC<CensusTableBodyProps> = ({
  occupiedRows,
  emptyBeds,
  currentDateString,
  readOnly,
  diagnosisMode,
  bedTypes,
  onAction,
  onActivateEmptyBed,
}) => (
  <tbody>
    {occupiedRows.map((row, index) => (
      <PatientRow
        key={row.id}
        bed={row.bed}
        data={row.data}
        currentDateString={currentDateString}
        onAction={onAction}
        readOnly={readOnly}
        actionMenuAlign={index >= occupiedRows.length - 4 ? 'bottom' : 'top'}
        diagnosisMode={diagnosisMode}
        isSubRow={row.isSubRow}
        bedType={bedTypes[row.bed.id]}
      />
    ))}

    {emptyBeds.length > 0 && (
      <tr className="border-t-2 border-slate-200 print:hidden">
        <td colSpan={12} className="py-2 px-3 bg-slate-50/50">
          <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
            <Bed size={14} />
            <span>Camas disponibles ({emptyBeds.length})</span>
          </div>
        </td>
      </tr>
    )}

    {emptyBeds.map(bed => (
      <EmptyBedRow
        key={bed.id}
        bed={bed}
        readOnly={readOnly}
        onClick={() => onActivateEmptyBed(bed.id)}
      />
    ))}
  </tbody>
);
