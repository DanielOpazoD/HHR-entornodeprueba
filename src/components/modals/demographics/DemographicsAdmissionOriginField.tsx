import React from 'react';
import clsx from 'clsx';
import { ADMISSION_ORIGIN_OPTIONS } from '@/constants/clinicalSpecialtyConstants';
import { AdmissionOrigin, LocalDemographicsState } from './types';

interface DemographicsAdmissionOriginFieldProps {
  localData: LocalDemographicsState;
  setLocalData: React.Dispatch<React.SetStateAction<LocalDemographicsState>>;
  isOriginMissing: boolean;
  isOriginDetailsMissing: boolean;
  missingRequiredClass: string;
}

export const DemographicsAdmissionOriginField: React.FC<DemographicsAdmissionOriginFieldProps> = ({
  localData,
  setLocalData,
  isOriginMissing,
  isOriginDetailsMissing,
  missingRequiredClass,
}) => (
  <div className="space-y-1">
    <label
      htmlFor="demographics-admission-origin"
      className="block text-[9px] font-bold text-slate-500 uppercase tracking-wide ml-1"
    >
      Origen del Ingreso
    </label>
    <div className="space-y-1.5">
      <div className="relative">
        <select
          id="demographics-admission-origin"
          aria-label="Origen del ingreso"
          aria-invalid={isOriginMissing || undefined}
          className={clsx(
            'w-full px-2.5 py-1.5 border rounded-lg text-[13px] text-slate-700 focus:bg-white focus:ring-2 outline-none appearance-none cursor-pointer shadow-sm transition-all',
            isOriginMissing
              ? missingRequiredClass
              : 'bg-slate-50 border-transparent focus:ring-blue-500/20 focus:border-blue-500'
          )}
          value={localData.admissionOrigin}
          onChange={e =>
            setLocalData({
              ...localData,
              admissionOrigin: e.target.value as AdmissionOrigin,
            })
          }
        >
          <option value="">-- Seleccionar --</option>
          {ADMISSION_ORIGIN_OPTIONS.map(opt => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {localData.admissionOrigin === 'Otro' && (
        <input
          type="text"
          aria-invalid={isOriginDetailsMissing || undefined}
          className={clsx(
            'w-full px-2.5 py-1.5 border rounded-lg text-[13px] focus:ring-2 outline-none transition-all shadow-inner',
            isOriginDetailsMissing
              ? missingRequiredClass
              : 'bg-white border-slate-200 focus:ring-blue-500/20 focus:border-blue-500'
          )}
          placeholder="Especifique origen..."
          value={localData.admissionOriginDetails}
          onChange={e => setLocalData({ ...localData, admissionOriginDetails: e.target.value })}
          autoFocus
        />
      )}
    </div>
  </div>
);
