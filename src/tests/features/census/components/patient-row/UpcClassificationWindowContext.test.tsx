import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  loadFreshUpcContext,
  mockDeferredUpcWindow,
  type MockUpcWindowProps,
  UPC_WINDOW_MODULE_PATH,
} from './upcClassificationWindowTestSupport';

describe('UpcClassificationWindowProvider · lifecycle, recovery and focus', () => {
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
      await loadFreshUpcContext();

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
      await loadFreshUpcContext();

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
      await loadFreshUpcContext();

    const Trigger = () => {
      const { openUpcWindow } = useUpcClassificationWindowOpener();
      return (
        <button type="button" onClick={() => openUpcWindow('R3')}>
          Abrir R3
        </button>
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
      await loadFreshUpcContext();

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
    const { useUpcClassificationWindowOpener } = await loadFreshUpcContext();

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

  it('cancels a pending open when the census date changes so another day episode is never opened', async () => {
    const { resolveDialog } = mockDeferredUpcWindow();
    const { UpcClassificationWindowProvider, useUpcClassificationWindowOpener } =
      await loadFreshUpcContext();

    const Trigger = () => {
      const { openUpcWindow } = useUpcClassificationWindowOpener();
      return (
        <button type="button" onClick={() => openUpcWindow('R1', { crib: true })}>
          Abrir cuna R1
        </button>
      );
    };

    const { rerender } = render(
      <UpcClassificationWindowProvider currentDateString="2026-11-24">
        <Trigger />
      </UpcClassificationWindowProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna R1' }));
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    rerender(
      <UpcClassificationWindowProvider currentDateString="2026-11-23">
        <Trigger />
      </UpcClassificationWindowProvider>
    );
    expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();

    await resolveDialog(({ currentDateString, initialBedId }) => (
      <div role="dialog" aria-label="Clasificación UPC">
        {`${currentDateString}|${initialBedId}`}
      </div>
    ));

    expect(screen.queryByRole('dialog')).toBeNull();

    // Returning to the original day must not resurrect the cancelled request either.
    rerender(
      <UpcClassificationWindowProvider currentDateString="2026-11-24">
        <Trigger />
      </UpcClassificationWindowProvider>
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancels a pending open on Escape and restores focus to the keyboard opener', async () => {
    const { resolveDialog } = mockDeferredUpcWindow();
    const { UpcClassificationWindowProvider, useUpcClassificationWindowOpener } =
      await loadFreshUpcContext();

    const Trigger = () => {
      const { openUpcWindow } = useUpcClassificationWindowOpener();
      return (
        <button type="button" onClick={() => openUpcWindow('R1')}>
          Abrir UPC R1
        </button>
      );
    };

    render(
      <UpcClassificationWindowProvider currentDateString="2026-11-24">
        <Trigger />
      </UpcClassificationWindowProvider>
    );

    const openerButton = screen.getByRole('button', { name: 'Abrir UPC R1' });
    openerButton.focus();
    fireEvent.click(openerButton);

    const loadingModal = screen.getByTestId('upc-window-module-loading');
    expect(loadingModal).toBeInTheDocument();

    fireEvent.keyDown(loadingModal, { key: 'Escape' });
    expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();
    expect(openerButton).toHaveFocus();

    await resolveDialog();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('traps Tab inside the error modal and restores focus to the keyboard opener on Escape', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.doMock(UPC_WINDOW_MODULE_PATH, () => {
      throw new Error('503 Service Unavailable');
    });

    const { UpcClassificationWindowProvider, useUpcClassificationWindowOpener } =
      await loadFreshUpcContext();

    const Trigger = () => {
      const { openUpcWindow } = useUpcClassificationWindowOpener();
      return (
        <div>
          <select aria-label="Enfermería externa">
            <option value="a">A</option>
          </select>
          <button type="button" onClick={() => openUpcWindow('R1')}>
            Evaluación UPC R1
          </button>
        </div>
      );
    };

    render(
      <UpcClassificationWindowProvider currentDateString="2026-11-24">
        <Trigger />
      </UpcClassificationWindowProvider>
    );

    const openerButton = screen.getByRole('button', { name: 'Evaluación UPC R1' });
    openerButton.focus();
    fireEvent.click(openerButton);

    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);

    const closeButton = screen.getByRole('button', { name: 'Cerrar modal' });
    const retryButton = screen.getByRole('button', { name: 'Reintentar' });
    expect(closeButton).toHaveFocus();

    expect(fireEvent.keyDown(closeButton, { key: 'Tab' })).toBe(false);
    expect(retryButton).toHaveFocus();
    expect(fireEvent.keyDown(retryButton, { key: 'Tab' })).toBe(false);
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(closeButton, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(openerButton).toHaveFocus();
    consoleErrorSpy.mockRestore();
  });

  it('restores focus to the clicked trigger button on Escape even when activeElement stayed on an ancestor wrapper', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let attempts = 0;

    vi.doMock(UPC_WINDOW_MODULE_PATH, () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('503 Service Unavailable');
      }
      return {
        UpcClassificationWindow: ({ onClose }: MockUpcWindowProps) => (
          <div role="dialog" aria-label="Clasificación UPC">
            <button type="button" onClick={onClose}>
              Cancelar
            </button>
          </div>
        ),
      };
    });

    const { UpcClassificationWindowProvider, useUpcClassificationWindowOpener } =
      await loadFreshUpcContext();

    const Trigger = () => {
      const { openUpcWindow } = useUpcClassificationWindowOpener();
      return (
        <div tabIndex={0} aria-label="Censo de pacientes, tabla desplazable">
          <button
            type="button"
            onClick={event =>
              openUpcWindow('R1', {
                triggerElement: event.currentTarget,
              })
            }
          >
            Evaluación UPC pendiente
          </button>
        </div>
      );
    };

    render(
      <UpcClassificationWindowProvider currentDateString="2026-11-24">
        <Trigger />
      </UpcClassificationWindowProvider>
    );

    const tableWrapper = screen.getByLabelText('Censo de pacientes, tabla desplazable');
    const triggerButton = screen.getByRole('button', { name: 'Evaluación UPC pendiente' });

    // Simulate WebKit pointer click: focus lands on the scrollable wrapper instead of the button.
    tableWrapper.focus();
    fireEvent.click(triggerButton);

    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cerrar modal' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(triggerButton).toHaveFocus();

    // Repeat for a healthy open after pointer click.
    tableWrapper.focus();
    fireEvent.click(triggerButton);
    const cancel = await screen.findByRole('button', { name: 'Cancelar' });
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(triggerButton).toHaveFocus();
    consoleErrorSpy.mockRestore();
  });
});
