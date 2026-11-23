/** Fixed shortcuts shared by the Eloísa drawer and Centro HHR settings. */
(() => {
  'use strict';

  const links = [
    { label: 'SysLab', href: 'http://10.4.69.90/syslab/', icon: 'icons/shortcut-syslab.png' },
    { label: 'MMRAD', href: 'https://ris.mmrad.cl/web/guest', icon: 'icons/shortcut-mmrad.png' },
    { label: 'Gmail', href: 'https://mail.google.com/', icon: 'icons/shortcut-gmail.png' },
  ];

  const create = () => {
    const nav = document.createElement('nav');
    nav.className = 'hhr-favorite-links';
    nav.setAttribute('aria-label', 'Favoritos');
    const heading = document.createElement('p');
    heading.textContent = 'Favoritos';
    nav.append(heading);
    for (const { label, href, icon } of links) {
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const image = document.createElement('img');
      image.src = chrome.runtime.getURL(icon);
      image.alt = '';
      image.width = 20;
      image.height = 20;
      link.append(image, label);
      nav.append(link);
    }
    return nav;
  };

  globalThis.HhrFavoriteLinks = Object.freeze({ create });
})();
