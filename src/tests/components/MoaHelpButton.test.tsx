import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MoaHelpButton } from '@/components/layout/navbar/MoaHelpButton';

const openHelp = async () => {
  const trigger = screen.getByRole('button', { name: 'Ayuda de Moa' });
  fireEvent.click(trigger);
  await screen.findByRole('region', { name: 'Moa · Ayuda de HHR' });
  return trigger;
};

describe('MoaHelpButton', () => {
  it('contains a rejected import and requires confirmation before reloading', async () => {
    vi.resetModules();
    const { defaultBrowserWindowRuntime } =
      await import('@/shared/runtime/browserWindowRuntimeCore');
    const originalLazy = React.lazy;
    const load = vi
      .spyOn(React, 'lazy')
      .mockImplementationOnce(() =>
        originalLazy(() => Promise.reject(new Error('Help chunk unavailable')))
      );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const confirm = vi.spyOn(defaultBrowserWindowRuntime, 'confirm').mockReturnValue(false);
    const reload = vi
      .spyOn(defaultBrowserWindowRuntime, 'reload')
      .mockImplementation(() => undefined);
    try {
      // A fresh module load lets the controlled rejection initialise the lazy panel.
      const { MoaHelpButton: Help } = await import('@/components/layout/navbar/MoaHelpButton');
      render(
        <>
          <Help />
          <button type="button">Censo disponible</button>
        </>
      );
      const trigger = screen.getByRole('button', { name: 'Ayuda de Moa' });
      fireEvent.click(trigger);
      expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo abrir la ayuda.');
      expect(screen.getByRole('button', { name: 'Censo disponible' })).toBeInTheDocument();
      const recovery = screen.getByRole('button', { name: 'Recargar aplicación' });
      recovery.focus();
      fireEvent.click(recovery);
      expect(confirm).toHaveBeenCalledOnce();
      expect(reload).not.toHaveBeenCalled();
      expect(recovery).toHaveFocus();
      confirm.mockReturnValue(true);
      fireEvent.click(recovery);
      expect(reload).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole('button', { name: 'Cerrar ayuda de Moa' }));
      expect(trigger).toHaveFocus();
    } finally {
      load.mockRestore();
      errors.mockRestore();
      confirm.mockRestore();
      reload.mockRestore();
    }
  });

  it('starts closed and explains the limited scope when explicitly opened', async () => {
    render(<MoaHelpButton />);
    expect(screen.getByRole('button', { name: 'Ayuda de Moa' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.queryByRole('region')).not.toBeInTheDocument();

    const trigger = await openHelp();
    const panel = screen.getByRole('region', { name: 'Moa · Ayuda de HHR' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', panel.id);
    expect(screen.getByText('Guía local, sin IA clínica.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('closes with Escape and restores the trigger focus', async () => {
    render(<MoaHelpButton />);
    const trigger = await openHelp();
    const closeButton = screen.getByRole('button', { name: 'Cerrar ayuda de Moa' });
    closeButton.focus();
    fireEvent.keyDown(closeButton, { key: 'Escape' });

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes from its close button without leaving focus on a removed element', async () => {
    render(<MoaHelpButton />);
    const trigger = await openHelp();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar ayuda de Moa' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('dismisses on outside click', async () => {
    render(<MoaHelpButton />);
    await openHelp();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('dismisses when keyboard focus leaves but not when it moves inside', async () => {
    render(
      <>
        <MoaHelpButton />
        <button type="button">Otra herramienta</button>
      </>
    );
    const trigger = await openHelp();
    const closeButton = screen.getByRole('button', { name: 'Cerrar ayuda de Moa' });
    fireEvent.blur(trigger, { relatedTarget: closeButton });
    expect(screen.getByRole('region')).toBeInTheDocument();
    fireEvent.blur(closeButton, {
      relatedTarget: screen.getByRole('button', { name: 'Otra herramienta' }),
    });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('assigns distinct controls and labels to separate instances', async () => {
    render(
      <>
        <MoaHelpButton />
        <MoaHelpButton />
      </>
    );
    const triggers = screen.getAllByRole('button', { name: 'Ayuda de Moa' });
    triggers.forEach(trigger => fireEvent.click(trigger));
    const panels = await screen.findAllByRole('region', { name: 'Moa · Ayuda de HHR' });
    expect(panels).toHaveLength(2);
    expect(panels[0].id).not.toBe(panels[1].id);
    expect(triggers[0]).toHaveAttribute('aria-controls', panels[0].id);
    expect(triggers[1]).toHaveAttribute('aria-controls', panels[1].id);
  });

  it('keeps readable content open when blur has no next focus target', async () => {
    render(<MoaHelpButton />);
    const trigger = await openHelp();
    fireEvent.blur(trigger, { relatedTarget: null });
    expect(screen.getByRole('region')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it.each([
    ['CENSUS', 'Censo diario'],
    ['NURSING_HANDOFF', 'Entrega de enfermería'],
    ['MEDICAL_HANDOFF', 'Entrega médica'],
    ['CUDYR', 'Categorización CUDYR'],
  ] as const)('offers local guidance for %s without a patient context', async (module, title) => {
    render(<MoaHelpButton currentModule={module} />);
    await openHelp();
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText('Guía local, sin IA clínica.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('closes old guidance when the module changes, then shows the new context', async () => {
    const { rerender } = render(<MoaHelpButton currentModule="CENSUS" />);
    await openHelp();
    rerender(<MoaHelpButton currentModule="MEDICAL_HANDOFF" />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    await openHelp();
    expect(screen.getByRole('heading', { name: 'Entrega médica' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Censo diario' })).not.toBeInTheDocument();
  });

  it('uses general guidance for modules without a dedicated guide', async () => {
    render(<MoaHelpButton currentModule="ANALYTICS" />);
    await openHelp();
    expect(screen.getByRole('heading', { name: 'Herramientas de HHR' })).toBeInTheDocument();
  });
});
