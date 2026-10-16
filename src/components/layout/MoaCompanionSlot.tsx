import { lazy, Suspense } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { hideMoaAndRestoreFocus, useMoaVisibility } from '@/shared/ui/useMoaVisibility';
import { reloadMoaHelp } from './navbar/moaHelpRecovery';

const loadCompanion = () => import('./MoaCompanion');
const Companion = lazy(loadCompanion);

export const MoaCompanionSlot = () => {
  const visible = useMoaVisibility();
  if (!visible) return null;
  return (
    <ErrorBoundary
      fallbackRender={() => (
        <div id="census-moa" className="w-36 text-center text-xs text-slate-500 print:hidden">
          <p role="alert">No se pudo mostrar Moa.</p>
          <button type="button" onClick={reloadMoaHelp} className="mt-2 underline">
            Recargar aplicación
          </button>
          <button type="button" onClick={hideMoaAndRestoreFocus} className="mt-2 underline">
            Ocultar Moa
          </button>
        </div>
      )}
    >
      <Suspense
        fallback={
          <span id="census-moa" className="h-[84px] w-36 print:hidden" aria-label="Cargando Moa" />
        }
      >
        <Companion />
      </Suspense>
    </ErrorBoundary>
  );
};
