import React from 'react';
import clsx from 'clsx';
import { Bed, UserPlus } from 'lucide-react';
import { LocalDemographicsState } from './types';

interface DemographicsHeaderProps {
  bedId: string;
  displayName: string;
  displayRut: string;
  age?: string;
  isClinicalCribPatient: boolean;
  localData: LocalDemographicsState;
  setLocalData: React.Dispatch<React.SetStateAction<LocalDemographicsState>>;
}

export const DemographicsHeader: React.FC<DemographicsHeaderProps> = ({
  bedId,
  displayName,
  displayRut,
  age,
  isClinicalCribPatient,
  localData,
  setLocalData,
}) => {
  const fillDemoPatient = () => {
    setLocalData(prev => ({
      ...prev,
      firstName: 'Daniel',
      lastName: 'Opazo',
      secondLastName: 'Damiani',
      provisionalName: '',
      identityStatus: 'official',
      documentType: 'RUT',
      rut: '17.752.753-K',
      birthDate: '1990-11-15',
      pathology: 'Neumonía (Probando)',
    }));
  };

  return (
    <>
      <div className="flex items-center justify-between pb-2 border-b border-slate-100/80">
        <div>
          <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-blue-700">
            <Bed size={12} aria-hidden="true" />
            Cama {bedId}
          </div>
          <p className="text-base font-display font-black text-slate-900 leading-tight tracking-tight">
            {displayName}
          </p>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
            {displayRut}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {age && (
            <div className="bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full text-[11px] font-bold border border-blue-100">
              {age}
            </div>
          )}
          <button
            type="button"
            aria-label="Rellenar paciente ficticio"
            title="Rellenar paciente ficticio"
            onClick={fillDemoPatient}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <UserPlus size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      {isClinicalCribPatient && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={clsx(
              'px-2 py-1.5 rounded-lg text-[11px] font-bold border transition-colors',
              localData.identityStatus === 'provisional'
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            )}
            onClick={() =>
              setLocalData(prev => ({
                ...prev,
                identityStatus: 'provisional',
                documentType: 'RUT',
                rut: '',
              }))
            }
          >
            RN provisional
          </button>
          <button
            type="button"
            className={clsx(
              'px-2 py-1.5 rounded-lg text-[11px] font-bold border transition-colors',
              localData.identityStatus === 'official'
                ? 'bg-blue-50 border-blue-200 text-blue-800'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            )}
            onClick={() =>
              setLocalData(prev => ({
                ...prev,
                identityStatus: 'official',
              }))
            }
          >
            Identidad oficial
          </button>
        </div>
      )}
    </>
  );
};
