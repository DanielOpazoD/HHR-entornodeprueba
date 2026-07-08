/**
 * ClinicalUpdateDateTimeHeader
 *
 * Inline date/time display for clinical update sections.
 * Shows formatted date and time as text; click toggles to
 * editable date/time inputs.
 */

import React, { useState } from 'react';

interface ClinicalUpdateDateTimeHeaderProps {
  sectionId: string;
  date?: string;
  time?: string;
  canEdit: boolean;
  onPatchDate?: (sectionId: string, date: string) => void;
  onPatchTime?: (sectionId: string, time: string) => void;
}

/** Formats YYYY-MM-DD to DD/MM/YYYY for display. */
const formatDisplayDate = (iso: string | undefined): string => {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

export const ClinicalUpdateDateTimeHeader: React.FC<ClinicalUpdateDateTimeHeaderProps> = ({
  sectionId,
  date,
  time,
  canEdit,
  onPatchDate,
  onPatchTime,
}) => {
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing && canEdit) {
    return (
      <span
        className="inline-flex items-center gap-1.5 ml-3"
        onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setIsEditing(false);
          }
        }}
      >
        <input
          type="date"
          value={date || ''}
          onChange={e => onPatchDate?.(sectionId, e.target.value)}
          className="text-[12px] text-slate-600 border border-slate-200 rounded px-1 py-0.5"
          autoFocus
        />
        <input
          type="time"
          value={time || ''}
          onChange={e => onPatchTime?.(sectionId, e.target.value)}
          className="text-[12px] text-slate-600 border border-slate-200 rounded px-1 py-0.5 w-[80px]"
        />
      </span>
    );
  }

  return (
    <span
      className={`ml-3 text-[13px] font-normal text-slate-500 whitespace-nowrap shrink-0 ${canEdit ? 'cursor-pointer hover:text-slate-700' : ''}`}
      onClick={canEdit ? () => setIsEditing(true) : undefined}
      title={canEdit ? 'Click para editar fecha y hora' : undefined}
    >
      {formatDisplayDate(date)}
      {date && time ? ', ' : ''}
      {time || ''}
    </span>
  );
};
