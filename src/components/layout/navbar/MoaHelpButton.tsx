import React from 'react';
import { CircleHelp } from 'lucide-react';
import { ErrorBoundary } from 'react-error-boundary';
import { reloadMoaHelp } from './moaHelpRecovery';
import type { ModuleType } from '@/constants/navigationConfig';
import { useNavbarDisclosure } from './useNavbarDisclosure';
const MoaHelpPanel = React.lazy(() =>
  import('./MoaHelpPanel').then(module => ({ default: module.MoaHelpPanel }))
);

interface MoaHelpButtonProps {
  currentModule?: ModuleType;
}

/** B1: local help only. No patient context, storage, AI, or clinical actions. */
export const MoaHelpButton: React.FC<MoaHelpButtonProps> = ({ currentModule }) => {
  const { isOpen, menuRef, triggerRef, panelId, toggle, closeAndRestoreFocus, onKeyDown, onBlur } =
    useNavbarDisclosure(currentModule);

  return (
    <div
      ref={menuRef}
      className="shrink-0 print:hidden sm:relative"
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-label="Ayuda de Moa"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        title="Ayuda de Moa"
        className="flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border border-white/20 px-2 text-white/90 transition-colors duration-150 hover:bg-white/10 aria-expanded:border-white/40 aria-expanded:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
      >
        <CircleHelp size={16} aria-hidden="true" />
      </button>
      {isOpen && (
        <ErrorBoundary
          fallbackRender={() => (
            <section
              id={panelId}
              aria-label="Ayuda de Moa no disponible"
              className="absolute right-3 top-full rounded-xl border bg-white p-4 text-sm text-slate-700 shadow-lg"
            >
              <p role="alert">No se pudo abrir la ayuda.</p>
              <button type="button" onClick={reloadMoaHelp}>
                Recargar aplicación
              </button>
              <button type="button" onClick={closeAndRestoreFocus}>
                Cerrar ayuda de Moa
              </button>
            </section>
          )}
        >
          <React.Suspense
            fallback={
              <span
                id={panelId}
                role="status"
                className="absolute right-3 top-full rounded-xl bg-white p-3 text-xs text-slate-700 shadow-lg"
              >
                Cargando ayuda…
              </span>
            }
          >
            <MoaHelpPanel
              currentModule={currentModule}
              panelId={panelId}
              onClose={closeAndRestoreFocus}
            />
          </React.Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
};

export default MoaHelpButton;
