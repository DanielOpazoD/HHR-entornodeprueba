import React from 'react';
import clsx from 'clsx';

import type {
  ClinicalAuditPatientPackageIntentId,
  ClinicalAuditPatientPackageIntentOption,
} from '@/services/admin/clinicalAuditPatientPackageFilters';

interface AuditPatientPackageIntentTabsProps {
  options: ClinicalAuditPatientPackageIntentOption[];
  activeIntent: ClinicalAuditPatientPackageIntentId;
  onIntentChange: (value: ClinicalAuditPatientPackageIntentId) => void;
  panelId: string;
  tabsId: string;
}

export const buildPatientPackageIntentTabId = (
  tabsId: string,
  intentId: ClinicalAuditPatientPackageIntentId
): string => `${tabsId}-${intentId}`;

export const AuditPatientPackageIntentTabs: React.FC<AuditPatientPackageIntentTabsProps> = ({
  options,
  activeIntent,
  onIntentChange,
  panelId,
  tabsId,
}) => {
  const intentTabRefs = React.useRef<
    Partial<Record<ClinicalAuditPatientPackageIntentId, HTMLButtonElement | null>>
  >({});

  const handleIntentTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    optionId: ClinicalAuditPatientPackageIntentId
  ) => {
    const currentIndex = options.findIndex(option => option.id === optionId);
    if (currentIndex === -1) return;

    const lastIndex = options.length - 1;
    const nextIndexByKey: Record<string, number> = {
      ArrowLeft: currentIndex === 0 ? lastIndex : currentIndex - 1,
      ArrowUp: currentIndex === 0 ? lastIndex : currentIndex - 1,
      ArrowRight: currentIndex === lastIndex ? 0 : currentIndex + 1,
      ArrowDown: currentIndex === lastIndex ? 0 : currentIndex + 1,
      Home: 0,
      End: lastIndex,
    };
    const nextIndex = nextIndexByKey[event.key];
    if (nextIndex === undefined) return;

    event.preventDefault();
    const nextOption = options[nextIndex];
    onIntentChange(nextOption.id);
    intentTabRefs.current[nextOption.id]?.focus();
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2 px-5 py-2"
      aria-label="Vista de paquetes por intención"
      role="tablist"
    >
      {options.map(option => {
        const isActive = activeIntent === option.id;
        return (
          <button
            key={option.id}
            ref={element => {
              intentTabRefs.current[option.id] = element;
            }}
            type="button"
            role="tab"
            id={buildPatientPackageIntentTabId(tabsId, option.id)}
            aria-selected={isActive}
            aria-controls={panelId}
            aria-label={`${option.label} ${option.count}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onIntentChange(option.id)}
            onKeyDown={event => handleIntentTabKeyDown(event, option.id)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-black transition focus:outline-none focus:ring-4',
              isActive
                ? 'border-indigo-200 bg-indigo-50 text-indigo-700 focus:ring-indigo-500/15'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 focus:ring-slate-500/10'
            )}
          >
            <span>{option.label}</span>
            <span
              className={clsx(
                'rounded-md px-1.5 py-0.5 text-[10px]',
                isActive ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-600'
              )}
            >
              {option.count}
            </span>
          </button>
        );
      })}
    </div>
  );
};
