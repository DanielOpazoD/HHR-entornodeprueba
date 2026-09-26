import React from 'react';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';

interface CensusMovementPatientIdentityProps {
  name: string;
  identifier: string;
  admissionDate?: string;
}

/** The same two-line identity hierarchy as the occupied-bed census row. */
export const CensusMovementPatientIdentity: React.FC<CensusMovementPatientIdentityProps> = ({
  name,
  identifier,
  admissionDate,
}) => (
  <td className="min-w-52 p-2 align-middle">
    <div className="break-words text-[13px] font-semibold leading-4 text-slate-700">
      {name || '—'}
    </div>
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] leading-tight text-slate-500">
      <span className="whitespace-nowrap tabular-nums">{identifier || '—'}</span>
      {admissionDate ? (
        <span className="whitespace-nowrap">FI: {formatDateDDMMYYYY(admissionDate)}</span>
      ) : null}
    </div>
  </td>
);
