import { useEffect, useState } from 'react';
import { api, cloudMode, localEmulator } from './cloud.mjs';
import { CalendarDays, Download, KeyRound, LogOut } from 'lucide-react';
import { initialMonth, transition } from './domain/month.mjs';
import { downloadWorkbook } from './export.mjs';
import { Login, ChangePassword } from './components/Login.jsx';
import { Staff } from './components/Staff.jsx';
import { ShiftForm } from './components/ShiftForm.jsx';
import { Admin } from './components/Admin.jsx';

import { PeriodPicker } from './components/PeriodPicker.jsx';

export function App() {
  const [period, setPeriod] = useState(
    cloudMode
      ? new Date().toLocaleDateString('sv-SE', { timeZone: 'Pacific/Easter' }).slice(0, 7)
      : '2026-09'
  );
  const [months, setMonths] = useState(() => (cloudMode ? {} : { '2026-09': initialMonth() }));
  const [remoteMonth, setRemoteMonth] = useState(null);
  const [cloudPerson, setCloudPerson] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const month = cloudMode ? remoteMonth : months[period];
  const [userId, setUserId] = useState(null);
  const [passwords, setPasswords] = useState({});
  const [gate, setGate] = useState(cloudMode ? 'loading' : 'login');
  const [view, setView] = useState('staff');
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const sheet = month?.sheets.find(item => item.id === userId) || cloudPerson;
  const formOpen = Boolean(form);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [gate, view, formOpen]);

  function acceptPerson(person) {
    if (!person.adminRole) setView('staff');
    setForm(null);
    setCloudPerson(person);
    setUserId(person.id);
    setGate(person.mustChange ? 'change' : 'ready');
  }
  useEffect(() => {
    if (!cloudMode) return;
    const controller = new AbortController();
    api('/me', { signal: controller.signal })
      .then(({ person }) => acceptPerson(person))
      .catch(error => {
        if (error.name === 'AbortError') return;
        if (error.status !== 401) setLoadError(error.message);
        setGate('login');
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!cloudMode || gate !== 'ready') return;
    const controller = new AbortController();
    setRemoteMonth(null);
    setLoadError('');
    api(`/month?period=${period}&team=${view === 'admin'}`, { signal: controller.signal })
      .then(data => setRemoteMonth(data))
      .catch(error => {
        if (error.name === 'AbortError') return;
        if (error.status === 401) {
          setGate('login');
          setCloudPerson(null);
          setView('staff');
          setForm(null);
        }
        setLoadError(error.message);
      });
    return () => controller.abort();
  }, [gate, period, view, reload]);

  async function logout() {
    if (cloudMode) {
      try {
        await api('/logout', { method: 'POST', body: {} });
      } catch (error) {
        setNotice({ type: 'error', text: error.message });
        return;
      }
      setRemoteMonth(null);
      setCloudPerson(null);
    }
    setGate('login');
    setUserId(null);
    setView('staff');
    setForm(null);
    setNotice(null);
  }
  async function act(action, propagate = false) {
    try {
      if (cloudMode) {
        setBusy(true);
        const updated = await api('/shift', {
          method: action.type === 'save' ? 'PUT' : 'DELETE',
          body: {
            period,
            revision: sheet.revision,
            id: action.shift?.id || action.id,
            shift: action.shift,
          },
        });
        setRemoteMonth(updated);
        setNotice({
          type: 'success',
          text:
            action.type === 'save' ? 'Turno guardado en la nube.' : 'Turno eliminado de la nube.',
        });
        return;
      }
      const actor = { id: userId };
      const target = { ...action, sheetId: userId };
      const adjacentShifts = Object.values(months)
        .filter(item => item.period !== period)
        .flatMap(item => item.sheets.find(person => person.id === userId)?.shifts || []);
      setMonths({ ...months, [period]: transition(month, { ...target, adjacentShifts }, actor) });
      setNotice({
        type: 'success',
        text: action.type === 'save' ? 'Turno guardado.' : 'Turno eliminado.',
      });
    } catch (cause) {
      if (cloudMode && cause.status === 409) {
        // Refresh the revision without discarding the user's form or retrying a write.
        try {
          setRemoteMonth(await api(`/month?period=${period}`));
        } catch {
          /* Keep the original error. */
        }
      }
      if (propagate) throw cause;
      setNotice({ type: 'error', text: cause.message });
    } finally {
      setBusy(false);
    }
  }
  async function exportSheets(sheets, group) {
    setBusy(true);
    setNotice(null);
    try {
      if (cloudMode) {
        const latest = await api(`/month?period=${period}&team=${view === 'admin'}`);
        sheets =
          view === 'admin' ? latest.sheets.filter(person => person.group === group) : latest.sheets;
      }
      await downloadWorkbook(sheets, group, period, { demo: !cloudMode });
      setNotice({ type: 'success', text: 'Archivo Excel preparado para descargar.' });
    } catch (cause) {
      setNotice({ type: 'error', text: cause.message || 'No se pudo preparar la descarga.' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {localEmulator && (
        <div className="demo-bar">Prueba local · Firestore emulado · datos ficticios.</div>
      )}
      {!cloudMode && (
        <div className="demo-bar">
          Demostración · datos ficticios · los cambios se pierden al recargar. No ingreses datos ni
          contraseñas reales.
        </div>
      )}
      <header className="app-header">
        <a
          href="#"
          onClick={event => {
            event.preventDefault();
            if (!busy) setForm(null);
          }}
          className="brand"
        >
          <img src={`${import.meta.env.BASE_URL}assets/logo-hhr.svg`} alt="Hospital Hanga Roa" />
          <span>
            <strong>HHR</strong>
            <small>Hospitalizados · Horas extras</small>
          </span>
        </a>
        {gate === 'ready' && (
          <div className="header-user">
            <span>
              {sheet.name}
              <small>{sheet.adminRole ? 'Administrador' : sheet.group}</small>
            </span>
            <button
              disabled={busy}
              onClick={() => {
                setGate('password');
                setForm(null);
                setNotice(null);
              }}
              aria-label="Cambiar clave"
            >
              <KeyRound size={18} />
            </button>
            <button disabled={busy} onClick={logout} aria-label="Cerrar sesión">
              <LogOut size={19} />
            </button>
          </div>
        )}
      </header>
      {gate === 'loading' && (
        <p className="cloud-state" role="status">
          Conectando…
        </p>
      )}
      {loadError && gate === 'login' && (
        <p className="cloud-state error" role="alert">
          {loadError}
        </p>
      )}
      {gate === 'login' && (
        <Login
          people={month?.sheets || []}
          onAuthenticate={
            cloudMode
              ? async (rut, password) => {
                  const { person } = await api('/login', {
                    method: 'POST',
                    body: { rut, password },
                  });
                  setLoadError('');
                  acceptPerson(person);
                }
              : undefined
          }
          passwords={passwords}
          onLogin={(id, first) => {
            setUserId(id);
            setGate(first ? 'change' : 'ready');
          }}
        />
      )}
      {(gate === 'change' || gate === 'password') && (
        <ChangePassword
          first={gate === 'change'}
          initialPassword={gate === 'change' ? sheet.rut.split('-')[0] : undefined}
          onCancel={gate === 'change' ? logout : () => setGate('ready')}
          onChange={async password => {
            if (cloudMode) {
              const { person } = await api('/password', { method: 'POST', body: { password } });
              acceptPerson(person);
              return;
            }
            setPasswords({ ...passwords, [userId]: password });
            setGate('ready');
          }}
        />
      )}
      {gate === 'ready' && (
        <div
          className={`workspace ${view === 'admin' ? 'admin-workspace' : ''} ${form ? 'has-form' : ''}`}
        >
          {sheet.adminRole && (
            <nav className="main-nav" aria-label="Navegación del perfil">
              <button
                disabled={busy}
                className={view === 'staff' ? 'active' : ''}
                onClick={() => {
                  setView('staff');
                  setForm(null);
                  setNotice(null);
                }}
              >
                <CalendarDays size={19} />
                Mis horas
              </button>
              {sheet.adminRole && (
                <button
                  disabled={busy}
                  className={view === 'admin' ? 'active' : ''}
                  onClick={() => {
                    setView('admin');
                    setForm(null);
                    setNotice(null);
                  }}
                >
                  <Download size={19} />
                  Planillas del equipo
                </button>
              )}
            </nav>
          )}
          <main id="main-content">
            {!form && (
              <PeriodPicker
                period={period}
                disabled={busy}
                onChange={value => {
                  if (!cloudMode)
                    setMonths(current =>
                      current[value] ? current : { ...current, [value]: initialMonth(value) }
                    );
                  setPeriod(value);
                  setForm(null);
                  setNotice(null);
                }}
              />
            )}
            {notice && (
              <div
                role={notice.type === 'error' ? 'alert' : 'status'}
                className={`notice ${notice.type}`}
              >
                <span>{notice.text}</span>
                <button
                  disabled={busy}
                  className="text-button"
                  aria-label="Cerrar aviso"
                  onClick={() => setNotice(null)}
                >
                  Cerrar
                </button>
              </div>
            )}
            {cloudMode && !month ? (
              <div className="cloud-state" role={loadError ? 'alert' : 'status'}>
                <p>{loadError || 'Cargando registros…'}</p>
                {loadError && (
                  <button className="secondary" onClick={() => setReload(value => value + 1)}>
                    Reintentar
                  </button>
                )}
              </div>
            ) : view === 'admin' && sheet.adminRole ? (
              <Admin
                key={period}
                month={month}
                busy={busy}
                onExport={group =>
                  exportSheets(
                    month.sheets.filter(item => item.group === group),
                    group
                  )
                }
              />
            ) : form ? (
              <ShiftForm
                key={form.id || form.date}
                initial={form.id ? form : undefined}
                initialDate={form.date}
                period={period}
                onCancel={() => {
                  if (!busy) setForm(null);
                }}
                onSave={async shift => {
                  await act({ type: 'save', shift }, true);
                  setForm(null);
                }}
              />
            ) : (
              <Staff
                key={`${period}-${userId}`}
                month={month}
                sheet={sheet}
                onAdd={date => setForm({ date })}
                onEdit={setForm}
                onAction={act}
                busy={busy}
                onExport={() => exportSheets([sheet], sheet.name)}
              />
            )}
          </main>
        </div>
      )}
    </>
  );
}
