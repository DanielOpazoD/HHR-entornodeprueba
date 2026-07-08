import React from 'react';
import { PrescriptionPinGate } from '@/features/prescriptions/components/PrescriptionPinGate';
import { PrescriptionUploadForm } from '@/features/prescriptions/components/PrescriptionUploadForm';
import { usePrescriptionUploadController } from '@/features/prescriptions/hooks/usePrescriptionUploadController';

interface PrescriptionUploadViewProps {
  /**
   * When true (admin/nurse navigated from inside the app), the PIN gate
   * is skipped — auth context is enough. The QR-physical entry leaves
   * this `false` so the gate is shown.
   */
  bypassPinGate?: boolean;
}

export const PrescriptionUploadView: React.FC<PrescriptionUploadViewProps> = ({
  bypassPinGate = false,
}) => {
  const controller = usePrescriptionUploadController({ bypassPinGate });

  return (
    <main
      data-module="prescriptions-upload"
      className="min-h-screen bg-slate-100 px-4 py-8 print:bg-white"
    >
      <div className="mx-auto max-w-md space-y-4">
        <header className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Hospital Hanga Roa · Hospitalizados
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-800">Respaldo de receta</h1>
          <p className="mt-1 text-xs text-slate-500">
            Las fotos sirven como evidencia operativa. La receta original queda en farmacia.
          </p>
        </header>

        {controller.phase === 'awaiting-pin' ? (
          <PrescriptionPinGate
            errorMessage={controller.errorMessage}
            onSubmitPin={controller.submitPin}
          />
        ) : (
          <PrescriptionUploadForm controller={controller} />
        )}
      </div>
    </main>
  );
};

export default PrescriptionUploadView;
