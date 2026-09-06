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
    expect(trigger).toHaveAttribute('data-census-menu-action');
    expect(drawerRender).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText('Cerrar biblioteca'));
    expect(screen.queryByText('Cerrar biblioteca')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('renders the toolbar variant without the census-menu marker', () => {
    render(<ClinicalLibraryQuickAction variant="toolbar" />);
    const trigger = screen.getByTestId('clinical-library-quick-action');
    expect(trigger).not.toHaveAttribute('data-census-menu-action');
    expect(trigger).toHaveClass('h-8', 'rounded-lg');
    expect(trigger).toHaveTextContent('Documentos');
  });

  it('keeps the shared DateStrip quick-action dimensions', () => {
    render(<ClinicalLibraryQuickAction />);
    const trigger = screen.getByTestId('clinical-library-quick-action');
    expect(trigger).toHaveClass('h-[30px]', 'min-w-[76px]', 'py-0', 'text-[10px]');
    expect(trigger).toHaveAttribute('title', 'Documentos y herramientas clínicas');
  });
});
