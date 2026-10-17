import type { DicomCapture } from '@/services/radiology/dicomTypes';
import { saveAs } from 'file-saver';

interface SavePickerWindow extends Window {
  showSaveFilePicker?: (options: object) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
}

/** Open the picker synchronously in the click gesture, before asynchronous capture. */
export const saveDicomPng = async (capture: () => Promise<DicomCapture>): Promise<void> => {
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  const handle = picker
    ? await picker.call(window, {
        suggestedName: 'captura-dicom.png',
        startIn: 'desktop',
        types: [{ description: 'Imagen PNG', accept: { 'image/png': ['.png'] } }],
      })
    : null;
  const image = await capture();
  const blob = new Blob([new Uint8Array(image.png)], { type: 'image/png' });
  if (handle) {
    const file = await handle.createWritable();
    await file.write(blob);
    await file.close();
  } else {
    saveAs(blob, 'captura-dicom.png');
  }
};
