import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MoaHelpButton } from '@/components/layout/navbar/MoaHelpButton';

const openHelp = () => {
  const trigger = screen.getByRole('button', { name: 'Ayuda de Moa' });
  fireEvent.click(trigger);
  return trigger;
};

describe('MoaHelpButton', () => {
  it('starts closed and explains the limited scope when explicitly opened', () => {
    render(<MoaHelpButton />);
    expect(screen.getByRole('button', { name: 'Ayuda de Moa' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.queryByRole('region')).not.toBeInTheDocument();

    const trigger = openHelp();
    const panel = screen.getByRole('region', { name: 'Moa · Ayuda de HHR' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', panel.id);
    expect(screen.getByText('Guía local, sin IA clínica.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('closes with Escape and restores the trigger focus', () => {
    render(<MoaHelpButton />);
    const trigger = openHelp();
    const closeButton = screen.getByRole('button', { name: 'Cerrar ayuda de Moa' });
    closeButton.focus();
    fireEvent.keyDown(closeButton, { key: 'Escape' });

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes from its close button without leaving focus on a removed element', () => {
    render(<MoaHelpButton />);
    const trigger = openHelp();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar ayuda de Moa' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('dismisses on outside click', () => {
    render(<MoaHelpButton />);
    openHelp();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('dismisses when keyboard focus leaves but not when it moves inside', () => {
    render(
      <>
        <MoaHelpButton />
        <button type="button">Otra herramienta</button>
      </>
    );
    const trigger = openHelp();
    const closeButton = screen.getByRole('button', { name: 'Cerrar ayuda de Moa' });
    fireEvent.blur(trigger, { relatedTarget: closeButton });
    expect(screen.getByRole('region')).toBeInTheDocument();
    fireEvent.blur(closeButton, {
      relatedTarget: screen.getByRole('button', { name: 'Otra herramienta' }),
    });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('assigns distinct controls and labels to separate instances', () => {
    render(
      <>
        <MoaHelpButton />
        <MoaHelpButton />
      </>
    );
    const triggers = screen.getAllByRole('button', { name: 'Ayuda de Moa' });
    triggers.forEach(trigger => fireEvent.click(trigger));
    const panels = screen.getAllByRole('region', { name: 'Moa · Ayuda de HHR' });
    expect(panels).toHaveLength(2);
    expect(panels[0].id).not.toBe(panels[1].id);
    expect(triggers[0]).toHaveAttribute('aria-controls', panels[0].id);
    expect(triggers[1]).toHaveAttribute('aria-controls', panels[1].id);
  });
});
