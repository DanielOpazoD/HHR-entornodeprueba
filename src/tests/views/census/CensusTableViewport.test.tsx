import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CensusTableViewport } from '@/features/census/components/CensusTableViewport';

const setup = (initialTableWidth: number) => {
  let width = initialTableWidth;
  let onResize = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        onResize = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500);
  vi.spyOn(HTMLTableElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width }) as DOMRect
  );
  const view = render(
    <CensusTableViewport>
      <table>
        <tbody>
          <tr>
            <td>
              <button>Editar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </CensusTableViewport>
  );
  const viewport = screen.getByRole('region');
  const scrollBy = vi.fn();
  viewport.scrollBy = scrollBy;
  return {
    ...view,
    viewport,
    scrollBy,
    disconnect,
    resize: (nextWidth: number) =>
      act(() => {
        width = nextWidth;
        onResize();
      }),
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CensusTableViewport', () => {
  it('releases vertical sticky positioning when the table fits and responds to resized columns', () => {
    const { viewport, resize, unmount, disconnect } = setup(500);
    expect(viewport).toHaveAttribute('data-horizontal-overflow', 'false');
    resize(720);
    expect(viewport).toHaveAttribute('data-horizontal-overflow', 'true');
    resize(480);
    expect(viewport).toHaveAttribute('data-horizontal-overflow', 'false');
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('scrolls with arrows only from the overflowing region, leaving child controls alone', () => {
    const { viewport, scrollBy, resize } = setup(720);
    fireEvent.keyDown(viewport, { key: 'ArrowRight' });
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 240 });
    fireEvent.keyDown(viewport, { key: 'ArrowLeft' });
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -240 });
    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowRight' });
    resize(480);
    fireEvent.keyDown(viewport, { key: 'ArrowRight' });
    expect(scrollBy).toHaveBeenCalledTimes(2);
  });
});
