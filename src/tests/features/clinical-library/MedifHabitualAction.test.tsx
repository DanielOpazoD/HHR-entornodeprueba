import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MedifEditor } from '@/features/clinical-library/components/tools/medif/MedifEditor';
import type { MedifEditorProps } from '@/features/clinical-library/components/tools/medif/medifEditorTypes';
import {
  defaultMedifPreferences,
  MEDIF_PREFERENCES_STORAGE_KEY,
  setMedifFieldHidden,
} from '@/features/clinical-library/domain/medifPreferences';

const setup = () => {
  const onGeneratePdf = vi.fn<MedifEditorProps['onGeneratePdf']>().mockResolvedValue(undefined);
  render(
    <MedifEditor patients={[]} onBack={vi.fn()} onClose={vi.fn()} onGeneratePdf={onGeneratePdf} />
  );
  return onGeneratePdf;
};

describe('MEDIF green check', () => {
  beforeEach(() => window.localStorage.clear());

  it('applies only on click and preserves clinical responses and manual text', async () => {
    const onGeneratePdf = setup();
    const button = screen.getByRole('button', { name: 'Respuestas habituales' });
    expect(document.getElementById('medif-p2_comer_si')).not.toBeChecked();
    expect(document.getElementById('medif-p2_instrucciones_si')).not.toBeChecked();
    fireEvent.change(screen.getByRole('textbox', { name: 'Hacia' }), {
      target: { value: 'Destino manual' },
    });
    fireEvent.click(document.getElementById('medif-p2_medicacion_previa_si')!);
    fireEvent.click(button);
    expect(document.getElementById('medif-p2_comer_si')).toBeChecked();
    expect(document.getElementById('medif-p1_especiales_no')).toBeChecked();
    expect(document.getElementById('medif-p2_instrucciones_si')).toBeChecked();
    expect(document.getElementById('medif-p2_medicacion_previa_si')).toBeChecked();
    expect(document.getElementById('medif-p2_medicacion_previa_no')).not.toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Hacia' })).toHaveValue('Destino manual');
    expect(screen.getByRole('textbox', { name: 'Desde' })).toHaveValue('Isla de pascua');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'PDF editable' }));
    });
    expect(onGeneratePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        p2_comer_si: 'X',
        p1_especiales_no: 'X',
        p2_instrucciones_si: 'X',
        p2_medicacion_previa_si: 'X',
        p2_medicacion_previa_no: '',
        p1_itinerario_1_hacia: 'Destino manual',
      }),
      expect.anything(),
      'editable'
    );
    fireEvent.click(button);
    expect(screen.getByRole('status')).toHaveTextContent(
      'No había respuestas habituales pendientes.'
    );
  });

  it('does not fill hidden habitual answers', async () => {
    window.localStorage.setItem(
      MEDIF_PREFERENCES_STORAGE_KEY,
      JSON.stringify(setMedifFieldHidden(defaultMedifPreferences(), 'p2_comer_si', true))
    );
    const onGeneratePdf = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Respuestas habituales' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'PDF imprimible' }));
    });
    expect(onGeneratePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        p2_comer_si: '',
        p2_comer_no: '',
        p2_bano_si: 'X',
      }),
      expect.anything(),
      'print'
    );
  });
});
