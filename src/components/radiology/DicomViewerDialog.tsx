import React, { lazy, Suspense } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { BaseModal } from '@/components/shared/BaseModal';
import { LAYER_Z_INDEX } from '@/shared/ui/layering';
import type { DicomCapture } from '@/services/radiology/dicomTypes';

const Viewer = lazy(() => import('./DicomViewer'));
export interface DicomViewerDialogProps {
  link: string;
  patientId: string;
  title: string;
  onClose: () => void;
  onCapture?: (capture: DicomCapture) => void;
}

/** Mount only after an explicit click; no prefetch or viewer imports from census startup. */
export const DicomViewerDialog: React.FC<DicomViewerDialogProps> = props => (
  <BaseModal
    isOpen
    backdropZIndex={LAYER_Z_INDEX.modal + 1}
    onClose={props.onClose}
    title={`Visor DICOM · ${props.title}`}
    size="3xl"
    className="!w-[96vw] !max-w-[1480px]"
    bodyClassName="!max-h-[85vh] !p-0"
  >
    <ErrorBoundary
      fallbackRender={({ resetErrorBoundary }) => (
        <div role="alert" className="p-5 text-sm text-slate-700">
          No se pudo cargar el visor.
          <button type="button" onClick={resetErrorBoundary} className="ml-3 underline">
            Reintentar
          </button>
        </div>
      )}
    >
      <Suspense
        fallback={
          <p role="status" className="p-5 text-sm">
            Cargando visor…
          </p>
        }
      >
        <Viewer {...props} />
      </Suspense>
    </ErrorBoundary>
  </BaseModal>
);
