(function (root) {
  'use strict';
  const normalizeIdentity = value => String(value || '').replace(/[^0-9kK]/g, '').toUpperCase();
  const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const create = dependencies => {
    const {
      document,
      MutationObserver,
      sendMessage,
      writeClipboard,
      setTimeout,
      clearTimeout,
    } = dependencies;
    let observer = null;
    let timer = null;
    let patients = [];
    let patientsReadAt = 0;
    const readPatients = async () => {
      if (patients.length && Date.now() - patientsReadAt < 20_000) return patients;
      const result = await sendMessage({ type: 'RAYEN_CENSUS_LIST_REQUEST' });
      if (!result || result.error || !Array.isArray(result.patients)) return patients;
      patients = result.patients;
      patientsReadAt = Date.now();
      return patients;
    };
    const patientForRow = (row, candidates) => {
      const explicit = row.getAttribute('data-encounter-id') || row.getAttribute('data-enc-id');
      if (explicit) return candidates.find(patient => String(patient.encounterId) === explicit) || null;
      const rowText = normalizeText(row.textContent);
      const rowIdentity = normalizeIdentity(rowText);
      const identityMatches = candidates.filter(patient => {
        const rut = normalizeIdentity(patient.run);
        return rut && rowIdentity.includes(rut);
      });
      if (identityMatches.length) return identityMatches.length === 1 ? identityMatches[0] : null;
      const nameMatches = candidates.filter(patient => {
        const name = normalizeText(patient.name);
        return name.length >= 8 && rowText.includes(name);
      });
      return nameMatches.length === 1 ? nameMatches[0] : null;
    };

    const copy = async (button, patient) => {
      if (button.disabled) return;
      button.disabled = true;
      const original = button.textContent;
      button.textContent = 'Preparando…';
      try {
        const result = await sendMessage({
          type: 'RAYEN_MANUAL_PATIENT_CODE_REQUEST',
          encId: String(patient.encounterId),
        });
        if (!result || result.error || !result.code) throw new Error(result && result.error || 'No se pudo crear el código.');
        await writeClipboard(result.code);
        button.textContent = 'Copiado ✓';
        button.dataset.state = 'copied';
      } catch (error) {
        button.textContent = 'No se pudo copiar';
        button.title = String(error && error.message || error);
        button.dataset.state = 'error';
      } finally {
        setTimeout(() => {
          button.textContent = original;
          button.disabled = false;
          delete button.dataset.state;
        }, 1800);
      }
    };

    const scan = async () => {
      if (!/encounter-list-nurse/i.test(String(root.location && root.location.pathname || ''))) return;
      const candidates = await readPatients();
      if (!candidates.length) return;
      document.querySelectorAll('tr, [role="row"]').forEach(row => {
        const existing = row.querySelector('[data-hhr-patient-code-action="1"]');
        const patient = patientForRow(row, candidates);
        if (!patient) {
          if (existing) existing.remove();
          return;
        }
        const encounterId = String(patient.encounterId);
        if (existing?.dataset.hhrEncounterId === encounterId) return;
        if (existing) existing.remove();
        const host = row.querySelector('td:last-child, [role="cell"]:last-child') || row;
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.hhrPatientCodeAction = '1';
        button.dataset.hhrEncounterId = encounterId;
        button.textContent = 'Copiar para HHR';
        button.title = 'Copia un código clínico temporal para ingresarlo manualmente en HHR';
        button.style.cssText = 'margin:2px 4px;padding:4px 8px;border:1px solid #0f9f8f;border-radius:6px;background:#effcf9;color:#08786d;font:600 12px/1.2 system-ui;cursor:pointer;white-space:nowrap';
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          void copy(button, patient);
        });
        host.appendChild(button);
      });
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void scan(); }, 180);
    };
    const start = () => {
      if (observer) return;
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, {
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-encounter-id', 'data-enc-id'],
        subtree: true,
      });
      schedule();
    };
    const stop = () => {
      if (observer) observer.disconnect();
      observer = null;
      if (timer) clearTimeout(timer);
      timer = null;
    };
    return Object.freeze({ start, stop, scan, patientForRow });
  };

  const startDefault = () => {
    if (!root.document || !root.chrome?.runtime || !root.navigator?.clipboard) return null;
    const runtime = create({
      document: root.document,
      MutationObserver: root.MutationObserver,
      setTimeout: root.setTimeout.bind(root),
      clearTimeout: root.clearTimeout.bind(root),
      sendMessage: message => new Promise(resolve => {
        root.chrome.runtime.sendMessage(message, response => {
          const runtimeError = root.chrome.runtime.lastError;
          resolve(runtimeError ? { error: runtimeError.message } : response);
        });
      }),
      writeClipboard: code => root.navigator.clipboard.writeText(code),
    });
    runtime.start();
    return runtime;
  };
  const publicApi = Object.freeze({ create, startDefault });
  root.HhrFichaMedicoManualPatientCopy = publicApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = publicApi;
  else startDefault();
})(typeof self !== 'undefined' ? self : globalThis);
