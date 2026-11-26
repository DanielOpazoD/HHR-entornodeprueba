import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseModal } from '@/components/shared/BaseModal';

describe('BaseModal focus lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('does not steal focus from an interaction before the opening timer finishes', () => {
    render(
      <BaseModal isOpen onClose={vi.fn()} title="Focus">
        <button>Chosen action</button>
      </BaseModal>
    );
    screen.getByRole('button', { name: 'Chosen action' }).focus();
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole('button', { name: 'Chosen action' })).toHaveFocus();
  });

  it('wraps Tab using only enabled sequential controls', () => {
    render(
      <BaseModal isOpen onClose={vi.fn()} title="Focus">
        <button>Last action</button>
        <button disabled>Disabled</button>
        <button tabIndex={-1}>Inactive tab</button>
        <button hidden>Hidden</button>
      </BaseModal>
    );
    const first = screen.getByRole('button', { name: 'Cerrar modal' });
    const last = screen.getByRole('button', { name: 'Last action' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('opens on the first enabled, shown field, ahead of the buttons before it', () => {
    render(
      <BaseModal isOpen onClose={vi.fn()} title="Focus">
        <button>Earlier action</button>
        <input aria-label="Disabled field" disabled />
        <div hidden>
          <input aria-label="Field in a hidden block" />
        </div>
        <input aria-label="Field without display" style={{ display: 'none' }} />
        <input aria-label="Invisible field" style={{ visibility: 'hidden' }} />
        <input aria-label="Field out of the tab order" tabIndex={-1} />
        <input aria-label="First usable field" />
        <input aria-label="Later field" />
      </BaseModal>
    );
    expect(screen.getByLabelText('First usable field')).toHaveFocus();
  });

  it('returns focus to the opener on close and cancels pending focus on rapid close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const view = render(
      <BaseModal isOpen onClose={vi.fn()} title="Focus">
        <button>Action</button>
      </BaseModal>
    );
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole('button', { name: 'Action' })).not.toHaveFocus();
    view.rerender(
      <BaseModal isOpen={false} onClose={vi.fn()} title="Focus">
        {null}
      </BaseModal>
    );
    expect(opener).toHaveFocus();
    view.rerender(
      <BaseModal isOpen onClose={vi.fn()} title="Focus">
        {null}
      </BaseModal>
    );
    view.rerender(
      <BaseModal isOpen={false} onClose={vi.fn()} title="Focus">
        {null}
      </BaseModal>
    );
    act(() => vi.advanceTimersByTime(100));
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('keeps Tab inside a read-only dialog without controls', () => {
    render(
      <BaseModal isOpen onClose={vi.fn()} title="Read only" showCloseButton={false}>
        Text
      </BaseModal>
    );
    act(() => vi.advanceTimersByTime(100));
    const dialog = screen.getByRole('dialog');
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
    expect(dialog).toHaveFocus();
  });

  it('keeps a child dialog focus and routes Escape only to that dialog', () => {
    const parentClose = vi.fn();
    const childClose = vi.fn();
    const parent = render(
      <BaseModal isOpen onClose={parentClose} title="Parent">
        <button>Open child</button>
      </BaseModal>
    );
    const opener = screen.getByRole('button', { name: 'Open child' });
    opener.focus();
    const child = render(
      <BaseModal isOpen onClose={childClose} title="Child">
        <input aria-label="Child input" />
      </BaseModal>
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(childClose).toHaveBeenCalledOnce();
    expect(parentClose).not.toHaveBeenCalled();
    child.unmount();
    expect(opener).toHaveFocus();
    parent.unmount();
  });

  it('does not steal external focus or restore a removed opener', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const view = render(
      <BaseModal isOpen onClose={vi.fn()} title="Focus">
        {null}
      </BaseModal>
    );
    const other = document.createElement('button');
    document.body.appendChild(other);
    other.focus();
    act(() => vi.advanceTimersByTime(100));
    expect(other).toHaveFocus();
    opener.remove();
    view.unmount();
    expect(other).toHaveFocus();
    other.remove();
  });

  it('preserves mount-time autoFocus and restores the actual external opener', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const view = render(
      <BaseModal isOpen onClose={vi.fn()} title="Autofocus">
        <input aria-label="First" />
        <input aria-label="Chosen" autoFocus />
      </BaseModal>
    );
    expect(screen.getByRole('textbox', { name: 'Chosen' })).toHaveFocus();
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole('textbox', { name: 'Chosen' })).toHaveFocus();
    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('explicitly cycles Tab across button-only dialogs so browsers that skip buttons cannot escape', () => {
    const outsideSelect = document.createElement('select');
    document.body.appendChild(outsideSelect);

    const view = render(
      <BaseModal isOpen onClose={vi.fn()} title="Error">
        <button type="button">Reintentar</button>
      </BaseModal>
    );

    const closeButton = screen.getByRole('button', { name: 'Cerrar modal' });
    const retryButton = screen.getByRole('button', { name: 'Reintentar' });
    expect(closeButton).toHaveFocus();

    expect(fireEvent.keyDown(closeButton, { key: 'Tab' })).toBe(false);
    expect(retryButton).toHaveFocus();

    expect(fireEvent.keyDown(retryButton, { key: 'Tab' })).toBe(false);
    expect(closeButton).toHaveFocus();

    expect(fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(retryButton).toHaveFocus();

    // If focus somehow falls to body while the modal is open, Tab brings it back inside.
    document.body.focus();
    expect(fireEvent.keyDown(document.body, { key: 'Tab' })).toBe(false);
    expect(closeButton).toHaveFocus();

    view.unmount();
    outsideSelect.remove();
  });

  it('includes details summary in Tab order while skipping controls inside a closed details body', () => {
    render(
      <BaseModal isOpen onClose={vi.fn()} title="Historial UPC">
        <details>
          <summary>Ver criterios y registro</summary>
          <button type="button">Acción interna</button>
        </details>
        <button type="button">Cerrar</button>
      </BaseModal>
    );

    const closeModal = screen.getByRole('button', { name: 'Cerrar modal' });
    const summary = screen.getByText('Ver criterios y registro');
    const footerClose = screen.getByRole('button', { name: 'Cerrar' });

    expect(closeModal).toHaveFocus();
    fireEvent.keyDown(closeModal, { key: 'Tab' });
    expect(summary).toHaveFocus();

    // Details is closed: Tab must skip the hidden button inside it and go straight to Cerrar.
    fireEvent.keyDown(summary, { key: 'Tab' });
    expect(footerClose).toHaveFocus();

    // Once expanded, Tab visits the inner control too.
    const details = summary.closest('details') as HTMLDetailsElement;
    details.open = true;
    summary.focus();
    fireEvent.keyDown(summary, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Acción interna' })).toHaveFocus();
  });

  it('leaves Tab and Shift+Tab native inside and entering segmented date inputs while still wrapping at modal bounds', () => {
    const outsideSelect = document.createElement('select');
    document.body.appendChild(outsideSelect);

    const view = render(
      <BaseModal isOpen onClose={vi.fn()} title="Demográficos">
        <input aria-label="RUT" type="text" defaultValue="11.111.111-1" />
        <input aria-label="Fecha de nacimiento" type="date" defaultValue="1980-06-15" />
        <select aria-label="Previsión">
          <option value="Fonasa">Fonasa</option>
        </select>
      </BaseModal>
    );

    const closeButton = screen.getByRole('button', { name: 'Cerrar modal' });
    const rutInput = screen.getByLabelText('RUT');
    const dateInput = screen.getByLabelText('Fecha de nacimiento');
    const insuranceSelect = screen.getByLabelText('Previsión');
    expect(rutInput).toHaveFocus();

    // Entering date input forward (Tab) and backward (Shift+Tab) stays native so Shift+Tab lands
    // on the final date segment (yyyy) instead of forcing focus onto the first segment (dd).
    expect(fireEvent.keyDown(rutInput, { key: 'Tab' })).toBe(true);
    insuranceSelect.focus();
    expect(fireEvent.keyDown(insuranceSelect, { key: 'Tab', shiftKey: true })).toBe(true);

    // Stepping inside the date input stays native so the browser walks dd -> mm -> yyyy.
    dateInput.focus();
    expect(fireEvent.keyDown(dateInput, { key: 'Tab' })).toBe(true);
    expect(dateInput).toHaveFocus();

    // If native Tab walks out of the modal after the final segment, focusin wraps to next control.
    outsideSelect.focus();
    expect(insuranceSelect).toHaveFocus();

    // Wrapping at modal bounds still stays trapped inside the dialog.
    closeButton.focus();
    expect(fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(insuranceSelect).toHaveFocus();

    view.unmount();
    outsideSelect.remove();
  });

  it('does not hijack Tab when a contentEditable editor handles Tab itself', () => {
    const onTabHandled = vi.fn((event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Tab') {
        event.preventDefault();
      }
    });

    render(
      <BaseModal isOpen onClose={vi.fn()} title="Documentos Clínicos">
        <button type="button">Formato</button>
        <div
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Antecedentes"
          onKeyDown={onTabHandled}
        >
          Texto clínico
        </div>
      </BaseModal>
    );

    const editor = screen.getByRole('textbox', { name: 'Antecedentes' });
    editor.focus();
    fireEvent.keyDown(editor, { key: 'Tab' });

    expect(onTabHandled).toHaveBeenCalledOnce();
    expect(editor).toHaveFocus();
  });
});
