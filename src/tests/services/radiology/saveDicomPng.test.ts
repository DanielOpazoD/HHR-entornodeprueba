import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveAs } from 'file-saver';
import { saveDicomPng } from '@/services/radiology/saveDicomPng';
import type { DicomCapture } from '@/services/radiology/dicomTypes';
vi.mock('file-saver', () => ({ saveAs: vi.fn() }));
const capture = vi.fn().mockResolvedValue({ png: new Uint8Array([1, 2, 3]) } as DicomCapture);
describe('DICOM capture download', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'showSaveFilePicker');
    vi.clearAllMocks();
  });
  it('requests the Desktop picker before asynchronous capture and writes only the selected PNG', async () => {
    const write = vi.fn();
    const close = vi.fn();
    const picker = vi
      .fn()
      .mockResolvedValue({ createWritable: vi.fn().mockResolvedValue({ write, close }) });
    Object.assign(window, { showSaveFilePicker: picker });
    const promise = saveDicomPng(capture);
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ startIn: 'desktop' }));
    expect(capture).not.toHaveBeenCalled();
    await promise;
    expect(write).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
  it('uses a normal browser download when the picker is unavailable and respects cancellation', async () => {
    await saveDicomPng(capture);
    expect(saveAs).toHaveBeenCalledWith(expect.any(Blob), 'captura-dicom.png');
    capture.mockClear();
    Object.assign(window, {
      showSaveFilePicker: vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError')),
    });
    await expect(saveDicomPng(capture)).rejects.toHaveProperty('name', 'AbortError');
    expect(capture).not.toHaveBeenCalled();
  });
});
