import React from 'react';
import { Clock3 } from 'lucide-react';
import { resolveMovementDateTimeDisplayValue } from '@/features/census/controllers/censusMovementDatePresentationController';

interface CensusMovementDateTimeCellProps {
  recordDate: string;
  movementDate?: string;
  movementTime?: string;
}

export const CensusMovementDateTimeCell: React.FC<CensusMovementDateTimeCellProps> = ({
  recordDate,
  movementDate,
  movementTime,
}) => {
  const displayValue = resolveMovementDateTimeDisplayValue(recordDate, movementDate, movementTime);

  return (
    <div className="flex flex-col items-center">
      <div className="w-24 rounded-md border border-slate-300 bg-slate-50 px-2 py-1">
        <div className="flex items-center justify-center gap-1 text-[12px] font-semibold text-slate-700 leading-tight">
          <span>{displayValue.timeLabel}</span>
          <Clock3 size={11} className="text-slate-500" />
        </div>
        <div className="text-[10px] text-slate-500 leading-tight">({displayValue.dateLabel})</div>
      </div>
    </div>
  );
};
