import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MoaCatalogSequence } from '@/components/layout/moa/MoaCatalogSequence';
import { fetchMoaAtlas, parseMoaCatalog } from '@/components/layout/moa/moaCatalog';
import fixture from '../fixtures/moa/catalog.json';
vi.mock('@/components/layout/moa/moaCatalog', async importOriginal => ({
  ...(await importOriginal<typeof import('@/components/layout/moa/moaCatalog')>()),
  fetchMoaAtlas: vi.fn(),
}));
vi.mock('@/components/layout/navbar/MoaMascot', () => ({
  MoaMascot: () => <span data-testid="portrait" />,
}));
const scene = parseMoaCatalog(fixture).scenes.find(s => s.id === 'E08')!;
let finish: (() => void) | null;
let pause: ReturnType<typeof vi.fn>;
let play: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  finish = null;
  pause = vi.fn();
  play = vi.fn();
  cancel = vi.fn();
  vi.mocked(fetchMoaAtlas).mockResolvedValue(new Blob(['png']));
  URL.createObjectURL = vi.fn(() => 'blob:moa-test');
  URL.revokeObjectURL = vi.fn();
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  HTMLElement.prototype.animate = vi.fn(
    () =>
      ({
        set onfinish(fn: (() => void) | null) {
          finish = fn;
        },
        currentTime: 0,
        pause,
        play,
        cancel,
      }) as unknown as Animation
  );
});
async function load(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
  const img = container.querySelector('img')!;
  Object.defineProperties(img, { naturalWidth: { value: 13824 }, naturalHeight: { value: 336 } });
  fireEvent.load(img);
  return img;
}
describe('HD Moa lifecycle', () => {
  it('starts after verified image load, uses smooth rendering and completes once', async () => {
    const done = vi.fn();
    const { container } = render(
      <MoaCatalogSequence scene={scene} paused={false} onComplete={done} />
    );
    expect(screen.getByTestId('portrait')).toBeInTheDocument();
    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();
    const img = await load(container);
    expect(img.style.imageRendering).toBe('auto');
    expect(img.style.width).toBe('2400%');
    expect(HTMLElement.prototype.animate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ duration: 5760, iterations: 1 })
    );
    act(() => {
      finish?.();
      finish?.();
    });
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('pauses while hidden and cancels/revokes resources on close', async () => {
    const done = vi.fn();
    const { container, rerender, unmount } = render(
      <MoaCatalogSequence scene={scene} paused={false} onComplete={done} />
    );
    await load(container);
    rerender(<MoaCatalogSequence scene={scene} paused onComplete={done} />);
    expect(pause).toHaveBeenCalled();
    rerender(<MoaCatalogSequence scene={scene} paused={false} onComplete={done} />);
    expect(play).toHaveBeenCalled();
    unmount();
    expect(cancel).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:moa-test');
    expect(finish).toBeNull();
    expect(done).not.toHaveBeenCalled();
  });
  it('ignores an old download after switching or hiding the companion', async () => {
    let resolve: (value: Blob) => void = () => {};
    vi.mocked(fetchMoaAtlas).mockImplementationOnce(
      () =>
        new Promise(r => {
          resolve = r;
        })
    );
    const done = vi.fn();
    const view = render(<MoaCatalogSequence scene={scene} paused={false} onComplete={done} />);
    const signal = vi.mocked(fetchMoaAtlas).mock.calls[0][1];
    view.unmount();
    await act(async () => resolve(new Blob(['late'])));
    expect(signal.aborted).toBe(true);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });
  it('fails closed to the local portrait on network/integrity errors', async () => {
    vi.mocked(fetchMoaAtlas).mockRejectedValue(new Error('wrong hash'));
    const done = vi.fn();
    render(<MoaCatalogSequence scene={scene} paused={false} onComplete={done} />);
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('rejects mismatched decoded dimensions', async () => {
    const done = vi.fn();
    const { container } = render(
      <MoaCatalogSequence scene={scene} paused={false} onComplete={done} />
    );
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    fireEvent.load(container.querySelector('img')!);
    expect(done).toHaveBeenCalledOnce();
    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();
  });
});
