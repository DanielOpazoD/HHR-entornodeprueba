import type { PatientData } from '@/types/domain/patient';

/**
 * CheckboxCell - Generic checkbox cell for boolean fields
 */

import React from 'react';
import { BaseCellProps, CheckHandler } from './inputCellTypes';

import { PatientEmptyCell } from './PatientEmptyCell';

interface CheckboxCellProps extends BaseCellProps {
  field: keyof PatientData;
  onChange: CheckHandler;
  title: string;
  colorClass?: string;
  isLastColumn?: boolean;
  checked?: boolean;
  disabled?: boolean;
}

export const CheckboxCell: React.FC<CheckboxCellProps> = ({
  data,
  isSubRow = false,
  isEmpty = false,
  readOnly = false,
  readOnlyReason,
  field,
  onChange,
  title,
  colorClass = 'text-slate-600',
  isLastColumn = false,
  checked,
  disabled = false,
}) => {
  const cellClasses = isLastColumn
    ? 'p-0.5 text-center w-10'
    : 'p-0.5 border-r border-slate-200 text-center w-10';

  if (isEmpty && !isSubRow) {
    return <PatientEmptyCell tdClassName={cellClasses} />;
  }

  return (
    <td className={`${cellClasses} relative`}>
      <input
        type="checkbox"
        checked={checked ?? Boolean(data[field])}
        onChange={event => {
          onChange(field)(event);
        }}
        className={`w-4 h-4 ${colorClass} rounded`}
        title={readOnlyReason || title}
        disabled={readOnly || disabled}
      />
    </td>
  );
};
