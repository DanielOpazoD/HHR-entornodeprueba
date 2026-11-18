import { fetchMMRADPdfBlob } from './mmradService';
import { getSessionEpoch, onSessionChange } from '@/services/storage/sessionStorageTransition';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

type PdfTarget = { print: boolean } | { download: (blob: Blob) => void };

/** Delivers only within the initiating session, including the delayed print. */
export const deliverMmradPdf = async (
  link: string,
  controller: AbortController,
  target: PdfTarget
): Promise<void> => {
  const epoch = getSessionEpoch();
  const { signal } = controller;
  if (signal.aborted) return;
  const popup = 'download' in target ? null : defaultBrowserWindowRuntime.open('', '_blank');
  if (!('download' in target) && !popup) return;
  const cancel = () => popup?.close();
  signal.addEventListener('abort', cancel, { once: true });
  const unsubscribe = onSessionChange(() => controller.abort());
  const isCurrent = () => !signal.aborted && getSessionEpoch() === epoch;
  try {
    const blob = await fetchMMRADPdfBlob(link, signal);
    if (!isCurrent()) return;
    if ('download' in target) {
      target.download(blob);
    } else if (popup && !popup.closed) {
      const url = URL.createObjectURL(blob);
      try {
        popup.location.href = url;
        popup.focus();
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (target.print) {
        await new Promise<void>(resolve => {
          const timer = window.setTimeout(resolve, 1500);
          signal.addEventListener(
            'abort',
            () => {
              window.clearTimeout(timer);
              resolve();
            },
            { once: true }
          );
        });
        if (isCurrent() && !popup.closed) {
          try {
            popup.focus();
            popup.print();
          } catch {
            // Ignore popup cross-origin print limitations.
          }
        }
      }
    }
  } catch (error) {
    popup?.close();
    if (isCurrent()) throw error;
  } finally {
    unsubscribe();
    signal.removeEventListener('abort', cancel);
  }
};
