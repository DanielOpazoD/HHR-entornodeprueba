'use strict';
(() => {
  const manifest = globalThis.chrome?.runtime?.getManifest?.();
  const version = typeof manifest?.version === 'string' ? manifest.version.trim() : '';
  const buildId = globalThis.HhrExtensionBuildIdentity?.withIdentity(manifest).buildId;
  const render = (id, text, title = '') => {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = text;
    element.title = title;
  };
  render('extension-version', version ? `v${version}` : 'Abrir desde Chrome');
  render('extension-build', buildId ? `Paquete ${buildId.slice(0, 12)}` : 'Paquete sin identificador verificable', buildId);
  if (version) document.title = `Puente Eloísa → HHR · v${version}`;
})();
