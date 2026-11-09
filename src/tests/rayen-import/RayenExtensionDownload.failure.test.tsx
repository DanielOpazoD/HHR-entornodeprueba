import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SectionErrorBoundary } from '@/components/shared/SectionErrorBoundary';
import { RayenExtensionDownload } from '@/features/rayen-import/components/RayenExtensionDownload';

vi.mock('virtual:rayen-extension-release', () => ({
  default: {
    version: '0.48.88',
    buildId: 'a'.repeat(64),
    path: 'downloads/synthetic-extension.zip',
    notesUrl: 'https://example.invalid/notes',
  },
}));
vi.mock('@/features/rayen-import/components/RayenExtensionDownloadDetails', () => {
  throw new Error('Synthetic help module download failed');
});

it('contains a rejected help import, preserves the census draft and keeps ZIP and notes available', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const save = vi.fn();
  render(
    <SectionErrorBoundary sectionName="Censo">
      <h1>Censo sintético</h1>
      <input aria-label="Borrador" defaultValue="sin cambios" />
      <button type="button" onClick={save}>
        Guardar borrador
      </button>
      <RayenExtensionDownload installedVersion="0.48.86" incompatible={false} working />
    </SectionErrorBoundary>
  );
  fireEvent.change(screen.getByLabelText('Borrador'), { target: { value: 'edición pendiente' } });
  fireEvent.click(screen.getByRole('button', { name: 'Identidad sin verificar' }));
  expect(await screen.findByText(/No se pudo cargar la ayuda/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Censo sintético' })).toBeInTheDocument();
  expect(screen.getByLabelText('Borrador')).toHaveValue('edición pendiente');
  expect(screen.queryByText('Error en Censo')).not.toBeInTheDocument();
  expect(screen.getByText('Descargar ZIP · v0.48.88')).toHaveAttribute(
    'href',
    '/downloads/synthetic-extension.zip'
  );
  expect(screen.getByText('Ver cambios de esta versión')).toHaveAttribute(
    'href',
    'https://example.invalid/notes'
  );
  expect(screen.getByText(/Espera a que termine la sincronización/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
  expect(save).toHaveBeenCalledOnce();
});
