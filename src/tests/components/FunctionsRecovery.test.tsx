import { Component, type ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FunctionsRecovery } from '@/components/ui/FunctionsRecovery';

const { attempted } = vi.hoisted(() => ({ attempted: vi.fn() }));
vi.mock('@/components/ui/FunctionsRecoveryNotice', () => {
  attempted();
  throw new TypeError('Failed to fetch dynamically imported module: /notice.js');
});

class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p>Aplicación no disponible</p> : this.props.children;
  }
}

it('keeps the editable app available when the optional recovery notice cannot load', async () => {
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await act(async () => {
      render(
        <AppBoundary>
          <FunctionsRecovery />
          <input aria-label="Borrador" defaultValue="Edición pendiente" />
        </AppBoundary>
      );
    });
    expect(attempted).toHaveBeenCalledOnce();
    expect(screen.queryByText('Aplicación no disponible')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Edición pendiente');
  } finally {
    errorLog.mockRestore();
  }
});
