import { useEffect, useState } from 'react';
import { CalendarDays, Download, KeyRound, LogOut } from 'lucide-react';
import { initialMonth, transition } from './domain/month.mjs';
import { downloadWorkbook } from './export.mjs';
import { Login, ChangePassword } from './components/Login.jsx';
import { Staff } from './components/Staff.jsx';
import { ShiftForm } from './components/ShiftForm.jsx';
import { Admin } from './components/Admin.jsx';

import { PeriodPicker } from './components/PeriodPicker.jsx';

export function App() {
  const [period, setPeriod] = useState('2026-09');
  const [months, setMonths] = useState(() => ({ '2026-09': initialMonth() }));
  const month = months[period];
  const [userId, setUserId] = useState(null);
  const [passwords, setPasswords] = useState({});
  const [gate, setGate] = useState('login');
  const [view, setView] = useState('staff');
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const sheet = month.sheets.find(item => item.id === userId);
  const formOpen = Boolean(form);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [gate, view, formOpen]);

  function logout() {
    setGate('login');
    setUserId(null);
    setView('staff');
    setForm(null);
    setNotice(null);
  }
  function act(action, propagate = false) {
    try {
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
      if (propagate) throw cause;
      setNotice({ type: 'error', text: cause.message });
    }
  }
  async function exportSheets(sheets, group) {
    setBusy(true);
    setNotice(null);
    try {
      await downloadWorkbook(sheets, group, period);
      setNotice({ type: 'success', text: 'Archivo Excel preparado para descargar.' });
    } catch (cause) {
      setNotice({ type: 'error', text: cause.message || 'No se pudo preparar la descarga.' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="demo-bar">
        Demostración · datos ficticios · los cambios se pierden al recargar. No ingreses datos ni
        contraseñas reales.
      </div>
      <header className="app-header">
        <a
          href="#"
          onClick={event => {
            event.preventDefault();
            setForm(null);
          }}
          className="brand"
        >
          <img src={`${import.meta.env.BASE_URL}assets/logo-hhr.svg`} alt="Hospital Hanga Roa" />
          <span>
            <strong>HHR</strong>
            <small>Hospitalizados · Horas extras</small>
          </span>
        </a>
        {(gate === 'ready' || gate === 'password') && (
          <div className="header-user">
            <span>
              {sheet.name}
              <small>{sheet.adminRole ? 'Administrador' : sheet.group}</small>
            </span>
            <button
              onClick={() => {
                setGate('password');
                setForm(null);
                setNotice(null);
              }}
              aria-label="Cambiar clave"
            >
              <KeyRound size={18} />
            </button>
            <button onClick={logout} aria-label="Cerrar sesión de demostración">
              <LogOut size={19} />
            </button>
          </div>
        )}
      </header>
      {gate === 'login' && (
        <Login
          people={month.sheets}
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
          onChange={password => {
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
                onChange={value => {
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
                  className="text-button"
                  aria-label="Cerrar aviso"
                  onClick={() => setNotice(null)}
                >
                  Cerrar
                </button>
              </div>
            )}
            {view === 'admin' && sheet.adminRole ? (
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
                onCancel={() => setForm(null)}
                onSave={shift => {
                  act({ type: 'save', shift }, true);
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
