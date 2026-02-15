import React from 'react';
import { AlertCircle } from 'lucide-react';

interface PatientMainRowBlockedCellProps {
  blockedReason?: string;
}

export const PatientMainRowBlockedCell: React.FC<PatientMainRowBlockedCellProps> = ({
  blockedReason,
}) => (
  <td colSpan={10} className="p-1 bg-slate-50/50 text-center">
    <div className="text-slate-400 text-sm flex items-center justify-center gap-2 italic">
      <AlertCircle size={14} className="text-red-300/60" />
      <span>Cama Bloqueada</span>
      {blockedReason && <span className="text-xs opacity-70">({blockedReason})</span>}
    </div>
  </td>
);
