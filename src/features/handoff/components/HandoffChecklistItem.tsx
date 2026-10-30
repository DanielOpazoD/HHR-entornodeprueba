import type { ReactNode } from 'react';

interface HandoffChecklistItemProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled: boolean;
}

export const HandoffChecklistItem = ({
  checked,
  onChange,
  label,
  disabled,
}: HandoffChecklistItemProps) => (
  <label className="handoff-checklist-item flex min-h-8 min-w-0 items-center gap-2 print:min-h-0 print:gap-1">
    <span className="relative flex shrink-0 items-center">
      <input
        type="checkbox"
        className="h-4 w-4 appearance-none rounded border border-teal-600 bg-white checked:bg-teal-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-default print:h-3 print:w-3 print:!bg-white print:border-slate-800"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        disabled={disabled}
      />
      <svg
        className={`pointer-events-none absolute inset-0 h-4 w-4 text-white print:text-slate-800 print:h-3 print:w-3 ${checked ? 'opacity-100' : 'opacity-0'}`}
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
      </svg>
    </span>
    <span className="text-xs font-medium leading-5 text-slate-700 print:text-[8px] print:text-black">
      {label}
    </span>
  </label>
);
