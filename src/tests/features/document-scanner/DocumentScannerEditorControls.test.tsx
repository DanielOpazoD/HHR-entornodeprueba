import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentCropEditor } from '@/features/document-scanner/components/DocumentCropEditor';
import { DocumentPageAddControls } from '@/features/document-scanner/components/DocumentPageAddControls';

const initialCorners = {
  topLeftCorner: { x: 0.1, y: 0.1 },
  topRightCorner: { x: 0.9, y: 0.1 },
  bottomLeftCorner: { x: 0.1, y: 0.9 },
  bottomRightCorner: { x: 0.9, y: 0.9 },
};

describe('document scanner editor controls', () => {
  it('allows keyboard users to nudge a crop corner', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      <DocumentCropEditor
        sourceObjectUrl="blob:test"
        initialCorners={initialCorners}
        busy={false}
        onCancel={vi.fn()}
        onApply={onApply}
      />
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Esquina superior izquierda' }), {
      key: 'ArrowRight',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar recorte' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply.mock.calls[0][0].topLeftCorner.x).toBeCloseTo(0.105, 3);
  });

  it('passes only the number of photos that still fit in the PDF', () => {
    const onAddPages = vi.fn().mockResolvedValue(undefined);
    render(
      <DocumentPageAddControls busy={false} adding={false} pageCount={11} onAddPages={onAddPages} />
    );
    const files = [
      new File(['one'], 'one.jpg', { type: 'image/jpeg' }),
      new File(['two'], 'two.jpg', { type: 'image/jpeg' }),
    ];

    fireEvent.change(screen.getByLabelText('Elegir páginas adicionales'), {
      target: { files },
    });

    expect(onAddPages).toHaveBeenCalledTimes(1);
    expect(onAddPages).toHaveBeenCalledWith([files[0]]);
  });

  it('disables direct file-input activation once the maximum is reached', () => {
    render(
      <DocumentPageAddControls
        busy={false}
        adding={false}
        pageCount={12}
        onAddPages={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByLabelText('Fotografiar página adicional')).toBeDisabled();
    expect(screen.getByLabelText('Elegir páginas adicionales')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tomar foto' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Elegir fotos' })).toBeDisabled();
  });

  it('disables new selections while additional pages are being processed', () => {
    render(
      <DocumentPageAddControls
        busy={false}
        adding
        pageCount={2}
        onAddPages={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByLabelText('Fotografiar página adicional')).toBeDisabled();
    expect(screen.getByLabelText('Elegir páginas adicionales')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tomar foto' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Elegir fotos' })).toBeDisabled();
  });
});
