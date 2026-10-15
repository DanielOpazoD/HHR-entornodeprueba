import React, { useRef } from 'react';
import { FileText, List, Settings2 } from 'lucide-react';
import { MEDIF_SECTIONS, getMedifGroupFieldIds } from '../../../domain/medifSchema';
import { isMedifFieldHidden, type MedifPreferences } from '../../../domain/medifPreferences';
import type { MedifValues } from '../../../domain/medifDraft';

const TABS = [
  { id: 'form', label: 'Formulario', icon: FileText },
  { id: 'variables', label: 'Variables', icon: List },
  { id: 'preferences', label: 'Preferencias', icon: Settings2 },
] as const;
export type MedifTabId = (typeof TABS)[number]['id'];

export const MedifTabs: React.FC<{ value: MedifTabId; onChange: (tab: MedifTabId) => void }> = ({
  value,
  onChange,
}) => {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div
      role="tablist"
      aria-label="Vistas de MEDIF"
      className="mb-4 flex gap-1 border-b border-slate-200"
    >
      {TABS.map((item, index) => (
        <button
          key={item.id}
          ref={node => {
            refs.current[index] = node;
          }}
          type="button"
          role="tab"
          id={`medif-tab-${item.id}`}
          aria-controls={`medif-panel-${item.id}`}
          aria-selected={value === item.id}
          tabIndex={value === item.id ? 0 : -1}
          onClick={() => onChange(item.id)}
          onKeyDown={event => {
            const next =
              event.key === 'ArrowRight'
                ? (index + 1) % TABS.length
                : event.key === 'ArrowLeft'
                  ? (index + TABS.length - 1) % TABS.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? TABS.length - 1
                      : null;
            if (next !== null) {
              event.preventDefault();
              onChange(TABS[next].id);
              refs.current[next]?.focus();
            }
          }}
          className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[12px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600 ${value === item.id ? 'border-medical-600 text-medical-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <item.icon size={14} aria-hidden="true" />
          {item.label}
        </button>
      ))}
    </div>
  );
};

export const MedifSectionNavigation: React.FC<{
  sectionId: string;
  values: MedifValues;
  preferences: MedifPreferences;
  onSelect: (id: string) => void;
}> = ({ sectionId, values, preferences, onSelect }) => (
  <nav aria-label="Secciones del formulario MEDIF" className="min-w-0">
    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
      Índice del formulario
    </p>
    <div className="flex gap-1.5 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
      {MEDIF_SECTIONS.map((item, index) => {
        const ids = item.groups
          .flatMap(getMedifGroupFieldIds)
          .filter(id => !isMedifFieldHidden(preferences, id));
        const count = ids.filter(id => values[id]?.trim()).length;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={sectionId === item.id ? 'step' : undefined}
            className={`flex min-w-40 items-start gap-2 rounded-lg border px-2.5 py-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600 lg:min-w-0 ${sectionId === item.id ? 'border-medical-200 bg-medical-50 text-medical-800' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}
          >
            <span
              className={`flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold ${sectionId === item.id ? 'bg-medical-600 text-white' : 'bg-slate-100 text-slate-500'}`}
            >
              {index + 1}
            </span>
            <span className="min-w-0 text-[11px] font-semibold leading-4">
              {item.title}
              <span className="mt-0.5 block text-[9px] font-normal text-slate-400">
                {count} / {ids.length} casilleros con datos
              </span>
            </span>
          </button>
        );
      })}
    </div>
  </nav>
);
