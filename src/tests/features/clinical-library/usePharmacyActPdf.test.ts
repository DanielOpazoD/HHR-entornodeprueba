import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePharmacyActPdf } from '@/features/clinical-library/components/tools/pharmacy/usePharmacyActPdf';
import { createPharmacyDraft } from '@/features/clinical-library/domain/pharmacy/pharmacyDraft';
import type { PharmacyActDraft } from '@/features/clinical-library/domain/pharmacy/pharmacyTypes';

const { saveAs, print } = vi.hoisted(() => ({ saveAs: vi.fn(), print: vi.fn() }));
vi.mock('file-saver', () => ({ saveAs }));
vi.mock('@/features/clinical-library/services/libraryDocumentActions', () => ({
  printLibraryDocument: print,
}));
vi.mock('@/features/clinical-library/services/pharmacyActPdf', () => ({
  generatePharmacyActPdf: vi.fn(),
}));

const validDraft = (): PharmacyActDraft => {
  const draft = createPharmacyDraft('return', {
    name: 'Profesional de prueba',
    rut: '',
    role: 'Enfermero/a',
    unit: 'Hospitalizados',
  });
  draft.lines[0] = {
    ...draft.lines[0],
    medicationId: 'manual',
    name: 'Medicamento de prueba',
    presentation: 'Comprimido',
    quantity: '2',
    reason: 'Tratamiento suspendido',
  };
  return draft;
};

describe('pharmacy PDF session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:pharmacy-test'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('previews, downloads and prints the same bytes, then invalidates after an edit', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const generate = vi.fn().mockResolvedValue(bytes);
    const draft = validDraft();
    const { result, rerender, unmount } = renderHook(
      ({ value }) => usePharmacyActPdf(value, vi.fn(), generate),
      { initialProps: { value: draft } }
    );
    await act(async () => {
      await result.current.prepare();
    });
    expect(result.current.currentPdf?.bytes).toBe(bytes);
    await act(async () => {
      await result.current.download();
    });
    act(() => result.current.print());
    expect(generate).toHaveBeenCalledOnce();
    expect(saveAs).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.stringContaining('devolucion-farmacos')
    );
    expect(print).toHaveBeenCalledWith('blob:pharmacy-test');
    rerender({ value: { ...draft, paperSize: 'letter' } });
    expect(result.current.currentPdf).toBeNull();
    act(() => result.current.print());
    await act(async () => {
      await result.current.download();
    });
    expect(print).toHaveBeenCalledOnce();
    expect(saveAs).toHaveBeenCalledOnce();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pharmacy-test');
  });

  it('does not publish a PDF completed after the draft changed or the editor unmounted', async () => {
    let complete: ((bytes: Uint8Array) => void) | undefined;
    const generate = vi.fn(
      () =>
        new Promise<Uint8Array>(resolve => {
          complete = resolve;
        })
    );
    const notice = vi.fn();
    const draft = validDraft();
    const { result, rerender, unmount } = renderHook(
      ({ value }) => usePharmacyActPdf(value, notice, generate),
      { initialProps: { value: draft } }
    );
    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.prepare();
    });
    rerender({ value: { ...draft, number: '2' } });
    await act(async () => {
      complete?.(new Uint8Array([1]));
      await pending;
    });
    expect(result.current.currentPdf).toBeNull();
    expect(notice).toHaveBeenCalledWith(expect.stringContaining('datos cambiaron'));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    act(() => {
      pending = result.current.prepare();
    });
    unmount();
    await act(async () => {
      complete?.(new Uint8Array([2]));
      await pending;
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
