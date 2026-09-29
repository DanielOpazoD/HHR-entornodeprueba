import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  RayenExtensionDownload,
  isOlderExtensionVersion,
} from '@/features/rayen-import/components/RayenExtensionDownload';

vi.mock('virtual:rayen-extension-release', () => ({
  default: { version: '0.48.37', path: 'downloads/eloisa-extension-0.48.37-abc123.zip' },
}));

describe('extension update download', () => {
  it.each([
    ['0.48.9', true],
    ['0.48.36', true],
    ['0.48.37', false],
    ['0.48.37.0', false],
    ['0.48.38', false],
    ['1.0', false],
    [undefined, false],
    ['unknown', false],
  ])('compares the reported version %s numerically', (version, expected) => {
    expect(isOlderExtensionVersion(version, '0.48.37')).toBe(expected);
  });

  it('offers a same-origin ZIP and keeps the warning until a fresh version is detected', () => {
    const { rerender } = render(
      <RayenExtensionDownload installedVersion="0.48.9" incompatible={false} working={false} />
    );
    expect(screen.getByRole('button', { name: 'Actualización disponible' })).toBeInTheDocument();
    const link = screen.getByText('Descargar ZIP · v0.48.37');
    expect(link).toHaveAttribute('href', '/downloads/eloisa-extension-0.48.37-abc123.zip');
    expect(link).toHaveAttribute('download');
    link.addEventListener('click', event => event.preventDefault());
    fireEvent.click(link);
    expect(screen.getByRole('button', { name: 'Actualización disponible' })).toBeInTheDocument();
    rerender(
      <RayenExtensionDownload installedVersion="0.48.37" incompatible={false} working={false} />
    );
    expect(screen.getByRole('button', { name: 'Descargar extensión' })).toBeInTheDocument();
  });

  it('distinguishes compatibility and warns against interrupting a sync without disabling download', () => {
    render(<RayenExtensionDownload installedVersion="0.48.9" incompatible working />);
    expect(screen.getByRole('button', { name: 'Actualización necesaria' })).toBeInTheDocument();
    expect(screen.getByText(/Espera a que termine la sincronización/)).toBeInTheDocument();
    expect(screen.getByText('Descargar ZIP · v0.48.37')).toHaveAttribute('download');
  });

  it('does not present a missing report as an outdated version', () => {
    render(<RayenExtensionDownload incompatible={false} working={false} />);
    expect(screen.getByRole('button', { name: 'Descargar extensión' })).toBeInTheDocument();
    expect(screen.getByText(/Detectada: sin reporte/)).toBeInTheDocument();
  });
});
