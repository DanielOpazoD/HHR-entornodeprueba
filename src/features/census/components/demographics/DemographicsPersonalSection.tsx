import React from 'react';
import clsx from 'clsx';
import { User } from 'lucide-react';
import { LocalDemographicsState, DocumentType, Insurance } from './types';
import { calculateFormattedAge } from './utils';

interface DemographicsPersonalSectionProps {
  localData: LocalDemographicsState;
  setLocalData: React.Dispatch<React.SetStateAction<LocalDemographicsState>>;
  isProvisionalRnMode: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  missingRequiredFields?: string[];
}

const missingRequiredClass = 'border-amber-300 bg-amber-50/60 focus:border-amber-500';

export const DemographicsPersonalSection: React.FC<DemographicsPersonalSectionProps> = ({
  localData,
  setLocalData,
  isProvisionalRnMode,
  error,
  setError,
  missingRequiredFields = [],
}) => {
  const isMissingRequired = (field: string): boolean => missingRequiredFields.includes(field);

  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800 pb-1.5 border-b border-slate-100">
        <User size={14} className="text-blue-500" />
        Información Personal
      </h4>

      <div className="space-y-3">
        {isProvisionalRnMode ? (
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-600">
              Nombre provisional RN
            </label>
            <input
              type="text"
              aria-invalid={isMissingRequired('nombre provisional') || undefined}
              className={clsx(
                'hhr-field',
                isMissingRequired('nombre provisional') && missingRequiredClass
              )}
              placeholder="RN de Nombre Apellido Madre"
              value={localData.provisionalName}
              onChange={e => {
                setLocalData(current => ({ ...current, provisionalName: e.target.value }));
                setError(null);
              }}
            />
            <p className="text-xs text-amber-700 font-semibold">
              Usa este modo cuando el RN aún no tiene nombre oficial ni RUT.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-600">Nombre</label>
              <div className="grid grid-cols-1 gap-2">
                <input
                  type="text"
                  aria-invalid={isMissingRequired('nombre') || undefined}
                  className={clsx('hhr-field', isMissingRequired('nombre') && missingRequiredClass)}
                  placeholder="Nombre"
                  value={localData.firstName}
                  onChange={e => {
                    setLocalData(current => ({ ...current, firstName: e.target.value }));
                    setError(null);
                  }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-600">Apellidos</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  aria-invalid={isMissingRequired('apellido paterno') || undefined}
                  className={clsx(
                    'hhr-field',
                    isMissingRequired('apellido paterno') && missingRequiredClass
                  )}
                  placeholder="Apellido paterno"
                  value={localData.lastName}
                  onChange={e => {
                    setLocalData(current => ({ ...current, lastName: e.target.value }));
                    setError(null);
                  }}
                />
                <input
                  type="text"
                  aria-invalid={isMissingRequired('apellido materno') || undefined}
                  className={clsx(
                    'hhr-field',
                    isMissingRequired('apellido materno') && missingRequiredClass
                  )}
                  placeholder="Apellido materno"
                  value={localData.secondLastName}
                  onChange={e => {
                    setLocalData(current => ({ ...current, secondLastName: e.target.value }));
                    setError(null);
                  }}
                />
              </div>
            </div>
          </>
        )}

        <div className="space-y-1">
          <label className="block text-xs font-semibold text-slate-600">Documento</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select
              className="hhr-field"
              value={localData.documentType}
              disabled={isProvisionalRnMode}
              onChange={e => {
                setLocalData(current => ({
                  ...current,
                  documentType: e.target.value as DocumentType,
                }));
                setError(null);
              }}
            >
              <option value="RUT">RUT</option>
              <option value="Pasaporte">Pasaporte</option>
            </select>
            <input
              type="text"
              aria-invalid={isMissingRequired('documento') || undefined}
              className={clsx(
                'hhr-field sm:col-span-2',
                isMissingRequired('documento') && missingRequiredClass
              )}
              placeholder={
                isProvisionalRnMode
                  ? 'Pendiente'
                  : localData.documentType === 'Pasaporte'
                    ? 'N° Pasaporte'
                    : '12.345.678-9'
              }
              value={isProvisionalRnMode ? '' : localData.rut}
              disabled={isProvisionalRnMode}
              onChange={e => {
                setLocalData(current => ({ ...current, rut: e.target.value }));
                setError(null);
              }}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-semibold text-slate-600">Fecha de Nacimiento</label>
          <input
            type="date"
            aria-invalid={isMissingRequired('fecha de nacimiento') || undefined}
            className={clsx(
              'hhr-field',
              error
                ? 'border-red-300 focus:border-red-400'
                : isMissingRequired('fecha de nacimiento') && missingRequiredClass
            )}
            value={localData.birthDate}
            onChange={e => {
              setLocalData(current => ({ ...current, birthDate: e.target.value }));
              setError(null);
            }}
          />
          {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
          {!error && localData.birthDate && calculateFormattedAge(localData.birthDate) && (
            <p className="text-xs text-emerald-700 font-semibold">
              Edad calculada: {calculateFormattedAge(localData.birthDate)}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-semibold text-slate-600">Previsión</label>
          <div className="relative">
            <select
              className="hhr-field appearance-none cursor-pointer pr-8"
              value={localData.insurance}
              onChange={e =>
                setLocalData(current => ({ ...current, insurance: e.target.value as Insurance }))
              }
            >
              <option value="Fonasa">Fonasa</option>
              <option value="Isapre">Isapre</option>
              <option value="Particular">Particular</option>
            </select>
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
