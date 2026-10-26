import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SaveDropdown } from '@/components/layout/date-strip/actions/SaveDropdown';
import { EmailDropdown } from '@/components/layout/date-strip/actions/EmailDropdown';

describe('Date strip action panels', () => {
  it('renders outside the scrolling toolbar and preserves clicks inside the portal', () => {
    const onExportExcel = vi.fn();
    const { container } = render(
      <div style={{ overflowX: 'auto' }}>
        <SaveDropdown
          onExportExcel={onExportExcel}
          isBackingUp={false}
          showFirebaseBackupOption={false}
        />
      </div>
    );
    const trigger = screen.getByTitle('Opciones de guardado');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    const panel = screen.getByRole('group', { name: 'Opciones de guardado' });
    expect(container).not.toContainElement(panel);
    expect(document.body).toContainElement(panel);
    expect(trigger).toHaveAttribute('aria-controls', panel.id);
    const exportAction = screen.getByRole('button', { name: /Descargar Excel/ });
    expect(exportAction).toHaveFocus();
    fireEvent.mouseDown(exportAction);
    expect(panel).toBeInTheDocument();
    fireEvent.click(exportAction);
    expect(onExportExcel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: 'Opciones de guardado' })).not.toBeInTheDocument();
  });

  it('returns focus to the trigger on Escape and dismisses on an outside click', () => {
    render(<SaveDropdown onExportExcel={vi.fn()} isBackingUp={false} />);
    const trigger = screen.getByTitle('Opciones de guardado');
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('button', { name: /Descargar Excel/ }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Opciones de guardado' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('group', { name: 'Opciones de guardado' })).not.toBeInTheDocument();
  });

  it('keeps blocked sending disabled and makes its explanation keyboard reachable', () => {
    const onSendEmail = vi.fn();
    render(
      <EmailDropdown onSendEmail={onSendEmail} emailBlockedReason="Revise los destinatarios" />
    );
    const trigger = screen.getByTitle('Enviar censo');
    fireEvent.click(trigger);
    const panel = screen.getByRole('group', { name: 'Opciones de envío' });
    expect(panel).toHaveFocus();
    const sendAction = screen.getByRole('button', { name: /Enviar Archivo Excel/ });
    expect(sendAction).toBeDisabled();
    fireEvent.click(sendAction);
    expect(onSendEmail).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Revise los destinatarios');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(panel).not.toBeInTheDocument();
  });
});
