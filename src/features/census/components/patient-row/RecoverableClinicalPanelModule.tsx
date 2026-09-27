import React, { Suspense, useReducer, type ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

/** Keeps load failures local; the caller replaces React.lazy's rejected payload. */
export function RecoverableClinicalPanelModule({
  render,
  resetModule,
  fallback,
}: {
  render: () => ReactNode;
  resetModule: () => void;
  fallback: (retry?: () => void) => ReactNode;
}) {
  const [, refresh] = useReducer(value => value + 1, 0);
  return (
    <ErrorBoundary
      onError={resetModule}
      onReset={refresh}
      fallbackRender={({ resetErrorBoundary }) => fallback(resetErrorBoundary)}
    >
      <Suspense fallback={fallback()}>{render()}</Suspense>
    </ErrorBoundary>
  );
}

export const PanelModuleRetry = ({ onRetry }: { onRetry: () => void }) => (
  <div role="alert" className="space-y-3 text-xs text-slate-600">
    <p>No se pudo abrir este panel. Puedes volver a intentarlo.</p>
    <p>Si el problema continúa, guarda tus cambios antes de recargar la página.</p>
    <button
      type="button"
      onClick={onRetry}
      className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-700"
    >
      Reintentar
    </button>
  </div>
);
