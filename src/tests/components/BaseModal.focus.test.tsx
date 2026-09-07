import React from 'react';
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
});
