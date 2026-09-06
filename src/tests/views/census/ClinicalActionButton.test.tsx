import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClinicalActionButton } from '@/features/census/components/patient-row/ClinicalActionButton';
import { PatientDocumentManagerButton } from '@/features/census/components/patient-row/PatientDocumentManagerButton';

describe('ClinicalActionButton', () => {
  it.each(['clinical', 'laboratory', 'radiology', 'documents'] as const)(
    'keeps the same target, focus and accessible name for %s',
    tone => {
      const action = vi.fn();
      const row = vi.fn();
      render(
        <div onClick={row}>
          <ClinicalActionButton
            tone={tone}
            label="Abrir paciente"
            title="Descripción"
            onClick={action}
          >
            <svg />
          </ClinicalActionButton>
        </div>
      );
      const button = screen.getByRole('button', { name: 'Abrir paciente' });
      expect(button).toHaveClass('size-8', 'focus-visible:outline-medical-700');
      const color = {
        clinical: 'medical',
        laboratory: 'emerald',
        radiology: 'violet',
        documents: 'teal',
      }[tone];
      expect(button).toHaveClass('bg-transparent', `text-${color}-700`);
      expect(button).not.toHaveClass('text-slate-600');
      expect(button).toHaveAttribute('title', 'Descripción');
      fireEvent.click(button);
      expect(action).toHaveBeenCalledOnce();
      expect(row).not.toHaveBeenCalled();
    }
  );

  it('blocks activation while loading and restores it when ready', () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <PatientDocumentManagerButton patientName="Prueba" count={null} loading onOpen={onOpen} />
    );
    const button = screen.getByRole('button', { name: 'Cargando documentos de Prueba' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
    rerender(<PatientDocumentManagerButton patientName="Prueba" count={120} onOpen={onOpen} />);
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button).toHaveAccessibleName(/120 archivos/);
    expect(button).toHaveTextContent('99+');
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it.each([0, null])('keeps documents accessible with count=%s, without a false badge', count => {
    render(<PatientDocumentManagerButton patientName="Prueba" count={count} onOpen={vi.fn()} />);
    const button = screen.getByRole('button');
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleName(count === 0 ? /sin archivos/ : /cantidad no disponible/);
    expect(button).not.toHaveTextContent(/\d/);
    expect(button).not.toHaveClass('opacity-40');
  });
});
