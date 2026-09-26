import { isVacancySelection } from '@/services/staff/staffSelectionPresentation';

/** The compact select keeps its width; the chosen full name appears on hover or focus. */
export const StaffSelectionNameHint = ({ name, id }: { name: string; id: string }) => {
  if (isVacancySelection(name)) return null;

  return (
    <span
      id={id}
      role="tooltip"
      className="pointer-events-none invisible absolute left-0 top-full z-50 mt-1 w-max max-w-64 rounded-md border border-slate-200 bg-slate-900 px-2 py-1 text-[11px] font-medium leading-tight text-white opacity-0 shadow-md transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
    >
      {name}
    </span>
  );
};
