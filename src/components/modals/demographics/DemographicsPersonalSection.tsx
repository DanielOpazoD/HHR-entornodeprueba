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

const missingRequiredClass =
  'border-amber-300 bg-amber-50/60 focus:border-amber-500 focus:ring-amber-500/20';

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
      <h4 className="flex items-center gap-2 text-[11px] font-bold text-slate-800 uppercase tracking-wider pb-1.5 border-b border-slate-100">
        <User size={14} className="text-blue-500" />
        Información Personal
      </h4>

      <div className="space-y-3">
        {isProvisionalRnMode ? (
          <div className="space-y-1">
            <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wide ml-1">
              Nombre provisional RN
            </label>
            <input
              type="text"
              aria-invalid={isMissingRequired('nombre provisional') || undefined}
              className={clsx(
                'w-full px-2.5 py-1.5 border rounded-lg text-[13px] transition-all shadow-sm focus:bg-white focus:ring-2',
                isMissingRequired('nombre provisional')
                  ? missingRequiredClass
                  : 'bg-slate-50 border-transparent focus:ring-blue-500/20 focus:border-blue-500'
              )}
              placeholder="RN de Nombre Apellido Madre"
              value={localData.provisionalName}
              onChange={e => {
                setLocalData({ ...localData, provisionalName: e.target.value });
                setError(null);
              }}
            />
            <p className="text-[9px] text-amber-700 font-semibold ml-1">
              Usa este modo cuando el RN aun no tiene nombre oficial ni RUT.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wide ml-1">
                Nombre
              </label>
              <div className="grid grid-cols-1 gap-2">
                <input
                  type="text"
                  aria-invalid={isMissingRequired('nombre') || undefined}
                  className={clsx(
                    'w-full px-2.5 py-1.5 border rounded-lg text-[13px] transition-all shadow-sm focus:bg-white focus:ring-2',
                    isMissingRequired('nombre')
                      ? missingRequiredClass
                      : 'bg-slate-50 border-transparent focus:ring-blue-500/20 focus:border-blue-500'
                  )}
                  placeholder="Nombre"
                  value={localData.firstName}
                  onChange={e => {
                    setLocalData({ ...localData, firstName: e.target.value });
                    setError(null);
                  }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wide ml-1">
                Apellidos
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  aria-invalid={isMissingRequired('apellido paterno') || undefined}
                  className={clsx(
                    'w-full px-2.5 py-1.5 border rounded-lg text-[13px] transition-all shadow-sm focus:bg-white focus:ring-2',
                    isMissingRequired('apellido paterno')
                      ? missingRequiredClass
                      : 'bg-slate-50 border-transparent focus:ring-blue-500/20 focus:border-blue-500'
                  )}
                  placeholder="Apellido paterno"
                  value={localData.lastName}
                  onChange={e => {
                    setLocalData({ ...localData, lastName: e.target.value });
                    setError(null);
                  }}
                />
                <input
                  type="text"
                  aria-invalid={isMissingRequired('apellido materno') || undefined}
                  className={clsx(
                    'w-full px-2.5 py-1.5 border rounded-lg text-[13px] transition-all shadow-sm focus:bg-white focus:ring-2',
                    isMissingRequired('apellido materno')
                      ? missingRequiredClass
                      : 'bg-slate-50 border-transparent focus:ring-blue-500/20 focus:border-blue-500'
                  )}
                  placeholder="Apellido materno"
                  value={localData.secondLastName}
                  onChange={e => {
                    setLocalData({ ...localData, secondLastName: e.target.value });
                    setError(null);
                  }}
                />
              </div>
            </div>
          </>
        )}

        <div className="space-y-1">
          <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wide ml-1">
            Documento
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-transparent rounded-lg text-[13px] text-slate-700 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none disabled:opacity-70"
              value={localData.documentType}
              disabled={isProvisionalRnMode}
              onChange={e => {
                setLocalData({ ...localData, documentType: e.target.value as DocumentType });
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
                'w-full sm:col-span-2 px-2.5 py-1.5 border rounded-lg text-[13px] transition-all shadow-sm focus:bg-white focus:ring-2 disabled:opacity-70',
                isMissingRequired('documento')
                  ? missingRequiredClass
                  : 'bg-slate-50 border-transparent focus:ring-blue-500/20 focus:border-blue-500'
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
                setLocalData({ ...localData, rut: e.target.value });
                setError(null);
              }}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wide ml-1">
            Fecha de Nacimiento
          </label>
          <input
            type="date"
            aria-invalid={isMissingRequired('fecha de nacimiento') || undefined}
            className={clsx(
              'w-full px-2.5 py-1.5 bg-slate-50 border rounded-lg text-[13px] transition-all shadow-sm',
              'focus:bg-white focus:ring-2 focus:ring-blue-500/20 ease-out duration-200',
              error
                ? 'border-red-300 focus:border-red-400'
                : isMissingRequired('fecha de nacimiento')
                  ? 'border-amber-300 bg-amber-50/60 focus:border-amber-500 focus:ring-amber-500/20'
                  : 'border-transparent focus:border-blue-500'
            )}
            value={localData.birthDate}
            onChange={e => {
              setLocalData({ ...localData, birthDate: e.target.value });
              setError(null);
            }}
          />
          {error && <p className="text-[9px] text-red-500 font-bold ml-1">{error}</p>}
          {!error && localData.birthDate && calculateFormattedAge(localData.birthDate) && (
            <p className="text-[9px] text-emerald-600 font-bold ml-1">
              Edad calculada: {calculateFormattedAge(localData.birthDate)}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wide ml-1">
            Previsión
          </label>
          <div className="relative">
            <select
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-transparent rounded-lg text-[13px] text-slate-700 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none appearance-none cursor-pointer shadow-sm transition-all"
              value={localData.insurance}
              onChange={e => setLocalData({ ...localData, insurance: e.target.value as Insurance })}
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
