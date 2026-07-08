import React from 'react';
import { User } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { DemographicsModalProps } from './demographics/types';
import { useDemographicsLogic } from './demographics/useDemographicsLogic';
import { DemographicsHeader } from './demographics/DemographicsHeader';
import { DemographicsPersonalSection } from './demographics/DemographicsPersonalSection';
import { DemographicsOriginSection } from './demographics/DemographicsOriginSection';

export type { DemographicSubset } from './demographics/types';

export const DemographicsModal: React.FC<DemographicsModalProps> = ({
  isOpen,
  onClose,
  onCancel,
  onEmptySave,
  data,
  onSave,
  bedId,
  recordDate,
  isClinicalCribPatient = false,
  requiresCompleteDemographics = false,
  canUseArbitraryAdmissionDate = false,
}) => {
  const {
    localData,
    setLocalData,
    error,
    setError,
    isProvisionalRnMode,
    displayName,
    displayRut,
    handleSave,
    requiredCompletion,
    requiredCompletionMessage,
  } = useDemographicsLogic({
    data,
    isClinicalCribPatient,
    isOpen,
    bedId,
    recordDate,
    onSave,
    onClose,
    onEmptySave,
    requiresCompleteDemographics,
  });

  const handleCancel = React.useCallback(() => {
    onCancel?.();
    onClose();
  }, [onCancel, onClose]);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleCancel}
      title="Datos Demográficos"
      icon={<User size={18} />}
      size="2xl"
      headerIconColor="text-blue-600"
      variant="white"
      closeOnBackdrop={false}
      bodyClassName="p-4 space-y-3 max-h-[86vh] overflow-y-auto"
    >
      <div className="space-y-3">
        <DemographicsHeader
          bedId={bedId}
          displayName={displayName}
          displayRut={displayRut}
          age={data.age}
          isClinicalCribPatient={isClinicalCribPatient}
          localData={localData}
          setLocalData={setLocalData}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DemographicsPersonalSection
            localData={localData}
            setLocalData={setLocalData}
            isProvisionalRnMode={isProvisionalRnMode}
            error={error}
            setError={setError}
            missingRequiredFields={
              requiresCompleteDemographics ? requiredCompletion.missingFields : []
            }
          />
          <DemographicsOriginSection
            localData={localData}
            setLocalData={setLocalData}
            recordDate={recordDate}
            canUseArbitraryAdmissionDate={canUseArbitraryAdmissionDate}
            missingRequiredFields={
              requiresCompleteDemographics ? requiredCompletion.missingFields : []
            }
          />
        </div>

        <div className="sticky bottom-0 bg-white/95 backdrop-blur pt-2 mt-1 border-t border-slate-100">
          {requiresCompleteDemographics && !requiredCompletion.isComplete ? (
            <div
              role="status"
              aria-live="polite"
              className="mb-1.5 flex items-center justify-end gap-2 text-[10px] font-semibold text-slate-500"
            >
              <span>Campos obligatorios pendientes</span>
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-slate-600">
                {requiredCompletionMessage}
              </span>
            </div>
          ) : null}

          <div className="flex justify-end items-center gap-3">
            <button
              onClick={handleCancel}
              className="text-slate-400 hover:text-slate-600 text-[13px] font-bold transition-colors px-2"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={requiresCompleteDemographics && !requiredCompletion.isComplete}
              className={`px-5 py-2 rounded-lg text-[13px] font-bold transition-all active:scale-95 active:translate-y-0 flex items-center gap-1.5 ${
                requiresCompleteDemographics && !requiredCompletion.isComplete
                  ? 'cursor-not-allowed bg-slate-200 text-slate-500 shadow-none'
                  : 'bg-blue-600 text-white shadow-lg shadow-blue-500/30 hover:bg-blue-700 hover:shadow-blue-500/40 hover:-translate-y-0.5'
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              Guardar Cambios
            </button>
          </div>
        </div>
      </div>
    </BaseModal>
  );
};
