import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RayenSyncStatusLine } from '@/features/rayen-import/components/RayenSyncStatusLine';

const renderLine = (pending: React.ComponentProps<typeof RayenSyncStatusLine>['pending']) => {
  const onOpen = vi.fn();
  render(
    <RayenSyncStatusLine pending={pending} onOpen={onOpen}>
      <span>Actualizado</span>
    </RayenSyncStatusLine>
  );
  return onOpen;
};

it('shows sends that go out by themselves as a calm pending save', () => {
  const onOpen = renderLine('info');
  const indicator = screen.getByRole('button', { name: 'Guardado pendiente · Ver detalle' });

  expect(indicator).toHaveAttribute('title', 'Guardado pendiente · Ver detalle');
  expect(indicator.querySelector('.lucide-cloud-upload')).not.toBeNull();
  expect(indicator.className).not.toMatch(/(?:red|rose|amber|orange|yellow)-\d/);
  fireEvent.click(indicator);
  expect(onOpen).toHaveBeenCalledOnce();
});

it('gives stopped sends a distinct shape and says what to do, without an alarm color', () => {
  renderLine('action');
  const indicator = screen.getByRole('button', { name: 'Guardado pendiente · Ver detalle' });

  expect(indicator).toHaveAttribute('title', 'Hay cambios sin enviar · Revisa el detalle');
  expect(indicator.querySelector('.lucide-circle-alert')).not.toBeNull();
  expect(indicator.querySelector('.lucide-cloud-upload')).toBeNull();
  expect(indicator.className).toContain('text-slate-900');
  expect(indicator.className).not.toMatch(/(?:red|rose|amber|orange|yellow)-\d/);
});

it('hides the indicator when nothing local needs attention', () => {
  renderLine(null);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
