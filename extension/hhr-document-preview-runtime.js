/** In-panel document preview; PDF code loads only when a PDF is requested. */
(() => {
  'use strict';
  let library;
  const loadLibrary = () => library || (library = (async () => {
    // Reuse PDF.js's supported main-thread transport, avoiding page-origin worker CSP.
    globalThis.pdfjsWorker = await import(chrome.runtime.getURL('pdf.worker.min.mjs'));
    return import(chrome.runtime.getURL('pdf.min.mjs'));
  })().catch(error => { library = null; throw error; }));
  const printHtml = html => new Promise((resolve, reject) => {
    const popup = window.open('', '_blank');
    if (!popup) { reject(new Error('Chrome bloqueó la impresión. Permite las ventanas emergentes y reintenta.')); return; }
    popup.opener = null;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      try {
        if (popup.closed) throw new Error('Se cerró la pestaña de impresión.');
        popup.focus(); popup.print(); resolve();
      } catch (error) { reject(error); }
    };
    popup.addEventListener('load', start, { once: true });
    popup.document.open(); popup.document.write(html); popup.document.close();
    window.setTimeout(start, 300);
  });
  const renderFormats = ({ host, name, checkedFormat = globalThis.HhrCenterPreferences?.get().printFormat || 'standard' }) => {
    const formatTitle = document.createElement('div');
    formatTitle.className = 'hhr-rx-format-title';
    formatTitle.textContent = 'Formato de impresión';
    const formats = document.createElement('div');
    formats.className = 'hhr-rx-formats';
    const addFormat = ({ value, title, meta }) => {
      const label = document.createElement('label');
      label.className = 'hhr-rx-format-option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = name;
      input.value = value;
      input.checked = value === checkedFormat;
      const details = document.createElement('span');
      const optionTitle = document.createElement('span');
      optionTitle.className = 'hhr-rx-date';
      optionTitle.textContent = title;
      const optionMeta = document.createElement('span');
      optionMeta.className = 'hhr-rx-meta';
      optionMeta.textContent = meta;
      details.append(optionTitle, optionMeta);
      label.append(input, details);
      formats.appendChild(label);
    };
    addFormat({
      value: 'standard',
      title: 'Estándar',
      meta: 'Documento oficial con lectura amplia',
    });
    addFormat({
      value: 'compact',
      title: 'Compacta',
      meta: 'Mismo contenido, hasta 22 fármacos por hoja',
    });
    formats.setAttribute('role', 'radiogroup');
    formats.setAttribute('aria-label', 'Formato de impresión');
    host.replaceChildren(formatTitle, formats);
    host.hidden = false;
    formats.addEventListener('change', () => {
      const selected = formats.querySelector('input:checked');
      if (selected) globalThis.HhrCenterPreferences?.save({ printFormat: selected.value });
    });
    return formats;
  };
  const notes = result => (result?.skipped?.length ? ' ' + result.skipped.length +
    (result.skipped.length === 1 ? ' paciente no se pudo incluir.' : ' pacientes no se pudieron incluir.') : '') +
    (result?.compactFallbacks?.length ? ' Se conservó el formato oficial en ' + result.compactFallbacks.length +
      (result.compactFallbacks.length === 1 ? ' receta' : ' recetas') + ' para mantener su contenido.' : '');
  const open = ({ root, title, load, sendMessage, runtimeMessages, printDirect, loadPdfLibrary = loadLibrary, format = 'standard', formats = false }) => {
    root.__hhrDocumentPreview?.dispose();
    const main = root.querySelector('.hhr-center-main');
    const section = document.createElement('section');
    section.className = 'hhr-document-preview';
    section.setAttribute('aria-label', 'Vista previa de ' + title);
    section.innerHTML = `
      <header class="hhr-preview-header"><strong></strong>
        <button class="hhr-center-action" type="button" data-preview="back">Volver</button>
        <button class="hhr-center-action hhr-center-action-primary" type="button" data-preview="print" disabled>Imprimir</button>
      </header>
      <div class="hhr-preview-formats" role="group" aria-label="Formato de la vista previa" ${formats ? '' : 'hidden'}>
        <button class="hhr-center-action" type="button" data-format="standard">Estándar</button>
        <button class="hhr-center-action" type="button" data-format="compact">Compacta</button>
      </div>
      <div class="hhr-preview-page-controls" hidden>
        <button class="hhr-center-action" type="button" data-page="-1" aria-label="Página anterior">‹</button>
        <span></span><button class="hhr-center-action" type="button" data-page="1" aria-label="Página siguiente">›</button>
      </div>
      <div class="hhr-preview-pages" hidden></div>
      <iframe class="hhr-preview-html" title="Documento para imprimir" sandbox="allow-same-origin allow-modals" hidden></iframe>
      <div class="hhr-preview-status" role="status" aria-live="polite">Preparando vista previa…</div>`;
    section.querySelector('strong').textContent = title;
    const previousFocus = document.activeElement;
    const inactive = new Map(Array.from(main.children).map(child => [child, child.inert]));
    inactive.forEach((_value, child) => { child.inert = true; });
    main.append(section);
    const print = section.querySelector('[data-preview="print"]');
    const status = section.querySelector('[role="status"]');
    const frame = section.querySelector('iframe');
    const pages = section.querySelector('.hhr-preview-pages');
    const controls = section.querySelector('.hhr-preview-page-controls');
    const context = root.dataset.selectedEncounterId || root.dataset.encounterId || '';
    let generation = 0;
    let pdf = null;
    let task = null;
    let rendering = null;
    let prepared = null;
    let pageNumber = 1;
    let disposed = false;
    let retry = false;
    let direct = false;
    const current = () => !disposed && section.isConnected &&
      (root.dataset.selectedEncounterId || root.dataset.encounterId || '') === context;
    const release = result => {
      if (result?.jobId) void sendMessage({ type: runtimeMessages.DOCUMENT_PREVIEW_REQUEST,
        jobId: result.jobId, operation: 'release' });
    };
    const stopPdf = () => {
      rendering?.cancel(); rendering = null;
      if (task) void task.destroy().catch(() => {});
      task = null; pdf = null;
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true; generation += 1;
      stopPdf(); release(prepared); prepared = null;
      observer.disconnect(); section.remove(); frame.srcdoc = '';
      inactive.forEach((value, child) => { child.inert = value; });
      if (root.__hhrDocumentPreview?.dispose === dispose) delete root.__hhrDocumentPreview;
    };
    const renderPage = async request => {
      if (!pdf || !current()) return;
      rendering?.cancel();
      const documentPdf = pdf;
      const number = pageNumber;
      const page = await documentPdf.getPage(number);
      if (!current() || request !== generation || documentPdf !== pdf || number !== pageNumber) return;
      const viewport = page.getViewport({ scale: Math.min(1.5, devicePixelRatio || 1) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      pages.replaceChildren(canvas);
      rendering = page.render({ canvasContext: canvas.getContext('2d'), viewport });
      await rendering.promise;
      if (!current() || request !== generation || number !== pageNumber) return;
      controls.querySelector('span').textContent = number + ' / ' + documentPdf.numPages;
      controls.querySelector('[data-page="-1"]').disabled = number === 1;
      controls.querySelector('[data-page="1"]').disabled = number === documentPdf.numPages;
    };
    const prepare = async nextFormat => {
      const request = ++generation;
      format = nextFormat;
      retry = false;
      direct = false;
      stopPdf(); release(prepared); prepared = null;
      print.disabled = true; print.textContent = 'Imprimir';
      status.textContent = 'Preparando vista previa…';
      section.querySelectorAll('[data-format]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.format === format)));
      pages.hidden = true; frame.hidden = true; controls.hidden = true;
      try {
        const result = await load(format);
        if (!current() || request !== generation) { release(result); return; }
        if (['PREVIEW_TOO_LARGE', 'PREVIEW_STORAGE_UNAVAILABLE'].includes(result?.errorCode) && typeof printDirect === 'function') {
          direct = true; print.disabled = false; print.textContent = 'Imprimir sin vista previa';
          status.textContent = result.error + ' Puedes imprimirlo directamente.';
          return;
        }
        if (!result || result.error) {
          const error = new Error(result?.error || 'No se pudo preparar la vista previa.'); error.response = result; throw error;
        }
        prepared = result;
        if (result.html) {
          frame.hidden = false;
          frame.onload = () => { if (current() && request === generation) print.disabled = false; };
          frame.srcdoc = result.html;
        } else if (result.pdfBase64 && result.jobId) {
          const pdfjs = await loadPdfLibrary();
          if (!current() || request !== generation) return;
          const bytes = Uint8Array.from(atob(result.pdfBase64), char => char.charCodeAt(0));
          const loading = pdfjs.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false });
          task = loading;
          const loaded = await loading.promise;
          if (!current() || request !== generation) { void loading.destroy().catch(() => {}); return; }
          pdf = loaded;
          pages.hidden = false; pageNumber = 1;
          await renderPage(request);
          if (current() && request === generation) { controls.hidden = false; print.disabled = false; }
        } else throw new Error('La extensión no entregó un documento para visualizar.');
        if (current() && request === generation) status.textContent = 'Documento listo para revisar e imprimir.' + notes(result);
      } catch (error) {
        if (current() && request === generation) {
          status.textContent = error?.message || 'No se pudo preparar el documento.';
          retry = true; print.disabled = false; print.textContent = 'Reintentar vista previa';
          globalThis.HhrReadRecovery?.attach({ root, host: status, response: error.response || { error: error.message },
            isCurrent: () => current() && request === generation, retry: () => prepare(format), sendMessage, runtimeMessages });
        }
      }
    };
    section.querySelector('[data-preview="back"]').addEventListener('click', () => {
      dispose(); if (previousFocus?.isConnected) previousFocus.focus();
    });
    section.querySelectorAll('[data-format]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.format === format) return;
      globalThis.HhrCenterPreferences?.save({ printFormat: button.dataset.format });
      prepare(button.dataset.format);
    }));
    controls.addEventListener('click', event => {
      const step = Number(event.target.closest('[data-page]')?.dataset.page || 0);
      if (controls.hidden || !pdf || !step) return;
      pageNumber = Math.max(1, Math.min(pdf.numPages, pageNumber + step));
      renderPage(generation).catch(error => { if (current() && error?.name !== 'RenderingCancelledException') status.textContent = 'No se pudo mostrar esta página.'; });
    });
    print.addEventListener('click', async () => {
      if (current() && retry) { prepare(format); return; }
      if (!current() || (!prepared && !direct)) return;
      print.disabled = true;
      const request = generation;
      const document = prepared;
      const printingDirect = direct;
      try {
        let printed = document;
        if (printingDirect) {
          printed = await printDirect(format);
          if (printed?.error || !printed) throw new Error(printed?.error || 'No se pudo imprimir.');
        } else if (document.html) await printHtml(document.html);
        else {
          const result = await sendMessage({ type: runtimeMessages.DOCUMENT_PREVIEW_REQUEST, jobId: document.jobId, operation: 'print' });
          if (!current() || request !== generation) return;
          if (!result || result.error) throw new Error(result?.error || 'No se pudo abrir la impresión.');
          prepared = null;
        }
        if (current() && request === generation) { status.textContent = 'Impresión solicitada.' + notes(printed); print.textContent = 'Impresión solicitada'; }
      } catch (error) {
        if (current() && request === generation) {
          status.textContent = error?.message || 'No se pudo imprimir.';
          retry = true; print.disabled = false; print.textContent = 'Preparar de nuevo';
        }
      }
    });
    const observer = new MutationObserver(() => { if (!current()) dispose(); });
    observer.observe(document.body, { childList: true, subtree: true });
    root.__hhrDocumentPreview = { dispose };
    section.querySelector('[data-preview="back"]').focus();
    prepare(format);
    return root.__hhrDocumentPreview;
  };
  const prescription = ({ root, title, sendMessage, runtimeMessages, formatRadios, request, onFormat }) => {
    const send = (printFormat, preview) => sendMessage({ ...request, printFormat, preview });
    return open({ root, title, sendMessage, runtimeMessages, formats: true,
      format: formatRadios.querySelector('input:checked')?.value || 'standard',
      load: format => {
        formatRadios.querySelectorAll('input').forEach(input => { input.checked = input.value === format; });
        onFormat?.(); return send(format, true);
      }, printDirect: format => send(format, false),
    });
  };
  globalThis.HhrDocumentPreviewRuntime = Object.freeze({ open, renderFormats, prescription });
})();
