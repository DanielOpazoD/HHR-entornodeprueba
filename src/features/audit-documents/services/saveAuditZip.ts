interface SavePickerWindow extends Window {
  showSaveFilePicker?: (options: object) => Promise<{
    name: string;
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
}

/**
 * The browser's own download. Written here, not imported: the audit chunk pulls in what it
 * imports, and shared helpers moved into it broke the offline screens that use them.
 */
const downloadInBrowser = (archive: Blob, filename: string) => {
  const url = URL.createObjectURL(archive);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/**
 * Saves the ZIP where the person chooses. Call it from the click itself: the browser opens its
 * picker only during a gesture. A browser without a picker uses its own download. Returns the name
 * of the saved file, or null when the person closed the picker.
 */
export const saveAuditZip = async (archive: Blob, filename: string): Promise<string | null> => {
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  if (!picker) {
    downloadInBrowser(archive, filename);
    return filename;
  }
  let handle: Awaited<ReturnType<NonNullable<SavePickerWindow['showSaveFilePicker']>>>;
  try {
    handle = await picker.call(window, {
      suggestedName: filename,
      types: [{ description: 'Archivo ZIP', accept: { 'application/zip': ['.zip'] } }],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
  const file = await handle.createWritable();
  await file.write(archive);
  await file.close();
  return handle.name;
};
