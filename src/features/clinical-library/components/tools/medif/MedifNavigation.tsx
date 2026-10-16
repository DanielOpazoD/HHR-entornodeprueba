import React, { useRef } from 'react';
import { FileText, List, Settings2 } from 'lucide-react';

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
    <div role="tablist" aria-label="Vistas de MEDIF" className="medif-tabs">
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
        >
          <item.icon size={14} aria-hidden="true" />
          {item.label}
        </button>
      ))}
    </div>
  );
};
