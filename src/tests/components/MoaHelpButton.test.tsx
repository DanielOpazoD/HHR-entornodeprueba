import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MoaHelpButton } from '@/components/layout/navbar/MoaHelpButton';
import { MoaCompanionSlot } from '@/components/layout/MoaCompanionSlot';
import { setMoaVisible } from '@/shared/ui/useMoaVisibility';

const renderMoa = () =>
  render(
    <>
      <MoaHelpButton currentModule="CENSUS" />
      <MoaCompanionSlot />
    </>
  );

describe('Moa visibility and companion', () => {
  beforeEach(() => {
    localStorage.clear();
    setMoaVisible(true);
  });

  it('toggles the census companion directly and preserves the preference on remount', async () => {
    const first = renderMoa();
    const companion = await screen.findByRole('region', { name: 'Moa' });
    const toggle = document.querySelector('[data-moa-toggle]')!;
    expect(toggle).toHaveAttribute('aria-controls', companion.id);
    expect(screen.queryByText('Guía local, sin IA clínica.')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(localStorage.getItem('hhr_moa_visible_v1')).toBe('false');
    first.unmount();
    renderMoa();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar Moa' }));
    expect(await screen.findByRole('region', { name: 'Moa' })).toBeInTheDocument();
  });

  it('hides from the companion and restores focus to the navbar toggle', async () => {
    renderMoa();
    const companion = await screen.findByRole('region', { name: 'Moa' });
    fireEvent.click(within(companion).getByRole('button', { name: 'Ocultar Moa' }));
    expect(screen.getByRole('button', { name: 'Mostrar Moa' })).toHaveFocus();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('keeps both surfaces in sync when storage is unavailable', async () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    try {
      renderMoa();
      await screen.findByRole('region', { name: 'Moa' });
      fireEvent.click(document.querySelector('[data-moa-toggle]')!);
      expect(screen.queryByRole('region')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Mostrar Moa' }));
      expect(await screen.findByRole('region', { name: 'Moa' })).toBeInTheDocument();
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });

  it('responds to a preference changed in another tab', async () => {
    renderMoa();
    await screen.findByRole('region', { name: 'Moa' });
    act(() => {
      localStorage.setItem('hhr_moa_visible_v1', 'false');
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'hhr_moa_visible_v1', newValue: 'false' })
      );
    });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mostrar Moa' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('keeps the toggle scoped to the census', () => {
    render(<MoaHelpButton currentModule="ANALYTICS" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
