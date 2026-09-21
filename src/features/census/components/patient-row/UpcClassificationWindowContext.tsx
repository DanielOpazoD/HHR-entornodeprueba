import React, { useCallback, useMemo, useState } from 'react';
import { UpcClassificationWindow } from './UpcClassificationWindow';

interface UpcClassificationWindowContextValue {
  /** Opens the day panel focused on the bed —or its clinical crib— whose UPC cell was clicked. */
  openUpcWindow: (bedId: string, options?: { crib?: boolean }) => void;
}

const UpcClassificationWindowContext =
  React.createContext<UpcClassificationWindowContextValue | null>(null);

export const useUpcClassificationWindowOpener = (): UpcClassificationWindowContextValue => {
  const context = React.useContext(UpcClassificationWindowContext);
  // Sin proveedor la celda queda inerte en vez de tumbar el censo completo: en un tablero clínico
  // un botón que no abre es un fallo recuperable, una tabla en blanco no.
  return context ?? { openUpcWindow: () => undefined };
};

interface UpcClassificationWindowProviderProps {
  currentDateString: string;
  readOnly?: boolean;
  children: React.ReactNode;
}

/**
 * Holds the single day-level UPC window so every UPC cell in the census opens the same panel
 * instead of rendering its own anchored popover.
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
    (bedId: string, options?: { crib?: boolean }) =>
      setOpenState({ isOpen: true, bedId: options?.crib ? `${bedId}:crib` : bedId }),
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
        <UpcClassificationWindow
          currentDateString={currentDateString}
          readOnly={readOnly}
          initialBedId={openState.bedId}
          onClose={closeUpcWindow}
        />
      )}
    </UpcClassificationWindowContext.Provider>
  );
};
