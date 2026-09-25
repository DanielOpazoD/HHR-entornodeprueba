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
    <div className="text-[13px] font-semibold leading-5 text-slate-800">{name || '—'}</div>
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
      <span className="whitespace-nowrap tabular-nums">{identifier || '—'}</span>
      {admissionDate ? (
        <span className="whitespace-nowrap">FI: {formatDateDDMMYYYY(admissionDate)}</span>
      ) : null}
    </div>
  </td>
);
