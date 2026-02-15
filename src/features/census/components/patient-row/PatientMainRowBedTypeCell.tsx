import React from 'react';
import { RefreshCcw } from 'lucide-react';
import { MedicalBadge } from '@/components/ui/base/MedicalBadge';
import { BedType } from '@/types';
import { isIntensiveBedType } from '@/utils/bedTypeUtils';

interface PatientMainRowBedTypeCellProps {
  bedType: BedType;
  canToggleBedType: boolean;
  onToggleBedType: () => void;
}

export const PatientMainRowBedTypeCell: React.FC<PatientMainRowBedTypeCellProps> = ({
  bedType,
  canToggleBedType,
  onToggleBedType,
}) => (
  <td className="p-0 border-r border-slate-100 text-center w-16 relative group/tipo-cell">
    <div className="flex flex-col items-center gap-1 py-1">
      <MedicalBadge
        variant={isIntensiveBedType(bedType) ? 'pink' : 'blue'}
        className="w-10 justify-center mx-auto"
      >
        {bedType}
      </MedicalBadge>
    </div>
    {canToggleBedType && (
      <button
        onClick={onToggleBedType}
        className="absolute top-0.5 right-0.5 p-0.5 rounded-full text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition-all opacity-0 group-hover/tipo-cell:opacity-100"
        title="Cambiar nivel de cuidado (UCI/UTI)"
      >
        <RefreshCcw size={10} className="animate-hover-spin" />
      </button>
    )}
  </td>
);
