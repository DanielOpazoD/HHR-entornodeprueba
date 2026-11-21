import { useCallback, useEffect, useRef, useState } from 'react';
import {
  accountErrorMessage,
  establishNursingSession,
} from '@/services/auth/nursingAccountService';
import {
  isValidNursingPassword,
  NURSING_PASSWORD_HINT,
} from '@/services/auth/nursingPasswordPolicy';

export const useNursingPasswordChange = () => {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (password !== confirmation) {
        setMessage('Las claves nuevas no coinciden.');
        return;
      }
      if (!isValidNursingPassword(password)) {
        setMessage(NURSING_PASSWORD_HINT);
        return;
      }
      setBusy(true);
      setMessage('');
      try {
        await establishNursingSession(
          'changeNursingPassword',
          { currentPassword, password },
          () => mounted.current
        );
        setCurrentPassword('');
        setPassword('');
        setConfirmation('');
        setMessage('Clave cambiada. Las otras sesiones han quedado invalidadas.');
      } catch (error) {
        setMessage(accountErrorMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [confirmation, currentPassword, password]
  );

  return {
    currentPassword,
    setCurrentPassword,
    password,
    setPassword,
    confirmation,
    setConfirmation,
    busy,
    message,
    submit,
  };
};
