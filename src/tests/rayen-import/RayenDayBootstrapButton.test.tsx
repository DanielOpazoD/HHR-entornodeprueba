import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RayenDayBootstrapButton } from '@/features/rayen-import/components/RayenDayBootstrapButton';
import { RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS } from '@/features/rayen-import/bridge/extensionHealthBridge';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  warning: vi.fn(),
  health: {
    connection: 'ready',
    canSync: true,
    message: 'Extensión operativa.',
  },
}));

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ warning: mocks.warning }),
}));

vi.mock('@/features/rayen-import/hooks/useRayenExtensionHealth', () => ({
  useRayenExtensionHealth: () => ({ ...mocks.health, refresh: mocks.refresh }),
}));

describe('RayenDayBootstrapButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refresh.mockResolvedValue({ connection: 'ready', canSync: true, message: 'Operativa.' });
    mocks.health.connection = 'ready';
    mocks.health.canSync = true;
    mocks.health.message = 'Extensión operativa.';
  });

  it('checks both sources and requests reviewed reconstruction for a historical day', async () => {
    const order: string[] = [];
    mocks.refresh.mockImplementation(async () => {
      order.push('health');
      return { connection: 'ready', canSync: true, message: 'Operativa.' };
    });
    const onCreateBlank = vi.fn(async () => {
      order.push('create');
      return true;
    });
    const onReady = vi.fn(() => order.push('review'));

    render(<RayenDayBootstrapButton historical onCreateBlank={onCreateBlank} onReady={onReady} />);
    expect(screen.getByTestId('eloisa-bootstrap-status')).toHaveTextContent(
      'Lista para sincronizar'
    );
    fireEvent.click(screen.getByRole('button', { name: /Reconstruir desde Eloísa/i }));

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).toHaveBeenCalledWith({
      timeoutMs: RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS,
      showChecking: true,
    });
    expect(onCreateBlank).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['health', 'create', 'review']);
    expect(screen.getByText('Revisar evidencia del día antes de importar')).toBeVisible();
  });

  it('copies the prior census before checking Eloísa and starting a reviewed import', async () => {
    const order: string[] = [];
    mocks.refresh.mockImplementation(async () => {
      order.push('health');
      return { connection: 'ready', canSync: true, message: 'Operativa.' };
    });
    const onCopyPrevious = vi.fn(async () => {
      order.push('copy');
      return true;
    });
    const onCreateBlank = vi.fn();
    const onReady = vi.fn(() => order.push('review'));
    render(
      <RayenDayBootstrapButton
        copySourceDate="2026-09-23"
        onCopyPrevious={onCopyPrevious}
        onCreateBlank={onCreateBlank}
        onReady={onReady}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Copiar pacientes del 23/i }));
    await waitFor(() => expect(onCopyPrevious).toHaveBeenCalledOnce());
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(onCreateBlank).not.toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledOnce();
    expect(mocks.warning).not.toHaveBeenCalled();
    expect(order).toEqual(['copy', 'health', 'review']);
  });

  it('keeps the copied census and warns when Eloísa is unavailable', async () => {
    mocks.health.connection = 'offline';
    mocks.health.canSync = false;
    mocks.health.message = 'Extensión no disponible.';
    mocks.refresh.mockResolvedValue({ connection: 'offline', canSync: false });
    const onCopyPrevious = vi.fn().mockResolvedValue(true);
    const onReady = vi.fn();
    render(
      <RayenDayBootstrapButton
        copySourceDate="2026-09-23"
        onCopyPrevious={onCopyPrevious}
        onCreateBlank={vi.fn()}
        onReady={onReady}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Copiar pacientes del 23/i }));
    await waitFor(() => expect(onCopyPrevious).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledOnce());
    expect(onReady).not.toHaveBeenCalled();
  });

  it('does not start Eloísa when the previous-day copy fails', async () => {
    const onReady = vi.fn();
    render(
      <RayenDayBootstrapButton
        copySourceDate="2026-09-23"
        onCopyPrevious={vi.fn().mockResolvedValue(false)}
        onCreateBlank={vi.fn()}
        onReady={onReady}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Copiar pacientes del 23/i }));
    expect(await screen.findByText(/No se pudo copiar el censo anterior/)).toBeVisible();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });

  it('does not create the day when a required Rayen source is unavailable', async () => {
    mocks.refresh.mockResolvedValue({
      connection: 'blocked',
      canSync: false,
      message: 'Gestión de Camas no está disponible.',
    });
    const onCreateBlank = vi.fn();
    const onReady = vi.fn();

    render(<RayenDayBootstrapButton onCreateBlank={onCreateBlank} onReady={onReady} />);
    fireEvent.click(screen.getByRole('button', { name: /Crear desde Eloísa/i }));

    expect(await screen.findByText('Gestión de Camas no está disponible.')).toBeVisible();
    expect(screen.getByTestId('eloisa-bootstrap-status')).toHaveTextContent(
      'Extensión requiere atención'
    );
    expect(onCreateBlank).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });

  it('offers a confirmed manual start only after the current-day extension check fails', async () => {
    mocks.refresh.mockResolvedValue({
      connection: 'offline',
      canSync: false,
      message: 'La extensión Eloísa no está disponible.',
    });
    const onCreateBlank = vi.fn().mockResolvedValue(true);
    const onReady = vi.fn();
    render(<RayenDayBootstrapButton onCreateBlank={onCreateBlank} onReady={onReady} />);
    expect(
      screen.queryByRole('button', { name: 'Iniciar censo sin Eloísa' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Crear desde Eloísa/i }));
    const fallback = await screen.findByRole('button', { name: 'Iniciar censo sin Eloísa' });
    fireEvent.click(fallback);
    expect(onCreateBlank).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar censo vacío' }));
    await waitFor(() => expect(onCreateBlank).toHaveBeenCalledOnce());
    expect(onReady).not.toHaveBeenCalled();
  });

  it('shows connection and synchronization preparation as distinct steps', async () => {
    let finishHealth!: (value: { canSync: boolean }) => void;
    let finishCreate!: (created: boolean) => void;
    mocks.refresh.mockReturnValue(
      new Promise(resolve => {
        finishHealth = resolve;
      })
    );
    const onCreateBlank = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          finishCreate = resolve;
        })
    );
    const onReady = vi.fn();
    render(<RayenDayBootstrapButton onCreateBlank={onCreateBlank} onReady={onReady} />);
    fireEvent.click(screen.getByRole('button', { name: /Crear desde Eloísa/i }));
    expect(screen.getByTestId('eloisa-bootstrap-status')).toHaveTextContent('Comprobando conexión');
    finishHealth({ canSync: true });
    await waitFor(() =>
      expect(screen.getByTestId('eloisa-bootstrap-status')).toHaveTextContent(
        'Preparando sincronización'
      )
    );
    finishCreate(true);
    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  });

  it('offers manual recovery when checking the extension rejects', async () => {
    mocks.refresh.mockRejectedValue(new Error('transport timeout'));
    const onCreateBlank = vi.fn();
    render(<RayenDayBootstrapButton onCreateBlank={onCreateBlank} onReady={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Crear desde Eloísa/i }));
    expect(await screen.findByRole('button', { name: 'Iniciar censo sin Eloísa' })).toBeVisible();
    expect(onCreateBlank).not.toHaveBeenCalled();
  });

  it('keeps the reviewed synchronization unopened when blank-day creation fails', async () => {
    mocks.refresh.mockResolvedValue({
      connection: 'ready',
      canSync: true,
      message: 'Operativa.',
    });
    const onCreateBlank = vi.fn().mockRejectedValue(new Error('write failed'));
    const onReady = vi.fn();

    render(<RayenDayBootstrapButton onCreateBlank={onCreateBlank} onReady={onReady} />);
    fireEvent.click(screen.getByRole('button', { name: /Crear desde Eloísa/i }));

    expect(await screen.findByText(/No se pudo crear el día/)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Iniciar censo sin Eloísa' })
    ).not.toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();
  });
});
