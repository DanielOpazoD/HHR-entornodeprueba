import { useState } from 'react';
import { normalizeRut } from '../domain/overtime.mjs';
import { validatePassword, demoPassword, needsPasswordChange } from '../domain/password.mjs';

export function Login({ people, passwords, onLogin, onAuthenticate }) {
  const [rut, setRut] = useState(onAuthenticate ? '' : '11.111.111-1');
  const [password, setPassword] = useState(onAuthenticate ? '' : '11111111');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="auth-wrap">
      <form
        className="login-card"
        onSubmit={async event => {
          event.preventDefault();
          if (busy) return;
          setError('');
          if (onAuthenticate) {
            setBusy(true);
            try {
              await onAuthenticate(rut, password);
            } catch (cause) {
              setError(cause.message);
            } finally {
              setBusy(false);
            }
            return;
          }
          const person = people.find(item => item.rut === normalizeRut(rut));
          if (!person || password !== demoPassword(person, passwords)) {
            setError('RUT o clave incorrectos.');
            return;
          }
          onLogin(person.id, needsPasswordChange(person.id, passwords));
        }}
      >
        <h1>Iniciar sesión</h1>
        <p>Horas extras de Hospitalizados</p>
        <label>
          RUT
          <input
            value={rut}
            onChange={event => setRut(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Clave
          <input
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <p className="hint">Primera clave: tu RUT sin puntos ni dígito verificador.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary wide" disabled={busy}>
          {busy ? 'Ingresando…' : 'Ingresar'}
        </button>
        {!onAuthenticate && (
          <details className="demo-profiles">
            <summary>Probar otro perfil de ejemplo</summary>
            <label>
              Funcionario de ejemplo
              <select
                value={people.find(item => item.rut === normalizeRut(rut))?.id || ''}
                onChange={event => {
                  const person = people.find(item => item.id === event.target.value);
                  setRut(person.rut);
                  setPassword(
                    needsPasswordChange(person.id, passwords) ? demoPassword(person, passwords) : ''
                  );
                  setError('');
                }}
              >
                <option value="" disabled>
                  Seleccionar
                </option>
                {people.map(person => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.adminRole ? 'ADMIN' : person.group}
                  </option>
                ))}
              </select>
            </label>
          </details>
        )}
      </form>
    </div>
  );
}
export function ChangePassword({ first = true, initialPassword, onChange, onCancel }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="auth-wrap">
      <form
        className="login-card"
        onSubmit={async event => {
          event.preventDefault();
          const message = validatePassword(password, confirm, first ? initialPassword : undefined);
          if (message) {
            setError(message);
            return;
          }
          if (busy) return;
          setBusy(true);
          try {
            await onChange(password);
          } catch (cause) {
            setError(cause.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>{first ? 'Elige tu nueva clave' : 'Cambiar clave'}</h1>
        <p>
          {first ? 'Cambia la clave inicial para continuar.' : 'Escribe la clave que quieres usar.'}
        </p>
        <label>
          Nueva clave
          <input
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        <label>
          Repetir clave
          <input
            type="password"
            value={confirm}
            onChange={event => setConfirm(event.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary wide" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar clave'}
        </button>
        <button type="button" className="text-button wide" disabled={busy} onClick={onCancel}>
          {first ? 'Volver al inicio' : 'Cancelar'}
        </button>
      </form>
    </div>
  );
}
