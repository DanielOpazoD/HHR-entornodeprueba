import type { User } from 'firebase/auth';
import { isManagedUserRole } from '@/shared/access/roleAccessMatrix';
import { clearRecentAuthRoleLookups, getDynamicRoleForEmail } from './authRoleLookup';

/** Backend rules deny revoked versions immediately; this also closes a connected stale UI. */
export const watchNursingSession = (user: User, onRevoked: () => Promise<void>): (() => void) => {
  let active = true;
  let checking = false;
  let expiresAt = 0;
  const check = async (forceFreshLookup = false) => {
    if (!active || checking) return;
    checking = true;
    try {
      if (!expiresAt) {
        const token = await user.getIdTokenResult();
        const authTime = Number(token.claims.auth_time);
        expiresAt = Number.isFinite(authTime) ? (authTime + 43200) * 1000 : 1;
      }
      if (!active) return;
      if (Date.now() >= expiresAt) {
        await onRevoked();
        return;
      }
      // Bootstrap just validated this session. Reuse only the existing short-lived
      // lookup (or join it in flight); periodic revocation checks still force a read.
      if (forceFreshLookup) clearRecentAuthRoleLookups();
      const role = await getDynamicRoleForEmail(user.email || '');
      if (active && !isManagedUserRole(role ?? undefined)) await onRevoked();
    } catch {
      // Transient transport failures do not discard this actor's queued offline edits.
      // Absolute session expiry and the existing inactivity monitor remain in force.
      if (active && expiresAt && Date.now() >= expiresAt) await onRevoked();
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(() => void check(true), 60000);
  void check();
  return () => {
    active = false;
    clearInterval(timer);
  };
};
