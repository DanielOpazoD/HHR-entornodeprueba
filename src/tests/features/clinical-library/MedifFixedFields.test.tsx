import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MedifEditor } from '@/features/clinical-library/components/tools/medif/MedifEditor';
import type { MedifEditorProps } from '@/features/clinical-library/components/tools/medif/medifEditorTypes';

describe('MEDIF fixed fields and compact controls', () => {
  it('keeps the route fixed before shortcuts, shares the declaration date and exposes compact draft icons', async () => {
    window.localStorage.clear();
    const props = {
      patients: [],
      onBack: vi.fn(),
      onClose: vi.fn(),
      onGeneratePdf: vi.fn<MedifEditorProps['onGeneratePdf']>().mockResolvedValue(undefined),
      onDirtyChange: vi.fn(),
    };
    render(<MedifEditor {...props} />);
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(
      screen.queryByRole('navigation', { name: 'Bloques del formulario MEDIF' })
    ).not.toBeInTheDocument();
    for (const id of [
      'p1_itinerario_1_desde',
      'p1_itinerario_1_hacia',
      'p2_prognosis',
      'p3_firma_medico_texto',
      'p1_declaracion_fecha',
    ]) {
      expect(document.getElementById(`medif-${id}`)).not.toBeInTheDocument();
    }
    expect(screen.getByRole('textbox', { name: 'Fecha del vuelo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar borrador' })).toHaveTextContent('');
    expect(screen.getByRole('button', { name: 'Importar borrador' })).toHaveTextContent('');
    fireEvent.change(document.getElementById('medif-p3_fecha_declaracion')!, {
      target: { value: '16/10/2026' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'PDF editable' }));
    });
    expect(props.onGeneratePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        p1_itinerario_1_desde: 'Isla de Pascua',
        p1_itinerario_1_hacia: 'Santiago',
        p3_fecha_declaracion: '16/10/2026',
        p1_declaracion_fecha: '16/10/2026',
      }),
      expect.anything(),
      'editable',
      expect.any(AbortSignal)
    );
    fireEvent.change(document.getElementById('medif-p3_fecha_declaracion')!, {
      target: { value: '' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'PDF editable' }));
    });
    expect(props.onGeneratePdf.mock.lastCall?.[0]).toMatchObject({
      p3_fecha_declaracion: '',
      p1_declaracion_fecha: '',
    });
  });
});
