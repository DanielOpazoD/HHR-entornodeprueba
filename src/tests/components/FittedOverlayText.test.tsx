import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FittedOverlayText } from '@/components/modals/imaging/FittedOverlayText';

const NAME = 'Ana María Josefa Valentina Del Sagrado Corazón de la Fuente';

// jsdom has no layout: give the field and its text the widths a browser would measure.
const stubLayout = ({ field, text }: { field: number; text: number }) => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(field);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(text);
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
    const style = computedStyle(element);
    const fontSize = (element as HTMLElement).style.fontSize || '14px';
    return new Proxy(style, {
      get: (target, key) => {
        if (key === 'fontSize') return fontSize;
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });
};

const renderName = () =>
  render(
    <FittedOverlayText
      text={NAME}
      className="absolute text-sm"
      style={{ left: '16.27%', top: '17.12%' }}
      width="36.93%"
    />
  );

describe('FittedOverlayText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shrinks a name wider than its field so it stays on one line inside it', () => {
    stubLayout({ field: 266, text: 420 });
    renderName();

    const name = screen.getByText(NAME);
    expect(name).toHaveStyle({ width: '36.93%' });
    expect(name).toHaveClass('whitespace-nowrap');
    expect(name.style.fontSize).toBe('8.8px');
  });

  it('keeps the base size when the name fits', () => {
    stubLayout({ field: 266, text: 200 });
    renderName();

    expect(screen.getByText(NAME).style.fontSize).toBe('');
  });
});
