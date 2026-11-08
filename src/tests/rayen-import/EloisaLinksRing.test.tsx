import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RayenConnectionMonitor } from '@/features/rayen-import/components/RayenConnectionMonitor';

const renderMonitor = () =>
  render(
    <RayenConnectionMonitor
      extension={{
        connection: 'ready',
        message: 'Extensión Eloísa operativa.',
        canSync: true,
        report: null,
        refresh: vi.fn(async () => ({
          connection: 'ready' as const,
          message: 'Extensión Eloísa operativa.',
          canSync: true,
          report: null,
        })),
        adoptReport: vi.fn(),
      }}
      working={false}
      lastSyncLine="Última 31-08-2026 · 17:37 h"
      open={false}
      onOpenChange={vi.fn()}
    />
  );

const mark = () => screen.getByRole('button', { name: 'Accesos a Eloísa' });

const openRing = async () => {
  fireEvent.click(mark());
  return screen.findByRole('menu', { name: 'Accesos a Eloísa' });
};

describe('Eloísa links ring', () => {
  it('opens from the Eloísa mark with its four pages, each in a new tab', async () => {
    renderMonitor();
    expect(mark()).toHaveAttribute('aria-expanded', 'false');

    const ring = await openRing();
    expect(mark()).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(ring)
        .getAllByRole('menuitem')
        .map(item => item.getAttribute('aria-label'))
    ).toEqual([
      'Hospitalizados en Eloísa',
      'Gestión de camas en Eloísa',
      'Ambulatoria en Eloísa',
      'Urgencias en Eloísa',
    ]);
    const hospitalized = screen.getByTestId('eloisa-link-hospitalized');
    expect(hospitalized).toHaveAttribute(
      'href',
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse'
    );
    expect(hospitalized).toHaveAttribute('target', '_blank');
    expect(hospitalized).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByTestId('eloisa-link-beds')).toHaveAttribute(
      'href',
      'https://hospitalizado.rayensalud.cl/'
    );
    expect(screen.getByTestId('eloisa-link-outpatient')).toHaveAttribute(
      'href',
      'https://clinicohangaroa.eloisa.cl/'
    );
    expect(screen.getByTestId('eloisa-link-emergency')).toHaveAttribute(
      'href',
      'https://urgencia.saludenred.cl/'
    );
    expect(hospitalized).toHaveFocus();
  });

  it('moves by arrow towards each page and closes with Escape, back on the mark', async () => {
    renderMonitor();
    const ring = await openRing();

    fireEvent.keyDown(ring, { key: 'ArrowRight' });
    expect(screen.getByTestId('eloisa-link-beds')).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(screen.getByTestId('eloisa-link-emergency')).toHaveFocus();

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(mark()).toHaveFocus();
  });

  it('closes after choosing a page or on an outside click', async () => {
    renderMonitor();

    fireEvent.click(within(await openRing()).getByTestId('eloisa-link-beds'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(mark()).toHaveFocus();

    const ring = await openRing();
    fireEvent.click(ring.previousElementSibling!);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
