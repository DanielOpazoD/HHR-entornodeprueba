/** Installs the compact HHR connection surface without growing the clinical relay. */
(() => {
  'use strict';
  const runtimeMessages = globalThis.HhrRayenMessageContract?.types;
  const owner = globalThis.HhrGestionCamasConnectionIndicator;
  const actionModel = globalThis.HhrConnectionActionModel;
  if (!runtimeMessages || !owner || !actionModel) return;

  owner.create({
    documentRef: document,
    windowRef: window,
    chromeApi: chrome,
    runtimeMessages,
    actionModel,
  }).mount();
})();
