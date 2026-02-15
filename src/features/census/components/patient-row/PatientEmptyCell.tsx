import React from 'react';
import clsx from 'clsx';

interface PatientEmptyCellProps {
  tdClassName: string;
  contentClassName?: string;
  marker?: string;
}

export const PatientEmptyCell: React.FC<PatientEmptyCellProps> = ({
  tdClassName,
  contentClassName,
  marker = '-',
}) => (
  <td className={tdClassName}>
    <div
      className={clsx(
        'w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-xs italic text-center',
        contentClassName
      )}
    >
      {marker}
    </div>
  </td>
);
