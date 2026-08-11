import React from 'react';
import { RefreshCw } from 'lucide-react';

interface RayenImportWorkingStateProps {
  message: string;
}

export const RayenImportWorkingState: React.FC<RayenImportWorkingStateProps> = ({ message }) => (
  <div
    className="flex min-h-40 flex-col items-center justify-center rounded-xl bg-slate-50 px-6 text-center"
    role="status"
    aria-live="polite"
    data-testid="rayen-import-working-state"
  >
    <RefreshCw
      size={28}
      className="mb-4 animate-spin text-teal-600 motion-reduce:animate-none"
      aria-hidden="true"
    />
    <p className="text-base font-semibold text-slate-800">{message}</p>
    <p className="mt-2 text-sm text-slate-500">
      Esta ejecución continuará automáticamente con la siguiente etapa.
    </p>
  </div>
);
