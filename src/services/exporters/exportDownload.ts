import { downloadBlob as triggerBlobDownload } from '@/utils/downloadBlob';

export const downloadBlob = (blob: Blob, filename: string): void => {
  triggerBlobDownload(blob, filename);
};
