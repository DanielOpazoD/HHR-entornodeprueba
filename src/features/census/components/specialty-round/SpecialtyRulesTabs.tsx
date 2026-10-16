import { useId, useRef } from 'react';

const tabs = [
  ['rules', 'Reglas'],
  ['current', 'Hospitalizados'],
  ['history', 'Historial'],
] as const;
export type SpecialtyRulesTab = (typeof tabs)[number][0];

export const SpecialtyRulesTabs = ({
  active,
  onChange,
}: {
  active: SpecialtyRulesTab;
  onChange: (tab: SpecialtyRulesTab) => void;
}) => {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const label = useId();
  return (
    <div
      role="tablist"
      aria-label="Asociaciones de especialidad"
      id={label}
      className="flex gap-1 border-b border-slate-200"
    >
      {tabs.map(([key, title], index) => (
        <button
          key={key}
          type="button"
          role="tab"
          id={`specialty-tab-${key}`}
          aria-controls={`specialty-panel-${key}`}
          aria-selected={active === key}
          tabIndex={active === key ? 0 : -1}
          ref={element => {
            refs.current[index] = element;
          }}
          onClick={() => onChange(key)}
          onKeyDown={event => {
            const next =
              event.key === 'ArrowRight'
                ? (index + 1) % tabs.length
                : event.key === 'ArrowLeft'
                  ? (index + tabs.length - 1) % tabs.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : null;
            if (next === null) return;
            event.preventDefault();
            onChange(tabs[next][0]);
            refs.current[next]?.focus();
          }}
          className={`border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 ${
            active === key
              ? 'border-teal-700 text-teal-800'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          {title}
        </button>
      ))}
    </div>
  );
};
