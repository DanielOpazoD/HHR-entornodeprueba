import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useClinicalFormPdf } from '@/features/clinical-library/components/tools/forms/useClinicalFormPdf';
import { getClinicalForm } from '@/features/clinical-library/domain/forms/clinicalFormCatalog';

const { saveAs, print } = vi.hoisted(() => ({ saveAs: vi.fn(), print: vi.fn() }));
vi.mock('file-saver', () => ({ saveAs }));
vi.mock('@/features/clinical-library/services/libraryDocumentActions', () => ({
  printLibraryDocument: print,
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const bytes = new Uint8Array([37, 80, 68, 70]);
const form = getClinicalForm('informe-traslado-hospital-salvador');
const setup = () => {
  const generate = vi.fn().mockResolvedValue(bytes);
  const generateDocx = vi.fn().mockResolvedValue(new Uint8Array([80, 75]));
  const notice = vi.fn();
  const view = renderHook(
    ({ source }) =>
      useClinicalFormPdf(
        form,
        { paciente_nombre_completo: 'PACIENTE SINTÉTICO' },
        [],
        source,
        generate,
        notice,
        generateDocx
      ),
    { initialProps: { source: 'episode-a' }, wrapper: StrictMode }
  );
  return { ...view, generate, generateDocx, notice };
};

describe('clinical form export lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:synthetic-form'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('reuses the reviewed PDF bytes for preview, download and print', async () => {
    const view = setup();
    await act(async () => {
      await view.result.current.prepare();
    });
    expect(view.result.current.currentPdf?.bytes).toBe(bytes);
    await act(async () => {
      await view.result.current.download();
    });
    act(() => view.result.current.print());
    expect(view.generate).toHaveBeenCalledOnce();
    expect(saveAs).toHaveBeenCalledWith(expect.any(Blob), `${form.id}-imprimible.pdf`);
    expect(print).toHaveBeenCalledWith('blob:synthetic-form');
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-form');
  });

  it.each(['prepare', 'download', 'downloadDocx'] as const)(
    'accepts only one %s action before React commits its busy state',
    async action => {
      const view = setup();
      await act(async () => {
        await Promise.all([view.result.current[action](), view.result.current[action]()]);
      });
      expect(action === 'downloadDocx' ? view.generateDocx : view.generate).toHaveBeenCalledOnce();
      expect(saveAs).toHaveBeenCalledTimes(action === 'prepare' ? 0 : 1);
      expect(view.result.current.busy).toBe(false);
    }
  );

  it('locks cached PDF downloads too and releases the lock after a save error', async () => {
    const view = setup();
    await act(async () => {
      await view.result.current.prepare();
    });
    saveAs.mockImplementationOnce(() => {
      throw new Error('synthetic download failure');
    });
    await act(async () => {
      await Promise.all([view.result.current.download(), view.result.current.download()]);
    });
    expect(saveAs).toHaveBeenCalledOnce();
    expect(view.result.current.busy).toBe(false);
    await act(async () => {
      await view.result.current.download();
    });
    expect(saveAs).toHaveBeenCalledTimes(2);
    expect(view.generate).toHaveBeenCalledOnce();
  });

  it('does not download a cached PDF after the editor closes', async () => {
    const view = setup();
    await act(async () => {
      await view.result.current.prepare();
    });
    let pending!: Promise<unknown>;
    act(() => {
      pending = view.result.current.download();
    });
    view.unmount();
    await act(async () => {
      await pending;
    });
    expect(saveAs).not.toHaveBeenCalled();
  });

  it.each(['prepare', 'download', 'downloadDocx'] as const)(
    'discards %s after an intervening context change, even when the original context returns',
    async action => {
      const view = setup();
      const pending = deferred<Uint8Array>();
      (action === 'downloadDocx' ? view.generateDocx : view.generate).mockReturnValueOnce(
        pending.promise
      );
      let operation!: Promise<unknown>;
      act(() => {
        operation = view.result.current[action]();
      });
      view.rerender({ source: 'episode-b' });
      view.rerender({ source: 'episode-a' });
      await act(async () => {
        pending.resolve(bytes);
        await operation;
      });
      expect(saveAs).not.toHaveBeenCalled();
      expect(view.result.current.currentPdf).toBeNull();
      expect(view.notice).toHaveBeenCalledWith(expect.stringContaining('datos cambiaron'));
      expect(view.result.current.busy).toBe(false);
      await act(async () => {
        await view.result.current[action]();
      });
      expect(action === 'downloadDocx' ? view.generateDocx : view.generate).toHaveBeenCalledTimes(
        2
      );
    }
  );

  it.each(['download', 'downloadDocx'] as const)(
    'ignores a failed %s after unmount and does not publish a stale notice',
    async action => {
      const view = setup();
      const pending = deferred<Uint8Array>();
      (action === 'downloadDocx' ? view.generateDocx : view.generate).mockReturnValueOnce(
        pending.promise
      );
      let operation!: Promise<unknown>;
      act(() => {
        operation = view.result.current[action]();
      });
      view.unmount();
      view.notice.mockClear();
      await act(async () => {
        pending.reject(new Error('synthetic late failure'));
        await operation;
      });
      expect(view.notice).not.toHaveBeenCalled();
      expect(saveAs).not.toHaveBeenCalled();
    }
  );

  it('invalidates printing and releases a preview when its context changes', async () => {
    const view = setup();
    await act(async () => {
      await view.result.current.prepare();
    });
    const stalePrint = view.result.current.print;
    view.rerender({ source: 'episode-b' });
    act(() => stalePrint());
    expect(print).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-form');
    view.rerender({ source: 'episode-a' });
    expect(view.result.current.currentPdf).toBeNull();
  });
});
