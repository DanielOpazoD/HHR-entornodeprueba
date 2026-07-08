import React from 'react';
import { CheckCircle2, Eye, RotateCcw } from 'lucide-react';

interface PrescriptionUploadSuccessStateProps {
  expiresAt: string;
  onReset: () => void;
  onOpenViewer: () => void;
}

export const PrescriptionUploadSuccessState: React.FC<PrescriptionUploadSuccessStateProps> = ({
  expiresAt,
  onReset,
  onOpenViewer,
}) => (
  <div className="mx-auto max-w-md rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center shadow-sm">
    <CheckCircle2 size={36} className="mx-auto mb-3 text-emerald-600" />
    <h2 className="mb-1 text-lg font-semibold text-emerald-900">Receta registrada</h2>
    <p className="text-sm text-emerald-800">
      La foto quedó guardada para respaldo mensual. El administrador debe respaldarla antes de
      eliminarla manualmente. Revisión sugerida:{' '}
      <span className="font-semibold">{new Date(expiresAt).toLocaleDateString('es-CL')}</span>.
    </p>
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      <button
        type="button"
        onClick={onReset}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
      >
        <RotateCcw size={14} /> Subir otra receta
      </button>
      <button
        type="button"
        onClick={onOpenViewer}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
      >
        <Eye size={14} /> Ver recetas subidas
      </button>
    </div>
  </div>
);
