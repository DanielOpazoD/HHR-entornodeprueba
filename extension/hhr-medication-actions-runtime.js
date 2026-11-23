/**
 * hhr-medication-actions-runtime.js (ISOLATED world)
 *
 * Owns the medication-related actions rendered by the Ficha Médico orchestrator.
 * Receives the current episode, extension messaging and feedback from the consumer.
 */
(() => {
  'use strict';

  if (globalThis.HhrMedicationActionsRuntime) return;

  const create = dependencies => {
    const {
      documentRef,
      normalizedText,
      currentRouteEncounterId,
      createFeedbackModal,
      sendMessage,
      runtimeMessages,
    } = dependencies || {};

    if (
      !documentRef ||
      typeof normalizedText !== 'function' ||
      typeof currentRouteEncounterId !== 'function' ||
      typeof createFeedbackModal !== 'function' ||
      typeof sendMessage !== 'function' ||
      !runtimeMessages
    ) {
      throw new Error('No se pudo inicializar el runtime de acciones de medicación HHR.');
    }

    const findPharmaHeading = () => {
      const candidates = documentRef.querySelectorAll(
        'h1,h2,h3,h4,h5,h6,[role="heading"],p,span,div'
      );
      return (
        Array.from(candidates)
          .filter(element => normalizedText(element.textContent) === 'farmacos')
          .sort((a, b) => a.childElementCount - b.childElementCount)[0] || null
      );
    };

    const downloadIndications = async (encId, button) => {
      if (currentRouteEncounterId() !== String(encId || '')) {
        createFeedbackModal({
          title: 'Indicaciones',
          message: 'El episodio cambió. Vuelve a abrir Indicaciones desde el paciente actual.',
          error: true,
        });
        return;
      }
      button.disabled = true;
      const result = await sendMessage({ type: runtimeMessages.INDICATIONS_PRINT_REQUEST, encId });
      button.disabled = false;
      if (!result || result.error) {
        createFeedbackModal({
          title: 'Indicaciones',
          message: (result && result.error) || 'No se pudo descargar el reporte de indicaciones.',
          error: true,
        });
        return;
      }
      createFeedbackModal({
        title: 'Indicaciones',
        message: 'PDF de indicaciones descargado. Ábrelo desde Descargas para imprimir.',
      });
    };

    const hasVisibleNursingRole = () => {
      const roleLabels = documentRef.querySelectorAll('span,p,small,div');
      return Array.from(roleLabels).some(element => {
        const text = normalizedText(element.textContent);
        return (
          text === 'enfermera(o)' ||
          text === 'enfermero(a)' ||
          text === 'enfermera' ||
          text === 'enfermero'
        );
      });
    };

    const findToolbarAnchor = heading => {
      const card =
        heading.closest('[class*="MuiPaper"], [class*="MuiCard"], section, article') ||
        heading.parentElement?.parentElement ||
        documentRef.body;
      const textNodes = card.querySelectorAll('label,span,div,p');
      const suspended = Array.from(textNodes)
        .filter(element => normalizedText(element.textContent).includes('mostrar suspendidos'))
        .sort((a, b) => String(a.textContent || '').length - String(b.textContent || '').length)[0];
      if (!suspended) return heading.parentElement || heading;
      return suspended.closest('label') || suspended;
    };

    return Object.freeze({
      findPharmaHeading,
      downloadIndications,
      hasVisibleNursingRole,
      findToolbarAnchor,
    });
  };

  globalThis.HhrMedicationActionsRuntime = Object.freeze({ create });
})();
