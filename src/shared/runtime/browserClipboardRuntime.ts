import { recordE2EClipboardText } from '@/shared/runtime/e2eRuntime';

export const writeClipboardText = async (text: string): Promise<void> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    recordE2EClipboardText(text);
    if (typeof navigator === 'undefined') {
      return;
    }
    throw new Error('Clipboard API no disponible');
  }

  await navigator.clipboard.writeText(text);
  recordE2EClipboardText(text);
};

export const getNavigatorUserAgent = (): string =>
  typeof navigator !== 'undefined' ? navigator.userAgent : '';

/** Sensitive values must never enter E2E captures or browser storage, including localhost. */
export const writePrivateClipboardText = async (text: string): Promise<void> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    throw new Error('Clipboard API no disponible');
  }
  await navigator.clipboard.writeText(text);
};
