import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClinicalDocumentImageEditor } from '@/features/clinical-documents/components/ClinicalDocumentImageEditor';

const makeImage = (width = 200, height = 120) => {
  const img = document.createElement('img');
  img.src = 'data:image/png;base64,abc';
  Object.defineProperty(img, 'offsetWidth', { value: width, configurable: true });
  img.getBoundingClientRect = () =>
    ({
      left: 50,
      top: 80,
      right: 50 + width,
      bottom: 80 + height,
      width,
      height,
      x: 50,
      y: 80,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(img);
  return img;
};

describe('ClinicalDocumentImageEditor', () => {
  it('renders the alignment toolbar and delete button', () => {
    const img = makeImage();

    render(<ClinicalDocumentImageEditor imageElement={img} onUpdate={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByTitle('Alinear izquierda')).toBeInTheDocument();
    expect(screen.getByTitle('Centrar')).toBeInTheDocument();
    expect(screen.getByTitle('Alinear derecha')).toBeInTheDocument();
    expect(screen.getByTitle('Ancho completo')).toBeInTheDocument();
    expect(screen.getByTitle('Eliminar imagen')).toBeInTheDocument();
  });

  it('applies left alignment styles and calls onUpdate', () => {
    const img = makeImage();
    const onUpdate = vi.fn();

    render(
      <ClinicalDocumentImageEditor imageElement={img} onUpdate={onUpdate} onClose={vi.fn()} />
    );

    fireEvent.click(screen.getByTitle('Alinear izquierda'));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(img.style.display).toBe('block');
    expect(img.style.marginLeft).toBe('0px');
    expect(img.style.marginRight).toBe('auto');
  });

  it('applies center alignment and full-width variants', () => {
    const img = makeImage();
    const onUpdate = vi.fn();

    render(
      <ClinicalDocumentImageEditor imageElement={img} onUpdate={onUpdate} onClose={vi.fn()} />
    );

    fireEvent.click(screen.getByTitle('Centrar'));
    fireEvent.click(screen.getByTitle('Ancho completo'));

    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('removes the image and closes on delete action', () => {
    const img = makeImage();
    const onUpdate = vi.fn();
    const onClose = vi.fn();

    render(
      <ClinicalDocumentImageEditor imageElement={img} onUpdate={onUpdate} onClose={onClose} />
    );

    fireEvent.click(screen.getByTitle('Eliminar imagen'));

    expect(img.isConnected).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape key and ignores other keys', () => {
    const img = makeImage();
    const onClose = vi.fn();

    render(<ClinicalDocumentImageEditor imageElement={img} onUpdate={vi.fn()} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('starts a resize drag on mousedown and commits on mouseup', () => {
    const img = makeImage(200);
    const onUpdate = vi.fn();

    const { container } = render(
      <ClinicalDocumentImageEditor imageElement={img} onUpdate={onUpdate} onClose={vi.fn()} />
    );

    const handle = container.ownerDocument.querySelector('div.cursor-se-resize') as HTMLDivElement;
    expect(handle).toBeTruthy();

    fireEvent.mouseDown(handle, { clientX: 250 });
    fireEvent(document, new MouseEvent('mousemove', { clientX: 330, bubbles: true }));
    fireEvent(document, new MouseEvent('mouseup', { bubbles: true }));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(img.style.width).toMatch(/\d+px/);
  });

  it('refreshes position when the window scrolls or resizes', () => {
    const img = makeImage();
    const spy = vi.spyOn(img, 'getBoundingClientRect');

    render(<ClinicalDocumentImageEditor imageElement={img} onUpdate={vi.fn()} onClose={vi.fn()} />);

    const initialCalls = spy.mock.calls.length;

    fireEvent.scroll(window);
    fireEvent(window, new Event('resize'));

    expect(spy.mock.calls.length).toBeGreaterThan(initialCalls);
  });
});
