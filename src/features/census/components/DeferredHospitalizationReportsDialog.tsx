import React, { useRef } from 'react';
import { FileClock } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { LAYER_Z_INDEX } from '@/shared/ui/layering';
import {
  RecoverableClinicalPanelModule,
  PanelModuleRetry,
} from './patient-row/RecoverableClinicalPanelModule';
import type { PatientHospitalizationReportsDialog } from './PatientHospitalizationReportsDialog';

type ReportsProps = React.ComponentProps<typeof PatientHospitalizationReportsDialog>;
const loadReports = () =>
  import('./PatientHospitalizationReportsDialog').then(module => ({
    default: module.PatientHospitalizationReportsDialog,
  }));
let ReportsModule = React.lazy(loadReports);
const resetReportsModule = () => {
  ReportsModule = React.lazy(loadReports);
};

const ReportsImportFallback: React.FC<{
  patientName: string;
  onClose: () => void;
  onRetry?: () => void;
}> = ({ patientName, onClose, onRetry }) => (
  <BaseModal
    isOpen
    onClose={onClose}
    title="Informes de hospitalización"
    icon={<FileClock size={18} />}
    size="lg"
    dataTestId="reports-module-loading"
    backdropZIndex={LAYER_Z_INDEX.modal}
    bodyClassName="p-0"
  >
    <div className="border-b border-slate-100 px-5 py-3">
      <p className="truncate text-sm font-semibold text-slate-800">{patientName}</p>
      <p className="mt-0.5 text-xs text-slate-500">
        Selecciona una hospitalización y el documento que necesitas.
      </p>
    </div>
    <div aria-busy={!onRetry} className="min-h-40 space-y-3 p-4">
      {onRetry ? (
        <PanelModuleRetry onRetry={onRetry} />
      ) : (
        <p className="text-xs text-slate-500">Abriendo informes…</p>
      )}
      <div aria-hidden="true" className="space-y-2">
        {[0, 1].map(index => (
          <div
            key={index}
            className="min-h-[60px] rounded-lg border border-slate-200 bg-white px-4 py-3"
          >
            <div className="h-3 w-40 rounded bg-slate-100" />
            <div className="mt-2 h-2 w-24 rounded bg-slate-50" />
          </div>
        ))}
      </div>
    </div>
  </BaseModal>
);

const OpenReports = (props: ReportsProps) => {
  const opener = useRef(document.activeElement as HTMLElement | null);
  const close = () => {
    props.onClose();
    if (opener.current?.isConnected) opener.current.focus();
  };
  return (
    <RecoverableClinicalPanelModule
      resetModule={resetReportsModule}
      fallback={retry => (
        <ReportsImportFallback patientName={props.patientName} onClose={close} onRetry={retry} />
      )}
      render={() => <ReportsModule {...props} onClose={close} />}
    />
  );
};

/** No report code is requested until an actual report dialog is opened. */
export const DeferredHospitalizationReportsDialog = (props: ReportsProps) =>
  props.isOpen ? <OpenReports {...props} /> : null;
