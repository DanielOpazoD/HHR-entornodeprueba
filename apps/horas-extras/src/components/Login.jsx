import { useState } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { normalizeRut } from '../domain/overtime.mjs';

export function Login({ people, passwords, onLogin }) {
  const [rut, setRut] = useState('11.111.111-1');
  const [password, setPassword] = useState('11111111');
  const [error, setError] = useState('');
  function submit(event) {
    event.preventDefault();
    const normalized = normalizeRut(rut);
    const person = people.find(item => item.rut === normalized);
    if (!person || password !== (passwords[person.id] || normalized.split('-')[0])) {
      setError('RUT o contraseña de demostración incorrectos.');
      return;
    }
    onLogin(person.id, !passwords[person.id]);
  }
  return (
    <div className="auth-wrap">
      <div className="auth-intro">
        <span className="eyebrow">HOSPITAL HANGA ROA</span>
        <h1>
          Tus horas extras,
          <br />
          en un solo lugar.
        </h1>
        <p>
          Registra tus turnos de Hospitalizados y revisa tu planilla desde el celular o el
          computador.
        </p>
        <span className="pill">TENS y Enfermería</span>
      </div>
      <form className="card login-card" onSubmit={submit}>
        <LockKeyhole className="accent" size={26} />
        <h2>Iniciar sesión</h2>
        <p className="muted">Acceso de demostración · perfiles separados</p>
        <label>
          Funcionario de ejemplo
          <select
            value={people.find(item => item.rut === normalizeRut(rut))?.id || ''}
            onChange={event => {
              const person = people.find(item => item.id === event.target.value);
              setRut(person.rut);
              setPassword(passwords[person.id] ? '' : person.rut.split('-')[0]);
              setError('');
            }}
          >
            <option value="" disabled>
              Seleccionar
            </option>
            {people.map(person => (
              <option key={person.id} value={person.id}>
                {person.name} · {person.adminRole ? 'ADMIN' : 'Trabajador'} · {person.group}
              </option>
            ))}
          </select>
        </label>
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
          Contraseña
          <input
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <p className="hint">
          Primer acceso: RUT sin puntos ni dígito verificador. Ejemplo: 11111111.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary wide">
          Ingresar <ArrowRight size={18} />
        </button>
      </form>
    </div>
  );
}

export function ChangePassword({ onChange, onCancel }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="auth-wrap single">
      <form
        className="card login-card"
        onSubmit={event => {
          event.preventDefault();
          if (password.length < 12 || password !== confirm) {
            setError('Usa al menos 12 caracteres y repite la misma contraseña.');
            return;
          }
          onChange(password);
        }}
      >
        <LockKeyhole size={28} className="accent" />
        <span className="eyebrow">PRIMER INGRESO</span>
        <h1>Crea tu contraseña</h1>
        <p>Debes cambiar la contraseña inicial antes de acceder a tus horas extras.</p>
        <p className="notice">
          Usa una contraseña inventada para esta prueba. Se conserva solo mientras esta página esté
          abierta.
        </p>
        <label>
          Nueva contraseña
          <input
            type="password"
            minLength={12}
            value={password}
            onChange={event => setPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        <label>
          Repetir contraseña
          <input
            type="password"
            minLength={12}
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
        <button className="primary wide">Guardar y continuar</button>
        <button type="button" className="text-button wide" onClick={onCancel}>
          Volver al inicio
        </button>
      </form>
    </div>
  );
}
