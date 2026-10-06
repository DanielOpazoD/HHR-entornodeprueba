import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NavbarTabs } from '@/components/layout/NavbarTabs';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ role: 'admin' }),
}));

const props = {
  currentModule: 'CENSUS' as const,
  onModuleChange: vi.fn(),
  visibleModules: ['CENSUS', 'ANALYTICS', 'NURSING_HANDOFF', 'BACKUP_FILES'] as const,
  censusViewMode: 'REGISTER' as const,
  setCensusViewMode: vi.fn(),
};

describe('Navbar B1 disclosure and selection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('announces the active clinical module and preserves the CUDYR alias', () => {
    const { rerender } = render(<NavbarTabs {...props} />);
    const census = screen.getByRole('button', { name: 'Censo Diario' });
    const nursing = screen.getByRole('button', { name: 'Entrega Turno Enfermería' });
    expect(census).toHaveAttribute('aria-current', 'page');
    expect(nursing).not.toHaveAttribute('aria-current');

    rerender(<NavbarTabs {...props} currentModule="CUDYR" />);
    expect(nursing).toHaveAttribute('aria-current', 'page');
    expect(census).not.toHaveAttribute('aria-current');
  });

  it('links the expanded utility trigger to its panel', () => {
    render(<NavbarTabs {...props} />);
    const trigger = screen.getByRole('button', { name: 'Abrir módulos utilitarios' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', screen.getByTestId('navbar-utility-menu').id);
  });

  it('restores focus on Escape from a utility item', () => {
    render(<NavbarTabs {...props} />);
    const trigger = screen.getByRole('button', { name: 'Abrir módulos utilitarios' });
    fireEvent.click(trigger);
    const item = screen.getByRole('button', { name: 'Estadísticas' });
    item.focus();
    fireEvent.keyDown(item, { key: 'Escape' });
    expect(screen.queryByTestId('navbar-utility-menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('does not expose utilities outside the supplied authorized modules', () => {
    render(<NavbarTabs {...props} visibleModules={['CENSUS']} />);
    expect(screen.getByRole('button', { name: 'Censo Diario' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir módulos utilitarios' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Entrega Turno Enfermería' })).toBeNull();
  });

  it('keeps navigation actions distinct from help or new persistence actions', () => {
    render(<NavbarTabs {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir módulos utilitarios' }));
    fireEvent.click(screen.getByRole('button', { name: 'Estadísticas' }));
    expect(props.onModuleChange).toHaveBeenCalledTimes(1);
    expect(props.onModuleChange).toHaveBeenCalledWith('ANALYTICS');
    expect(props.setCensusViewMode).not.toHaveBeenCalled();
    expect(screen.queryByTestId('navbar-utility-menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir módulos utilitarios' })).toHaveFocus();
  });

  it('closes an old disclosure when the external module changes', () => {
    const { rerender } = render(<NavbarTabs {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir módulos utilitarios' }));
    rerender(<NavbarTabs {...props} currentModule="ANALYTICS" />);
    expect(screen.queryByTestId('navbar-utility-menu')).not.toBeInTheDocument();
  });

  it('does not reopen a stale menu after authorized modules disappear and return', () => {
    const { rerender } = render(<NavbarTabs {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir módulos utilitarios' }));
    rerender(<NavbarTabs {...props} visibleModules={['CENSUS']} />);
    expect(screen.queryByTestId('navbar-utility-menu')).not.toBeInTheDocument();
    rerender(<NavbarTabs {...props} />);
    expect(screen.queryByTestId('navbar-utility-menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir módulos utilitarios' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('does not steal focus from a directly selected clinical tab', () => {
    render(<NavbarTabs {...props} />);
    const nursing = screen.getByRole('button', { name: 'Entrega Turno Enfermería' });
    nursing.focus();
    fireEvent.click(nursing);
    expect(nursing).toHaveFocus();
    expect(props.onModuleChange).toHaveBeenCalledWith('NURSING_HANDOFF');
  });
});
