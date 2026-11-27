import { downloadBlob } from '@/utils/downloadBlob';

export const CLINICAL_TOOL_DRAFT_MAX_BYTES = 1_000_000;
export const CLINICAL_TOOL_PREFERENCES_MAX_BYTES = 100_000;

export const downloadToolJsonFile = (content: string, fileName: string): void => {
  downloadBlob(new Blob([content], { type: 'application/json' }), fileName);
};

interface ReadBoundedToolJsonFileOptions {
  maxBytes: number;
  tooLargeMessage: string;
  readErrorMessage?: string;
}

export const readBoundedToolJsonFile = async (
  file: File,
  { maxBytes, tooLargeMessage, readErrorMessage }: ReadBoundedToolJsonFileOptions
): Promise<string> => {
  if (file.size > maxBytes) {
    throw new Error(tooLargeMessage);
  }
  return file.text().catch(() => {
    throw new Error(readErrorMessage ?? 'No se pudo leer el archivo. Vuelve a intentarlo.');
  });
};
