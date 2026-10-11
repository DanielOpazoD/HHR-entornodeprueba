import React from 'react';
import { CircleHelp } from 'lucide-react';
import { ErrorBoundary } from 'react-error-boundary';
import { reloadMoaHelp } from './moaHelpRecovery';
import type { ModuleType } from '@/constants/navigationConfig';
import { useNavbarDisclosure } from './useNavbarDisclosure';
import { MoaMascot } from './MoaMascot';
const MoaHelpPanel = React.lazy(() =>
  import('./MoaHelpPanel').then(module => ({ default: module.MoaHelpPanel }))
);

interface MoaHelpButtonProps {
  currentModule?: ModuleType;
}

/** Local help with an optional mascot. No patient context, AI, or clinical actions. */
export const MoaHelpButton: React.FC<MoaHelpButtonProps> = ({ currentModule }) => {
  const [showMascot, setShowMascot] = React.useState(() => {
    try {
      return localStorage.getItem('hhr_moa_visible_v1') !== 'false';
    } catch {
      return true;
    }
  });
  const toggleMascot = () => {
    const next = !showMascot;
    setShowMascot(next);
    try {
      localStorage.setItem('hhr_moa_visible_v1', String(next));
    } catch {
      // The control still works when browser storage is unavailable.
    }
  };
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
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 text-white/90 transition-colors duration-150 hover:bg-white/10 aria-expanded:border-white/40 aria-expanded:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
      >
        {showMascot ? (
          <MoaMascot className="h-7 w-7" />
        ) : (
          <CircleHelp size={16} aria-hidden="true" />
        )}
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
              showMascot={showMascot}
              onToggleMascot={toggleMascot}
            />
          </React.Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
};

export default MoaHelpButton;
