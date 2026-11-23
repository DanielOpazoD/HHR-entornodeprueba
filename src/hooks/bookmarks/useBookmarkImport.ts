import { useCallback, useRef, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import { importBookmarksFromJson } from '@/services/bookmarks/bookmarkService';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

interface UseBookmarkImportResult {
  fileInputRef: RefObject<HTMLInputElement | null>;
  openFilePicker: () => void;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  isImporting: boolean;
}

export const useBookmarkImport = (): UseBookmarkImportResult => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);

    try {
      const content = await file.text();
      if (typeof content !== 'string') {
        throw new Error('Invalid file content for bookmark import');
      }

      await importBookmarksFromJson(content);
      defaultBrowserWindowRuntime.alert('Marcadores importados con éxito');
    } catch (_error) {
      defaultBrowserWindowRuntime.alert('Error al importar marcadores');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, []);

  return {
    fileInputRef,
    openFilePicker,
    handleFileChange,
    isImporting,
  };
};
