import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClinicalLibraryQuickAction } from '@/features/clinical-library/components/ClinicalLibraryQuickAction';

const drawerRender = vi.hoisted(() => vi.fn());

vi.mock('@/features/clinical-library/components/ClinicalLibraryDrawer', () => ({
  ClinicalLibraryDrawer: (props: { onClose: () => void }) => {
    drawerRender(props);
    return (
      <button type="button" onClick={props.onClose}>
        Cerrar biblioteca
      </button>
    );
  },
}));

describe('ClinicalLibraryQuickAction', () => {
  it('mounts the drawer only on demand and returns focus to the trigger on close', async () => {
    render(<ClinicalLibraryQuickAction />);
    const trigger = screen.getByRole('button', { name: /documentos/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(drawerRender).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText('Cerrar biblioteca'));
    expect(screen.queryByText('Cerrar biblioteca')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('matches the trailing-action geometry and stays named when only the icon is visible', () => {
    render(<ClinicalLibraryQuickAction />);
    const trigger = screen.getByTestId('clinical-library-quick-action');
    expect(trigger).toHaveClass('h-8', 'rounded-lg', 'border-slate-200');
    expect(trigger).toHaveAttribute('aria-label', 'Documentos');
    expect(trigger).not.toHaveAttribute('data-census-menu-action');
    expect(trigger).toHaveAttribute('title', 'Documentos y herramientas clínicas');
  });
});
