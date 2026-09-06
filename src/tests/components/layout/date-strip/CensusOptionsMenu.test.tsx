import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CensusOptionsMenu } from '@/components/layout/date-strip/CensusOptionsMenu';

describe('CensusOptionsMenu', () => {
  it('closes when Shift+Tab returns to the trigger without breaking click-to-close', async () => {
    const user = userEvent.setup();
    render(
      <CensusOptionsMenu>
        <button data-census-menu-action>Buscar</button>
      </CensusOptionsMenu>
    );
    const trigger = screen.getByRole('button', { name: 'Más opciones del censo' });
    await user.click(trigger);
    await user.tab({ shift: true });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('focuses the first enabled action and closes when Tab leaves the options', async () => {
    const user = userEvent.setup();
    render(
      <>
        <CensusOptionsMenu>
          <button disabled data-census-menu-action>
            Esperar
          </button>
          <button data-census-menu-action>Buscar</button>
          <button data-census-menu-action>Laboratorio</button>
        </CensusOptionsMenu>
        <button>Después</button>
      </>
    );
    const trigger = screen.getByRole('button', { name: 'Más opciones del censo' });
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Buscar' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Laboratorio' })).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Después' })).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not steal focus for Escape bubbling from an owned dialog portal', async () => {
    const user = userEvent.setup();
    function DialogOwner() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button data-census-menu-action onClick={() => setOpen(true)}>
            Abrir
          </button>
          {open &&
            createPortal(
              <div role="dialog">
                <button>Dentro del visor</button>
              </div>,
              document.body
            )}
        </>
      );
    }
    render(
      <CensusOptionsMenu>
        <DialogOwner />
      </CensusOptionsMenu>
    );
    await user.click(screen.getByRole('button', { name: 'Más opciones del censo' }));
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialogButton = screen.getByRole('button', { name: 'Dentro del visor' });
    await user.click(dialogButton);
    await user.keyboard('{Escape}');
    expect(dialogButton).toHaveFocus();
  });

  it('closes with Escape and restores trigger focus', () => {
    render(
      <CensusOptionsMenu>
        <button data-census-menu-action>Buscar</button>
      </CensusOptionsMenu>
    );
    const trigger = screen.getByRole('button', { name: 'Más opciones del censo' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Buscar' }), { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('closes for a portaled action without unmounting its opened dialog', () => {
    function Fixture() {
      const [target, setTarget] = useState<HTMLDivElement | null>(null);
      const [open, setOpen] = useState(false);
      return (
        <>
          <CensusOptionsMenu>
            <div ref={setTarget} />
          </CensusOptionsMenu>
          {target &&
            createPortal(
              <button data-census-menu-action onClick={() => setOpen(true)}>
                Abrir
              </button>,
              target
            )}
          {open && createPortal(<div role="dialog">Visor</div>, document.body)}
        </>
      );
    }
    render(<Fixture />);
    const trigger = screen.getByRole('button', { name: 'Más opciones del censo' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('keeps disabled options inert and closes on outside click', () => {
    render(
      <CensusOptionsMenu>
        <button disabled data-census-menu-action>
          Esperar
        </button>
      </CensusOptionsMenu>
    );
    const trigger = screen.getByRole('button', { name: 'Más opciones del censo' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Esperar' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.mouseDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
