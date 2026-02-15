import React from 'react';
import { Bed } from 'lucide-react';

interface CensusEmptyBedsDividerRowProps {
  emptyBedsCount: number;
}

export const CensusEmptyBedsDividerRow: React.FC<CensusEmptyBedsDividerRowProps> = ({
  emptyBedsCount,
}) => (
  <tr className="border-t-2 border-slate-200 print:hidden">
    <td colSpan={12} className="py-2 px-3 bg-slate-50/50">
      <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
        <Bed size={14} />
        <span>Camas disponibles ({emptyBedsCount})</span>
      </div>
    </td>
  </tr>
);
