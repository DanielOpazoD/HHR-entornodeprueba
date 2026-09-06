/**
 * Acciones de navegador sobre documentos de la biblioteca. No hay persistencia:
 * abrir, imprimir y descargar son operaciones del navegador sobre assets públicos.
 */

import {
  defaultBrowserWindowRuntime,
  type BrowserWindowRuntime,
} from '@/shared/runtime/browserWindowRuntimeCore';

const PRINT_FRAME_CLEANUP_MS = 60_000;

/** `encodeURI` deja pasar `#`, `?` y `+`, que cambiarían la ruta de un archivo que los contenga. */
export const toLibraryDocumentHref = (url: string): string =>
  encodeURI(url).replace(/[#?+]/g, character => encodeURIComponent(character));

/** WebKit imprime en blanco el PDF de un iframe oculto: ahí conviene el visor de la pestaña nueva. */
export const canPrintInline = (runtimeNavigator: Navigator | undefined): boolean => {
  if (!runtimeNavigator) return true;
  const viewer = (runtimeNavigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled;
  if (viewer === false) return false;
  const agent = runtimeNavigator.userAgent ?? '';
  return !/AppleWebKit/i.test(agent) || /Chrom(e|ium)/i.test(agent);
};

export const openLibraryDocument = (
  url: string,
  runtime: BrowserWindowRuntime = defaultBrowserWindowRuntime
): void => {
  runtime.open(toLibraryDocumentHref(url), '_blank', 'noopener,noreferrer');
};

export interface PrintLibraryDocumentDependencies {
  host?: Document | null;
  runtime?: BrowserWindowRuntime;
  cleanupDelayMs?: number;
  navigator?: Navigator;
}

/**
 * Imprime un PDF o imagen desde un iframe oculto para abrir directamente el
 * diálogo de impresión. Si el navegador no lo permite, abre el documento en
 * una pestaña nueva para imprimir desde el visor.
 */
export const printLibraryDocument = (
  url: string,
  deps: PrintLibraryDocumentDependencies = {}
): HTMLIFrameElement | null => {
  const host =
    deps.host === undefined ? (typeof document !== 'undefined' ? document : null) : deps.host;
  if (!host) return null;
  const runtime = deps.runtime ?? defaultBrowserWindowRuntime;
  const href = toLibraryDocumentHref(url);
  const runtimeNavigator =
    deps.navigator ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  if (!canPrintInline(runtimeNavigator)) {
    runtime.open(href, '_blank', 'noopener,noreferrer');
    return null;
  }
  // Un solo marco de impresión a la vez: un doble clic no debe abrir dos diálogos.
  host.querySelector('iframe[data-library-print-frame]')?.remove();
  const frame = host.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('data-library-print-frame', '');
  frame.title = 'Impresión de documento';
  frame.tabIndex = -1;
  Object.assign(frame.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
  });

  let removed = false;
  const remove = (): void => {
    if (removed) return;
    removed = true;
    frame.remove();
  };

  frame.addEventListener('load', () => {
    const target = frame.contentWindow;
    try {
      if (!target) throw new Error('print frame without window');
      target.addEventListener('afterprint', remove, { once: true });
      target.focus();
      target.print();
    } catch {
      remove();
      runtime.open(href, '_blank', 'noopener,noreferrer');
    }
  });

  frame.src = href;
  host.body.appendChild(frame);
  setTimeout(remove, deps.cleanupDelayMs ?? PRINT_FRAME_CLEANUP_MS);
  return frame;
};
