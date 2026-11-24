/** Restore a chart's originating list entry, including after a full document navigation. */
(() => {
  'use strict';
  const listPattern = /^\/dashboard\/encounter-list(?:-nurse)?$/;
  const pathOf = url => {
    if (!url) return '';
    const parsed = new URL(url, location.href);
    return parsed.origin === location.origin ? parsed.pathname.replace(/\/$/, '') : '';
  };
  const tabName = button => button.textContent.trim().replace(/\s*\(\d+\)$/, '').trim();
  const portFor = element => {
    for (let p = element.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (p.scrollHeight > p.clientHeight && /^(auto|scroll|overlay)$/.test(getComputedStyle(p).overflowY)) return p;
    }
    return null;
  };
  const tabsFor = () => [...document.querySelectorAll('[data-hhr-worklist-rail] [role="tab"]')];
  const tablesFor = () => [...document.querySelectorAll('table[data-hhr-compact-worklist]')].filter(t => t.getClientRects().length);

  const create = send => {
    const nav = window.navigation;
    if (!nav || !send) return;
    let pending, frame, expiry, marked, departure;
    const cancel = () => {
      pending = undefined;
      cancelAnimationFrame(frame);
      frame = 0;
      clearTimeout(expiry);
      marked?.removeAttribute('data-hhr-returned-row');
      marked = null;
    };
    const finish = snapshot => {
      if (snapshot) void send({ action: 'finish', receipt: snapshot.receipt }).catch(() => {});
    };
    const dismiss = () => {
      if (pending) {
        pending.dismissed = true;
        finish(pending.snapshot);
      }
      cancel();
    };

    const remember = event => {
      if (event.type === 'keydown' && event.key !== 'Enter') return;
      if (!event.isTrusted || event.button || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const link = event.target.closest?.('a[href]');
      const row = link?.closest('table[data-hhr-compact-worklist] > tbody > tr');
      if (!row || link.getAttribute('aria-haspopup') === 'dialog' || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
      const episode = row.querySelector('[data-hhr-worklist-episode]')?.dataset.hhrWorklistEpisode;
      const list = pathOf(location.href);
      if (!listPattern.test(list) || !episode || pathOf(link.href) !== list + '/' + episode) return;
      const tab = tabsFor().find(button => button.getAttribute('aria-selected') === 'true');
      const search = document.getElementById('search-encounter-list');
      if (!tab || !search || !nav.currentEntry?.key) return;
      const snapshot = {
        entryKey: nav.currentEntry.key, episode, referral: new URL(link.href).searchParams.get('referralGuid') || '',
        query: search.value, tab: tabName(tab), rowTop: row.getBoundingClientRect().top,
        windowY: window.scrollY, scrollTop: portFor(row)?.scrollTop || 0,
      };
      if (!departure || departure.link !== link || departure.query !== snapshot.query ||
          departure.rowTop !== snapshot.rowTop || departure.entryKey !== snapshot.entryKey || event.type !== 'click') {
        const intent = departure = { link, query: snapshot.query, rowTop: snapshot.rowTop, entryKey: snapshot.entryKey };
        intent.done = send({ action: 'remember', snapshot }).catch(() => {}).then(() => { intent.ready = true; });
      }
      if (event.type === 'click') {
        departure.activation = event;
        departure.href = link.href;
      }
    };

    const followHardNavigation = event => {
      const intent = departure;
      // Let the native router handle same-document visits immediately. Only a
      // full page load can discard the outgoing document's pending message.
      if (intent?.activation !== event || event.defaultPrevented || !event.cancelable ||
          intent.ready || nav.currentEntry?.key !== intent.entryKey) return;
      event.preventDefault();
      let timeout;
      Promise.race([intent.done, new Promise(resolve => { timeout = setTimeout(resolve, 8000); })]).then(() => {
        clearTimeout(timeout);
        if (departure === intent && nav.currentEntry?.key === intent.entryKey) location.assign(intent.href);
      });
    };

    const restore = () => {
      frame = 0;
      const snapshot = pending?.snapshot;
      if (!snapshot || pathOf(location.href) !== snapshot.path) return;
      const tab = tabsFor().find(button => tabName(button) === snapshot.tab);
      const search = document.getElementById('search-encounter-list');
      if (!tab || !search) return;
      if (tab.getAttribute('aria-selected') !== 'true') {
        if (!pending.selectedTab) { pending.selectedTab = true; tab.click(); }
        return;
      }
      if (search.value !== snapshot.query) {
        if (pending.lastSearch === search && pending.attempts >= 2) return;
        pending.attempts = pending.lastSearch === search ? pending.attempts + 1 : 1;
        pending.lastSearch = search;
        // React tracks controlled input values; use the browser setter and the native input event.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, snapshot.query);
        search.dispatchEvent(new Event('input', { bubbles: true }));
        refresh();
        return;
      }

      const matches = [];
      for (const table of tablesFor()) {
        for (const cell of table.querySelectorAll('[data-hhr-worklist-episode="' + snapshot.episode + '"]')) {
          const row = cell.closest('tr');
          const links = [...row.querySelectorAll('a[href]')].filter(link =>
            pathOf(link.href) === snapshot.path + '/' + snapshot.episode &&
            (!snapshot.referral || new URL(link.href).searchParams.get('referralGuid') === snapshot.referral));
          const target = links.find(link => link.hasAttribute('data-hhr-rongorongo-link')) || links[0];
          if (target) matches.push({ row, target });
        }
      }
      if (matches.length !== 1) return;
      const { row, target } = matches[0];
      if (pending.target === target && pending.rowIndex === row.rowIndex) return;
      // Rayen may replace provisional rows after its filtered data arrives. Keep
      // the return anchored to this episode until the cue fades or the user acts.
      pending.target = target;
      pending.rowIndex = row.rowIndex;
      const port = portFor(row);
      window.scrollTo({ top: snapshot.windowY, behavior: 'instant' });
      if (port) port.scrollTop = snapshot.scrollTop;
      const header = row.closest('table').tHead;
      const top = Math.max(0, port?.getBoundingClientRect().top || 0, header?.rows[0]?.cells[0]?.getBoundingClientRect().bottom || 0);
      const bottom = Math.min(innerHeight, port?.getBoundingClientRect().bottom ?? innerHeight);
      const rect = row.getBoundingClientRect();
      const desired = Math.max(top, Math.min(snapshot.rowTop, bottom - rect.height));
      (port || window).scrollBy({ top: rect.top - desired, behavior: 'instant' });
      target.focus({ preventScroll: true });
      marked?.removeAttribute('data-hhr-returned-row');
      clearTimeout(expiry);
      marked = row;
      row.setAttribute('data-hhr-returned-row', '');
      expiry = setTimeout(dismiss, 2200);
    };
    const refresh = () => {
      if (pending?.snapshot && !frame) frame = requestAnimationFrame(restore);
    };

    const enter = (from, traversal) => {
      const path = pathOf(location.href);
      if (!listPattern.test(path)) { cancel(); return; }
      const previous = pathOf(from?.url || document.referrer);
      const episode = previous.startsWith(path + '/') ? previous.slice(path.length + 1) : '';
      const fromChart = /^[1-9]\d{0,15}$/.test(episode);
      if (!fromChart && (!traversal || previous)) return;
      if (pending?.entryKey === nav.currentEntry?.key) return;
      // Back retains the original entry key. A native "Volver" may push a new list
      // entry; in that case verify the list immediately preceding this chart visit.
      const entryKeys = [nav.currentEntry?.key];
      if (fromChart && from) {
        const origin = nav.entries().slice(0, from.index).reverse().find(item => pathOf(item.url) !== previous);
        if (pathOf(origin?.url) === path) entryKeys.push(origin.key);
      }
      cancel();
      const intent = pending = { entryKey: nav.currentEntry?.key };
      expiry = setTimeout(dismiss, 30000);
      void send({ action: 'return', entryKeys, fromEpisode: fromChart ? episode : '' }).then(result => {
        if (intent.dismissed) { finish(result?.snapshot); return; }
        if (pending !== intent) return;
        if (!result?.snapshot) { cancel(); return; }
        intent.snapshot = result.snapshot;
        refresh();
      }).catch(() => { if (pending === intent) cancel(); });
    };
    const onEntry = event => enter(event.from, event.navigationType === 'traverse');
    const onPageShow = event => {
      if (event.persisted) enter(nav.activation?.from, true);
    };
    const userAction = event => { if (event.isTrusted && pending) dismiss(); };
    const inputs = ['pointerdown', 'keydown', 'beforeinput', 'wheel'];
    for (const type of inputs) document.addEventListener(type, userAction, true);
    const activations = ['pointerdown', 'keydown', 'click'];
    for (const type of activations) document.addEventListener(type, remember, true);
    window.addEventListener('click', followHardNavigation);
    nav.addEventListener('currententrychange', onEntry);
    window.addEventListener('pageshow', onPageShow);
    enter(nav.activation?.from, nav.activation?.navigationType === 'traverse');
    return {
      refresh,
      dispose() {
        cancel();
        for (const type of inputs) document.removeEventListener(type, userAction, true);
        for (const type of activations) document.removeEventListener(type, remember, true);
        window.removeEventListener('click', followHardNavigation);
        nav.removeEventListener('currententrychange', onEntry);
        window.removeEventListener('pageshow', onPageShow);
      },
    };
  };
  globalThis.HhrWorklistReturnNavigation = Object.freeze({ create });
})();
