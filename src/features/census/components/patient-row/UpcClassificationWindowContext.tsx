import React, { useCallback, useMemo, useState } from 'react';
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

/**
 * Holds the single day-level UPC window so every UPC cell in the census opens the same panel
 * instead of rendering its own anchored popover.
 *
 * The dialog module loads only on open so initial census paint does not parse the checklist
 * panel until a clinician requests it.
 */
export const UpcClassificationWindowProvider: React.FC<UpcClassificationWindowProviderProps> = ({
  currentDateString,
  readOnly = false,
  children,
}) => {
  const [openState, setOpenState] = useState<{ isOpen: boolean; bedId: string | null }>({
    isOpen: false,
    bedId: null,
  });

  const openUpcWindow = useCallback(
    (bedId?: string, options?: { crib?: boolean }) =>
      setOpenState({
        isOpen: true,
        bedId: bedId && options?.crib ? `${bedId}:crib` : (bedId ?? null),
      }),
    []
  );
  const closeUpcWindow = useCallback(
    () => setOpenState(current => ({ ...current, isOpen: false })),
    []
  );
  const value = useMemo(() => ({ openUpcWindow }), [openUpcWindow]);

  return (
    <UpcClassificationWindowContext.Provider value={value}>
      {children}
      {openState.isOpen && (
        <RecoverableClinicalPanelModule
          resetModule={resetUpcClassificationWindowModule}
          fallback={retry =>
            retry ? (
              <UpcClassificationWindowErrorFallback onClose={closeUpcWindow} onRetry={retry} />
            ) : null
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
