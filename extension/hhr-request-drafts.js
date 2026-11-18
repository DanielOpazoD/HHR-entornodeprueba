/** Request drafts live only on the open Centro HHR root, never in browser storage. */
(() => {
  'use strict';
  const checkpoint = root => {
    root.__hhrDraftCheckpoint?.();
    root.__hhrDraftCleanup?.();
    delete root.__hhrDraftCheckpoint;
    delete root.__hhrDraftCleanup;
  };
  const attach = ({ root, main, kind, encId, capture, restore, isManual, fieldForEvent }) => {
    const drafts = root.__hhrRequestDrafts ||= new Map();
    const key = kind + ':' + String(encId || 'manual');
    let confirmedPatient = '';
    const edits = new Map();
    const markEdited = (field = '*') => {
      const path = Array.isArray(field) ? field : [field];
      edits.set(JSON.stringify(path), path);
    };
    const onEdit = event => {
      const field = fieldForEvent ? fieldForEvent(event) : '*';
      if (field) markEdited(field);
    };
    const merge = (saved, pending) => {
      if (edits.has('["*"]')) return structuredClone(pending);
      const merged = structuredClone(saved);
      edits.forEach(path => {
        let target = merged, source = pending;
        path.slice(0, -1).forEach(key => { target = target[key] ||= {}; source = source[key]; });
        const key = path.at(-1); target[key] = structuredClone(source[key]);
      });
      return merged;
    };
    main.addEventListener('input', onEdit, true); main.addEventListener('change', onEdit, true);
    const save = () => {
      // First-visit edits stay pending; existing bindings must match a fresh confirmation.
      const previous = drafts.get(key);
      const identity = confirmedPatient || previous?.patientId || '';
      if (!main.isConnected || (!confirmedPatient && !edits.size)) return;
      const current = capture();
      drafts.set(key, { patientId: identity, value: confirmedPatient || !previous ? structuredClone(current) : merge(previous.value, current) });
    };
    root.__hhrDraftCheckpoint = save;
    root.__hhrDraftCleanup = () => { main.removeEventListener('input', onEdit, true); main.removeEventListener('change', onEdit, true); };
    const confirm = (patientId, actorId = '') => {
      if (!main.isConnected || root.__hhrDraftCheckpoint !== save) return;
      if (!patientId) return;
      const identity = JSON.stringify([String(patientId), String(actorId)]);
      if (confirmedPatient === identity) return;
      const previous = drafts.get(key);
      if (previous && (!previous.patientId || previous.patientId === identity)) {
        const value = merge(previous.value, capture()); restore(value);
        drafts.set(key, { patientId: identity, value: structuredClone(value) });
      }
      else if (previous) drafts.delete(key);
      confirmedPatient = identity;
    };
    const confirmManual = () => confirm('manual:' + String(encId || ''));
    const previous = drafts.get(key);
    if (previous && isManual?.(previous.value)) confirmManual();
    return Object.freeze({ confirm, confirmManual, markEdited });
  };
  globalThis.HhrRequestDrafts = Object.freeze({ checkpoint, attach });
})();
