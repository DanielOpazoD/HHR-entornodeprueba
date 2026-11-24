// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createChecklistHandler,
} = require('../../../functions/lib/checklists/checklistFunctions.js');

it.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'conserva un único original en Firebase tras un reintento y tras editar la plantilla',
  async () => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toMatch(/^(127\.0\.0\.1|localhost):\d+$/);
    const app = initializeApp({ projectId: 'demo-hhr-clinical-checklists' }, randomUUID());
    const firestore = getFirestore(app);
    const db = firestore.collection('hospitals').doc('hanga_roa');
    const uid = 'test-professional';
    const context = {
      auth: { uid, token: { name: 'Profesional de prueba', email: 'nurse@example.test' } },
    };
    let role = 'nurse_hospital';
    const call = createChecklistHandler({
      firestore,
      resolveRoleForEmail: async () => role,
      now: () => new Date('2026-11-20T06:19:00Z'),
    });
    const code = 'PT-' + randomUUID().toUpperCase();
    const input = {
      action: 'apply',
      uid,
      code,
      episode: '66001',
      document: 'TEST-X',
      templateId: 'vigilancia-cirugias',
      version: 1,
      answers: {
        cirugia: 'Procedimiento de prueba',
        'fecha-cirugia': '2026-11-18',
        'primer-control': '2026-11-19',
        'observacion-1': 'Texto sintético',
      },
    };
    const day = db.collection('dailyRecords').doc('2026-11-19');
    const saved = db.collection('checklistApplications').doc(code);
    const templ = db.collection('checklistTemplates').doc(input.templateId);
    try {
      await day.set({
        beds: {
          TEST: {
            clinicalEpisodeId: input.episode,
            documentType: 'Pasaporte',
            rut: input.document,
            patientName: 'Paciente de prueba',
          },
        },
      });
      const [first, retry] = await Promise.all([call(input, context), call(input, context)]);
      expect(first.record).toEqual(retry.record);
      expect(first.record).toMatchObject({
        code,
        censusDate: '2026-11-19',
        authorUid: uid,
        score: null,
      });
      expect(first.record.evolution).toContain(code);
      expect((await saved.get()).exists).toBe(true);
      await expect(
        call({ ...input, answers: { ...input.answers, cirugia: 'Otro texto' } }, context)
      ).rejects.toThrow('otra aplicación');
      await expect(
        call({ action: 'configure', template: first.record.template, version: 1 }, context)
      ).rejects.toThrow('administración');
      role = 'admin';
      await call(
        {
          action: 'configure',
          template: { ...first.record.template, title: 'Plantilla revisada' },
          version: 1,
        },
        context
      );
      expect((await call({ action: 'get', code }, context)).record).toEqual(first.record);
      await expect(call({ ...input, code: 'PT-' + randomUUID() }, context)).rejects.toThrow(
        'plantilla'
      );
      await expect(call({ action: 'get', code }, {})).rejects.toThrow('sesión');
      role = 'viewer';
      await expect(call({ action: 'get', code }, context)).rejects.toThrow('acceso');
    } finally {
      await Promise.all([day.delete(), saved.delete(), templ.delete()]);
      await deleteApp(app);
    }
  },
  30000
);
