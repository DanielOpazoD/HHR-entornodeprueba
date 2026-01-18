
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'fs';
import * as path from 'path';

// Disable timeout for emulator startup
// vitest.setConfig({ testTimeout: 10000 });

// TODO: Enable this test suite once Java Runtime Environment (JRE) is installed and Firebase Emulator is running.
// Run 'npx firebase emulators:start --only firestore' before enabling.
describe.skip('Firestore Security Rules', () => {
    let testEnv: RulesTestEnvironment;

    // Users
    const unauth = () => testEnv.unauthenticatedContext().firestore();
    const authed = () => testEnv.authenticatedContext('user_basic', { email: 'user@example.com' }).firestore();
    const admin = () => testEnv.authenticatedContext('user_admin', { email: 'daniel.opazo@hospitalhangaroa.cl' }).firestore();
    const nurse = () => testEnv.authenticatedContext('user_nurse', { email: 'hospitalizados@hospitalhangaroa.cl' }).firestore();

    beforeAll(async () => {
        // Read rules from root
        const rulesPath = path.resolve(__dirname, '../../firestore.rules');
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
            const doc = await setupDoc(admin(), 'hospitals/H1/auditLogs/log1', { action: 'TEST' });
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

        it('Nurses can update records (mocking window)', async () => {
            // Note: Testing time window requires setting global time in rules or emulator context. 
            // We'll assume default pass for simplified test or would need to mock request.time
            // For now we test basic nurse access assuming window logic is sound or window passes
            const db = nurse();
            // We setup a record with dateTimestamp close to now approx
            const now = Date.now();
            await setupDoc(admin(), recordPath, { date: '2025-01-01', dateTimestamp: now });

            await assertSucceeds(db.doc(recordPath).update({ 'nursesDayShift': ['Nurse1'] }));
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
    });

});

// Helper to setup a document as admin
async function setupDoc(db: any, path: string, data: any) {
    const docRef = db.doc(path);
    await docRef.set(data);
    return docRef;
}
