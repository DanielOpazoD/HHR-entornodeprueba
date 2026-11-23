'use strict';
(() => {
  const releases = 'https://api.github.com/repos/DanielOpazoD/extensioneloisahhr/releases/latest';
  const downloads = 'https://github.com/DanielOpazoD/extensioneloisahhr/releases/download/';
  const status = document.getElementById('release-status');
  const download = document.getElementById('update-download');
  const retry = document.getElementById('retry-release');
  const manifest = chrome.runtime.getManifest();

  function show(state, label) {
    status.dataset.state = state;
    status.textContent = label;
    retry.hidden = state !== 'error';
    download.hidden = state !== 'available';
  }

  async function check() {
    show('checking', 'Comprobando versión…');
    try {
      const response = await fetch(releases, {
        credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw new Error('Release unavailable');
      const release = await response.json();
      const match = /^v(\d+\.\d+\.\d+)$/.exec(release.tag_name);
      if (!match || release.draft || release.prerelease) throw new Error('Invalid release');
      const published = match[1];
      const prefix = 'eloisa-extension-' + published + '-';
      const names = release.assets.filter(asset => asset.state === 'uploaded').map(asset => asset.name);
      const zip = names.find(name => name.startsWith(prefix) && /^[a-f0-9]{12}\.zip$/.test(name.slice(prefix.length)));
      if (!zip) throw new Error('Package unavailable');

      const latest = published.split('.').map(Number);
      const installed = manifest.version.split('.').map(Number);
      const difference = latest.map((value, i) => value - installed[i]).find(value => value !== 0) || 0;
      const build = globalThis.HhrExtensionBuildIdentity.withIdentity(manifest).buildId;
      const differentBuild = difference === 0 && build && !zip.startsWith(prefix + build.slice(0, 12) + '.');
      if (difference > 0 || differentBuild) {
        download.href = downloads + release.tag_name + '/' + zip;
        download.target = '_blank';
        download.rel = 'noreferrer';
        show('available', differentBuild ? 'El paquete publicado es distinto' : 'Disponible v' + published);
      } else if (difference < 0) {
        show('ahead', 'Versión local más reciente');
      } else {
        show('current', build ? 'Actualizada' : 'Versión al día · paquete sin verificar');
      }
    } catch {
      show('error', 'No se pudo comprobar');
    }
  }

  retry.addEventListener('click', check);
  void check();
})();
