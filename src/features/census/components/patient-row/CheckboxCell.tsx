/**
 * CheckboxCell - Generic checkbox cell for boolean fields
 */

import React from 'react';
import { BaseCellProps, CheckHandler } from './inputCellTypes';
import { PatientData } from '@/types';
import { PatientEmptyCell } from './PatientEmptyCell';

interface CheckboxCellProps extends BaseCellProps {
  field: keyof PatientData;
  onChange: CheckHandler;
  title: string;
  colorClass?: string;
  isLastColumn?: boolean;
}

export const CheckboxCell: React.FC<CheckboxCellProps> = ({
  data,
  isSubRow = false,
  isEmpty = false,
  readOnly = false,
  field,
  onChange,
  title,
  colorClass = 'text-slate-600',
  isLastColumn = false,
}) => {
  const cellClasses = isLastColumn
    ? 'p-0.5 text-center w-10'
    : 'p-0.5 border-r border-slate-200 text-center w-10';

  if (isEmpty && !isSubRow) {
    return <PatientEmptyCell tdClassName={cellClasses} />;
  }

  return (
    <td className={cellClasses}>
      <input
        type="checkbox"
        checked={Boolean(data[field])}
        onChange={onChange(field)}
        className={`w-4 h-4 ${colorClass} rounded`}
        title={title}
        disabled={readOnly}
      />
    </td>
  );
};
