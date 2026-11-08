import React from 'react';
import { Plane, RefreshCcw } from 'lucide-react';
import { MedicalBadge } from '@/components/ui/base/MedicalBadge';
import { BedType } from '@/features/census/contracts/censusBedContracts';
import { usePatientActiveTransferQuery } from '@/features/census/components/patient-row/useBedActiveTransferQuery';
import type { PatientMainRowBedTypeCellProps } from '@/features/census/components/patient-row/patientRowContracts';

export const PatientMainRowBedTypeCell: React.FC<PatientMainRowBedTypeCellProps> = ({
  bedId: _bedId,
  patientRut,
  bedType,
  hasPatient,
  canToggleBedType,
  onToggleBedType,
}) => {
  const activeTransferQuery = usePatientActiveTransferQuery(patientRut, hasPatient);
  const activeTransfer = activeTransferQuery.data;
  const hasActiveTransfer = Boolean(activeTransfer);
  const isAcceptedTransfer = activeTransfer?.status === 'ACCEPTED';

  return (
    <td className="p-0 border-r border-slate-100 text-center w-[30px] relative overflow-hidden group/tipo-cell">
      {hasActiveTransfer && (
        <div
          className={
            isAcceptedTransfer
              ? 'absolute top-0.5 left-0.5 z-0 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shadow-sm ring-1 ring-emerald-200'
              : 'absolute top-0.5 left-0.5 z-0 flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-slate-500 shadow-sm ring-1 ring-slate-200'
          }
          title={isAcceptedTransfer ? 'Traslado aceptado' : 'Gestión de traslado activa'}
          aria-label={isAcceptedTransfer ? 'Traslado aceptado' : 'Gestión de traslado activa'}
        >
          <Plane size={10} />
        </div>
      )}
      <div className="flex flex-col items-center gap-1 py-1">
        <MedicalBadge
          variant={bedType === BedType.UCI ? 'red' : bedType === BedType.UTI ? 'purple' : 'blue'}
          className="w-10 justify-center mx-auto"
        >
          {bedType}
        </MedicalBadge>
      </div>
      {canToggleBedType && (
        <button
          onClick={onToggleBedType}
          className="absolute top-0.5 right-0.5 z-10 p-0.5 rounded-full text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition-all opacity-0 group-hover/tipo-cell:opacity-100 focus-visible:opacity-100"
          title="Cambiar nivel de cuidado (UCI/UTI)"
        >
          <RefreshCcw size={10} className="animate-hover-spin" />
        </button>
      )}
    </td>
  );
};
