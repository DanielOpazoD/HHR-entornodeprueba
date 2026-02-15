
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'fs';
import * as path from 'path';

const runRulesTests =
    process.env.RUN_FIRESTORE_RULES_TESTS === '1' ||
    process.env.FIRESTORE_EMULATOR_HOST !== undefined;

const describeRules = runRulesTests ? describe : describe.skip;

// Run 'npx firebase emulators:start --only firestore' and set RUN_FIRESTORE_RULES_TESTS=1
describeRules('Firestore Security Rules', () => {
    let testEnv: RulesTestEnvironment;

    // Users
    const unauth = () => testEnv.unauthenticatedContext().firestore();
    const authed = () => testEnv.authenticatedContext('user_basic', { email: 'user@example.com' }).firestore();
    const admin = () => testEnv.authenticatedContext('user_admin', { email: 'daniel.opazo@hospitalhangaroa.cl' }).firestore();
    const nurse = () => testEnv.authenticatedContext('user_nurse', { email: 'hospitalizados@hospitalhangaroa.cl' }).firestore();
    const doctor = () => testEnv.authenticatedContext('user_doctor', { email: 'doctor@example.com' }).firestore();

    beforeAll(async () => {
        // Read rules from project root
        const rulesPath = path.resolve(__dirname, '../../../firestore.rules');
        const rules = fs.readFileSync(rulesPath, 'utf8');

        try {
            testEnv = await initializeTestEnvironment({
                projectId: 'demo-hhr-rules-test',
                firestore: {
                    rules,
                    host: '127.0.0.1',
                    port: 8080
                }
            });
        } catch (e) {
            console.error("Failed to init emulator. Is it running? run 'firebase emulators:start --only firestore'");
            throw e;
        }
    });

    afterAll(async () => {
        if (testEnv) await testEnv.cleanup();
    });

    beforeEach(async () => {
        if (testEnv) await testEnv.clearFirestore();
    });

    describe('Audit Logs Collection', () => {
        const auditCollection = (db: any) => db.collection('hospitals/H1/auditLogs');

        it('Unauthenticated users cannot read audit logs', async () => {
            await assertFails(auditCollection(unauth()).get());
        });

        it('Admins can read audit logs', async () => {
            await assertSucceeds(auditCollection(admin()).get());
        });

        it('Any authenticated user can create an audit log', async () => {
            await assertSucceeds(auditCollection(authed()).add({ action: 'TEST_ACTION', timestamp: 123456 }));
        });

        it('Regular users CANNOT delete audit logs', async () => {
            const db = authed();
            await setupDoc(admin(), 'hospitals/H1/auditLogs/log1', { action: 'TEST' });
            await assertFails(db.doc('hospitals/H1/auditLogs/log1').delete());
        });

        it('Admins CAN delete audit logs (for Consolidation)', async () => {
            const db = admin();
            await setupDoc(db, 'hospitals/H1/auditLogs/log1', { action: 'TEST' });
            await assertSucceeds(db.doc('hospitals/H1/auditLogs/log1').delete());
        });
    });

    describe('Daily Records Collection', () => {
        const recordPath = 'hospitals/H1/dailyRecords/2025-01-01';

        it('Authenticated users can read daily records', async () => {
            await setupDoc(admin(), recordPath, { date: '2025-01-01' });
            await assertSucceeds(authed().doc(recordPath).get());
        });

        it('Unauthenticated users cannot read daily records', async () => {
            await assertFails(unauth().doc(recordPath).get());
        });

        it('Nurses can update records within the editing window', async () => {
            const db = nurse();
            const now = Date.now();
            await setupDoc(admin(), recordPath, { date: '2025-01-01', dateTimestamp: now });

            await assertSucceeds(db.doc(recordPath).update({ 'nursesDayShift': ['Nurse1'] }));
        });

        it('Nurses cannot update records outside the editing window', async () => {
            const db = nurse();
            const old = Date.now() - 3 * 86400000;
            await setupDoc(admin(), recordPath, { date: '2025-01-01', dateTimestamp: old });

            await assertFails(db.doc(recordPath).update({ 'nursesDayShift': ['Nurse1'] }));
        });

        it('Doctors can update only medical signature fields', async () => {
            await setupDoc(admin(), recordPath, { date: '2025-01-01', dateTimestamp: Date.now() });

            await assertSucceeds(
                doctor().doc(recordPath).update({
                    medicalSignature: 'signed',
                    lastUpdated: Date.now(),
                    medicalHandoffDoctor: 'Dr. X',
                    medicalHandoffSentAt: Date.now()
                })
            );
        });

        it('Doctors cannot update non-medical fields', async () => {
            await setupDoc(admin(), recordPath, { date: '2025-01-01', dateTimestamp: Date.now() });

            await assertFails(
                doctor().doc(recordPath).update({
                    nursesDayShift: ['Nurse1']
                })
            );
        });

        it('Admins can delete daily records', async () => {
            await setupDoc(admin(), recordPath, { date: '2025-01-01' });
            await assertSucceeds(admin().doc(recordPath).delete());
        });

        it('Nurses CANNOT delete daily records', async () => {
            const now = Date.now();
            await setupDoc(admin(), recordPath, { date: '2025-01-01', dateTimestamp: now });
            await assertFails(nurse().doc(recordPath).delete());
        });
    });

    describe('Settings Collection', () => {
        const settingsPath = 'hospitals/H1/settings/tableConfig';

        it('Admins can write settings', async () => {
            await assertSucceeds(admin().doc(settingsPath).set({ foo: 'bar' }));
        });

        it('Regular users CANNOT write settings', async () => {
            await assertFails(authed().doc(settingsPath).set({ foo: 'bar' }));
        });

        it('Nurses CANNOT write settings (unless admin)', async () => {
            await assertFails(nurse().doc(settingsPath).set({ foo: 'bar' }));
        });

        it('Unauthenticated users cannot read settings', async () => {
            await assertFails(unauth().doc(settingsPath).get());
        });
    });

    describe('Export Passwords', () => {
        const exportPath = 'hospitals/H1/exportPasswords/2025-01-01';

        it('Authenticated users can read export passwords', async () => {
            await setupDoc(admin(), exportPath, { password: 'secret' });
            await assertSucceeds(authed().doc(exportPath).get());
        });

        it('Unauthenticated users cannot read export passwords', async () => {
            await assertFails(unauth().doc(exportPath).get());
        });

        it('Admins can write export passwords', async () => {
            await assertSucceeds(admin().doc(exportPath).set({ password: 'secret' }));
        });

        it('Non-admins cannot write export passwords', async () => {
            await assertFails(authed().doc(exportPath).set({ password: 'secret' }));
        });
    });

    describe('Transfer Requests', () => {
        const transferPath = 'hospitals/H1/transferRequests/TR-1';

        it('Nurses can create transfer requests', async () => {
            await assertSucceeds(nurse().doc(transferPath).set({ status: 'pending' }));
        });

        it('Non-nurse users cannot create transfer requests', async () => {
            await assertFails(authed().doc(transferPath).set({ status: 'pending' }));
        });
    });

    describe('Backup Files', () => {
        const backupPath = 'hospitals/H1/backupFiles/file1';

        it('Authenticated users can create backup files', async () => {
            await assertSucceeds(authed().doc(backupPath).set({ name: 'file.pdf' }));
        });

        it('Unauthenticated users cannot read backup files', async () => {
            await assertFails(unauth().doc(backupPath).get());
        });

        it('Admins can update backup files', async () => {
            await setupDoc(admin(), backupPath, { name: 'file.pdf' });
            await assertSucceeds(admin().doc(backupPath).update({ name: 'file-v2.pdf' }));
        });

        it('Non-admins cannot update backup files', async () => {
            await setupDoc(admin(), backupPath, { name: 'file.pdf' });
            await assertFails(authed().doc(backupPath).update({ name: 'file-v2.pdf' }));
        });
    });

    describe('Allowed Users', () => {
        it('Users can read their own authorization doc', async () => {
            await setupDoc(admin(), 'allowedUsers/user_basic', { email: 'user@example.com' });
            await assertSucceeds(authed().doc('allowedUsers/user_basic').get());
        });

        it('Users cannot read other users authorization doc', async () => {
            await setupDoc(admin(), 'allowedUsers/user_other', { email: 'other@example.com' });
            await assertFails(authed().doc('allowedUsers/user_other').get());
        });
    });

    describe('User Settings', () => {
        it('Users can read/write their own settings', async () => {
            await assertSucceeds(authed().doc('userSettings/user_basic').set({ theme: 'light' }));
            await assertSucceeds(authed().doc('userSettings/user_basic').get());
        });

        it('Users cannot write settings for other users', async () => {
            await assertFails(authed().doc('userSettings/user_other').set({ theme: 'dark' }));
        });
    });

    describe('System Health', () => {
        it('Users can write their own system health record', async () => {
            await assertSucceeds(authed().doc('stats/system_health/users/user_basic').set({ ok: true }));
        });

        it('Users cannot write system health for other users', async () => {
            await assertFails(authed().doc('stats/system_health/users/user_other').set({ ok: true }));
        });
    });

    describe('Bookmarks', () => {
        const bookmarkPath = 'hospitals/H1/bookmarks/shift';

        it('Unauthenticated users can read bookmarks', async () => {
            await setupDoc(admin(), bookmarkPath, { alignment: 'left' });
            await assertSucceeds(unauth().doc(bookmarkPath).get());
        });

        it('Unauthenticated users cannot write bookmarks', async () => {
            await assertFails(unauth().doc(bookmarkPath).set({ alignment: 'right' }));
        });
    });

});

// Helper to setup a document as admin
async function setupDoc(db: any, path: string, data: any) {
    const docRef = db.doc(path);
    await docRef.set(data);
    return docRef;
}
