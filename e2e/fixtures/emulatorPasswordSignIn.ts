// Loaded in the page by the Vite dev server, so it signs in on the app's own Firebase Auth
// instance; the app then resolves the role as it does for any session.
import { signInWithEmailAndPassword } from 'firebase/auth';
import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';

export const signInWithEmulatorPassword = async (
  email: string,
  password: string
): Promise<void> => {
  await defaultAuthRuntime.ready;
  await signInWithEmailAndPassword(defaultAuthRuntime.auth, email, password);
};
