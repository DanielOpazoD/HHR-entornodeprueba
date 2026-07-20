/**
 * Direct, session-bound bridge for the internal Syslab portal.
 *
 * Runs only on http://10.4.69.90/syslab/*. The user authenticates in the official
 * portal inside the extension's hidden document; this isolated-world script receives credentials
 * only for the duration of the login message and never persists them. It then automates the RUT
 * search and fetches reports with the browser session already established.
 */
(function () {
  'use strict';

  if (window.__HHR_SYSLAB_BRIDGE__) return;
  window.__HHR_SYSLAB_BRIDGE__ = true;

  const SYSLAB_ORIGIN = 'http://10.4.69.90';
  const SYSLAB_PATH_PREFIX = '/syslab/';
  const MAX_BODY_BYTES = 6 * 1024 * 1024;
  const REQUEST_TIMEOUT_MS = 30_000;
  const DETAILS_CONCURRENCY = 3;
  const BRIDGE_ID = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `syslab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; // HTTP fallback; correlation only.
  const FRAME_REQUEST = 'HHR_SYSLAB_FRAME_REQUEST';
  const FRAME_RESULT = 'HHR_SYSLAB_FRAME_RESULT';
  const EXTENSION_ORIGIN = chrome.runtime.getURL('').replace(/\/$/, '');
  const cleanText = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const normalizeRutBody = value => self.HhrLabViewer.normalizeRutBody(value);
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const isAllowedSyslabUrl = value => {
    try {
      const url = new URL(String(value || ''), location.href);
      return url.origin === SYSLAB_ORIGIN &&
        url.pathname.startsWith(SYSLAB_PATH_PREFIX);
    } catch (_error) {
      return false;
    }
  };
  const isAllowedReportUrl = value => {
    if (!isAllowedSyslabUrl(value)) return false;
    return /\/detalleexamenes\.php$/i.test(new URL(String(value), location.href).pathname);
  };
  const loginRequired = () => Boolean(
    document.querySelector('input[name="password"], input[type="password"]')
  );

  const submitLogin = (username, password) => {
    const passwordInput = document.querySelector('input[name="password"], input[type="password"]');
    const usernameInput = document.querySelector(
      'input[name="username"], input[name="usuario"], input[name="user"], input[name*="usu" i], input[type="text"]'
    );
    if (!usernameInput || !passwordInput) {
      return { error: 'El formulario oficial de acceso a Syslab no está disponible.' };
    }
    dispatchFieldValue(usernameInput, username);
    dispatchFieldValue(passwordInput, password);
    if (!submitFormControl(passwordInput, /iniciar\s+sesi[oó]n|ingresar|entrar|aceptar/i)) {
      return { error: 'No se encontró el botón de acceso de Syslab.' };
    }
    return { ok: true, bridgeId: BRIDGE_ID, navigated: true };
  };

  const dispatchFieldValue = (input, value) => {
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const clickableByText = pattern => Array.from(document.querySelectorAll(
    'input[type="submit"], input[type="button"], button, a'
  )).find(element => pattern.test(cleanText(element.value || element.textContent)));
  const submitFormControl = (input, pattern) => {
    const form = input.closest('form');
    const controls = Array.from((form || document).querySelectorAll('input[type="submit"], input[type="button"], button, a'));
    const submit = controls.find(element => pattern.test(cleanText(element.value || element.textContent))) ||
      controls.find(element => /submit/i.test(element.type || '')) || (!form && clickableByText(pattern));
    if (!submit && !form) return false;
    setTimeout(() => submit ? submit.click() : typeof form.requestSubmit === 'function' ? form.requestSubmit() : form.submit(), 0);
    return true;
  };
  const extractExams = () => Array.from(document.querySelectorAll('table.narrow tr'))
    .map(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 6) return null;
      const anchor = cells[0].querySelector('a');
      const id = cleanText(anchor ? anchor.textContent : cells[0].textContent);
      const rawLink = anchor && anchor.getAttribute('href');
      if (!/^\d+$/.test(id) || !rawLink) return null;
      let link;
      try {
        link = new URL(rawLink, location.href).href;
      } catch (_error) {
        return null;
      }
      if (!isAllowedReportUrl(link)) return null;
      const dateParts = String(cells[1].innerHTML || '').split(/<br\s*\/?\s*>/i);
      const rutMatch = cleanText(cells[2].textContent).match(/\d[\d.]*/);
      return {
        id,
        link,
        date: cleanText(dateParts[0] || cells[1].textContent),
        time: cleanText((dateParts[1] || '').replace(/<[^>]+>/g, '')),
        rutBody: rutMatch ? rutMatch[0].replace(/\D/g, '') : '',
        patientName: cleanText(cells[3].textContent),
        origin: cleanText(cells[4].textContent),
        exams: Array.from(cells[5].querySelectorAll('.mitabla tr td'))
          .map(cell => cleanText(cell.textContent).replace(/\((?:V|P)\)/g, '').trim())
          .filter(Boolean),
      };
    })
    .filter(Boolean);

  const readBytesWithLimit = async response => {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      if (response.body) await response.body.cancel().catch(() => {});
      throw new Error('El informe supera el límite seguro de 6 MB.');
    }
    if (!response.body || typeof response.body.getReader !== 'function') {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_BODY_BYTES) throw new Error('El informe supera el límite seguro de 6 MB.');
      return new Uint8Array(buffer);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > MAX_BODY_BYTES) throw new Error('El informe supera el límite seguro de 6 MB.');
        chunks.push(chunk.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  };

  const fetchReport = async (url, { allowNestedResource = false } = {}) => {
    if (!(allowNestedResource ? isAllowedSyslabUrl(url) : isAllowedReportUrl(url))) {
      throw new Error('Syslab entregó una ruta de informe no permitida.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Syslab respondió HTTP ' + response.status + '.');
      const contentType = cleanText(response.headers.get('content-type')).toLowerCase();
      const bytes = await readBytesWithLimit(response);
      if (!bytes.byteLength) throw new Error('Syslab devolvió un informe vacío.');
      return { bytes, contentType, finalUrl: response.url || url };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Syslab demoró demasiado en responder.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  let pdfModulePromise = null;
  const loadPdfModule = async () => {
    if (!pdfModulePromise) {
      pdfModulePromise = import(chrome.runtime.getURL('pdf.min.mjs')).then(module => {
        module.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs');
        return module;
      });
    }
    return pdfModulePromise;
  };

  const pdfBytesToText = async bytes => {
    const pdfjs = await loadPdfModule();
    const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
    const document = await loadingTask.promise;
    const lines = [];
    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const rows = new Map();
        for (const item of content.items || []) {
          if (!item || typeof item.str !== 'string') continue;
          const y = item.transform && Number(item.transform[5]);
          const x = item.transform && Number(item.transform[4]);
          const rowKey = Number.isFinite(y) ? Math.round(y * 2) / 2 : rows.size;
          if (!rows.has(rowKey)) rows.set(rowKey, []);
          rows.get(rowKey).push({ x: Number.isFinite(x) ? x : 0, text: item.str });
        }
        [...rows.entries()].sort((left, right) => right[0] - left[0]).forEach(([, row]) => {
          lines.push(row.sort((left, right) => left.x - right.x).map(item => item.text).join(' '));
        });
      }
      return lines.join('\n');
    } finally {
      await document.destroy();
    }
  };

  const htmlReportMaterial = async report => {
    const html = new TextDecoder('utf-8').decode(report.bytes);
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const candidate = parsed.querySelector(
      'iframe[src], embed[src], object[data], a[href*=".pdf"], a[href*="detalleexamenes.php"]'
    );
    const nestedValue = candidate && (candidate.getAttribute('src') || candidate.getAttribute('data') || candidate.getAttribute('href'));
    if (nestedValue) {
      const nestedUrl = new URL(nestedValue, report.finalUrl).href;
      if (nestedUrl !== report.finalUrl && isAllowedSyslabUrl(nestedUrl)) {
        const nested = await fetchReport(nestedUrl, { allowNestedResource: true });
        if (nested.contentType.includes('pdf') || String.fromCharCode(...nested.bytes.slice(0, 4)) === '%PDF') {
          return { text: await pdfBytesToText(nested.bytes), report: nested };
        }
      }
    }
    if (!parsed.body) return { text: '', report };
    parsed.body.querySelectorAll('br').forEach(element => element.replaceWith('\n'));
    parsed.body.querySelectorAll('p, div, tr, li, h1, h2, h3, h4, section, table')
      .forEach(element => element.append('\n'));
    const text = String(parsed.body.textContent || '')
      .split(/\r?\n/)
      .map(cleanText)
      .filter(Boolean)
      .join('\n');
    return { text, report };
  };

  const resolveReportMaterial = async report => {
    const signature = String.fromCharCode(...report.bytes.slice(0, 4));
    if (report.contentType.includes('pdf') || signature === '%PDF') {
      return { text: await pdfBytesToText(report.bytes), report };
    }
    return htmlReportMaterial(report);
  };

  const bytesToBase64 = bytes => {
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  };

  const processReport = async (exam, expectedRutBody, { includeValidatedPdf = false } = {}) => {
    const report = await fetchReport(exam.link);
    const material = await resolveReportMaterial(report);
    const text = material.text;
    const rutBody = self.HhrLabViewer.extractRutBodyFromReportText(text);
    if (!rutBody || rutBody !== expectedRutBody) {
      throw new Error('El informe no corresponde al RUN solicitado.');
    }
    const detail = {
      examId: String(exam.id),
      rutBody,
      findings: self.HhrLabViewer.parseReportText(text),
    };
    if (includeValidatedPdf) {
      const signature = String.fromCharCode(...material.report.bytes.slice(0, 4));
      if (signature !== '%PDF') throw new Error('El informe validado no está disponible como PDF.');
      detail.pdfBase64 = bytesToBase64(material.report.bytes);
    }
    return detail;
  };

  const mapWithConcurrency = async (items, concurrency, mapper) => {
    const output = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        output[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    });
    await Promise.all(workers);
    return output;
  };

  const handleMessage = async message => {
    if (!message || typeof message.type !== 'string') return null;
    if (message.type === 'RAYEN_SYSLAB_STATUS') {
      return { ok: true, bridgeId: BRIDGE_ID, loginRequired: loginRequired(), url: location.href };
    }
    if (message.type === 'RAYEN_SYSLAB_LOGIN') {
      const username = cleanText(message.username);
      const password = String(message.password || '');
      if (!username || !password || username.length > 120 || password.length > 256) {
        return { error: 'Ingresa un usuario y una contraseña válidos.' };
      }
      if (!loginRequired()) {
        return { ok: true, bridgeId: BRIDGE_ID, loginRequired: false, navigated: false };
      }
      return submitLogin(username, password);
    }
    if (message.type === 'RAYEN_SYSLAB_PREPARE_SEARCH') {
      if (loginRequired()) return { error: 'Debes iniciar sesión en el cuadro de Syslab de la extensión.' };
      if (document.querySelector('input[name="rut"]')) {
        return { ok: true, bridgeId: BRIDGE_ID, navigated: false };
      }
      const searchButton = clickableByText(/b[úu]squeda\s+por\s+rut|\brut\b/i);
      if (!searchButton) return { error: 'No se encontró la opción Búsqueda por RUT en Syslab.' };
      setTimeout(() => searchButton.click(), 0);
      return { ok: true, bridgeId: BRIDGE_ID, navigated: true };
    }
    if (message.type === 'RAYEN_SYSLAB_SUBMIT_SEARCH') {
      const rutBody = normalizeRutBody(message.rutBody);
      const input = document.querySelector('input[name="rut"]') ||
        Array.from(document.querySelectorAll('input[type="text"]')).find(field => !/usuario/i.test(field.name || ''));
      if (!input || !/^\d{5,9}$/.test(rutBody)) return { error: 'El formulario de búsqueda por RUT no está disponible.' };
      dispatchFieldValue(input, rutBody);
      if (!submitFormControl(input, /aceptar|buscar|consultar/i)) return { error: 'No se pudo enviar la búsqueda por RUT en Syslab.' };
      return { ok: true, bridgeId: BRIDGE_ID, navigated: true };
    }
    if (message.type === 'RAYEN_SYSLAB_READ_RESULTS') {
      const rutBody = normalizeRutBody(message.rutBody);
      const exams = extractExams();
      if (!self.HhrLabViewer.examRowsMatchRut(exams, rutBody)) {
        return { error: 'Syslab devolvió órdenes que no corresponden al RUN consultado.' };
      }
      return { ok: true, rutBody, exams };
    }
    if (message.type === 'RAYEN_SYSLAB_READ_DETAILS') {
      const rutBody = normalizeRutBody(message.rutBody);
      const exams = Array.isArray(message.exams) ? message.exams : [];
      if (!/^\d{5,9}$/.test(rutBody) || !exams.length || exams.length > 24) {
        return { error: 'La selección de informes no es válida.' };
      }
      const details = await mapWithConcurrency(exams, DETAILS_CONCURRENCY, exam => processReport(exam, rutBody));
      return { ok: true, rutBody, details };
    }
    if (message.type === 'RAYEN_SYSLAB_VALIDATE_REPORT') {
      const rutBody = normalizeRutBody(message.rutBody);
      const detail = await processReport(
        { id: message.examId, link: message.link },
        rutBody,
        { includeValidatedPdf: true }
      );
      return { ok: true, rutBody: detail.rutBody, pdfBase64: detail.pdfBase64 };
    }
    return null;
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    Promise.resolve(handleMessage(message)).then(sendResponse, error => {
      sendResponse({ error: String((error && error.message) || error) });
    });
    return true;
  });

  // When Syslab runs inside the extension's hidden offscreen iframe there is no visible tab id.
  // Relay the same session-bound operations to the extension parent without exposing them to any
  // unrelated origin. Credentials remain transient and are submitted only to Syslab's own form.
  window.addEventListener('message', event => {
    if (window.parent === window || event.source !== window.parent || event.origin !== EXTENSION_ORIGIN) return;
    const data = event.data || {};
    if (data.type !== FRAME_REQUEST || !/^[0-9a-f-]{36}$/i.test(String(data.reqId || ''))) return;
    Promise.resolve(handleMessage(data.message)).then(
      response => window.parent.postMessage({
        type: FRAME_RESULT,
        reqId: data.reqId,
        response: response || { error: 'La operación de Syslab no es válida.' },
      }, EXTENSION_ORIGIN),
      error => window.parent.postMessage({
        type: FRAME_RESULT,
        reqId: data.reqId,
        response: { error: String((error && error.message) || error) },
      }, EXTENSION_ORIGIN)
    );
  });
})();
