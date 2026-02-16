import { useCallback, useRef, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import { importBookmarksFromJson } from '@/services/bookmarks/bookmarkService';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntime';
import {
  isFileReaderTextResult,
  resolveBookmarkImportAlertMessage,
} from '@/components/bookmarks/controllers/bookmarkImportController';

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
      if (!isFileReaderTextResult(content)) {
        throw new Error('Invalid file content for bookmark import');
      }

      await importBookmarksFromJson(content);
      defaultBrowserWindowRuntime.alert(resolveBookmarkImportAlertMessage('success'));
    } catch (_error) {
      defaultBrowserWindowRuntime.alert(resolveBookmarkImportAlertMessage('error'));
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
