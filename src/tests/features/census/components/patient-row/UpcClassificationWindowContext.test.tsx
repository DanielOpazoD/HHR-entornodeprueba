import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

interface MockUpcWindowProps {
  currentDateString: string;
  readOnly?: boolean;
  initialBedId?: string | null;
  onClose: () => void;
}

const UPC_WINDOW_MODULE_PATH = '@/features/census/components/patient-row/UpcClassificationWindow';
const UPC_CONTEXT_MODULE_PATH =
  '@/features/census/components/patient-row/UpcClassificationWindowContext';

const loadFreshContext = async () => {
  const mod = await import(UPC_CONTEXT_MODULE_PATH);
  return {
    UpcClassificationWindowProvider: mod.UpcClassificationWindowProvider as React.FC<{
      currentDateString: string;
      readOnly?: boolean;
      children: React.ReactNode;
    }>,
    useUpcClassificationWindowOpener: mod.useUpcClassificationWindowOpener as () => {
      openUpcWindow: (bedId?: string, options?: { crib?: boolean }) => void;
    },
  };
};

describe('UpcClassificationWindowProvider', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock(UPC_WINDOW_MODULE_PATH);
    vi.restoreAllMocks();
  });

  it('defers loading UpcClassificationWindow until opened and passes bed/crib context', async () => {
    const loaderSpy = vi.fn();
    vi.doMock(UPC_WINDOW_MODULE_PATH, () => {
      loaderSpy();
      return {
        UpcClassificationWindow: ({
          currentDateString,
          readOnly,
          initialBedId,
          onClose,
        }: MockUpcWindowProps) => (
          <div role="dialog" aria-label="Clasificación UPC">
            <span data-testid="upc-props">
              {`${currentDateString}|${String(Boolean(readOnly))}|${initialBedId ?? 'none'}`}
            </span>
            <button type="button" onClick={onClose}>
              Cerrar ronda
            </button>
          </div>
        ),
      };
    });

    const { UpcClassificationWindowProvider, useUpcClassificationWindowOpener } =
      await loadFreshContext();

    const Triggers = () => {
      const { openUpcWindow } = useUpcClassificationWindowOpener();
      return (
        <div>
          <span data-testid="census-table">Tabla del censo</span>
          <button type="button" onClick={() => openUpcWindow('R1')}>
            Abrir R1
          </button>
          <button type="button" onClick={() => openUpcWindow('R1', { crib: true })}>
            Abrir cuna R1
          </button>
        </div>
      );
    };

    render(
      <UpcClassificationWindowProvider currentDateString="2026-09-15" readOnly>
        <Triggers />
      </UpcClassificationWindowProvider>
    );

    expect(screen.getByTestId('census-table')).toBeInTheDocument();
    expect(loaderSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir R1' }));

    expect(await screen.findByRole('dialog', { name: 'Clasificación UPC' })).toBeInTheDocument();
    expect(loaderSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('upc-props')).toHaveTextContent('2026-09-15|true|R1');

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar ronda' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna R1' }));
    expect(await screen.findByRole('dialog', { name: 'Clasificación UPC' })).toBeInTheDocument();
    expect(screen.getByTestId('upc-props')).toHaveTextContent('2026-09-15|true|R1:crib');
  });

  it('recovers from a transient load failure via retry without unmounting census children', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let attempts = 0;

    vi.doMock(UPC_WINDOW_MODULE_PATH, () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('Failed to fetch dynamically imported module');
      }
      return {
        UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
          <div role="dialog" aria-label="Clasificación UPC recuperada">
            <span>{initialBedId}</span>
          </div>
        ),
      };
    });

    const { UpcClassificationWindowProvider, useUpcClassificationWindowOpener } =
      await loadFreshContext();

    const Trigger = () => {
      const { openUpcWindow } = useUpcClassificationWindowOpener();
      return (
        <div>
          <span data-testid="census-table">Tabla intacta</span>
          <button type="button" onClick={() => openUpcWindow('R2')}>
            Abrir R2
          </button>
        </div>
      );
    };

    render(
      <UpcClassificationWindowProvider currentDateString="2026-09-15">
        <Trigger />
      </UpcClassificationWindowProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir R2' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);
    expect(screen.getByTestId('census-table')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(
      await screen.findByRole('dialog', { name: 'Clasificación UPC recuperada' })
    ).toBeInTheDocument();
    expect(screen.getByText('R2')).toBeInTheDocument();
    expect(attempts).toBe(2);
    consoleErrorSpy.mockRestore();
  });

  it('allows closing the error modal and reopening cleanly after a failed load', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let attempts = 0;

    vi.doMock(UPC_WINDOW_MODULE_PATH, () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('Chunk unavailable');
      }
      return {
        UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
          <div role="dialog" aria-label="Clasificación UPC tras reabrir">
            <span>{initialBedId}</span>
          </div>
        ),
      };
    });

    const { UpcClassificationWindowProvider, useUpcClassificationWindowOpener } =
      await loadFreshContext();

    const Trigger = () => {
      const { openUpcWindow } = useUpcClassificationWindowOpener();
      return (
        <div>
          <button type="button" onClick={() => openUpcWindow('R3')}>
            Abrir R3
          </button>
        </div>
      );
    };

    render(
      <UpcClassificationWindowProvider currentDateString="2026-09-15">
        <Trigger />
      </UpcClassificationWindowProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir R3' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar modal' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Abrir R3' }));
    expect(
      await screen.findByRole('dialog', { name: 'Clasificación UPC tras reabrir' })
    ).toBeInTheDocument();
    expect(attempts).toBe(2);
    consoleErrorSpy.mockRestore();
  });

  it('isolates render errors inside the dialog so census children stay mounted', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let shouldThrow = true;

    vi.doMock(UPC_WINDOW_MODULE_PATH, () => ({
      UpcClassificationWindow: () => {
        if (shouldThrow) {
          throw new Error('Unexpected render crash');
        }
        return <div role="dialog" aria-label="Clasificación UPC estable" />;
      },
    }));

    const { UpcClassificationWindowProvider, useUpcClassificationWindowOpener } =
      await loadFreshContext();

    const Trigger = () => {
      const { openUpcWindow } = useUpcClassificationWindowOpener();
      return (
        <div>
          <span data-testid="census-table">Tabla operativa</span>
          <button type="button" onClick={() => openUpcWindow('R4')}>
            Abrir R4
          </button>
        </div>
      );
    };

    render(
      <UpcClassificationWindowProvider currentDateString="2026-09-15">
        <Trigger />
      </UpcClassificationWindowProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir R4' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);
    expect(screen.getByTestId('census-table')).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(
      await screen.findByRole('dialog', { name: 'Clasificación UPC estable' })
    ).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  it('returns an inert opener when used outside a provider', async () => {
    const { useUpcClassificationWindowOpener } = await loadFreshContext();

    const Orphan = () => {
      const { openUpcWindow } = useUpcClassificationWindowOpener();
      return (
        <button type="button" onClick={() => openUpcWindow('R1')}>
          Sin proveedor
        </button>
      );
    };

    render(<Orphan />);
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Sin proveedor' }))
    ).not.toThrow();
  });
});
