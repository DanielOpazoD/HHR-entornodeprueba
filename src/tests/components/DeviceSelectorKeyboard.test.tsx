import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeviceSelector } from '@/components/DeviceSelector';

describe('DeviceSelector keyboard access', () => {
  it.each(['{Enter}', ' '])(
    'opens an empty editor with %s and returns focus on close',
    async key => {
      const user = userEvent.setup();
      render(<DeviceSelector devices={[]} onChange={vi.fn()} />);
      const trigger = screen.getByRole('button', { name: 'Agregar dispositivo' });
      expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await user.tab();
      expect(trigger).toHaveFocus();
      await user.keyboard(key);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const menu = screen.getByRole('dialog', { name: 'Editar dispositivos' });
      expect(
        within(menu).getByRole('button', { name: 'Cerrar editor de dispositivos' })
      ).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).toHaveFocus();
    }
  );

  it('names the editor with badge text and age, and skips badges in the tab order', async () => {
    const user = userEvent.setup();
    render(
      <>
        <DeviceSelector
          devices={['VVP#1', 'Sonda Nasogástrica']}
          deviceDetails={{ 'VVP#1': { installationDate: '2026-11-06' } }}
          currentDate="2026-11-08"
          onChange={vi.fn()}
        />
        <button>Después</button>
      </>
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Editar dispositivos: SNG VVP(3d)' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Después' })).toHaveFocus();
  });

  it('selects and retires options with keyboard and exposes their current pressed state', async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    const onRetireChange = vi.fn();
    render(
      <DeviceSelector
        devices={[]}
        onChange={vi.fn()}
        onConfigChange={onConfigChange}
        onRetireChange={onRetireChange}
        currentDate="2026-11-08"
      />
    );
    await user.tab();
    await user.keyboard('{Enter}');
    const option = screen.getByRole('button', { name: 'CVC', pressed: false });
    option.focus();
    await user.keyboard('{Enter}');
    screen.getByRole('button', { name: 'Confirmar e Instalar' }).focus();
    await user.keyboard('{Enter}');
    expect(onConfigChange).toHaveBeenCalledWith(['CVC'], expect.any(Object));
    const selected = screen.getByRole('button', { name: 'CVC', pressed: true });
    expect(within(selected).queryByRole('button')).not.toBeInTheDocument();
    selected.focus();
    await user.keyboard(' ');
    screen.getByRole('button', { name: 'Confirmar Retiro' }).focus();
    await user.keyboard('{Enter}');
    expect(onRetireChange).toHaveBeenCalledWith([], expect.any(Object));
    expect(screen.getByRole('button', { name: 'CVC', pressed: false })).toBeInTheDocument();
  });

  it('names the custom add button and activates it with Space', async () => {
    const user = userEvent.setup();
    render(<DeviceSelector devices={[]} onChange={vi.fn()} />);
    await user.tab();
    await user.keyboard('{Enter}');
    await user.type(screen.getByPlaceholderText('Otro dispositivo...'), 'Drenaje');
    const add = screen.getByRole('button', { name: 'Agregar dispositivo personalizado' });
    add.focus();
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Confirmar e Instalar' })).toBeInTheDocument();
  });

  it.each(['{Enter}', ' '])('opens overflow independently with %s', async key => {
    const user = userEvent.setup();
    render(<DeviceSelector devices={['CVC', 'TET', 'SNG', 'LA']} onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /Editar dispositivos:.*LA/ });
    expect(within(trigger).queryByRole('button')).not.toBeInTheDocument();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Ver los 4 dispositivos' })).toHaveFocus();
    await user.keyboard(key);
    expect(screen.getByRole('dialog', { name: 'Dispositivos del paciente' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog', { name: 'Editar dispositivos' })).not.toBeInTheDocument();
  });

  it.each([{ devices: [] }, { devices: ['CVC'] }])(
    'keeps the read-only editor unavailable for %j',
    ({ devices }) => {
      render(<DeviceSelector devices={devices} onChange={vi.fn()} disabled />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
  );
});
