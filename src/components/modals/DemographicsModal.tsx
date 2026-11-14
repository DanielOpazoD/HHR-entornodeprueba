import React from 'react';
import { ClipboardPaste, User } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { buttonClassName } from '@/components/ui/base/buttonStyles';
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
  onImportEloisaCode,
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
              className="mb-1.5 flex items-center justify-end gap-2 text-xs font-semibold text-slate-600"
            >
              <span>Campos obligatorios pendientes</span>
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-slate-600">
                {requiredCompletionMessage}
              </span>
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end items-center gap-3">
            {requiresCompleteDemographics && onImportEloisaCode ? (
              <button
                type="button"
                onClick={onImportEloisaCode}
                className={buttonClassName('outline', 'md', 'mr-auto')}
              >
                <ClipboardPaste size={15} />
                Importar código de Eloísa
              </button>
            ) : null}
            <button onClick={handleCancel} className={buttonClassName('ghost')}>
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={requiresCompleteDemographics && !requiredCompletion.isComplete}
              className={buttonClassName('primary')}
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
