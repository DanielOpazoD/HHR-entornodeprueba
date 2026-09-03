'use strict';

(() => {
  const manifest = typeof chrome !== 'undefined' && chrome.runtime?.getManifest
    ? chrome.runtime.getManifest()
    : null;
  const version = typeof manifest?.version === 'string' && manifest.version.trim()
    ? manifest.version.trim()
    : null;
  const versionElement = document.getElementById('extension-version');

  if (versionElement) {
    versionElement.textContent = version ? `v${version}` : 'Abrir desde Chrome';
  }
  if (version) document.title = `Puente Eloísa → HHR · v${version}`;
})();
