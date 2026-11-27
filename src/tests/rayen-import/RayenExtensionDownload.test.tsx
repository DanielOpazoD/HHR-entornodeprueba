import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RayenExtensionDownload } from '@/features/rayen-import/components/RayenExtensionDownload';

vi.mock('virtual:rayen-extension-release', () => ({
  default: {
    version: '0.48.88',
    buildId: 'a'.repeat(64),
    path: 'downloads/eloisa-extension-0.48.88-aaaaaaaaaaaa.zip',
    notesUrl: 'https://github.com/DanielOpazoD/extensioneloisahhr/releases/tag/v0.48.88',
  },
}));

describe('RayenExtensionDownload', () => {
  it.each(['0.48.88', '0.48.210', '0.48.86'])(
    'does not show a package-mismatch or unverified alert for compatible version %s',
    async version => {
      render(
        <RayenExtensionDownload
          installedVersion={version}
          installedBuildId={'b'.repeat(64)}
          incompatible={false}
          working={false}
        />
      );

      const trigger = screen.getByRole('button', { name: 'Descargar extensión' });
      expect(trigger).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Paquete diferente' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Identidad sin verificar' })
      ).not.toBeInTheDocument();
      expect(trigger.querySelector('span')).toBeNull();

      fireEvent.click(trigger);

      const link = await screen.findByText('Descargar ZIP · v0.48.88');
      expect(link).toHaveAttribute('href', '/downloads/eloisa-extension-0.48.88-aaaaaaaaaaaa.zip');
      expect(link).toHaveAttribute('download');
      expect(screen.getByText('Ver cambios de esta versión')).toHaveAttribute(
        'href',
        'https://github.com/DanielOpazoD/extensioneloisahhr/releases/tag/v0.48.88'
      );
      expect(await screen.findByText(`Detectada: ${version}`)).toBeInTheDocument();
      expect(screen.getByText(`Paquete instalado: ${'b'.repeat(12)}`)).toBeInTheDocument();
      expect(screen.queryByText(/Paquete diferente/)).not.toBeInTheDocument();
      expect(screen.queryByText(/distinto del publicado/)).not.toBeInTheDocument();
      expect(screen.queryByText(/identidad verificable/)).not.toBeInTheDocument();
    }
  );

  it('stays neutral when a compatible extension does not report a buildId', async () => {
    render(
      <RayenExtensionDownload installedVersion="0.48.210" incompatible={false} working={false} />
    );

    const trigger = screen.getByRole('button', { name: 'Descargar extensión' });
    expect(trigger).toBeInTheDocument();
    fireEvent.click(trigger);

    expect(await screen.findByText('Detectada: 0.48.210')).toBeInTheDocument();
    expect(screen.queryByText(/Paquete instalado:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/identidad verificable/)).not.toBeInTheDocument();
  });

  it('keeps incompatibility review state and warns against interrupting a sync', async () => {
    render(<RayenExtensionDownload installedVersion="0.48.86" incompatible working />);

    const trigger = screen.getByRole('button', { name: 'Actualización necesaria' });
    expect(trigger).toBeInTheDocument();
    expect(trigger.querySelector('span')).not.toBeNull();

    fireEvent.click(trigger);
    expect(await screen.findByText(/Espera a que termine la sincronización/)).toBeInTheDocument();
    expect(await screen.findByText(/esta versión ya no es compatible/)).toBeInTheDocument();
    expect(screen.getByText('Descargar ZIP · v0.48.88')).toHaveAttribute('download');
  });

  it('renders absent report state cleanly', async () => {
    render(<RayenExtensionDownload incompatible={false} working={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Descargar extensión' }));
    expect(await screen.findByText(/Detectada: sin reporte/)).toBeInTheDocument();
  });
});
