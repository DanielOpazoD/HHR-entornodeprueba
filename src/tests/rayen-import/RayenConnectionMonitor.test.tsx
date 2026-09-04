import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RayenConnectionMonitor } from '@/features/rayen-import/components/RayenConnectionMonitor';
import { RAYEN_EXTENSION_PROTOCOL_VERSION } from '@/features/rayen-import/bridge/extensionHealthBridge';
import { RAYEN_GC_CONNECT_RESULT_TYPE } from '@/features/rayen-import/bridge/gestionCamasConnectChannel';
import { RAYEN_CONNECTION_REPAIR_RESULT_TYPE } from '@/features/rayen-import/bridge/connectionRepairChannel';
import type { RayenExtensionHealthState } from '@/features/rayen-import/hooks/useRayenExtensionHealth';

const refreshMock = () =>
  vi.fn(
    async (_options?: { timeoutMs?: number }): Promise<RayenExtensionHealthState> => ({
      connection: 'ready',
      message: 'Extensión Eloísa operativa.',
      canSync: true,
      report: null,
    })
  );

const baseExtension = (
  overrides: Partial<RayenExtensionHealthState> = {}
): RayenExtensionHealthState & {
  refresh: ReturnType<typeof refreshMock>;
} => ({
  connection: 'ready',
  message: 'Extensión Eloísa v0.48.3 operativa.',
  canSync: true,
  report: {
    version: '0.48.3',
    protocolVersion: RAYEN_EXTENSION_PROTOCOL_VERSION,
    checkedAt: new Date(Date.now() - 45_000).toISOString(),
    capabilities: ['clean-connection-repair', 'hhr-connection-repair-bridge'],
    fichaMedico: {
      status: 'ready',
      message: 'Ficha Médico disponible. Sesión clínica vigente.',
      identity: { fullName: 'Daniel Opazo', role: 'Médico' },
      // Sesión de 24 h de Eloísa (extensión ≥ 0.48.5 publica la vigencia).
      remainingSeconds: 23 * 3600 + 5 * 60,
    },
    gestionCamas: {
      status: 'ready',
      message: 'Gestión de Camas conectada con sesión vigente.',
      remainingSeconds: 1800,
      lastVerifiedAt: Date.now() - 3 * 60_000,
    },
  },
  refresh: refreshMock(),
  ...overrides,
});

const renderMonitor = (
  extension: ReturnType<typeof baseExtension>,
  open = true
): {
  onOpenChange: ReturnType<typeof vi.fn>;
  rerenderMonitor: (nextExtension: ReturnType<typeof baseExtension>) => void;
} => {
  const onOpenChange = vi.fn();
  const view = render(
    <RayenConnectionMonitor
      extension={extension}
      working={false}
      lastSyncLine="Última 31-08-2026 · 17:37 h"
      open={open}
      onOpenChange={onOpenChange}
    />
  );
  return {
    onOpenChange,
    rerenderMonitor: nextExtension =>
      view.rerender(
        <RayenConnectionMonitor
          extension={nextExtension}
          working={false}
          lastSyncLine="Última 31-08-2026 · 17:37 h"
          open={open}
          onOpenChange={onOpenChange}
        />
      ),
  };
};

describe('RayenConnectionMonitor', () => {
  it('muestra identidad, vigencia y frescura de cada fuente', () => {
    renderMonitor(baseExtension());

    expect(screen.getByText('Conectada')).toBeVisible();
    // La vigencia larga se lee en horas; la identidad sigue primero.
    expect(screen.getByText('Daniel Opazo · Médico · vence en ~23 h')).toBeVisible();
    expect(screen.getByText(/vence en ~30 min · verificada hace 3 min/)).toBeVisible();
    expect(screen.getByText(/v0\.48\.3 · estado hace 45 s/)).toBeVisible();
    // Con todo verde no corresponde ofrecer la conexión de Gestión de Camas.
    expect(screen.queryByTestId('rayen-monitor-connect-gc')).not.toBeInTheDocument();
  });

  it('con GC caída ofrece abrir la ventana oficial y reporta un fallo de apertura', async () => {
    const extension = baseExtension({
      connection: 'blocked',
      canSync: false,
      message: 'Gestión de Camas no está conectada.',
      report: {
        ...baseExtension().report!,
        gestionCamas: {
          status: 'missing',
          reason: 'tab_missing',
          message: 'Gestión de Camas no está conectada.',
        },
      },
    });
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    renderMonitor(extension);

    await waitFor(() => expect(screen.getByTestId('rayen-monitor-connect-gc')).toBeEnabled());
    fireEvent.click(screen.getByTestId('rayen-monitor-connect-gc'));
    const payload = postMessageSpy.mock.calls
      .map(call => call[0] as { type?: string; reqId?: string })
      .find(message => message?.type === 'HHR_RAYEN_GC_CONNECT_REQUEST');
    expect(payload?.reqId).toBeTruthy();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: RAYEN_GC_CONNECT_RESULT_TYPE,
          reqId: payload?.reqId,
          ok: false,
          error: 'No se pudo abrir Gestión de Camas.',
        },
      })
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('No se pudo abrir Gestión de Camas.')
    );
  });

  it('con Ficha Médico lista pero por vencer, la barra dice «Revisar Ficha Médico» y no ofrece conectar GC', () => {
    const extension = baseExtension({
      connection: 'blocked',
      blockedBy: 'fichaMedico',
      canSync: false,
      message:
        'La sesión de Ficha Médico vence en ~3 min y no alcanzaría a cubrir la sincronización.',
      report: {
        ...baseExtension().report!,
        fichaMedico: {
          ...baseExtension().report!.fichaMedico,
          remainingSeconds: 150,
          expiresAt: Date.now() + 150_000,
        },
      },
    });
    renderMonitor(extension);

    expect(screen.getByText('Revisar Ficha Médico')).toBeVisible();
    expect(screen.queryByTestId('rayen-monitor-connect-gc')).not.toBeInTheDocument();
    expect(screen.getByText(/Daniel Opazo · Médico · vence en ~3 min/)).toBeVisible();
  });

  it('con una extensión antigua (sin vigencia de Ficha Médico) muestra solo la identidad', () => {
    const extension = baseExtension({
      report: {
        ...baseExtension().report!,
        fichaMedico: {
          status: 'ready',
          message: 'Ficha Médico disponible. Sesión clínica vigente.',
          identity: { fullName: 'Daniel Opazo', role: 'Médico' },
        },
      },
    });
    renderMonitor(extension);
    expect(screen.getByText('Daniel Opazo · Médico')).toBeVisible();
  });

  it('reintenta la comprobación solo cuando no existe un diagnóstico accionable', async () => {
    const extension = baseExtension({
      connection: 'offline',
      canSync: false,
      report: null,
      message: 'Extensión sin respuesta.',
    });
    renderMonitor(extension);
    await waitFor(() => expect(extension.refresh).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('rayen-monitor-refresh'));
    await waitFor(() => expect(extension.refresh).toHaveBeenCalledTimes(2));
  });

  it('mantiene deshabilitada la acción anterior mientras comprueba al abrir', async () => {
    let finishRefresh!: (value: RayenExtensionHealthState) => void;
    const pendingRefresh = new Promise<RayenExtensionHealthState>(resolve => {
      finishRefresh = resolve;
    });
    const extension = baseExtension({
      connection: 'blocked',
      canSync: false,
      report: {
        ...baseExtension().report!,
        gestionCamas: {
          status: 'missing',
          reason: 'tab_missing',
          message: 'No abierta.',
        },
      },
    });
    extension.refresh = vi.fn(() => pendingRefresh);
    renderMonitor(extension);

    expect(screen.getByTestId('rayen-monitor-connect-gc')).toBeDisabled();
    finishRefresh({
      connection: extension.connection,
      message: extension.message,
      canSync: extension.canSync,
      report: extension.report,
    });
    await waitFor(() => expect(screen.getByTestId('rayen-monitor-connect-gc')).toBeEnabled());
  });

  it('expone la reparación limpia existente y guía el login solo si el runtime lo confirma', async () => {
    const extension = baseExtension({
      connection: 'blocked',
      blockedBy: 'fichaMedico',
      canSync: false,
      report: {
        ...baseExtension().report!,
        fichaMedico: {
          status: 'stale',
          reason: 'outdated_tab',
          message: 'Pestaña desactualizada.',
        },
      },
    });
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const monitor = renderMonitor(extension);
    await waitFor(() => expect(screen.getByTestId('rayen-monitor-repair')).toBeEnabled());
    fireEvent.click(screen.getByTestId('rayen-monitor-repair'));
    const payload = postMessageSpy.mock.calls
      .map(call => call[0] as { type?: string; reqId?: string })
      .find(message => message?.type === 'HHR_RAYEN_CONNECTION_REPAIR_REQUEST');
    expect(payload?.reqId).toBeTruthy();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: RAYEN_CONNECTION_REPAIR_RESULT_TYPE,
          reqId: payload?.reqId,
          ok: false,
          requiresLogin: true,
        },
      })
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Completa el inicio de sesión en las pestañas nuevas de Eloísa.'
      )
    );
    expect(extension.refresh).toHaveBeenCalledWith({ timeoutMs: 12_000 });

    monitor.rerenderMonitor(baseExtension());
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
