import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CensusOptionsMenu } from '@/components/layout/date-strip/CensusOptionsMenu';

describe('CensusOptionsMenu', () => {
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
