import React from 'react';
import clsx from 'clsx';
import { AuditSection } from '@/types/auditActionTypes';
import { AuditSectionConfig } from '@/services/admin/auditViewConfig';

interface AuditSectionTabsProps {
  sections: AuditSection[];
  sectionConfig: Record<AuditSection, AuditSectionConfig>;
  activeSection: AuditSection;
  onSelectSection: (section: AuditSection) => void;
  variant?: 'clinical' | 'system';
}

export const AuditSectionTabs: React.FC<AuditSectionTabsProps> = ({
  sections,
  sectionConfig,
  activeSection,
  onSelectSection,
  variant = 'clinical',
}) => {
  const containerClassName =
    variant === 'clinical'
      ? 'flex flex-wrap items-center gap-2 p-1.5 bg-slate-100/50 rounded-2xl w-fit'
      : 'flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-200/30 backdrop-blur-sm rounded-2xl w-fit border border-slate-200/50 shadow-inner';

  const buttonClassName =
    variant === 'clinical'
      ? 'px-4 py-2 rounded-xl font-bold text-[11px] transition-all flex items-center gap-2'
      : 'px-4 py-2 rounded-xl font-bold text-[10px] uppercase tracking-wider transition-all flex items-center gap-2';

  return (
    <div
      className={containerClassName}
      role="tablist"
      aria-label={
        variant === 'clinical'
          ? 'Categorías clínicas de auditoría'
          : 'Categorías técnicas de auditoría'
      }
    >
      {sections.map(section => (
        <button
          key={section}
          type="button"
          role="tab"
          aria-selected={activeSection === section}
          onClick={() => onSelectSection(section)}
          className={clsx(
            buttonClassName,
            activeSection === section
              ? variant === 'clinical'
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                : 'bg-slate-900 text-white shadow-lg shadow-slate-200'
              : variant === 'clinical'
                ? 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'
          )}
        >
          <div
            className={clsx(
              variant === 'clinical' ? 'w-2 h-2 rounded-full' : 'w-1.5 h-1.5 rounded-full',
              activeSection === section && variant === 'system'
                ? 'bg-white animate-pulse'
                : sectionConfig[section].color.split(' ')[0].replace('bg-', 'bg-')
            )}
          />
          {sectionConfig[section].label}
        </button>
      ))}
    </div>
  );
};
