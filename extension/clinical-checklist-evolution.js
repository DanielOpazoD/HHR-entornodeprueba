// Only write into an unambiguous native evolution editor. Signing stays in Eloísa.
(() => {
  'use strict';
  const selector = [
    'textarea:not(:disabled):not([readonly]):not([aria-hidden="true"])',
    '[contenteditable="true"]:not([aria-readonly="true"])',
    '[contenteditable=""]:not([aria-readonly="true"])',
    '[contenteditable="plaintext-only"]:not([aria-readonly="true"])',
  ].join(',');
  const EXTENSION_OVERLAY = '[data-hhr-checklist],#hhr-prescription-print-modal,#hhr-clinical-page-notices';
  const FORBIDDEN_ACTION = /\b(?:firmar|guardar|publicar|eliminar|borrar|historial|leer mas|ver mas|menu|opciones|cerrar|cancelar)\b/;
  const CREATE_LABEL = /\b(?:nueva|nuevo|crear|redactar|agregar|anadir|escribir|ingresar|registrar|editar)\s+(?:una\s+)?(?:evolucion|observacion|nota)\b/;
  const EDIT_ICON = /^(?:EditNote|PostAdd|NoteAdd|Create|Edit|BorderColor|RateReview|PlaylistAdd|Add|AddCircle)/i;
  const NON_EDIT_ICON = /(?:MoreVert|List|FormatList|History|Visibility|Delete|Save|Check|Close|Cancel)/i;

  const normalize = value =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const visible = el => {
    if (!el || el.closest('[hidden],[inert],[aria-hidden="true"],' + EXTENSION_OVERLAY)) return false;
    if (!el.getClientRects().length) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };

  const isShadowTextarea = el =>
    el instanceof HTMLTextAreaElement &&
    el.getAttribute('tabindex') === '-1' &&
    (el.getAttribute('aria-hidden') === 'true' || el.readOnly);

  const dialogs = () => {
    const raw = Array.from(
      document.querySelectorAll('dialog[open],[role="dialog"],.MuiDialog-paper,.MuiDrawer-paper,.MuiModal-root > .MuiPaper-root')
    ).filter(visible);
    return raw.filter(el => !raw.some(other => other !== el && other.contains(el)));
  };

  const evolutionDialog = dialog => {
    const headingText = Array.from(
      dialog.querySelectorAll('h1,h2,h3,h4,h5,h6,.MuiDialogTitle-root,.MuiTypography-h5,.MuiTypography-h6,.MuiTypography-subtitle1,.MuiCardHeader-title')
    )
      .slice(0, 4)
      .map(el => el.textContent)
      .join(' ');
    const label = [
      dialog.getAttribute('aria-label'),
      ...String(dialog.getAttribute('aria-labelledby') || '')
        .split(/\s+/)
        .map(id => document.getElementById(id)?.textContent),
      headingText,
    ]
      .filter(Boolean)
      .join(' ');
    const folded = normalize(label);
    return /\bevolucion(?:es)?\b/.test(folded) && !/\bhistorial\b/.test(folded);
  };

  const evolutionSection = () => {
    const section = document.getElementById('observationEntrySection');
    if (section && visible(section)) return section;
    const card = document.getElementById('evolution');
    if (card && visible(card) && normalize(card.querySelector('.MuiCardHeader-title')?.textContent) === 'evolucion') {
      return card;
    }
    return null;
  };

  const cardInside = section => {
    if (!section) return null;
    if (section.matches('.MuiCard-root,.MuiPaper-root')) return section;
    return section.querySelector('#evolution,.MuiCard-root,.MuiPaper-root') || section;
  };

  const findActionRow = card => {
    const cardActions = card.querySelector('.MuiCardActions-root');
    if (cardActions && visible(cardActions)) return cardActions;
    const buttons = Array.from(card.querySelectorAll('button,[role="button"]')).filter(
      el =>
        visible(el) &&
        !el.closest('.MuiCardHeader-root,.MuiCardHeader-action') &&
        !/^leer mas$/i.test(normalize(el.textContent))
    );
    for (const btn of buttons) {
      const parent = btn.parentElement;
      if (
        parent &&
        parent !== card &&
        visible(parent) &&
        !parent.querySelector('textarea,[contenteditable]') &&
        !Array.from(parent.children).some(child => child.matches('p,h1,h2,h3,h4,h5,h6') && String(child.textContent || '').trim().length > 24)
      ) {
        return parent;
      }
    }
    return null;
  };

  function resolveTriggerHost(nativeDialog) {
    if (nativeDialog && visible(nativeDialog)) {
      const titleBar = nativeDialog.querySelector('.MuiDialogTitle-root');
      return titleBar && visible(titleBar) ? titleBar : nativeDialog;
    }
    const section = evolutionSection();
    if (!section) return null;
    const card = cardInside(section);
    const actionRow = findActionRow(card);
    if (actionRow) return actionRow;
    const content = card.querySelector('.MuiCardContent-root');
    if (content && visible(content)) return content;
    return card;
  }

  const iframeEditors = scope =>
    Array.from(scope.querySelectorAll('iframe')).flatMap(frame => {
      try {
        const body = frame.contentDocument?.body;
        return visible(frame) && body?.isContentEditable ? [body] : [];
      } catch {
        return [];
      }
    });

  const editableCandidates = scope => [
    ...Array.from(scope.querySelectorAll(selector)).filter(el => visible(el) && !isShadowTextarea(el)),
    ...iframeEditors(scope),
  ];

  const hasEvolutionHint = el =>
    /\b(?:evolucion|observacion|nota)\b/.test(
      normalize([el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('name'), el.id].filter(Boolean).join(' '))
    );

  function editor() {
    const open = dialogs();
    const scopes = open.length ? open.filter(evolutionDialog) : [evolutionSection()].filter(Boolean);
    if (open.length && (open.length !== 1 || scopes.length !== 1)) return null;
    const candidates = scopes.flatMap(editableCandidates);
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      if (candidates.includes(document.activeElement)) return document.activeElement;
      const hinted = candidates.filter(hasEvolutionHint);
      if (hinted.length === 1) return hinted[0];
    }
    return null;
  }

  const buttonText = el =>
    normalize([el.getAttribute('aria-label'), el.title, el.getAttribute('data-testid'), el.textContent].filter(Boolean).join(' '));

  const iconTestIds = el =>
    Array.from(el.querySelectorAll('svg,[data-testid]'))
      .map(node => node.getAttribute('data-testid') || '')
      .filter(Boolean);

  function newEvolutionControl() {
    const section = evolutionSection();
    if (!section || dialogs().length) return null;
    const buttons = Array.from(section.querySelectorAll('button:not(:disabled),[role=button]:not([aria-disabled=true])')).filter(
      el => visible(el) && !el.closest('.MuiCardHeader-action') && !FORBIDDEN_ACTION.test(buttonText(el))
    );
    const byLabel = buttons.filter(el => CREATE_LABEL.test(buttonText(el)));
    if (byLabel.length === 1) return byLabel[0];
    const byIcon = buttons.filter(el => {
      const ids = iconTestIds(el);
      return ids.some(id => EDIT_ICON.test(id)) && !ids.some(id => NON_EDIT_ICON.test(id));
    });
    if (byIcon.length === 1) return byIcon[0];
    const card = cardInside(section);
    const row = findActionRow(card);
    if (row) {
      const iconButtons = Array.from(row.querySelectorAll('button:not(:disabled),[role=button]:not([aria-disabled=true])')).filter(
        el => visible(el) && !buttonText(el) && el.querySelector('svg')
      );
      if (iconButtons.length === 2) return iconButtons[0];
    }
    return null;
  }

  async function openEditor(isCurrent) {
    if (editor()) return true;
    const control = newEvolutionControl();
    if (!control) return false;
    return new Promise(resolve => {
      const finish = found => {
        observer.disconnect();
        if (timer != null) clearTimeout(timer);
        resolve(found);
      };
      const check = () => {
        if (!isCurrent()) finish(false);
        else if (editor()) finish(true);
      };
      const observer = new MutationObserver(check);
      const timer =
        typeof setTimeout === 'function'
          ? setTimeout(() => finish(Boolean(isCurrent() && editor())), 3500)
          : null;
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open', 'hidden', 'inert', 'aria-hidden'],
      });
      control.click();
      check();
    });
  }

  const readEditorText = el =>
    el instanceof HTMLTextAreaElement ? el.value : String(el.innerText ?? el.textContent ?? '');

  const hasMarker = (text, marker) =>
    String(text || '')
      .replace(/\r\n?/g, '\n')
      .includes(marker);

  const dispatchTextEvents = (el, insertedValue) => {
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: insertedValue }));
    } catch {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const insertIntoContentEditable = (el, value, marker) => {
    const doc = el.ownerDocument || document;
    const win = doc.defaultView || window;
    el.focus();
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = win.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, value) && hasMarker(readEditorText(el), marker)) {
      return true;
    }
    try {
      if (typeof DataTransfer === 'function' && typeof ClipboardEvent === 'function') {
        const dt = new DataTransfer();
        dt.setData('text/plain', value);
        el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
        if (hasMarker(readEditorText(el), marker)) return true;
      }
    } catch {
      // Fall back to direct text node insertion below.
    }
    const textNode = doc.createTextNode(value);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    dispatchTextEvents(el, value);
    return hasMarker(readEditorText(el), marker);
  };

  function insert(record) {
    const el = editor();
    if (!el || typeof record?.evolution !== 'string' || !record.code) return false;
    const marker = 'Código de verificación: ' + record.code;
    if (!record.evolution.replace(/\r\n?/g, '\n').split('\n').includes(marker)) return false;
    const previous = readEditorText(el);
    if (hasMarker(previous, marker)) return true;
    const value = (previous.trim() ? '\n\n' : '') + record.evolution;
    if (el instanceof HTMLTextAreaElement) {
      if (el.maxLength >= 0 && (previous + value).length > el.maxLength) return false;
      el.focus();
      const nextValue = previous + value;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, nextValue);
      try {
        el.setSelectionRange(nextValue.length, nextValue.length);
      } catch {
        // Ignore selection errors in non-interactive test environments.
      }
      dispatchTextEvents(el, value);
      return hasMarker(el.value, marker);
    }
    return insertIntoContentEditable(el, value, marker);
  }

  globalThis.HhrChecklistEvolution = {
    editor,
    openEditor,
    insert,
    evolutionDialog,
    dialogs,
    resolveTriggerHost,
  };
})();
