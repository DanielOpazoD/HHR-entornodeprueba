/**
 * Imprime un documento HTML generado por la app (carátula, hoja rápida) en una
 * pestaña nueva: se escribe el HTML, se espera la carga y se abre el diálogo de
 * impresión. La pestaña queda abierta para reimprimir o guardar como PDF.
 */

import {
  defaultBrowserWindowRuntime,
  type BrowserWindowRuntime,
} from '@/shared/runtime/browserWindowRuntimeCore';

export interface PrintableHtmlDocument {
  title: string;
  /** HTML del <body>; los estilos van en `styles` para poder declarar `@page`. */
  body: string;
  styles: string;
}

export const buildPrintableHtml = (document: PrintableHtmlDocument): string =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(document.title)}</title><style>${document.styles}</style></head><body>${document.body}</body></html>`;

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export type PrintHtmlOutcome = 'printed' | 'blocked';

export const printHtmlDocument = (
  document: PrintableHtmlDocument,
  runtime: BrowserWindowRuntime = defaultBrowserWindowRuntime
): PrintHtmlOutcome => {
  const target = runtime.open('', '_blank');
  if (!target) return 'blocked';
  target.document.open();
  target.document.write(buildPrintableHtml(document));
  target.document.close();
  const print = (): void => {
    target.focus();
    target.print();
  };
  if (target.document.readyState === 'complete') {
    // Las imágenes (logo) pueden seguir cargando: dar un respiro antes de imprimir.
    target.setTimeout(print, 150);
  } else {
    target.addEventListener('load', print, { once: true });
  }
  return 'printed';
};
