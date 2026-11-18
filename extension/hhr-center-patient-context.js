/** Consistent, visible patient and episode identity across Centro HHR modules. */
(() => {
  'use strict';
  const set = (root, { encId = '', patient = null, bulk = false } = {}) => {
    const bar = root.querySelector('.hhr-center-patientbar');
    if (!bar) return;
    bar.hidden = false;
    root.dataset.hhrContextEncounter = bulk ? '' : String(encId || '');
    bar.querySelector('.hhr-patientbar-tag').textContent = bulk ? 'Ámbito' : 'Paciente';
    bar.querySelector('.hhr-patientbar-episode').textContent = !bulk && encId ? 'Episodio ' + encId : '';
    bar.querySelector('.hhr-patientbar-name').textContent = bulk ? 'Hospitalizados' :
      patient?.name || (encId ? 'Identificando paciente…' : 'Sin paciente seleccionado');
    bar.querySelector('.hhr-patientbar-meta').textContent = bulk ? 'Impresión por lote' :
      [patient?.formattedRun || patient?.run, patient?.bed, patient?.service].filter(Boolean).join(' · ');
    if (bulk || !encId) bar.querySelector('.hhr-patientbar-route').hidden = true;
  };
  const refreshRoute = (root, routeId) => {
    const badge = root.querySelector('.hhr-patientbar-route');
    if (!badge) return;
    const selected = root.dataset.hhrContextEncounter;
    badge.hidden = !selected || !routeId || selected === String(routeId);
  };
  const prepare = (root, { encId, activeModule, currentRouteEncounterId, sendMessage, runtimeMessages }) => {
    root.dataset.selectedEncounterId = encId || '';
    set(root, { encId });
    const patientBound = ['lab', 'imaging'].includes(activeModule);
    root.querySelector('.hhr-patientbar-change').hidden = !patientBound;
    refreshRoute(root, currentRouteEncounterId());
    if (patientBound || activeModule === 'recipes' || activeModule === 'indications' || !encId) return;
    const main = root.querySelector('.hhr-center-main');
    void sendMessage({ type: runtimeMessages.PATIENT_HEADER_REQUEST, encId }).then(response => {
      if (!main.isConnected || root.dataset.selectedEncounterId !== encId || root.dataset.activeModule !== activeModule) return;
      if (response?.patient && !response.error) set(root, { encId, patient: response.patient });
      else {
        root.querySelector('.hhr-patientbar-name').textContent = 'Paciente no identificado';
        root.querySelector('.hhr-patientbar-meta').textContent = 'No se pudo comprobar la identidad.';
      }
    }).catch(() => {});
  };
  globalThis.HhrCenterPatientContext = Object.freeze({ set, prepare, refreshRoute });
})();
