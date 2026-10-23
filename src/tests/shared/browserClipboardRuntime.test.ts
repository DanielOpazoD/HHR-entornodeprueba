import { afterEach, describe, expect, it, vi } from 'vitest';
import { writePrivateClipboardText } from '@/shared/runtime/browserClipboardRuntime';

describe('private clipboard delivery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('copies explicitly without retaining a value in local E2E captures or storage', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const runtime = window as Window & { __HHR_LAST_CLIPBOARD__?: string };
    const previousCapture = runtime.__HHR_LAST_CLIPBOARD__;
    await writePrivateClipboardText('synthetic private delivery');
    expect(writeText).toHaveBeenCalledExactlyOnceWith('synthetic private delivery');
    expect(storageWrite).not.toHaveBeenCalled();
    expect(runtime.__HHR_LAST_CLIPBOARD__).toBe(previousCapture);
  });

  it('reports unavailable clipboard without using persisted fallback storage', async () => {
    vi.stubGlobal('navigator', {});
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    await expect(writePrivateClipboardText('synthetic private delivery')).rejects.toThrow(
      'Clipboard API no disponible'
    );
    expect(storageWrite).not.toHaveBeenCalled();
  });
});
