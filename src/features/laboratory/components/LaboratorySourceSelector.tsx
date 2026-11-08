export const LaboratorySourceSelector = ({
  source,
  onChange,
}: {
  source: 'syslab' | 'exalab';
  onChange: (source: 'syslab' | 'exalab') => void;
}) => (
  <div
    role="group"
    aria-label="Fuente de laboratorio"
    className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
  >
    {(['syslab', 'exalab'] as const).map(value => (
      <button
        key={value}
        type="button"
        aria-pressed={source === value}
        onClick={() => onChange(value)}
        className={`rounded-md px-2.5 py-1.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 ${source === value ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:bg-white'}`}
      >
        {value === 'syslab' ? 'Syslab HHR' : 'Exalab · Otros centros'}
      </button>
    ))}
  </div>
);
