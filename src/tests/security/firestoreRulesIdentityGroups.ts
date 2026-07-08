import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { describe, it } from 'vitest';

import type { FirestoreRulesHarness } from './firestoreRulesTestHarness';

export function registerFirestoreRulesIdentityGroups({
  unauth,
  authed,
  admin,
  nurse,
  adminWithoutClaim,
  editor,
  unauthorizedAuthed,
  firestoreForUser,
  NOW_MS,
  setupDoc,
}: FirestoreRulesHarness): void {
  describe('Role Config', () => {
    const roleConfigPath = 'config/roles';

    it('Configured admins can recover role config access without an admin claim', async () => {
      await setupDoc(admin(), roleConfigPath, {
        'admin.dynamic@example.com': 'admin',
        'user@example.com': 'viewer',
      });

      await assertSucceeds(
        adminWithoutClaim().doc(roleConfigPath).set({
          'admin.dynamic@example.com': 'admin',
          'user@example.com': 'viewer',
          'doctor@example.com': 'doctor_urgency',
        })
      );
    });

    it('Regular authenticated users cannot read role config directly', async () => {
      await setupDoc(admin(), roleConfigPath, {
        'user@example.com': 'viewer',
      });

      await assertFails(authed().doc(roleConfigPath).get());
    });

    it('Editors cannot write role config directly', async () => {
      await assertFails(
        editor().doc(roleConfigPath).set({
          'editor@example.com': 'editor',
          'doctor@example.com': 'doctor_urgency',
        })
      );
    });
  });

  describe('Allowed Users (legacy retired)', () => {
    it('Users cannot read legacy authorization docs', async () => {
      await assertFails(authed().doc('allowedUsers/user_basic').get());
    });

    it('Admins also cannot access legacy authorization docs directly', async () => {
      await assertFails(admin().doc('allowedUsers/user_other').get());
    });
  });

  describe('User Settings', () => {
    it('Users can read/write their own settings', async () => {
      await assertSucceeds(authed().doc('userSettings/user_basic').set({ theme: 'light' }));
      await assertSucceeds(authed().doc('userSettings/user_basic').get());
    });

    it('Users can persist their private clinical signature profile only in their own settings', async () => {
      await assertSucceeds(
        authed()
          .doc('userSettings/user_basic')
          .set({
            clinicalSignatureProfile: {
              uid: 'user_basic',
              email: 'user@example.com',
              displayName: 'Dra. Firma Personal',
              specialty: 'Medicina Interna',
              updatedAt: '2026-05-07T12:00:00.000Z',
            },
          })
      );
    });

    it('Users can persist their private clinical indications only in their own settings', async () => {
      await assertSucceeds(
        authed()
          .doc('userSettings/user_basic')
          .set({
            clinicalDocumentIndicationsProfile: {
              uid: 'user_basic',
              email: 'user@example.com',
              updatedAt: '2026-05-07T12:30:00.000Z',
              items: [
                {
                  id: 'custom-control',
                  text: 'Control con equipo tratante',
                  source: 'custom',
                  createdAt: '2026-05-07T12:30:00.000Z',
                },
              ],
            },
          })
      );
    });

    it('Users cannot read settings for other users', async () => {
      await setupDoc(admin(), 'userSettings/user_other', { theme: 'dark' });
      await assertFails(authed().doc('userSettings/user_other').get());
    });

    it('Users cannot write settings for other users', async () => {
      await assertFails(authed().doc('userSettings/user_other').set({ theme: 'dark' }));
    });
  });

  describe('System Health', () => {
    const validSystemHealthPayload = {
      uid: 'user_basic',
      email: 'user@example.com',
      displayName: 'User Basic',
      lastSeen: '2026-02-20T00:00:00.000Z',
      isOnline: true,
      isOutdated: false,
      pendingMutations: 0,
      pendingSyncTasks: 0,
      failedSyncTasks: 0,
      conflictSyncTasks: 0,
      retryingSyncTasks: 0,
      syncOrphanedTasks: 0,
      oldestPendingAgeMs: 0,
      remoteSyncReason: 'ready',
      versionUpdateReason: 'current',
      localErrorCount: 0,
      degradedLocalPersistence: false,
      repositoryWarningCount: 0,
      slowestRepositoryOperationMs: 0,
      operationalObservedCount: 0,
      operationalFailureCount: 0,
      operationalRetryableCount: 0,
      operationalRecoverableCount: 0,
      operationalDegradedCount: 0,
      operationalBlockedCount: 0,
      operationalUnauthorizedCount: 0,
      operationalLastHourObservedCount: 0,
      operationalSyncObservedCount: 0,
      operationalIndexedDbObservedCount: 0,
      operationalClinicalDocumentObservedCount: 0,
      operationalCreateDayObservedCount: 0,
      operationalHandoffObservedCount: 0,
      operationalExportBackupObservedCount: 0,
      operationalDailyRecordRecoveredRealtimeNullCount: 0,
      operationalDailyRecordConfirmedRealtimeNullCount: 0,
      operationalSyncReadUnavailableCount: 0,
      operationalIndexedDbFallbackModeCount: 0,
      operationalAuthBootstrapTimeoutCount: 0,
      operationalTopObservedCategory: 'sync',
      operationalTopObservedOperation: 'sync_queue_poll',
      latestOperationalOperation: 'sync_queue_poll',
      latestOperationalRuntimeState: 'recoverable',
      latestOperationalIssueAt: '2026-02-20T00:00:00.000Z',
      appVersion: 'v1',
      platform: 'MacIntel',
      userAgent: 'Vitest',
    };

    it('Users can write their own system health record', async () => {
      await assertSucceeds(
        authed().doc('stats/system_health/users/user_basic').set(validSystemHealthPayload)
      );
    });

    it('Regular viewers cannot read system health snapshots, even their own', async () => {
      await assertSucceeds(
        authed().doc('stats/system_health/users/user_basic').set(validSystemHealthPayload)
      );
      await assertFails(authed().doc('stats/system_health/users/user_basic').get());
    });

    it('Clinical write roles can read system health snapshots', async () => {
      await assertSucceeds(
        nurse()
          .doc('stats/system_health/users/user_nurse')
          .set({
            ...validSystemHealthPayload,
            uid: 'user_nurse',
            email: 'hospitalizados@hospitalhangaroa.cl',
            displayName: 'Nurse User',
          })
      );
      await assertSucceeds(nurse().doc('stats/system_health/users/user_nurse').get());
    });

    it('Only admins can delete stale system health snapshots', async () => {
      const healthPath = 'stats/system_health/users/user_nurse';
      await assertSucceeds(
        nurse()
          .doc(healthPath)
          .set({
            ...validSystemHealthPayload,
            uid: 'user_nurse',
            email: 'hospitalizados@hospitalhangaroa.cl',
            displayName: 'Nurse User',
          })
      );

      await assertFails(nurse().doc(healthPath).delete());
      await assertSucceeds(admin().doc(healthPath).delete());
    });

    it('Regular viewers cannot delete system health snapshots', async () => {
      const healthPath = 'stats/system_health/users/user_basic';
      await assertSucceeds(authed().doc(healthPath).set(validSystemHealthPayload));

      await assertFails(authed().doc(healthPath).delete());
    });

    it('Only admins can persist system health incident resolutions', async () => {
      const resolutionPath = 'stats/system_health/resolutions/user_nurse%3Aevent-1';
      const resolutionPayload = {
        resolutionKey: 'user_nurse:event-1',
        status: 'resolved',
        updatedAt: '2026-05-22T14:15:00.000Z',
        resolvedAt: '2026-05-22T14:15:00.000Z',
        resolvedByUid: 'user_admin',
        resolvedByEmail: 'daniel.opazo@hospitalhangaroa.cl',
        resolvedByName: 'Admin User',
        note: 'Permiso corregido',
        history: [
          {
            action: 'resolved',
            at: '2026-05-22T14:15:00.000Z',
            actorUid: 'user_admin',
          },
        ],
      };

      await assertFails(nurse().doc(resolutionPath).set(resolutionPayload));
      await assertSucceeds(admin().doc(resolutionPath).set(resolutionPayload));
      await assertSucceeds(nurse().doc(resolutionPath).get());
    });

    it('Regular viewers cannot write or read system health incident resolutions', async () => {
      const resolutionPath = 'stats/system_health/resolutions/user_basic%3Aevent-1';

      await assertFails(
        authed().doc(resolutionPath).set({
          resolutionKey: 'user_basic:event-1',
          status: 'resolved',
          updatedAt: '2026-05-22T14:15:00.000Z',
          resolvedAt: '2026-05-22T14:15:00.000Z',
          history: [],
        })
      );

      await setupDoc(admin(), resolutionPath, {
        resolutionKey: 'user_basic:event-1',
        status: 'resolved',
        updatedAt: '2026-05-22T14:15:00.000Z',
        resolvedAt: '2026-05-22T14:15:00.000Z',
        history: [],
      });
      await assertFails(authed().doc(resolutionPath).get());
    });

    it('Users cannot write system health for other users', async () => {
      await assertFails(
        authed().doc('stats/system_health/users/user_other').set(validSystemHealthPayload)
      );
    });

    it('Users cannot forge uid field in own system health record', async () => {
      await assertFails(
        authed()
          .doc('stats/system_health/users/user_basic')
          .set({
            ...validSystemHealthPayload,
            uid: 'someone_else',
          })
      );
    });

    it('Users cannot write non-whitelisted fields in system health payload', async () => {
      await assertFails(
        authed()
          .doc('stats/system_health/users/user_basic')
          .set({
            ...validSystemHealthPayload,
            injected: true,
          })
      );
    });

    it('Users cannot write invalid operational counters in system health payload', async () => {
      await assertFails(
        authed()
          .doc('stats/system_health/users/user_basic')
          .set({
            ...validSystemHealthPayload,
            operationalFailureCount: -1,
          })
      );

      await assertFails(
        authed()
          .doc('stats/system_health/users/user_basic')
          .set({
            ...validSystemHealthPayload,
            operationalSyncReadUnavailableCount: 'many',
          })
      );
    });
  });

  describe('Census Access Invitations', () => {
    const invitationPath = 'census-access-invitations/inv-1';

    it('Unauthenticated users cannot read invitations', async () => {
      await setupDoc(admin(), invitationPath, {
        email: 'invited@example.com',
        status: 'pending',
      });
      await assertFails(unauth().doc(invitationPath).get());
    });

    it('Authenticated user can claim own pending invitation', async () => {
      const invitedUser = () => firestoreForUser('user_invited', { email: 'invited@example.com' });

      await setupDoc(admin(), invitationPath, {
        email: 'invited@example.com',
        status: 'pending',
        createdAt: NOW_MS,
        createdBy: 'admin',
        expiresAt: NOW_MS + 86_400_000,
      });

      await assertSucceeds(
        invitedUser()
          .doc(invitationPath)
          .update({
            status: 'used',
            usedBy: 'user_invited',
            usedAt: NOW_MS + 1000,
          })
      );
    });

    it('Authenticated users cannot read invitations for other emails', async () => {
      await setupDoc(admin(), invitationPath, {
        email: 'invited@example.com',
        status: 'pending',
        createdAt: NOW_MS,
      });

      await assertFails(authed().doc(invitationPath).get());
    });

    it('Invitation owners cannot claim expired invitations', async () => {
      const invitedUser = () => firestoreForUser('user_invited', { email: 'invited@example.com' });

      await setupDoc(admin(), invitationPath, {
        email: 'invited@example.com',
        status: 'pending',
        createdAt: NOW_MS,
        createdBy: 'admin',
        expiresAt: NOW_MS - 1,
      });

      await assertFails(
        invitedUser()
          .doc(invitationPath)
          .update({
            status: 'used',
            usedBy: 'user_invited',
            usedAt: NOW_MS + 1000,
          })
      );
    });

    it('Regular authenticated users cannot create invitations', async () => {
      await assertFails(
        authed().doc('census-access-invitations/inv-2').set({
          email: 'new.user@example.com',
          status: 'pending',
          createdAt: NOW_MS,
          createdBy: 'user_basic',
        })
      );
    });
  });

  describe('Census Access Users', () => {
    const accessUserPath = 'census-access-users/user_basic';

    it('Regular users cannot self-create census access user documents', async () => {
      await assertFails(
        authed().doc(accessUserPath).set({
          id: 'user_basic',
          email: 'user@example.com',
          role: 'viewer',
          isActive: true,
        })
      );
    });

    it('Editors/admins can create census access user documents', async () => {
      await assertSucceeds(
        admin().doc(accessUserPath).set({
          id: 'user_basic',
          email: 'user@example.com',
          role: 'viewer',
          isActive: true,
        })
      );
    });

    it('Editors can create census access user documents', async () => {
      await assertSucceeds(
        editor().doc('census-access-users/user_editor_managed').set({
          id: 'user_editor_managed',
          email: 'viewer@example.com',
          role: 'viewer',
          isActive: true,
        })
      );
    });
  });

  describe('Census Access Logs', () => {
    const logPath = 'census-access-logs/log-1';

    it('Allows creating log only when userId/email match current caller', async () => {
      await assertSucceeds(
        authed().doc(logPath).set({
          userId: 'user_basic',
          email: 'user@example.com',
          action: 'list_files',
          timestamp: NOW_MS,
        })
      );
    });

    it('Rejects forged logs for other users', async () => {
      await assertFails(
        authed().doc(logPath).set({
          userId: 'user_other',
          email: 'user@example.com',
          action: 'list_files',
          timestamp: NOW_MS,
        })
      );
    });
  });

  describe('Bookmarks', () => {
    const bookmarkPath = 'hospitals/H1/bookmarks/shift';

    it('Unauthenticated users cannot read bookmarks', async () => {
      await setupDoc(admin(), bookmarkPath, { alignment: 'left' });
      await assertFails(unauth().doc(bookmarkPath).get());
    });

    it('Unauthenticated users cannot write bookmarks', async () => {
      await assertFails(unauth().doc(bookmarkPath).set({ alignment: 'right' }));
    });

    it('Clinical roles can read and write bookmarks', async () => {
      await assertSucceeds(nurse().doc(bookmarkPath).set({ alignment: 'right' }));
      await assertSucceeds(nurse().doc(bookmarkPath).get());
    });

    it('Authenticated users without a clinical role cannot read or write bookmarks', async () => {
      await setupDoc(admin(), bookmarkPath, { alignment: 'left' });
      await assertFails(unauthorizedAuthed().doc(bookmarkPath).get());
      await assertFails(unauthorizedAuthed().doc(bookmarkPath).set({ alignment: 'center' }));
    });
  });
}
