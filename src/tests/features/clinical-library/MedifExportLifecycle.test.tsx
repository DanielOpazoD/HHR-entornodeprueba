import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MedifEditor } from '@/features/clinical-library/components/tools/medif/MedifEditor';
import type { MedifEditorProps } from '@/features/clinical-library/components/tools/medif/medifEditorTypes';
import { emptyMedifValues } from '@/features/clinical-library/domain/medifDraft';

describe('MEDIF editor export lifecycle', () => {
  it.each(['close', 'source'] as const)(
    'cancels export after %s and suppresses its completion message',
    async change => {
      let finish!: () => void;
      const props: MedifEditorProps = {
        patients: [
          {
            key: 'episode-a',
            label: 'PRUEBA',
            sourceLabel: 'Cama sintética',
            values: emptyMedifValues(),
          },
        ],
        onBack: vi.fn(),
        onClose: vi.fn(),
        onGeneratePdf: vi.fn(
          () =>
            new Promise<void>(resolve => {
              finish = resolve;
            })
        ),
      };
      const view = render(<MedifEditor {...props} />);
      fireEvent.change(screen.getByLabelText('Origen de los datos'), {
        target: { value: 'episode-a' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'PDF imprimible' }));
      const signal = vi.mocked(props.onGeneratePdf).mock.calls[0][3];
      expect(signal?.aborted).toBe(false);
      if (change === 'close') view.unmount();
      else view.rerender(<MedifEditor {...props} patients={[]} />);
      expect(signal?.aborted).toBe(true);
      await act(async () => {
        finish();
      });
      expect(screen.queryByText('PDF imprimible preparado.')).not.toBeInTheDocument();
    }
  );

  it('allows a retry after generation fails and keeps the form values', async () => {
    const generate = vi
      .fn<MedifEditorProps['onGeneratePdf']>()
      .mockRejectedValueOnce(new Error('Plantilla no disponible.'))
      .mockResolvedValue(undefined);
    render(
      <MedifEditor patients={[]} onBack={vi.fn()} onClose={vi.fn()} onGeneratePdf={generate} />
    );
    fireEvent.change(document.getElementById('medif-p1_nombre_pasajero')!, {
      target: { value: 'PRUEBA' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'PDF imprimible' }));
    });
    expect(screen.getByText('Plantilla no disponible.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'PDF imprimible' }));
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.lastCall?.[0].p1_nombre_pasajero).toBe('PRUEBA');
    expect(screen.getByText('PDF imprimible preparado.')).toBeInTheDocument();
  });
});
