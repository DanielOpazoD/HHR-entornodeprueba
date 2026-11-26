import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { PanelModuleRetry, RecoverableClinicalPanelModule } from './RecoverableClinicalPanelModule';

const loadUpcClassificationWindow = () =>
  import('./UpcClassificationWindow').then(module => ({
    default: module.UpcClassificationWindow,
  }));

let UpcClassificationWindowModule = React.lazy(loadUpcClassificationWindow);
const resetUpcClassificationWindowModule = () => {
  UpcClassificationWindowModule = React.lazy(loadUpcClassificationWindow);
};

interface UpcClassificationWindowContextValue {
  /** The census header opens the round; a patient cell selects its bed or clinical crib. */
  openUpcWindow: (bedId?: string, options?: { crib?: boolean }) => void;
}

const UpcClassificationWindowContext =
  React.createContext<UpcClassificationWindowContextValue | null>(null);

export const useUpcClassificationWindowOpener = (): UpcClassificationWindowContextValue => {
  const context = React.useContext(UpcClassificationWindowContext);
  // Sin proveedor la celda queda inerte en vez de tumbar el censo completo: en un tablero clínico
  // un botón que no abre es un fallo recuperable, una tabla en blanco no.
  return context ?? { openUpcWindow: () => undefined };
};

const UpcClassificationWindowLoadingFallback: React.FC<{
  onClose: () => void;
}> = ({ onClose }) => (
  <BaseModal
    isOpen
    onClose={onClose}
    title="Abriendo ronda UPC…"
    icon={<ShieldCheck aria-hidden="true" />}
    headerIconColor="text-medical-700"
    size="md"
    closeOnBackdrop
    dataTestId="upc-window-module-loading"
  >
    <div role="status" aria-busy="true" className="text-xs text-slate-600">
      Cargando clasificación UPC…
    </div>
  </BaseModal>
);

const UpcClassificationWindowErrorFallback: React.FC<{
  onClose: () => void;
  onRetry: () => void;
}> = ({ onClose, onRetry }) => (
  <BaseModal
    isOpen
    onClose={onClose}
    title="Clasificación UPC"
    icon={<ShieldCheck aria-hidden="true" />}
    headerIconColor="text-medical-700"
    size="md"
    closeOnBackdrop
  >
    <PanelModuleRetry onRetry={onRetry} />
  </BaseModal>
);

interface UpcClassificationWindowProviderProps {
  currentDateString: string;
  readOnly?: boolean;
  children: React.ReactNode;
}

interface UpcWindowOpenState {
  isOpen: boolean;
  bedId: string | null;
  openedForDate: string | null;
}

const CLOSED_UPC_WINDOW_STATE: UpcWindowOpenState = {
  isOpen: false,
  bedId: null,
  openedForDate: null,
};

/**
 * Holds the single day-level UPC window so every UPC cell in the census opens the same panel
 * instead of rendering its own anchored popover.
 *
 * The dialog module loads only on open so initial census paint does not parse the checklist
 * panel until a clinician requests it. Pending or open requests are scoped to the census date
 * that opened them so changing days never opens another patient's episode.
 */
export const UpcClassificationWindowProvider: React.FC<UpcClassificationWindowProviderProps> = ({
  currentDateString,
  readOnly = false,
  children,
}) => {
  const [openState, setOpenState] = useState<UpcWindowOpenState>(CLOSED_UPC_WINDOW_STATE);
  const openerRef = useRef<HTMLElement | null>(null);
  const restoreOpenerOnCloseRef = useRef<HTMLElement | null>(null);

  if (openState.isOpen && openState.openedForDate !== currentDateString) {
    setOpenState(CLOSED_UPC_WINDOW_STATE);
  }
  const isWindowOpen = openState.isOpen && openState.openedForDate === currentDateString;

  const openUpcWindow = useCallback(
    (bedId?: string, options?: { crib?: boolean }) => {
      const activeElement =
        typeof document !== 'undefined' &&
        document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body &&
        !document.activeElement.closest('[role="dialog"]')
          ? document.activeElement
          : null;
      if (activeElement) {
        openerRef.current = activeElement;
      }
      restoreOpenerOnCloseRef.current = null;
      setOpenState({
        isOpen: true,
        bedId: bedId && options?.crib ? `${bedId}:crib` : (bedId ?? null),
        openedForDate: currentDateString,
      });
    },
    [currentDateString]
  );

  const closeUpcWindow = useCallback(() => {
    restoreOpenerOnCloseRef.current = openerRef.current;
    openerRef.current = null;
    setOpenState(CLOSED_UPC_WINDOW_STATE);
  }, []);

  useLayoutEffect(() => {
    if (isWindowOpen) return;
    const openerToRestore = restoreOpenerOnCloseRef.current;
    restoreOpenerOnCloseRef.current = null;
    if (!openerToRestore) {
      openerRef.current = null;
      return;
    }
    if (
      openerToRestore.isConnected &&
      typeof document !== 'undefined' &&
      (!document.activeElement ||
        document.activeElement === document.body ||
        !document.activeElement.isConnected)
    ) {
      openerToRestore.focus();
    }
  }, [isWindowOpen]);

  const value = useMemo(() => ({ openUpcWindow }), [openUpcWindow]);

  return (
    <UpcClassificationWindowContext.Provider value={value}>
      {children}
      {isWindowOpen && (
        <RecoverableClinicalPanelModule
          resetModule={resetUpcClassificationWindowModule}
          fallback={retry =>
            retry ? (
              <UpcClassificationWindowErrorFallback onClose={closeUpcWindow} onRetry={retry} />
            ) : (
              <UpcClassificationWindowLoadingFallback onClose={closeUpcWindow} />
            )
          }
          render={() => (
            <UpcClassificationWindowModule
              currentDateString={currentDateString}
              readOnly={readOnly}
              initialBedId={openState.bedId}
              onClose={closeUpcWindow}
            />
          )}
        />
      )}
    </UpcClassificationWindowContext.Provider>
  );
};
