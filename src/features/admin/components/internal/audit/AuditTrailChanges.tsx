import React from 'react';
import type { AuditTrailChange } from '@/types/auditTrailTypes';

const LONG_VALUE = 120;

const ChangeValue: React.FC<{ value?: string; tone: 'before' | 'after' }> = ({ value, tone }) => {
  const [expanded, setExpanded] = React.useState(false);
  if (!value) return <span className="text-slate-400">vacío</span>;
  const isLong = value.length > LONG_VALUE;
  const text = isLong && !expanded ? `${value.slice(0, LONG_VALUE - 1)}…` : value;
  return (
    <span
      className={
        tone === 'before' ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-800'
      }
    >
      {text}
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(current => !current)}
          className="ml-1 text-[11px] font-medium text-sky-700 no-underline hover:underline"
        >
          {expanded ? 'menos' : 'más'}
        </button>
      )}
    </span>
  );
};

interface AuditTrailChangesProps {
  changes: AuditTrailChange[];
  /** Field already named by the statement ("Edad"): only the values are shown. */
  hideField?: string;
}

/** "Campo: antes → después", one per line. */
export const AuditTrailChanges: React.FC<AuditTrailChangesProps> = ({ changes, hideField }) => {
  if (changes.length === 0) return null;
  return (
    <ul className="mt-0.5 space-y-0.5">
      {changes.map((change, index) => (
        <li key={`${change.field}-${index}`} className="break-words text-xs leading-5">
          {change.field !== hideField && <span className="text-slate-500">{change.field}: </span>}
          <ChangeValue value={change.before} tone="before" />
          <span className="mx-1 text-slate-400" aria-hidden>
            →
          </span>
          <span className="sr-only">cambió a</span>
          <ChangeValue value={change.after} tone="after" />
        </li>
      ))}
    </ul>
  );
};
