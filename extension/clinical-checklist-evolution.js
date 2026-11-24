// Only write into an unambiguous native evolution editor. Signing stays in Eloísa.
(() => {
  const selector = 'textarea:not(:disabled):not([readonly]),[contenteditable="true"]:not([aria-readonly="true"])';
  const visible = el => !el.closest('[hidden],[inert],[aria-hidden="true"],[data-hhr-checklist]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const dialogs = () => Array.from(document.querySelectorAll('dialog[open],[role="dialog"]')).filter(visible);
  const evolutionDialog = dialog => {
    const label = [dialog.getAttribute('aria-label'), ...String(dialog.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent),
      dialog.querySelector('h1,h2,h3,.MuiDialogTitle-root')?.textContent].filter(Boolean).join(' ');
    return /\bevoluci[oó]n(?:\s|$)/i.test(label) && !/historial/i.test(label);
  };
  function editor() {
    const open = dialogs();
    const scopes = open.length ? open.filter(evolutionDialog) : [document.querySelector('#observationEntrySection')].filter(Boolean);
    if (open.length && (open.length !== 1 || scopes.length !== 1)) return null;
    const candidates = scopes.flatMap(el => [...el.querySelectorAll(selector)]).filter(visible);
    return candidates.length === 1 ? candidates[0] : null;
  }
  function newEvolutionControl() {
    const section = document.getElementById('observationEntrySection');
    if (!section || dialogs().length) return null;
    const actions = [...section.querySelectorAll('button:not(:disabled),[role=button]:not([aria-disabled=true])')].filter(el => {
      if (!visible(el)) return false;
      return [el.getAttribute('aria-label'), el.title, el.textContent].some(name =>
        /^(?:nueva|crear|redactar|agregar|añadir) (?:una )?evolución$/i.test((name || '').trim()));
    });
    return actions.length === 1 ? actions[0] : null;
  }
  async function openEditor(isCurrent) {
    if (editor()) return true;
    const control = newEvolutionControl();
    if (!control) return false;
    return new Promise(resolve => {
      const finish = found => { observer.disconnect(); clearTimeout(timer); resolve(found); };
      const check = () => { if (!isCurrent()) finish(false); else if (editor()) finish(true); };
      const observer = new MutationObserver(check);
      const timer = setTimeout(() => finish(Boolean(isCurrent() && editor())), 2500);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open','hidden','inert','aria-hidden'] });
      control.click();
      check();
    });
  }
  function insert(record) {
    const el = editor();
    if (!el || typeof record?.evolution !== 'string' || !record.code) return false;
    const marker = 'Código de verificación: ' + record.code;
    if (!record.evolution.split('\n').includes(marker)) return false;
    const isTextArea = el instanceof HTMLTextAreaElement;
    const previous = isTextArea ? el.value : el.innerText;
    if (previous.split('\n').includes(marker)) return true;
    const value = (previous.trim() ? '\n\n' : '') + record.evolution;
    if (isTextArea) {
      if (el.maxLength >= 0 && (previous + value).length > el.maxLength) return false;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, previous + value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el); range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand('insertText', false, value)) return false;
    }
    const after = isTextArea ? el.value : el.innerText;
    return after.split('\n').includes(marker);
  }
  globalThis.HhrChecklistEvolution = { editor, openEditor, insert, evolutionDialog };
})();
