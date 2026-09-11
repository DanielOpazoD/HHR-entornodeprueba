import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RayenDayBootstrapButton } from '@/features/rayen-import/components/RayenDayBootstrapButton';
import { RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS } from '@/features/rayen-import/bridge/extensionHealthBridge';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  health: {
    connection: 'ready',
    canSync: true,
    message: 'Extensión operativa.',
  },
}));

vi.mock('@/features/rayen-import/hooks/useRayenExtensionHealth', () => ({
  useRayenExtensionHealth: () => ({ ...mocks.health, refresh: mocks.refresh }),
}));

describe('RayenDayBootstrapButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.health.connection = 'ready';
    mocks.health.canSync = true;
    mocks.health.message = 'Extensión operativa.';
  });

  it('checks both sources, creates a blank record and then requests the reviewed sync', async () => {
    const order: string[] = [];
    mocks.refresh.mockImplementation(async () => {
      order.push('health');
      return { connection: 'ready', canSync: true, message: 'Operativa.' };
    });
    const onCreateBlank = vi.fn(async () => {
      order.push('create');
    });
    const onReady = vi.fn(() => order.push('review'));

    render(<RayenDayBootstrapButton onCreateBlank={onCreateBlank} onReady={onReady} />);
    fireEvent.click(screen.getByRole('button', { name: /Crear desde Eloísa/i }));

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).toHaveBeenCalledWith({
      timeoutMs: RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS,
      showChecking: true,
    });
    expect(onCreateBlank).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['health', 'create', 'review']);
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
    expect(onCreateBlank).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
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
    expect(onReady).not.toHaveBeenCalled();
  });
});
