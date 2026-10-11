import { cert, initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export function createFirestoreStore(db) {
  const ref = (collection, id) => db.collection(`overtime_${collection}`).doc(id);
  const read = async (collection, id) => (await ref(collection, id).get()).data() || null;
  return {
    get: read,
    delete: (collection, id) => ref(collection, id).delete(),
    list: async collection =>
      (await db.collection(`overtime_${collection}`).get()).docs.map(doc => doc.data()),
    transaction: work =>
      db.runTransaction(tx =>
        work({
          get: async (collection, id) => (await tx.get(ref(collection, id))).data() || null,
          set: (collection, id, data) => tx.set(ref(collection, id), data),
          delete: (collection, id) => tx.delete(ref(collection, id)),
        })
      ),
  };
}

export function configuredStore(env = process.env) {
  const projectId = env.OVERTIME_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Falta configurar el proyecto de Horas Extras.');
  const options = { projectId };
  if (env.FIRESTORE_EMULATOR_HOST) {
    if (!projectId.startsWith('demo-')) throw new Error('El emulador solo admite proyectos demo-.');
  } else {
    const account = JSON.parse(env.OVERTIME_FIREBASE_SERVICE_ACCOUNT || '{}');
    if (account.project_id !== projectId)
      throw new Error('La credencial no coincide con el proyecto de Horas Extras.');
    options.credential = cert(account);
  }
  const name = `overtime-${projectId}`;
  const app = getApps().find(item => item.name === name) || initializeApp(options, name);
  return createFirestoreStore(getFirestore(app));
}
