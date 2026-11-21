import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RayenDayBootstrapButton } from '@/features/rayen-import/components/RayenDayBootstrapButton';

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
    mocks.refresh.mockResolvedValue({ connection: 'ready', canSync: true, message: 'Operativa.' });
    mocks.health.connection = 'ready';
    mocks.health.canSync = true;
    mocks.health.message = 'Extensión operativa.';
  });

  it('copies the prior census and then requests the reviewed import', async () => {
    const onReady = vi.fn();
    const onCopyPrevious = vi.fn().mockResolvedValue(true);
    render(
      <RayenDayBootstrapButton
        copySourceDate="2026-09-23"
        onCopyPrevious={onCopyPrevious}
        onReady={onReady}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Copiar censo y sincronizar/i }));

    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    expect(onCopyPrevious.mock.invocationCallOrder[0]).toBeLessThan(
      onReady.mock.invocationCallOrder[0]
    );
  });

  it('requests the import without warning even if Eloísa is not answering yet', async () => {
    mocks.refresh.mockRejectedValue(new Error('Eloísa dormida'));
    mocks.health.connection = 'offline';
    mocks.health.canSync = false;
    const onReady = vi.fn();
    render(
      <RayenDayBootstrapButton
        copySourceDate="2026-09-23"
        onCopyPrevious={vi.fn().mockResolvedValue(true)}
        onReady={onReady}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Copiar censo y sincronizar/i }));

    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('does not start Eloísa when the previous-day copy fails', async () => {
    const onReady = vi.fn();
    render(
      <RayenDayBootstrapButton
        copySourceDate="2026-09-23"
        onCopyPrevious={vi.fn().mockResolvedValue(false)}
        onReady={onReady}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Copiar censo y sincronizar/i }));
    expect(
      await screen.findByText(/El censo anterior todavía no se copió\. Vuelve a intentarlo\./)
    ).toBeVisible();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });
});

describe('compact copy connection summary', () => {
  it.each(['Ficha Médico', 'Gestión de Camas'])(
    'does not show ready when %s is unavailable',
    source => {
      mocks.health.connection = 'blocked';
      mocks.health.canSync = false;
      mocks.health.message = `${source}: sesión vencida`;
      render(
        <RayenDayBootstrapButton
          copySourceDate="2026-09-23"
          onCopyPrevious={vi.fn()}
          onReady={vi.fn()}
        />
      );
      expect(screen.getByTestId('eloisa-bootstrap-status')).toHaveTextContent(
        'Conexión incompleta'
      );
      expect(screen.getByTestId('eloisa-bootstrap-status')).toHaveAttribute(
        'title',
        `${source}: sesión vencida`
      );
      expect(screen.getByText('23 de septiembre de 2026')).toHaveAttribute(
        'datetime',
        '2026-09-23'
      );
      expect(screen.getByRole('button', { name: 'Copiar censo y sincronizar' })).toBeEnabled();
    }
  );
});

describe('creation schedule lock', () => {
  it('keeps the action visible and prevents copy and sync when disabled', () => {
    const onCopyPrevious = vi.fn();
    const onReady = vi.fn();
    render(
      <RayenDayBootstrapButton
        disabled
        disabledReason="Disponible desde las 08:00"
        copySourceDate="2026-09-23"
        onCopyPrevious={onCopyPrevious}
        onReady={onReady}
      />
    );
    const button = screen.getByRole('button', { name: 'Copiar censo y sincronizar' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onCopyPrevious).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });
});
