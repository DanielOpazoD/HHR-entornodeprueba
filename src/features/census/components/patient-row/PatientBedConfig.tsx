import React from 'react';
import { BedDefinition, PatientData } from '@/types';
import { Baby, Clock, Plus } from 'lucide-react';
import clsx from 'clsx';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';
import type { EventTextHandler } from './inputCellTypes';
import type {
  MaybePromiseVoid,
  PatientBedConfigCallbacks,
  RowMenuAlign,
} from './patientRowContracts';
import { calculateHospitalizedDays } from '@/features/census/controllers/patientBedConfigViewController';
import {
  resolveBedModeButtonModel,
  resolveClinicalCribButtonModel,
  resolveCompanionButtonModel,
  resolvePatientBedIndicators,
} from '@/features/census/controllers/patientBedConfigMenuController';
import { runPatientRowAsyncActionSafely } from '@/features/census/controllers/patientRowAsyncActionController';

interface PatientBedConfigProps extends PatientBedConfigCallbacks {
  bed: BedDefinition;
  data: PatientData;
  currentDateString: string;
  isBlocked: boolean;
  hasCompanion: boolean;
  hasClinicalCrib: boolean;
  isCunaMode: boolean;
  onTextChange: EventTextHandler;
  readOnly?: boolean;
  align?: RowMenuAlign;
}

export const PatientBedConfig: React.FC<PatientBedConfigProps> = ({
  bed,
  data,
  currentDateString,
  isBlocked,
  hasCompanion,
  hasClinicalCrib,
  isCunaMode,
  onToggleMode,
  onToggleCompanion,
  onToggleClinicalCrib,
  onTextChange,
  onUpdateClinicalCrib,
  readOnly = false,
  align = 'top',
}) => {
  const { isOpen: isMenuOpen, menuRef, toggle } = useDropdownMenu();

  const daysHospitalized = calculateHospitalizedDays({
    admissionDate: data.admissionDate,
    currentDate: currentDateString,
  });
  const hasPatient = !!data.patientName;
  const indicators = resolvePatientBedIndicators({
    isCunaMode,
    hasCompanion,
    hasClinicalCrib,
  });
  const bedModeModel = resolveBedModeButtonModel(isCunaMode);
  const companionModel = resolveCompanionButtonModel(hasCompanion);
  const clinicalCribModel = resolveClinicalCribButtonModel(hasClinicalCrib);
  const runAsyncSafe = (action: () => MaybePromiseVoid) => runPatientRowAsyncActionSafely(action);

  return (
    <td className="p-[2px] border-r border-slate-200 text-center w-24 relative">
      <div className="flex flex-col items-center gap-0.5">
        {/* BED NAME */}
        <div className="font-display font-bold text-lg text-slate-800 flex items-center gap-1.5 leading-none tracking-tight">
          {bed.name}
          {isCunaMode && <Baby size={16} className="text-pink-500 drop-shadow-sm" />}
        </div>

        {/* Days Hospitalized Counter */}
        {!isBlocked && hasPatient && daysHospitalized !== null && (
          <div
            className="flex items-center gap-0.5 text-slate-500"
            title={`${daysHospitalized} días hospitalizado`}
          >
            <Clock size={10} className="text-slate-400" />
            <span className="text-[10px] font-semibold">{daysHospitalized}d</span>
          </div>
        )}

        {/* Static Indicators (Persistent information) */}
        {!isBlocked && (
          <div className="flex gap-1 mt-1">
            {indicators.map(indicator => (
              <span key={indicator.key} className={indicator.className} title={indicator.title}>
                {indicator.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* FLOATING CONFIG MENU (Top Right) */}
      {!isBlocked && !readOnly && (
        <div className="absolute top-0 right-0 p-0.5 z-20" ref={menuRef}>
          <button
            onClick={toggle}
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
            <div
              className={clsx(
                'absolute left-0 w-56 bg-white rounded-lg shadow-2xl border border-slate-200 overflow-hidden animate-scale-in',
                align === 'top' ? 'top-full mt-1' : 'bottom-full mb-1'
              )}
            >
              <div className="p-1.5 flex flex-col gap-1">
                <div className="px-2 py-1 text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-50 mb-0.5 flex justify-between items-center">
                  <span>Opciones</span>
                  <span>⚙️</span>
                </div>

                {/* Mode Toggle - DYNAMIC TEXT AS REQUESTED */}
                <button
                  onClick={() => runAsyncSafe(onToggleMode)}
                  className={bedModeModel.className}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{bedModeModel.emoji}</span>
                    <span className="text-left leading-none">{bedModeModel.label}</span>
                  </div>
                  <div className={bedModeModel.dotClassName} />
                </button>

                {/* Companion Toggle */}
                <button
                  onClick={() => runAsyncSafe(onToggleCompanion)}
                  className={companionModel.className}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🤱</span>
                    <span>RN Sano</span>
                  </div>
                  <div className={companionModel.dotClassName} />
                </button>

                {/* Clinical Crib Toggle */}
                {!isCunaMode && (
                  <button onClick={onToggleClinicalCrib} className={clinicalCribModel.className}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">➕</span>
                      <span>Agregar Cuna Clínica</span>
                    </div>
                    <div className={clinicalCribModel.dotClassName} />
                  </button>
                )}

                {/* Clinical Crib Actions */}
                {hasClinicalCrib && (
                  <div className="flex gap-1 mt-1 border-t border-slate-100 pt-1.5 px-0.5">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onUpdateClinicalCrib('remove');
                      }}
                      className="flex-shrink-0 bg-red-50 hover:bg-red-100 text-red-500 p-2 rounded-md transition-all border border-red-100"
                      title="Eliminar Cuna"
                    >
                      <span className="text-xs">🗑️</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Extra beds allow editing location */}
      {bed.isExtra && (
        <input
          type="text"
          placeholder="Ubicación"
          className="w-full text-[10px] p-1 mt-1.5 border border-amber-200 rounded text-center bg-amber-50/50 text-amber-900 placeholder:text-amber-400 focus:ring-2 focus:ring-amber-400/20 focus:border-amber-400 focus:outline-none transition-all duration-200"
          value={data.location || ''}
          onChange={onTextChange('location')}
          disabled={readOnly}
        />
      )}
    </td>
  );
};
