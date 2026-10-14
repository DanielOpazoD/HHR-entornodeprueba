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
    const read = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    try {
      renderMoa();
      expect(screen.queryByRole('region')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Mostrar Moa' }));
      expect(await screen.findByRole('region', { name: 'Moa' })).toBeInTheDocument();
      fireEvent.click(document.querySelector('[data-moa-toggle]')!);
      expect(screen.queryByRole('region')).not.toBeInTheDocument();
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

  it('starts hidden with no preference or an invalid value and uses its own portrait', () => {
    localStorage.clear();
    const first = renderMoa();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mostrar Moa' }).querySelector('svg')).toBeTruthy();
    first.unmount();
    localStorage.setItem('hhr_moa_visible_v1', 'unexpected');
    renderMoa();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('offers the library and close controls and pauses automatically in a hidden document', async () => {
    renderMoa();
    const companion = await screen.findByRole('region', { name: 'Moa' });
    expect(within(companion).getAllByRole('button')).toHaveLength(3);
    const library = within(companion).getByRole('button', { name: 'Elegir animación de Moa' });
    fireEvent.click(library);
    const select = within(companion).getByLabelText('Animación de Moa');
    expect(within(select).getAllByRole('option')).toHaveLength(18);
    expect(select).toHaveFocus();
    fireEvent.keyDown(select, { key: 'Escape' });
    expect(library).toHaveFocus();
    expect(within(companion).queryByRole('dialog')).toBeNull();
    expect(within(companion).queryByRole('button', { name: /Pausar/ })).toBeNull();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    try {
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      expect(companion).toHaveAttribute('data-paused', 'true');
      hidden.mockReturnValue(false);
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      expect(companion).toHaveAttribute('data-paused', 'false');
    } finally {
      hidden.mockRestore();
    }
  });

  it('returns quietly to rest when a scene image cannot load', async () => {
    renderMoa();
    const companion = await screen.findByRole('region', { name: 'Moa' });
    const character = within(companion).getByRole('button', { name: 'Jugar con Moa' });
    fireEvent.click(character);
    fireEvent.error(companion.querySelector('.moa-scene-frames')!);
    expect(character).toHaveAttribute('data-gesture', 'idle');
    expect(within(companion).queryByRole('alert')).toBeNull();
    expect(within(companion).getByRole('button', { name: 'Ocultar Moa' })).toBeInTheDocument();
  });

  it('uses the same illustrated sequence for the welcome and returns to its neutral portrait', async () => {
    renderMoa();
    const companion = await screen.findByRole('region', { name: 'Moa' });
    const character = within(companion).getByRole('button', { name: 'Jugar con Moa' });
    expect(character).toHaveAttribute('data-gesture', 'welcome');
    const welcome = companion.querySelector('.moa-scene-frames')!;
    expect(welcome).toHaveAttribute('src', '/images/moa/moa-wave-v2.png');
    fireEvent.load(welcome);
    fireEvent.animationEnd(welcome);
    expect(character).toHaveAttribute('data-gesture', 'idle');
    expect(within(companion).getByTestId('moa-mascot')).toHaveAttribute(
      'src',
      '/images/moa/moa-wave-v2.png'
    );
  });

  it('restarts the curious scene on a tap even when hover already started it', async () => {
    renderMoa();
    const companion = await screen.findByRole('region', { name: 'Moa' });
    const character = within(companion).getByRole('button', { name: 'Jugar con Moa' });
    // The next explicit scene is curious, after the fourteen stories and wave.
    for (let index = 0; index < 15; index++) {
      fireEvent.click(character);
      fireEvent.animationEnd(companion.querySelector('.moa-scene-frames')!);
    }
    fireEvent.pointerEnter(character);
    const incidental = companion.querySelector('.moa-scene-frames')!;
    expect(character).toHaveAttribute('data-gesture', 'curious');
    fireEvent.click(character);
    const replay = companion.querySelector('.moa-scene-frames')!;
    expect(replay).not.toBe(incidental);
    expect(character).toHaveAttribute('data-gesture', 'curious');
    fireEvent.load(replay);
    fireEvent.animationEnd(replay);
    expect(character).toHaveAttribute('data-gesture', 'idle');
    fireEvent.click(character);
    expect(character).toHaveAttribute('data-gesture', 'stroll');
  });

  it('plays all scenes, including the former gestures, and returns to a quiet rest', async () => {
    renderMoa();
    const companion = await screen.findByRole('region', { name: 'Moa' });
    const character = within(companion).getByRole('button', { name: 'Jugar con Moa' });
    for (const scene of [
      'drink',
      'juggle',
      'care',
      'sleep',
      'yawn',
      'pushups',
      'roll',
      'jump',
      'run',
      'wink',
      'love',
      'angry',
      'mother',
      'surf',
      'wave',
      'curious',
      'stroll',
      'happy',
    ]) {
      fireEvent.click(character);
      expect(character).toHaveAttribute('data-gesture', scene);
      expect(companion.querySelector(`[data-moa-scene="${scene}"]`)).toBeTruthy();
      const frames = companion.querySelector('.moa-scene-frames')!;
      fireEvent.load(frames);
      expect(frames).toHaveAttribute('data-ready', 'true');
      fireEvent.animationEnd(frames);
      expect(character).toHaveAttribute('data-gesture', 'idle');
      expect(companion.querySelector('[data-moa-scene]')).toBeNull();
    }
  });
});
