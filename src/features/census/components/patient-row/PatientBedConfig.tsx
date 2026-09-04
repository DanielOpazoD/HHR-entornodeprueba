import React from 'react';
import { Baby, Clock, Plus } from 'lucide-react';
import clsx from 'clsx';
import { usePatientBedConfigController } from '@/features/census/components/patient-row/usePatientBedConfigController';
import { PatientBedConfigMenuPanel } from '@/features/census/components/patient-row/PatientBedConfigMenuPanel';
import { buildPatientBedConfigSections } from '@/features/census/controllers/patientBedConfigSectionsController';
import type { PatientBedConfigProps } from '@/features/census/components/patient-row/patientRowContracts';
import { IsolationBadge } from '@/features/census/components/patient-row/IsolationBadge';

export const PatientBedConfig: React.FC<PatientBedConfigProps> = ({
  bed,
  data,
  currentDateString,
  isBlocked,
  hasCompanion,
  hasClinicalCrib,
  isCunaMode,
  onToggleCompanion,
  onToggleClinicalCrib,
  onTextChange,
  onUpdateClinicalCrib,
  readOnly = false,
  align = 'top',
}) => {
  const {
    isMenuOpen,
    menuRef,
    toggleMenu,
    closeMenu,
    viewState,
    handleToggleCompanion,
    handleToggleClinicalCrib,
    handleRemoveClinicalCrib,
  } = usePatientBedConfigController({
    admissionDate: data.admissionDate,
    currentDateString,
    patientName: data.patientName,
    isBlocked,
    hasCompanion,
    hasClinicalCrib,
    isCunaMode,
    readOnly,
    onToggleCompanion,
    onToggleClinicalCrib,
    onUpdateClinicalCrib,
  });
  const sections = buildPatientBedConfigSections({
    props: {
      bed,
      data,
      currentDateString,
      isBlocked,
      hasCompanion,
      hasClinicalCrib,
      isCunaMode,
      onToggleCompanion,
      onToggleClinicalCrib,
      onTextChange,
      onUpdateClinicalCrib,
      readOnly,
      align,
    },
    viewState,
    handlers: {
      handleToggleCompanion,
      handleToggleClinicalCrib,
      handleRemoveClinicalCrib,
    },
  });

  return (
    <td className="p-[2px] border-r border-slate-200 text-center w-24 relative">
      <div className="flex flex-col items-center gap-0.5">
        {/* BED NAME */}
        <div className="font-display font-bold text-lg text-slate-800 flex items-center gap-1.5 leading-none tracking-tight">
          {sections.display.bedName}
          {sections.display.showCunaIcon && (
            <Baby size={16} className="text-pink-500 drop-shadow-sm" />
          )}
        </div>

        {/* Days Hospitalized Counter */}
        {sections.display.showDaysCounter && (
          <div
            className="flex items-center gap-0.5 text-slate-500"
            title={`${sections.display.daysHospitalized} días hospitalizado`}
          >
            <Clock size={10} className="text-slate-400" />
            <span className="text-[10px] font-semibold">{sections.display.daysHospitalized}d</span>
          </div>
        )}

        {data.isIsolated && (
          <IsolationBadge
            isolationType={data.isolationType}
            microorganism={data.isolationMicroorganism}
          />
        )}

        {/* Static Indicators (Persistent information) */}
        {sections.display.showIndicators && (
          <div className="flex gap-1 mt-1">
            {sections.display.indicators.map(indicator => (
              <span key={indicator.key} className={indicator.className} title={indicator.title}>
                {indicator.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* FLOATING CONFIG MENU (Top Right) */}
      {viewState.showMenu && (
        <div className="absolute top-0 right-0 p-0.5 z-20" ref={menuRef}>
          <button
            onClick={toggleMenu}
            className={clsx(
              'p-0.5 rounded shadow-sm border transition-all duration-200',
              isMenuOpen
                ? 'bg-slate-800 border-slate-900 text-white'
                : 'opacity-0 group-hover/row:opacity-100 bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-100'
            )}
            title="Configuración de cama"
          >
            <Plus size={8} strokeWidth={4} />
          </button>

          {/* Dropdown content */}
          {isMenuOpen && (
            <PatientBedConfigMenuPanel {...sections.menu} anchorRef={menuRef} onClose={closeMenu} />
          )}
        </div>
      )}

      {/* Extra beds allow editing location */}
      {sections.extraLocation.shouldRender && (
        <input
          type="text"
          placeholder="Ubicación"
          className="w-full text-[10px] p-1 mt-1.5 border border-amber-200 rounded text-center bg-amber-50/50 text-amber-900 placeholder:text-amber-400 focus:ring-2 focus:ring-amber-400/20 focus:border-amber-400 focus:outline-none transition-all duration-200"
          value={sections.extraLocation.value}
          onChange={sections.extraLocation.onChange}
          disabled={sections.extraLocation.readOnly}
        />
      )}
    </td>
  );
};
