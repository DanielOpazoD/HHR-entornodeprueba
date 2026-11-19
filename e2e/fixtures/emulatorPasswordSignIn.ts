// Loaded in the page by the Vite dev server, so it signs in on the app's own Firebase Auth
// instance; the app then resolves the role as it does for any session.
import { signInWithEmailAndPassword } from 'firebase/auth';
import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

export const signInWithEmulatorPassword = async (
  email: string,
  password: string
): Promise<void> => {
  await defaultAuthRuntime.ready;
  const { auth } = defaultAuthRuntime;
  // Credentials only ever go to a local Auth emulator, never to a real project.
  if (!auth.emulatorConfig || !LOOPBACK_HOSTS.has(auth.emulatorConfig.host)) {
    throw new Error('emulatorPasswordSignIn: Firebase Auth is not connected to a local emulator.');
  }
  await signInWithEmailAndPassword(auth, email, password);
};
