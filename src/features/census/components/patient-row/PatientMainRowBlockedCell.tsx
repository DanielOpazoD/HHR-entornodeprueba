import React from 'react';
import { AlertCircle } from 'lucide-react';
import type { PatientMainRowBlockedCellProps } from '@/features/census/components/patient-row/patientRowContracts';
import { isSpecialistCensusAccessProfile } from '@/features/census/types/censusAccessProfile';

export const PatientMainRowBlockedCell: React.FC<PatientMainRowBlockedCellProps> = ({
  blockedReason,
  accessProfile = 'default',
}) => (
  <td
    // Debe coincidir con los <td> que renderiza PatientInputCells tras las celdas fijas
    // (acciones/cama; "tipo" oculto): estado (1) + identidad (1) + diagnóstico (1) + flujo (3|1)
    // + flags (1|0) = 7 en perfil default, 3 en specialist (specialist no muestra estado).
    colSpan={isSpecialistCensusAccessProfile(accessProfile) ? 3 : 7}
    className="p-1 bg-slate-50/50 text-center"
  >
    <div className="text-slate-400 text-sm flex items-center justify-center gap-2 italic">
      <AlertCircle size={14} className="text-red-300/60" />
      <span>Cama Bloqueada</span>
      {blockedReason && <span className="text-xs opacity-70">({blockedReason})</span>}
    </div>
  </td>
);
