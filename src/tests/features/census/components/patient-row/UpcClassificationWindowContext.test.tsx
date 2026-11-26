import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DataFactory } from '@/tests/factories/DataFactory';
import { resolveUpcEpisodeIdentity } from '@/domain/upc/upcRoundSubject';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus } from '@/types/domain/patientClassification';

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
  const [mod, guardMod, providerTree] = await Promise.all([
    import(UPC_CONTEXT_MODULE_PATH),
    import('@/features/census/components/patient-row/upcPendingOpenGuard'),
    import('@/context/dailyRecordProviderTree'),
  ]);
  return {
    DailyRecordBedsContext: providerTree.DailyRecordBedsContext,
    resolveUpcCellSubjectIdentity: guardMod.resolveUpcCellSubjectIdentity as (
      subject?: Partial<PatientData> | null
    ) => string | null,
    UpcClassificationWindowProvider: mod.UpcClassificationWindowProvider as React.FC<{
      currentDateString: string;
      readOnly?: boolean;
      children: React.ReactNode;
    }>,
    useUpcClassificationWindowOpener: mod.useUpcClassificationWindowOpener as () => {
      openUpcWindow: (
        bedId?: string,
        options?: {
          crib?: boolean;
          episodeIdentity?: string | null;
          triggerElement?: HTMLElement | null;
        }
      ) => void;
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

  it('cancels a pending open when the census date changes so another day episode is never opened', async () => {
    let resolveChunk:
      | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
      | null = null;
    const chunkPromise = new Promise<{
      UpcClassificationWindow: React.FC<MockUpcWindowProps>;
    }>(resolve => {
      resolveChunk = resolve;
    });

    vi.doMock(UPC_WINDOW_MODULE_PATH, () => chunkPromise);

    const { UpcClassificationWindowProvider, useUpcClassificationWindowOpener } =
      await loadFreshContext();

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

    await act(async () => {
      resolveChunk?.({
        UpcClassificationWindow: ({ currentDateString, initialBedId }: MockUpcWindowProps) => (
          <div role="dialog" aria-label="Clasificación UPC">
            {`${currentDateString}|${initialBedId}`}
          </div>
        ),
      });
      await chunkPromise;
    });

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
    let resolveChunk:
      | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
      | null = null;
    const chunkPromise = new Promise<{
      UpcClassificationWindow: React.FC<MockUpcWindowProps>;
    }>(resolve => {
      resolveChunk = resolve;
    });

    vi.doMock(UPC_WINDOW_MODULE_PATH, () => chunkPromise);

    const { UpcClassificationWindowProvider, useUpcClassificationWindowOpener } =
      await loadFreshContext();

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

    await act(async () => {
      resolveChunk?.({
        UpcClassificationWindow: () => <div role="dialog" aria-label="Clasificación UPC" />,
      });
      await chunkPromise;
    });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('traps Tab inside the error modal and restores focus to the keyboard opener on Escape', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.doMock(UPC_WINDOW_MODULE_PATH, () => {
      throw new Error('503 Service Unavailable');
    });

    const { UpcClassificationWindowProvider, useUpcClassificationWindowOpener } =
      await loadFreshContext();

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

  it('cancels a pending open when the clicked bed changes episode on the same census day', async () => {
    let resolveChunk:
      | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
      | null = null;
    const chunkPromise = new Promise<{
      UpcClassificationWindow: React.FC<MockUpcWindowProps>;
    }>(resolve => {
      resolveChunk = resolve;
    });

    vi.doMock(UPC_WINDOW_MODULE_PATH, () => chunkPromise);

    const {
      DailyRecordBedsContext,
      UpcClassificationWindowProvider,
      useUpcClassificationWindowOpener,
    } = await loadFreshContext();

    const patientA = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente Original',
      rut: '11.111.111-1',
      clinicalEpisodeId: 'ep-original',
    });
    const patientB = DataFactory.createMockPatient('R2', {
      patientName: 'Reemplazo Mismo Dia',
      rut: '22.222.222-2',
      clinicalEpisodeId: 'ep-reemplazo',
    });

    const Trigger = ({ patient }: { patient: PatientData }) => {
      const { openUpcWindow } = useUpcClassificationWindowOpener();
      return (
        <button
          type="button"
          onClick={event =>
            openUpcWindow('R2', {
              episodeIdentity: resolveUpcEpisodeIdentity(patient),
              triggerElement: event.currentTarget,
            })
          }
        >
          Abrir UPC R2
        </button>
      );
    };

    const { rerender } = render(
      <DailyRecordBedsContext.Provider value={{ R2: patientA }}>
        <UpcClassificationWindowProvider currentDateString="2026-11-24">
          <Trigger patient={patientA} />
        </UpcClassificationWindowProvider>
      </DailyRecordBedsContext.Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir UPC R2' }));
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    // Same-day census re-read replaces the occupant in R2 while the chunk is still loading.
    rerender(
      <DailyRecordBedsContext.Provider value={{ R2: patientB }}>
        <UpcClassificationWindowProvider currentDateString="2026-11-24">
          <Trigger patient={patientB} />
        </UpcClassificationWindowProvider>
      </DailyRecordBedsContext.Provider>
    );
    expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();

    await act(async () => {
      resolveChunk?.({
        UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
          <div role="dialog" aria-label="Clasificación UPC">
            {initialBedId}
          </div>
        ),
      });
      await chunkPromise;
    });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancels a pending open for an unnamed bed with document and episode ID when replaced during load', async () => {
    let resolveChunk:
      | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
      | null = null;
    const chunkPromise = new Promise<{
      UpcClassificationWindow: React.FC<MockUpcWindowProps>;
    }>(resolve => {
      resolveChunk = resolve;
    });

    vi.doMock(UPC_WINDOW_MODULE_PATH, () => chunkPromise);

    const {
      DailyRecordBedsContext,
      resolveUpcCellSubjectIdentity,
      UpcClassificationWindowProvider,
      useUpcClassificationWindowOpener,
    } = await loadFreshContext();

    const unnamedOriginal = DataFactory.createMockPatient('R2', {
      patientName: '',
      rut: '11.111.111-1',
      clinicalEpisodeId: 'ep-unnamed-1',
    });
    const replacement = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente Reemplazo',
      rut: '22.222.222-2',
      clinicalEpisodeId: 'ep-replacement-2',
    });

    expect(resolveUpcEpisodeIdentity(unnamedOriginal)).toBeNull();
    expect(resolveUpcCellSubjectIdentity(unnamedOriginal)).not.toBeNull();

    const Trigger = ({ patient }: { patient: PatientData }) => {
      const { openUpcWindow } = useUpcClassificationWindowOpener();
      return (
        <button
          type="button"
          onClick={event =>
            openUpcWindow('R2', {
              episodeIdentity: resolveUpcCellSubjectIdentity(patient),
              triggerElement: event.currentTarget,
            })
          }
        >
          Abrir UPC R2 sin nombre
        </button>
      );
    };

    const { rerender } = render(
      <DailyRecordBedsContext.Provider value={{ R2: unnamedOriginal }}>
        <UpcClassificationWindowProvider currentDateString="2026-11-24">
          <Trigger patient={unnamedOriginal} />
        </UpcClassificationWindowProvider>
      </DailyRecordBedsContext.Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir UPC R2 sin nombre' }));
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    rerender(
      <DailyRecordBedsContext.Provider value={{ R2: replacement }}>
        <UpcClassificationWindowProvider currentDateString="2026-11-24">
          <Trigger patient={replacement} />
        </UpcClassificationWindowProvider>
      </DailyRecordBedsContext.Provider>
    );
    expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();

    await act(async () => {
      resolveChunk?.({
        UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
          <div role="dialog" aria-label="Clasificación UPC">
            {initialBedId}
          </div>
        ),
      });
      await chunkPromise;
    });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancels a pending open for an unnamed crib when replaced during a 503 retry', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let attempts = 0;
    let resolveRetry:
      | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
      | null = null;
    const retryPromise = new Promise<{
      UpcClassificationWindow: React.FC<MockUpcWindowProps>;
    }>(resolve => {
      resolveRetry = resolve;
    });

    vi.doMock(UPC_WINDOW_MODULE_PATH, () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('503 Service Unavailable');
      }
      return retryPromise;
    });

    const {
      DailyRecordBedsContext,
      resolveUpcCellSubjectIdentity,
      UpcClassificationWindowProvider,
      useUpcClassificationWindowOpener,
    } = await loadFreshContext();

    const unnamedCrib = DataFactory.createMockPatient('R1', {
      patientName: '',
      rut: '33.333.333-3',
      clinicalEpisodeId: 'ep-crib-unnamed-1',
    });
    const replacementCrib = DataFactory.createMockPatient('R1', {
      patientName: 'RN Reemplazo',
      rut: '44.444.444-4',
      clinicalEpisodeId: 'ep-crib-replacement-2',
    });
    const motherWithUnnamedCrib = DataFactory.createMockPatient('R1', {
      patientName: 'Madre R1',
      clinicalCrib: unnamedCrib,
    });
    const motherWithReplacementCrib = DataFactory.createMockPatient('R1', {
      patientName: 'Madre R1',
      clinicalCrib: replacementCrib,
    });

    const Trigger = ({ crib }: { crib: PatientData }) => {
      const { openUpcWindow } = useUpcClassificationWindowOpener();
      return (
        <button
          type="button"
          onClick={event =>
            openUpcWindow('R1', {
              crib: true,
              episodeIdentity: resolveUpcCellSubjectIdentity(crib),
              triggerElement: event.currentTarget,
            })
          }
        >
          Abrir cuna R1 sin nombre
        </button>
      );
    };

    const { rerender } = render(
      <DailyRecordBedsContext.Provider value={{ R1: motherWithUnnamedCrib }}>
        <UpcClassificationWindowProvider currentDateString="2026-11-24">
          <Trigger crib={unnamedCrib} />
        </UpcClassificationWindowProvider>
      </DailyRecordBedsContext.Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna R1 sin nombre' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    rerender(
      <DailyRecordBedsContext.Provider value={{ R1: motherWithReplacementCrib }}>
        <UpcClassificationWindowProvider currentDateString="2026-11-24">
          <Trigger crib={replacementCrib} />
        </UpcClassificationWindowProvider>
      </DailyRecordBedsContext.Provider>
    );
    expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();

    await act(async () => {
      resolveRetry?.({
        UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
          <div role="dialog" aria-label="Clasificación UPC">
            {initialBedId}
          </div>
        ),
      });
      await retryPromise;
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    consoleErrorSpy.mockRestore();
  });

  it('keeps the pending open alive when only patientName is filled in for the same bed or crib episode', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let resolveBedChunk:
      | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
      | null = null;
    const bedChunkPromise = new Promise<{
      UpcClassificationWindow: React.FC<MockUpcWindowProps>;
    }>(resolve => {
      resolveBedChunk = resolve;
    });

    vi.doMock(UPC_WINDOW_MODULE_PATH, () => bedChunkPromise);

    const {
      DailyRecordBedsContext,
      resolveUpcCellSubjectIdentity,
      UpcClassificationWindowProvider,
      useUpcClassificationWindowOpener,
    } = await loadFreshContext();

    // 1) Bed with accredited episode ID: completing patientName during deferred download keeps open.
    const unnamedBed = DataFactory.createMockPatient('R2', {
      patientName: '',
      rut: '11.111.111-1',
      clinicalEpisodeId: 'ep-same-bed',
      admissionDate: '2026-11-24',
      admissionTime: '08:00',
    });
    const namedSameBed = { ...unnamedBed, patientName: 'Paciente Completado' };

    expect(resolveUpcCellSubjectIdentity(unnamedBed)).toBe('ep-same-bed');
    expect(resolveUpcCellSubjectIdentity(namedSameBed)).toBe('ep-same-bed');

    const BedTrigger = ({ patient }: { patient: PatientData }) => {
      const { openUpcWindow } = useUpcClassificationWindowOpener();
      return (
        <button
          type="button"
          onClick={event =>
            openUpcWindow('R2', {
              episodeIdentity: resolveUpcCellSubjectIdentity(patient),
              triggerElement: event.currentTarget,
            })
          }
        >
          Abrir R2
        </button>
      );
    };

    const view = render(
      <DailyRecordBedsContext.Provider value={{ R2: unnamedBed }}>
        <UpcClassificationWindowProvider currentDateString="2026-11-24">
          <BedTrigger patient={unnamedBed} />
        </UpcClassificationWindowProvider>
      </DailyRecordBedsContext.Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir R2' }));
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    view.rerender(
      <DailyRecordBedsContext.Provider value={{ R2: namedSameBed }}>
        <UpcClassificationWindowProvider currentDateString="2026-11-24">
          <BedTrigger patient={namedSameBed} />
        </UpcClassificationWindowProvider>
      </DailyRecordBedsContext.Provider>
    );
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    await act(async () => {
      resolveBedChunk?.({
        UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
          <div role="dialog" aria-label="Clasificación UPC">
            {initialBedId}
          </div>
        ),
      });
      await bedChunkPromise;
    });

    expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent('R2');
    view.unmount();

    // 2) Legacy crib (no accredited episode ID) completing patientName during a 503 retry keeps open.
    const unnamedLegacyCrib = DataFactory.createMockPatient('R1', {
      patientName: '',
      rut: '33.333.333-3',
      clinicalEpisodeId: '',
      admissionDate: '2026-11-24',
      admissionTime: '09:30',
    });
    const namedLegacyCrib = { ...unnamedLegacyCrib, patientName: 'RN Completado' };
    const motherUnnamed = DataFactory.createMockPatient('R1', {
      patientName: 'Madre R1',
      clinicalCrib: unnamedLegacyCrib,
    });
    const motherNamed = DataFactory.createMockPatient('R1', {
      patientName: 'Madre R1',
      clinicalCrib: namedLegacyCrib,
    });

    vi.resetModules();
    let retryAttempts = 0;
    let resolveRetry:
      | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
      | null = null;
    const retryPromise = new Promise<{
      UpcClassificationWindow: React.FC<MockUpcWindowProps>;
    }>(resolve => {
      resolveRetry = resolve;
    });
    vi.doMock(UPC_WINDOW_MODULE_PATH, () => {
      retryAttempts += 1;
      if (retryAttempts === 1) throw new Error('503 Service Unavailable');
      return retryPromise;
    });

    const fresh = await loadFreshContext();
    const FreshCribTrigger = ({ crib }: { crib: PatientData }) => {
      const { openUpcWindow } = fresh.useUpcClassificationWindowOpener();
      return (
        <button
          type="button"
          onClick={event =>
            openUpcWindow('R1', {
              crib: true,
              episodeIdentity: fresh.resolveUpcCellSubjectIdentity(crib),
              triggerElement: event.currentTarget,
            })
          }
        >
          Abrir cuna R1 legacy
        </button>
      );
    };

    const freshView = render(
      <fresh.DailyRecordBedsContext.Provider value={{ R1: motherUnnamed }}>
        <fresh.UpcClassificationWindowProvider currentDateString="2026-11-24">
          <FreshCribTrigger crib={unnamedLegacyCrib} />
        </fresh.UpcClassificationWindowProvider>
      </fresh.DailyRecordBedsContext.Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna R1 legacy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    freshView.rerender(
      <fresh.DailyRecordBedsContext.Provider value={{ R1: motherNamed }}>
        <fresh.UpcClassificationWindowProvider currentDateString="2026-11-24">
          <FreshCribTrigger crib={namedLegacyCrib} />
        </fresh.UpcClassificationWindowProvider>
      </fresh.DailyRecordBedsContext.Provider>
    );
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    await act(async () => {
      resolveRetry?.({
        UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
          <div role="dialog" aria-label="Clasificación UPC">
            {initialBedId}
          </div>
        ),
      });
      await retryPromise;
    });

    expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent('R1:crib');
    consoleErrorSpy.mockRestore();
  });

  it('cancels a pending crib open when the mother episode changes even if both newborns share a legacy ID', async () => {
    let resolveChunk:
      | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
      | null = null;
    const chunkPromise = new Promise<{
      UpcClassificationWindow: React.FC<MockUpcWindowProps>;
    }>(resolve => {
      resolveChunk = resolve;
    });

    vi.doMock(UPC_WINDOW_MODULE_PATH, () => chunkPromise);

    const {
      DailyRecordBedsContext,
      resolveUpcCellSubjectIdentity,
      UpcClassificationWindowProvider,
      useUpcClassificationWindowOpener,
    } = await loadFreshContext();

    const cribA = DataFactory.createMockPatient('R1', {
      patientName: '',
      rut: '',
      clinicalEpisodeId: 'legacy_ep_shared_crib',
      admissionDate: '2026-11-24',
      admissionTime: '08:00',
    });
    const cribB = DataFactory.createMockPatient('R1', {
      patientName: 'RN Familia B',
      rut: '',
      clinicalEpisodeId: 'legacy_ep_shared_crib',
      admissionDate: '2026-11-24',
      admissionTime: '08:00',
    });
    const motherA = DataFactory.createMockPatient('R1', {
      patientName: 'Madre Familia A',
      rut: '11.111.111-1',
      clinicalEpisodeId: 'ep-mother-A',
      clinicalCrib: cribA,
    });
    const motherB = DataFactory.createMockPatient('R1', {
      patientName: 'Madre Familia B',
      rut: '22.222.222-2',
      clinicalEpisodeId: 'ep-mother-B',
      clinicalCrib: cribB,
    });

    const Trigger = ({ crib }: { crib: PatientData }) => {
      const { openUpcWindow } = useUpcClassificationWindowOpener();
      return (
        <button
          type="button"
          onClick={event =>
            openUpcWindow('R1', {
              crib: true,
              episodeIdentity: resolveUpcCellSubjectIdentity(crib),
              triggerElement: event.currentTarget,
            })
          }
        >
          Abrir cuna familia A
        </button>
      );
    };

    const { rerender } = render(
      <DailyRecordBedsContext.Provider value={{ R1: motherA }}>
        <UpcClassificationWindowProvider currentDateString="2026-11-24">
          <Trigger crib={cribA} />
        </UpcClassificationWindowProvider>
      </DailyRecordBedsContext.Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna familia A' }));
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    rerender(
      <DailyRecordBedsContext.Provider value={{ R1: motherB }}>
        <UpcClassificationWindowProvider currentDateString="2026-11-24">
          <Trigger crib={cribB} />
        </UpcClassificationWindowProvider>
      </DailyRecordBedsContext.Provider>
    );
    expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();

    await act(async () => {
      resolveChunk?.({
        UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
          <div role="dialog" aria-label="Clasificación UPC">
            {initialBedId}
          </div>
        ),
      });
      await chunkPromise;
    });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('latches the first completed name on an unnamed legacy crib so a second replacement cancels', async () => {
    let resolveChunk:
      | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
      | null = null;
    const chunkPromise = new Promise<{
      UpcClassificationWindow: React.FC<MockUpcWindowProps>;
    }>(resolve => {
      resolveChunk = resolve;
    });

    vi.doMock(UPC_WINDOW_MODULE_PATH, () => chunkPromise);

    const {
      DailyRecordBedsContext,
      resolveUpcCellSubjectIdentity,
      UpcClassificationWindowProvider,
      useUpcClassificationWindowOpener,
    } = await loadFreshContext();

    const unnamedCrib = DataFactory.createMockPatient('R1', {
      patientName: '',
      rut: '',
      clinicalEpisodeId: 'legacy_ep_shared_crib',
      admissionDate: '2026-11-24',
      admissionTime: '08:00',
    });
    const cribNamedA = { ...unnamedCrib, patientName: 'RN A' };
    const cribReplacedByB = { ...unnamedCrib, patientName: 'RN B' };
    const motherWith = (crib: PatientData) =>
      DataFactory.createMockPatient('R1', {
        patientName: 'Madre Misma',
        clinicalEpisodeId: 'ep-mother-same',
        clinicalCrib: crib,
      });

    const Trigger = ({ crib }: { crib: PatientData }) => {
      const { openUpcWindow } = useUpcClassificationWindowOpener();
      return (
        <button
          type="button"
          onClick={event =>
            openUpcWindow('R1', {
              crib: true,
              episodeIdentity: resolveUpcCellSubjectIdentity(crib),
              triggerElement: event.currentTarget,
            })
          }
        >
          Abrir cuna R1
        </button>
      );
    };

    const { rerender } = render(
      <DailyRecordBedsContext.Provider value={{ R1: motherWith(unnamedCrib) }}>
        <UpcClassificationWindowProvider currentDateString="2026-11-24">
          <Trigger crib={unnamedCrib} />
        </UpcClassificationWindowProvider>
      </DailyRecordBedsContext.Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna R1' }));
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    // First naming (unnamed -> RN A) keeps pending open alive and latches RN A.
    rerender(
      <DailyRecordBedsContext.Provider value={{ R1: motherWith(cribNamedA) }}>
        <UpcClassificationWindowProvider currentDateString="2026-11-24">
          <Trigger crib={cribNamedA} />
        </UpcClassificationWindowProvider>
      </DailyRecordBedsContext.Provider>
    );
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    // Second change (RN A -> RN B) must cancel instead of passing through the empty-name allowance.
    rerender(
      <DailyRecordBedsContext.Provider value={{ R1: motherWith(cribReplacedByB) }}>
        <UpcClassificationWindowProvider currentDateString="2026-11-24">
          <Trigger crib={cribReplacedByB} />
        </UpcClassificationWindowProvider>
      </DailyRecordBedsContext.Provider>
    );
    expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();

    await act(async () => {
      resolveChunk?.({
        UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
          <div role="dialog" aria-label="Clasificación UPC">
            {initialBedId}
          </div>
        ),
      });
      await chunkPromise;
    });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancels a pending legacy open when documentType switches between RUT and Pasaporte or admissionDate changes despite firstSeenDate', async () => {
    const runScenario = async (mutate: (base: PatientData) => PatientData) => {
      vi.resetModules();
      let resolveChunk:
        | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
        | null = null;
      const chunkPromise = new Promise<{
        UpcClassificationWindow: React.FC<MockUpcWindowProps>;
      }>(resolve => {
        resolveChunk = resolve;
      });
      vi.doMock(UPC_WINDOW_MODULE_PATH, () => chunkPromise);

      const {
        DailyRecordBedsContext,
        resolveUpcCellSubjectIdentity,
        UpcClassificationWindowProvider,
        useUpcClassificationWindowOpener,
      } = await loadFreshContext();

      const base = DataFactory.createMockPatient('R2', {
        patientName: '',
        documentType: 'RUT',
        rut: '12345678',
        clinicalEpisodeId: '',
        firstSeenDate: '2026-11-23',
        admissionDate: '2026-11-23',
        admissionTime: '08:00',
      });
      const updated = mutate(base);

      const Trigger = ({ patient }: { patient: PatientData }) => {
        const { openUpcWindow } = useUpcClassificationWindowOpener();
        return (
          <button
            type="button"
            onClick={event =>
              openUpcWindow('R2', {
                episodeIdentity: resolveUpcCellSubjectIdentity(patient),
                triggerElement: event.currentTarget,
              })
            }
          >
            Abrir R2 legado
          </button>
        );
      };

      const view = render(
        <DailyRecordBedsContext.Provider value={{ R2: base }}>
          <UpcClassificationWindowProvider currentDateString="2026-11-24">
            <Trigger patient={base} />
          </UpcClassificationWindowProvider>
        </DailyRecordBedsContext.Provider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Abrir R2 legado' }));
      expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

      view.rerender(
        <DailyRecordBedsContext.Provider value={{ R2: updated }}>
          <UpcClassificationWindowProvider currentDateString="2026-11-24">
            <Trigger patient={updated} />
          </UpcClassificationWindowProvider>
        </DailyRecordBedsContext.Provider>
      );
      expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();

      await act(async () => {
        resolveChunk?.({
          UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
            <div role="dialog" aria-label="Clasificación UPC">
              {initialBedId}
            </div>
          ),
        });
        await chunkPromise;
      });

      expect(screen.queryByRole('dialog')).toBeNull();
      view.unmount();
    };

    // 1) Switching RUT -> Pasaporte with the same document number cancels even when naming.
    await runScenario(base => ({
      ...base,
      patientName: 'Visitante Extranjero',
      documentType: 'Pasaporte',
    }));

    // 2) Changing admissionDate cancels even when firstSeenDate stays unchanged.
    await runScenario(base => ({
      ...base,
      patientName: 'Paciente Nuevo Ingreso',
      admissionDate: '2026-11-24',
    }));
  });

  it('cancels a pending unnamed crib open when twins sharing a legacy ID swap beds, while keeping non-swapped twin naming alive', async () => {
    const runTwinScenario = async (mode: 'swap-initial' | 'swap-retry' | 'control-no-swap') => {
      vi.resetModules();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      let attempts = 0;
      let resolveChunk:
        | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
        | null = null;
      const chunkPromise = new Promise<{
        UpcClassificationWindow: React.FC<MockUpcWindowProps>;
      }>(resolve => {
        resolveChunk = resolve;
      });
      vi.doMock(UPC_WINDOW_MODULE_PATH, () => {
        attempts += 1;
        if (mode === 'swap-retry' && attempts === 1) {
          throw new Error('503 Service Unavailable');
        }
        return chunkPromise;
      });

      const {
        DailyRecordBedsContext,
        resolveUpcCellSubjectIdentity,
        UpcClassificationWindowProvider,
        useUpcClassificationWindowOpener,
      } = await loadFreshContext();

      const unnamedTwinInCrib = DataFactory.createMockPatient('R1', {
        patientName: '',
        rut: '',
        biologicalSex: 'Femenino',
        clinicalEpisodeId: 'legacy_ep_twins',
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
      });
      const namedTwinInNeo = DataFactory.createMockPatient('Neo1', {
        patientName: 'RN Gemelo Dos',
        rut: '',
        biologicalSex: 'Femenino',
        clinicalEpisodeId: 'legacy_ep_twins',
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
      });
      const motherWith = (crib: PatientData) =>
        DataFactory.createMockPatient('R1', {
          patientName: 'Madre Gemelos',
          clinicalEpisodeId: 'ep-mother-twins',
          clinicalCrib: crib,
        });

      const Trigger = ({ crib }: { crib: PatientData }) => {
        const { openUpcWindow } = useUpcClassificationWindowOpener();
        return (
          <button
            type="button"
            onClick={event =>
              openUpcWindow('R1', {
                crib: true,
                episodeIdentity: resolveUpcCellSubjectIdentity(crib),
                triggerElement: event.currentTarget,
              })
            }
          >
            Abrir cuna gemelo
          </button>
        );
      };

      const initialBeds = {
        R1: motherWith(unnamedTwinInCrib),
        Neo1: namedTwinInNeo,
      };
      const view = render(
        <DailyRecordBedsContext.Provider value={initialBeds}>
          <UpcClassificationWindowProvider currentDateString="2026-11-24">
            <Trigger crib={unnamedTwinInCrib} />
          </UpcClassificationWindowProvider>
        </DailyRecordBedsContext.Provider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna gemelo' }));
      if (mode === 'swap-retry') {
        expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      }
      expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

      const nextBeds =
        mode === 'control-no-swap'
          ? {
              R1: motherWith({ ...unnamedTwinInCrib, patientName: 'RN Gemelo Uno' }),
              Neo1: namedTwinInNeo,
            }
          : {
              R1: motherWith({ ...unnamedTwinInCrib, patientName: 'RN Gemelo Dos' }),
              Neo1: { ...namedTwinInNeo, patientName: '' },
            };

      view.rerender(
        <DailyRecordBedsContext.Provider value={nextBeds}>
          <UpcClassificationWindowProvider currentDateString="2026-11-24">
            <Trigger crib={nextBeds.R1.clinicalCrib!} />
          </UpcClassificationWindowProvider>
        </DailyRecordBedsContext.Provider>
      );

      if (mode === 'control-no-swap') {
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();
      } else {
        expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();
      }

      await act(async () => {
        resolveChunk?.({
          UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
            <div role="dialog" aria-label="Clasificación UPC">
              {initialBedId}
            </div>
          ),
        });
        await chunkPromise;
      });

      if (mode === 'control-no-swap') {
        expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent(
          'R1:crib'
        );
      } else {
        expect(screen.queryByRole('dialog')).toBeNull();
      }

      view.unmount();
      consoleErrorSpy.mockRestore();
    };

    await runTwinScenario('swap-initial');
    await runTwinScenario('swap-retry');
    await runTwinScenario('control-no-swap');
  });

  it('cancels when twins with identical provisional names swap or when a second twin arrives in Neo1 after click and then swaps', async () => {
    const runVariant = async (
      variant:
        | 'same-provisional-initial'
        | 'same-provisional-retry'
        | 'late-neo1-initial'
        | 'late-neo1-retry'
    ) => {
      vi.resetModules();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const isRetry = variant.endsWith('-retry');
      let attempts = 0;
      let resolveChunk:
        | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
        | null = null;
      const chunkPromise = new Promise<{
        UpcClassificationWindow: React.FC<MockUpcWindowProps>;
      }>(resolve => {
        resolveChunk = resolve;
      });
      vi.doMock(UPC_WINDOW_MODULE_PATH, () => {
        attempts += 1;
        if (isRetry && attempts === 1) {
          throw new Error('503 Service Unavailable');
        }
        return chunkPromise;
      });

      const {
        DailyRecordBedsContext,
        resolveUpcCellSubjectIdentity,
        UpcClassificationWindowProvider,
        useUpcClassificationWindowOpener,
      } = await loadFreshContext();

      const motherWith = (crib: PatientData) =>
        DataFactory.createMockPatient('R1', {
          patientName: 'Madre Gemelos',
          clinicalEpisodeId: 'ep-mother-twins',
          clinicalCrib: crib,
        });

      const Trigger = ({ crib }: { crib: PatientData }) => {
        const { openUpcWindow } = useUpcClassificationWindowOpener();
        return (
          <button
            type="button"
            onClick={event =>
              openUpcWindow('R1', {
                crib: true,
                episodeIdentity: resolveUpcCellSubjectIdentity(crib),
                triggerElement: event.currentTarget,
              })
            }
          >
            Abrir cuna variante
          </button>
        );
      };

      if (variant.startsWith('same-provisional')) {
        const cribA = DataFactory.createMockPatient('R1', {
          patientName: 'RN de Madre Gemelos',
          rut: '',
          clinicalEpisodeId: 'legacy_ep_twins',
          admissionDate: '2026-11-24',
          admissionTime: '08:00',
          isUPC: false,
          upcChecklist: undefined,
        });
        const neoB = DataFactory.createMockPatient('Neo1', {
          patientName: 'RN de Madre Gemelos',
          rut: '',
          clinicalEpisodeId: 'legacy_ep_twins',
          admissionDate: '2026-11-24',
          admissionTime: '08:00',
          isUPC: true,
          upcChecklist: {
            uciCriteria: [],
            utiCriteria: ['uti_mon_cardio'],
            classification: 'UPC_UTI',
            evaluatedAt: '2026-11-24T09:00:00Z',
            evaluatedBedId: 'Neo1',
          },
        });

        const view = render(
          <DailyRecordBedsContext.Provider value={{ R1: motherWith(cribA), Neo1: neoB }}>
            <UpcClassificationWindowProvider currentDateString="2026-11-24">
              <Trigger crib={cribA} />
            </UpcClassificationWindowProvider>
          </DailyRecordBedsContext.Provider>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna variante' }));
        if (isRetry) {
          expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);
          fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        }
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

        view.rerender(
          <DailyRecordBedsContext.Provider value={{ R1: motherWith(neoB), Neo1: cribA }}>
            <UpcClassificationWindowProvider currentDateString="2026-11-24">
              <Trigger crib={neoB} />
            </UpcClassificationWindowProvider>
          </DailyRecordBedsContext.Provider>
        );
        expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();
        view.unmount();
      } else {
        const unnamedCrib = DataFactory.createMockPatient('R1', {
          patientName: '',
          rut: '',
          clinicalEpisodeId: 'legacy_ep_twins',
          admissionDate: '2026-11-24',
          admissionTime: '08:00',
        });
        const lateTwinNeo1 = DataFactory.createMockPatient('Neo1', {
          patientName: 'RN Gemelo Tardio',
          rut: '',
          clinicalEpisodeId: 'legacy_ep_twins',
          admissionDate: '2026-11-24',
          admissionTime: '08:00',
        });

        // At click time Neo1 is still empty.
        const view = render(
          <DailyRecordBedsContext.Provider value={{ R1: motherWith(unnamedCrib) }}>
            <UpcClassificationWindowProvider currentDateString="2026-11-24">
              <Trigger crib={unnamedCrib} />
            </UpcClassificationWindowProvider>
          </DailyRecordBedsContext.Provider>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna variante' }));
        if (isRetry) {
          expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);
          fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        }
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

        // Step 1: A new occupant arrives in previously empty Neo1 while the legacy crib open is
        // pending -> cancels immediately rather than risking a late twin move/swap.
        view.rerender(
          <DailyRecordBedsContext.Provider
            value={{ R1: motherWith(unnamedCrib), Neo1: lateTwinNeo1 }}
          >
            <UpcClassificationWindowProvider currentDateString="2026-11-24">
              <Trigger crib={unnamedCrib} />
            </UpcClassificationWindowProvider>
          </DailyRecordBedsContext.Provider>
        );
        expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();
        view.unmount();
      }

      await act(async () => {
        resolveChunk?.({
          UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
            <div role="dialog" aria-label="Clasificación UPC">
              {initialBedId}
            </div>
          ),
        });
        await chunkPromise;
      });
      expect(screen.queryByRole('dialog')).toBeNull();
      consoleErrorSpy.mockRestore();
    };

    await runVariant('same-provisional-initial');
    await runVariant('same-provisional-retry');
    await runVariant('late-neo1-initial');
    await runVariant('late-neo1-retry');
  });

  it('cancels before the first UPC evaluation when twins with identical provisional name, legacy ID, and diagnosis differ in clinical status and swap', async () => {
    const runFirstEvalSwap = async (mode: 'initial' | 'retry' | 'control-no-swap') => {
      vi.resetModules();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      let attempts = 0;
      let resolveChunk:
        | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
        | null = null;
      const chunkPromise = new Promise<{
        UpcClassificationWindow: React.FC<MockUpcWindowProps>;
      }>(resolve => {
        resolveChunk = resolve;
      });
      vi.doMock(UPC_WINDOW_MODULE_PATH, () => {
        attempts += 1;
        if (mode === 'retry' && attempts === 1) {
          throw new Error('503 Service Unavailable');
        }
        return chunkPromise;
      });

      const {
        DailyRecordBedsContext,
        resolveUpcCellSubjectIdentity,
        UpcClassificationWindowProvider,
        useUpcClassificationWindowOpener,
      } = await loadFreshContext();

      const stableTwin = DataFactory.createMockPatient('R1', {
        patientName: 'RN de Madre Gemelos',
        rut: '',
        clinicalEpisodeId: 'legacy_ep_twins_first_eval',
        pathology: 'Prematurez moderada',
        status: PatientStatus.ESTABLE,
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
        isUPC: false,
        upcChecklist: undefined,
      });
      const severeTwin = DataFactory.createMockPatient('Neo1', {
        patientName: 'RN de Madre Gemelos',
        rut: '',
        clinicalEpisodeId: 'legacy_ep_twins_first_eval',
        pathology: 'Prematurez moderada',
        status: PatientStatus.GRAVE,
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
        isUPC: false,
        upcChecklist: undefined,
      });
      const motherWith = (crib: PatientData) =>
        DataFactory.createMockPatient('R1', {
          patientName: 'Madre Gemelos',
          clinicalEpisodeId: 'ep-mother-twins-first-eval',
          clinicalCrib: crib,
        });

      const Trigger = ({ crib }: { crib: PatientData }) => {
        const { openUpcWindow } = useUpcClassificationWindowOpener();
        return (
          <button
            type="button"
            onClick={event =>
              openUpcWindow('R1', {
                crib: true,
                episodeIdentity: resolveUpcCellSubjectIdentity(crib),
                triggerElement: event.currentTarget,
              })
            }
          >
            Abrir cuna primera evaluacion
          </button>
        );
      };

      const view = render(
        <DailyRecordBedsContext.Provider value={{ R1: motherWith(stableTwin), Neo1: severeTwin }}>
          <UpcClassificationWindowProvider currentDateString="2026-11-24">
            <Trigger crib={stableTwin} />
          </UpcClassificationWindowProvider>
        </DailyRecordBedsContext.Provider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna primera evaluacion' }));
      if (mode === 'retry') {
        expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      }
      expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

      if (mode !== 'control-no-swap') {
        view.rerender(
          <DailyRecordBedsContext.Provider
            value={{
              R1: motherWith({ ...severeTwin, bedId: 'R1' }),
              Neo1: { ...stableTwin, bedId: 'Neo1' },
            }}
          >
            <UpcClassificationWindowProvider currentDateString="2026-11-24">
              <Trigger crib={{ ...severeTwin, bedId: 'R1' }} />
            </UpcClassificationWindowProvider>
          </DailyRecordBedsContext.Provider>
        );
        expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();
      }

      await act(async () => {
        resolveChunk?.({
          UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
            <div role="dialog" aria-label="Clasificación UPC">
              {initialBedId}
            </div>
          ),
        });
        await chunkPromise;
      });

      if (mode === 'control-no-swap') {
        expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent(
          'R1:crib'
        );
      } else {
        expect(screen.queryByRole('dialog')).toBeNull();
      }

      view.unmount();
      consoleErrorSpy.mockRestore();
    };

    await runFirstEvalSwap('initial');
    await runFirstEvalSwap('retry');
    await runFirstEvalSwap('control-no-swap');
  });

  it('cancels on a single-update move of twin Alfa into empty Neo1 with Beta arriving in R1:crib (with or without prior firstName) and keeps matching firstName completion alive', async () => {
    const runSingleUpdateMove = async (
      mode:
        | 'atomic-with-firstname-initial'
        | 'atomic-with-firstname-retry'
        | 'atomic-blank-initial'
        | 'atomic-blank-retry'
        | 'control-matching-firstname'
    ) => {
      vi.resetModules();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const isRetry = mode.endsWith('-retry');
      let attempts = 0;
      let resolveChunk:
        | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
        | null = null;
      const chunkPromise = new Promise<{
        UpcClassificationWindow: React.FC<MockUpcWindowProps>;
      }>(resolve => {
        resolveChunk = resolve;
      });
      vi.doMock(UPC_WINDOW_MODULE_PATH, () => {
        attempts += 1;
        if (isRetry && attempts === 1) {
          throw new Error('503 Service Unavailable');
        }
        return chunkPromise;
      });

      const {
        DailyRecordBedsContext,
        resolveUpcCellSubjectIdentity,
        UpcClassificationWindowProvider,
        useUpcClassificationWindowOpener,
      } = await loadFreshContext();

      const hasPriorFirstName = mode.includes('firstname');
      const initialCrib = DataFactory.createMockPatient('R1', {
        patientName: '',
        firstName: hasPriorFirstName ? 'Alfa' : '',
        rut: '',
        clinicalEpisodeId: 'legacy_ep_atomic_twins',
        pathology: 'Prematurez',
        status: PatientStatus.ESTABLE,
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
      });
      const motherWith = (crib: PatientData) =>
        DataFactory.createMockPatient('R1', {
          patientName: 'Madre Gemelos Atomico',
          clinicalEpisodeId: 'ep-mother-atomic',
          clinicalCrib: crib,
        });

      const Trigger = ({ crib }: { crib: PatientData }) => {
        const { openUpcWindow } = useUpcClassificationWindowOpener();
        return (
          <button
            type="button"
            onClick={event =>
              openUpcWindow('R1', {
                crib: true,
                episodeIdentity: resolveUpcCellSubjectIdentity(crib),
                triggerElement: event.currentTarget,
              })
            }
          >
            Abrir cuna atomica
          </button>
        );
      };

      // Neo1 is explicitly present as an empty bed (with default Indeterminado biologicalSex) at click time.
      const emptyNeo1 = DataFactory.createMockPatient('Neo1', {
        patientName: '',
        rut: '',
        clinicalEpisodeId: '',
        pathology: '',
        admissionDate: '',
        admissionTime: '',
        birthDate: '',
        biologicalSex: 'Indeterminado',
        status: PatientStatus.EMPTY,
        isUPC: false,
        upcChecklist: undefined,
        devices: [],
      });
      expect(resolveUpcCellSubjectIdentity(emptyNeo1)).toBeNull();

      const view = render(
        <DailyRecordBedsContext.Provider value={{ R1: motherWith(initialCrib), Neo1: emptyNeo1 }}>
          <UpcClassificationWindowProvider currentDateString="2026-11-24">
            <Trigger crib={initialCrib} />
          </UpcClassificationWindowProvider>
        </DailyRecordBedsContext.Provider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna atomica' }));
      if (isRetry) {
        expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      }
      expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

      if (mode === 'control-matching-firstname') {
        const namedAlfa = { ...initialCrib, patientName: 'Alfa Soto', firstName: 'Alfa' };
        view.rerender(
          <DailyRecordBedsContext.Provider
            value={{ R1: motherWith(namedAlfa), Neo1: { ...emptyNeo1 } }}
          >
            <UpcClassificationWindowProvider currentDateString="2026-11-24">
              <Trigger crib={namedAlfa} />
            </UpcClassificationWindowProvider>
          </DailyRecordBedsContext.Provider>
        );
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();
      } else {
        // Single update moves Alfa to previously empty Neo1 and places Beta in R1:crib.
        const betaInCrib = { ...initialCrib, patientName: 'RN Beta', firstName: 'Beta' };
        const alfaInNeo1 = {
          ...initialCrib,
          bedId: 'Neo1',
          patientName: 'RN Alfa',
          firstName: 'Alfa',
        };
        view.rerender(
          <DailyRecordBedsContext.Provider value={{ R1: motherWith(betaInCrib), Neo1: alfaInNeo1 }}>
            <UpcClassificationWindowProvider currentDateString="2026-11-24">
              <Trigger crib={betaInCrib} />
            </UpcClassificationWindowProvider>
          </DailyRecordBedsContext.Provider>
        );
        expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();
      }

      await act(async () => {
        resolveChunk?.({
          UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
            <div role="dialog" aria-label="Clasificación UPC">
              {initialBedId}
            </div>
          ),
        });
        await chunkPromise;
      });

      if (mode === 'control-matching-firstname') {
        expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent(
          'R1:crib'
        );
      } else {
        expect(screen.queryByRole('dialog')).toBeNull();
      }

      view.unmount();
      consoleErrorSpy.mockRestore();
    };

    await runSingleUpdateMove('atomic-with-firstname-initial');
    await runSingleUpdateMove('atomic-with-firstname-retry');
    await runSingleUpdateMove('atomic-blank-initial');
    await runSingleUpdateMove('atomic-blank-retry');
    await runSingleUpdateMove('control-matching-firstname');
  });

  it('rejects partial substring firstName matches and allows paired legacy mother/crib naming without false cancellation', async () => {
    let resolveChunk:
      | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
      | null = null;
    const chunkPromise = new Promise<{
      UpcClassificationWindow: React.FC<MockUpcWindowProps>;
    }>(resolve => {
      resolveChunk = resolve;
    });
    vi.doMock(UPC_WINDOW_MODULE_PATH, () => chunkPromise);

    const {
      DailyRecordBedsContext,
      resolveUpcCellSubjectIdentity,
      UpcClassificationWindowProvider,
      useUpcClassificationWindowOpener,
    } = await loadFreshContext();

    // 1) Token-boundary check: prior firstName "Ana" must not match "RN de Mariana".
    const { isSameUpcCellSubjectIdentity } =
      await import('@/features/census/components/patient-row/upcPendingOpenGuard');
    const expectedAna = resolveUpcCellSubjectIdentity(
      DataFactory.createMockPatient('R1', {
        patientName: '',
        firstName: 'Ana',
        rut: '',
        clinicalEpisodeId: 'legacy_ep_token',
      })
    );
    const currentMariana = resolveUpcCellSubjectIdentity(
      DataFactory.createMockPatient('R1', {
        patientName: 'RN de Mariana',
        firstName: '',
        rut: '',
        clinicalEpisodeId: 'legacy_ep_token',
      })
    );
    expect(isSameUpcCellSubjectIdentity(expectedAna, currentMariana)).toBe(false);

    // 2) Legacy mother + legacy crib sharing maternal RUT: completing crib patientName keeps open.
    const unnamedCrib = DataFactory.createMockPatient('R1', {
      patientName: '',
      rut: '11.111.111-1',
      clinicalEpisodeId: 'legacy_ep_shared_family',
      admissionDate: '2026-11-24',
      admissionTime: '08:00',
    });
    const namedCrib = { ...unnamedCrib, patientName: 'RN de Maria' };
    const legacyMother = (crib: PatientData) =>
      DataFactory.createMockPatient('R1', {
        patientName: 'Maria Lopez',
        rut: '11.111.111-1',
        clinicalEpisodeId: 'legacy_ep_shared_family',
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
        clinicalCrib: crib,
      });

    const Trigger = ({ crib }: { crib: PatientData }) => {
      const { openUpcWindow } = useUpcClassificationWindowOpener();
      return (
        <button
          type="button"
          onClick={event =>
            openUpcWindow('R1', {
              crib: true,
              episodeIdentity: resolveUpcCellSubjectIdentity(crib),
              triggerElement: event.currentTarget,
            })
          }
        >
          Abrir cuna madre legado
        </button>
      );
    };

    const view = render(
      <DailyRecordBedsContext.Provider value={{ R1: legacyMother(unnamedCrib) }}>
        <UpcClassificationWindowProvider currentDateString="2026-11-24">
          <Trigger crib={unnamedCrib} />
        </UpcClassificationWindowProvider>
      </DailyRecordBedsContext.Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna madre legado' }));
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    view.rerender(
      <DailyRecordBedsContext.Provider value={{ R1: legacyMother(namedCrib) }}>
        <UpcClassificationWindowProvider currentDateString="2026-11-24">
          <Trigger crib={namedCrib} />
        </UpcClassificationWindowProvider>
      </DailyRecordBedsContext.Provider>
    );
    expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

    await act(async () => {
      resolveChunk?.({
        UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
          <div role="dialog" aria-label="Clasificación UPC">
            {initialBedId}
          </div>
        ),
      });
      await chunkPromise;
    });

    expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent('R1:crib');
    view.unmount();
  });

  it('cancels when two unnamed legacy twins in R1:crib and Neo1 swap and get named simultaneously, keeps an accredited crib open on unrelated Neo1 admission despite a legacy mother, and opens a no-ID/no-RUT crib when consistent firstName completes', async () => {
    const runCase = async (
      mode:
        | 'dual-unnamed-swap-initial'
        | 'dual-unnamed-swap-retry'
        | 'accredited-crib-legacy-mother-neo1-admission'
        | 'no-id-no-rut-consistent-firstname'
    ) => {
      vi.resetModules();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const isRetry = mode === 'dual-unnamed-swap-retry';
      let attempts = 0;
      let resolveChunk:
        | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
        | null = null;
      const chunkPromise = new Promise<{
        UpcClassificationWindow: React.FC<MockUpcWindowProps>;
      }>(resolve => {
        resolveChunk = resolve;
      });
      vi.doMock(UPC_WINDOW_MODULE_PATH, () => {
        attempts += 1;
        if (isRetry && attempts === 1) {
          throw new Error('503 Service Unavailable');
        }
        return chunkPromise;
      });

      const {
        DailyRecordBedsContext,
        resolveUpcCellSubjectIdentity,
        UpcClassificationWindowProvider,
        useUpcClassificationWindowOpener,
      } = await loadFreshContext();

      const Trigger = ({ crib }: { crib: PatientData }) => {
        const { openUpcWindow } = useUpcClassificationWindowOpener();
        return (
          <button
            type="button"
            onClick={event =>
              openUpcWindow('R1', {
                crib: true,
                episodeIdentity: resolveUpcCellSubjectIdentity(crib),
                triggerElement: event.currentTarget,
              })
            }
          >
            Abrir cuna caso
          </button>
        );
      };

      if (mode.startsWith('dual-unnamed-swap')) {
        const twinAlfa = DataFactory.createMockPatient('R1', {
          patientName: '',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'legacy_ep_dual_unnamed',
          admissionDate: '2026-11-24',
          admissionTime: '08:00',
        });
        const twinBeta = DataFactory.createMockPatient('Neo1', {
          patientName: '',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'legacy_ep_dual_unnamed',
          admissionDate: '2026-11-24',
          admissionTime: '08:00',
        });
        const motherWith = (crib: PatientData) =>
          DataFactory.createMockPatient('R1', {
            patientName: 'Madre Gemelos',
            clinicalEpisodeId: 'ep-mother-dual',
            clinicalCrib: crib,
          });

        const view = render(
          <DailyRecordBedsContext.Provider value={{ R1: motherWith(twinAlfa), Neo1: twinBeta }}>
            <UpcClassificationWindowProvider currentDateString="2026-11-24">
              <Trigger crib={twinAlfa} />
            </UpcClassificationWindowProvider>
          </DailyRecordBedsContext.Provider>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna caso' }));
        if (isRetry) {
          expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);
          fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        }
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

        // Single update swaps both unnamed twins and assigns their names simultaneously.
        const betaNamedInCrib = { ...twinBeta, bedId: 'R1', patientName: 'RN Beta' };
        const alfaNamedInNeo1 = { ...twinAlfa, bedId: 'Neo1', patientName: 'RN Alfa' };
        view.rerender(
          <DailyRecordBedsContext.Provider
            value={{ R1: motherWith(betaNamedInCrib), Neo1: alfaNamedInNeo1 }}
          >
            <UpcClassificationWindowProvider currentDateString="2026-11-24">
              <Trigger crib={betaNamedInCrib} />
            </UpcClassificationWindowProvider>
          </DailyRecordBedsContext.Provider>
        );
        expect(screen.queryByTestId('upc-window-module-loading')).toBeNull();

        await act(async () => {
          resolveChunk?.({
            UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
              <div role="dialog" aria-label="Clasificación UPC">
                {initialBedId}
              </div>
            ),
          });
          await chunkPromise;
        });
        expect(screen.queryByRole('dialog')).toBeNull();
        view.unmount();
      } else if (mode === 'accredited-crib-legacy-mother-neo1-admission') {
        const accreditedCrib = DataFactory.createMockPatient('R1', {
          patientName: 'RN Acreditado',
          rut: '28.000.001-1',
          clinicalEpisodeId: 'ep-rn-accredited-1',
        });
        const legacyMother = DataFactory.createMockPatient('R1', {
          patientName: 'Madre Legada',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'legacy_ep_mother_only',
          clinicalCrib: accreditedCrib,
        });
        const unrelatedNeo1 = DataFactory.createMockPatient('Neo1', {
          patientName: 'RN Ajeno',
          rut: '28.000.009-7',
          clinicalEpisodeId: 'ep-rn-unrelated-9',
        });

        const view = render(
          <DailyRecordBedsContext.Provider value={{ R1: legacyMother }}>
            <UpcClassificationWindowProvider currentDateString="2026-11-24">
              <Trigger crib={accreditedCrib} />
            </UpcClassificationWindowProvider>
          </DailyRecordBedsContext.Provider>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna caso' }));
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

        // Unrelated admission to Neo1 must not cancel an accredited newborn open.
        view.rerender(
          <DailyRecordBedsContext.Provider value={{ R1: legacyMother, Neo1: unrelatedNeo1 }}>
            <UpcClassificationWindowProvider currentDateString="2026-11-24">
              <Trigger crib={accreditedCrib} />
            </UpcClassificationWindowProvider>
          </DailyRecordBedsContext.Provider>
        );
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

        await act(async () => {
          resolveChunk?.({
            UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
              <div role="dialog" aria-label="Clasificación UPC">
                {initialBedId}
              </div>
            ),
          });
          await chunkPromise;
        });
        expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent(
          'R1:crib'
        );
        view.unmount();
      } else {
        const cribNoIdNoRut = DataFactory.createMockPatient('R1', {
          patientName: '',
          firstName: 'Alfa',
          rut: '',
          clinicalEpisodeId: '',
          admissionDate: '2026-11-24',
          admissionTime: '08:00',
        });
        const cribNamedAlfa = { ...cribNoIdNoRut, patientName: 'Alfa Soto', firstName: 'Alfa' };
        const motherWith = (crib: PatientData) =>
          DataFactory.createMockPatient('R1', {
            patientName: 'Madre Sin Doc',
            clinicalEpisodeId: 'ep-mother-nodoc',
            clinicalCrib: crib,
          });

        const view = render(
          <DailyRecordBedsContext.Provider value={{ R1: motherWith(cribNoIdNoRut) }}>
            <UpcClassificationWindowProvider currentDateString="2026-11-24">
              <Trigger crib={cribNoIdNoRut} />
            </UpcClassificationWindowProvider>
          </DailyRecordBedsContext.Provider>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Abrir cuna caso' }));
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

        view.rerender(
          <DailyRecordBedsContext.Provider value={{ R1: motherWith(cribNamedAlfa) }}>
            <UpcClassificationWindowProvider currentDateString="2026-11-24">
              <Trigger crib={cribNamedAlfa} />
            </UpcClassificationWindowProvider>
          </DailyRecordBedsContext.Provider>
        );
        expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

        await act(async () => {
          resolveChunk?.({
            UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
              <div role="dialog" aria-label="Clasificación UPC">
                {initialBedId}
              </div>
            ),
          });
          await chunkPromise;
        });
        expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent(
          'R1:crib'
        );
        view.unmount();
      }

      consoleErrorSpy.mockRestore();
    };

    await runCase('dual-unnamed-swap-initial');
    await runCase('dual-unnamed-swap-retry');
    await runCase('accredited-crib-legacy-mother-neo1-admission');
    await runCase('no-id-no-rut-consistent-firstname');
  });

  it('keeps a pending legacy mother bed open when her own paired crib completes patientName (alone or together with the mother)', async () => {
    const runMotherNamingCase = async (mode: 'crib-only' | 'both-names' | 'both-names-retry') => {
      vi.resetModules();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const isRetry = mode === 'both-names-retry';
      let attempts = 0;
      let resolveChunk:
        | ((value: { UpcClassificationWindow: React.FC<MockUpcWindowProps> }) => void)
        | null = null;
      const chunkPromise = new Promise<{
        UpcClassificationWindow: React.FC<MockUpcWindowProps>;
      }>(resolve => {
        resolveChunk = resolve;
      });
      vi.doMock(UPC_WINDOW_MODULE_PATH, () => {
        attempts += 1;
        if (isRetry && attempts === 1) {
          throw new Error('503 Service Unavailable');
        }
        return chunkPromise;
      });

      const {
        DailyRecordBedsContext,
        resolveUpcCellSubjectIdentity,
        UpcClassificationWindowProvider,
        useUpcClassificationWindowOpener,
      } = await loadFreshContext();

      const unnamedCrib = DataFactory.createMockPatient('R1', {
        patientName: '',
        rut: '11.111.111-1',
        clinicalEpisodeId: 'legacy_ep_shared_maternal',
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
      });
      const initialMother = DataFactory.createMockPatient('R1', {
        patientName: mode === 'crib-only' ? 'Maria Lopez' : '',
        rut: '11.111.111-1',
        clinicalEpisodeId: 'legacy_ep_shared_maternal',
        admissionDate: '2026-11-24',
        admissionTime: '08:00',
        clinicalCrib: unnamedCrib,
      });

      const Trigger = ({ mother }: { mother: PatientData }) => {
        const { openUpcWindow } = useUpcClassificationWindowOpener();
        return (
          <button
            type="button"
            onClick={event =>
              openUpcWindow('R1', {
                episodeIdentity: resolveUpcCellSubjectIdentity(mother),
                triggerElement: event.currentTarget,
              })
            }
          >
            Abrir cama materna
          </button>
        );
      };

      const view = render(
        <DailyRecordBedsContext.Provider value={{ R1: initialMother }}>
          <UpcClassificationWindowProvider currentDateString="2026-11-24">
            <Trigger mother={initialMother} />
          </UpcClassificationWindowProvider>
        </DailyRecordBedsContext.Provider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Abrir cama materna' }));
      if (isRetry) {
        expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir este panel/);
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      }
      expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

      const updatedMother: PatientData = {
        ...initialMother,
        patientName: 'Maria Lopez',
        clinicalCrib: { ...unnamedCrib, patientName: 'RN de Maria' },
      };

      view.rerender(
        <DailyRecordBedsContext.Provider value={{ R1: updatedMother }}>
          <UpcClassificationWindowProvider currentDateString="2026-11-24">
            <Trigger mother={updatedMother} />
          </UpcClassificationWindowProvider>
        </DailyRecordBedsContext.Provider>
      );
      expect(screen.getByTestId('upc-window-module-loading')).toBeInTheDocument();

      await act(async () => {
        resolveChunk?.({
          UpcClassificationWindow: ({ initialBedId }: MockUpcWindowProps) => (
            <div role="dialog" aria-label="Clasificación UPC">
              {initialBedId}
            </div>
          ),
        });
        await chunkPromise;
      });

      expect(screen.getByRole('dialog', { name: 'Clasificación UPC' })).toHaveTextContent('R1');
      view.unmount();
      consoleErrorSpy.mockRestore();
    };

    await runMotherNamingCase('crib-only');
    await runMotherNamingCase('both-names');
    await runMotherNamingCase('both-names-retry');
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
      await loadFreshContext();

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
