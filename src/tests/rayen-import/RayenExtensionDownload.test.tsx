import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RayenExtensionDownload } from '@/features/rayen-import/components/RayenExtensionDownload';
const publishedId = 'a'.repeat(64);
vi.mock('virtual:rayen-extension-release', () => ({
  default: {
    version: '0.48.88',
    buildId: 'a'.repeat(64),
    path: 'downloads/eloisa-extension-0.48.88-aaaaaaaaaaaa.zip',
    notesUrl: 'https://github.com/DanielOpazoD/extensioneloisahhr/releases/tag/v0.48.88',
  },
}));
describe('extension package identity', () => {
  it.each(['0.48.88', '0.48.89', '0.48.86'])(
    'does not infer identity from version %s alone',
    async version => {
      render(
        <RayenExtensionDownload installedVersion={version} incompatible={false} working={false} />
      );
      expect(screen.getByRole('button', { name: 'Identidad sin verificar' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Identidad sin verificar' }));
      expect(await screen.findByText(/no informa una identidad verificable/)).toBeInTheDocument();
      expect(screen.queryByText(/El identificador coincide/)).not.toBeInTheDocument();
    }
  );
  it('distinguishes two parallel builds with the same version until a matching report arrives', async () => {
    const { rerender } = render(
      <RayenExtensionDownload
        installedVersion="0.48.88"
        installedBuildId={'b'.repeat(64)}
        incompatible={false}
        working={false}
      />
    );
    expect(screen.getByRole('button', { name: 'Paquete diferente' })).toBeInTheDocument();
    expect(screen.queryByText('Descargar ZIP · v0.48.88')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Paquete diferente' }));
    const link = await screen.findByText('Descargar ZIP · v0.48.88');
    expect(link).toHaveAttribute('href', '/downloads/eloisa-extension-0.48.88-aaaaaaaaaaaa.zip');
    expect(link).toHaveAttribute('download');
    expect(screen.getByText('Ver cambios de esta versión')).toHaveAttribute(
      'href',
      'https://github.com/DanielOpazoD/extensioneloisahhr/releases/tag/v0.48.88'
    );
    link.addEventListener('click', event => event.preventDefault());
    fireEvent.click(link);
    expect(screen.getByRole('button', { name: 'Paquete diferente' })).toBeInTheDocument();
    rerender(
      <RayenExtensionDownload
        installedVersion="0.48.88"
        installedBuildId={publishedId}
        incompatible={false}
        working={false}
      />
    );
    expect(screen.getByText('El identificador coincide con el publicado.')).toBeInTheDocument();
  });
  it('keeps compatibility separate and warns against interrupting a sync', async () => {
    render(<RayenExtensionDownload installedVersion="0.48.86" incompatible working />);
    expect(screen.getByRole('button', { name: 'Actualización necesaria' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actualización necesaria' }));
    expect(await screen.findByText(/Espera a que termine la sincronización/)).toBeInTheDocument();
    expect(screen.getByText('Descargar ZIP · v0.48.88')).toHaveAttribute('download');
  });
  it('keeps an absent report distinct from a different installed package', async () => {
    render(<RayenExtensionDownload incompatible={false} working={false} />);
    expect(screen.getByRole('button', { name: 'Descargar extensión' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Descargar extensión' }));
    expect(await screen.findByText(/Detectada: sin reporte/)).toBeInTheDocument();
  });
});
