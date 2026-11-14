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
      className="block text-xs font-semibold text-slate-600"
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
            'hhr-field appearance-none cursor-pointer pr-8',
            isOriginMissing && missingRequiredClass
          )}
          value={localData.admissionOrigin}
          onChange={e =>
            setLocalData(current => ({
              ...current,
              admissionOrigin: e.target.value as AdmissionOrigin,
            }))
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
          className={clsx('hhr-field', isOriginDetailsMissing && missingRequiredClass)}
          placeholder="Especifique origen…"
          value={localData.admissionOriginDetails}
          onChange={e =>
            setLocalData(current => ({ ...current, admissionOriginDetails: e.target.value }))
          }
          autoFocus
        />
      )}
    </div>
  </div>
);
