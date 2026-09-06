import { ChevronsDown, ChevronsUp } from 'lucide-react';

export const StaffMoreOptionsButton = ({
  expanded,
  count,
  label,
  onClick,
}: {
  expanded: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) =>
  count > 0 ? (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={`${expanded ? 'Ocultar' : 'Mostrar'} nombres menos usados de ${label}`}
      title={`${expanded ? 'Ocultar' : 'Mostrar'} ${count} nombres menos usados · últimos 90 censos locales`}
      className="absolute right-0 top-0 inline-flex h-5 w-4 items-center justify-center rounded-r text-slate-500 hover:bg-slate-100 hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
    >
      {expanded ? (
        <ChevronsUp size={12} aria-hidden="true" />
      ) : (
        <ChevronsDown size={12} aria-hidden="true" />
      )}
    </button>
  ) : null;
