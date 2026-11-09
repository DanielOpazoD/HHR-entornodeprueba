/** Read-only authentication check for an already-open native page; returns no credentials. */
(function (root) {
  'use strict';
  // Self-contained because chrome.scripting serializes this function into the native page.
  const isUsable = async () => {
    let timer;
    try {
      if (location.origin !== 'https://urgencia.saludenred.cl' ||
          !location.pathname.startsWith('/Emergency/')) return false;
      const login = window.angular?.element(document.body).injector()?.get('loginService');
      const owner = () => `${login.getCurrentFacility()?.Id}:${login.getCurrentStaffMember()?.Id}`;
      const initialOwner = owner();
      if (!/^[1-9]\d*:[1-9]\d*$/.test(initialOwner) || !login.isStaffMemberLogged()) return false;
      const [facilityId, staffId] = initialOwner.split(':');
      // Native validToken checks /api/verifyToken; it does not read patients or reports.
      const valid = await Promise.race([
        login.validToken(staffId, facilityId),
        new Promise(resolve => { timer = setTimeout(() => resolve(false), 2500); }),
      ]);
      return valid === true && owner() === initialOwner;
    } catch { return false; }
    finally { clearTimeout(timer); }
  };
  root.HhrUrgencySessionPage = { isUsable };
})(typeof self !== 'undefined' ? self : globalThis);
