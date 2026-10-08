import { useEffect, useState } from 'react';
import { CalendarDays, ClipboardCheck, LogOut } from 'lucide-react';
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
      const actor =
        view === 'admin' && sheet.adminRole
          ? { id: userId, role: 'admin', name: `${sheet.name} · ${sheet.adminRole}` }
          : { id: userId, role: 'staff', name: sheet.name };
      const target = ['close', 'reopen'].includes(action.type)
        ? action
        : { sheetId: userId, ...action };
      const adjacentShifts = Object.values(months)
        .filter(item => item.period !== period)
        .flatMap(item => item.sheets.find(person => person.id === userId)?.shifts || []);
      setMonths({ ...months, [period]: transition(month, { ...target, adjacentShifts }, actor) });
      setNotice({
        type: 'success',
        text:
          action.type === 'submit'
            ? 'Mes enviado a revisión en esta demostración.'
            : 'Cambio aplicado en esta demostración.',
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
      await downloadWorkbook(sheets, month.closed, group, period);
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
        {gate === 'ready' && (
          <div className="header-user">
            <span>
              {sheet.name}
              <small>
                {sheet.adminRole ? `ADMIN · ${sheet.adminRole}` : `Trabajador · ${sheet.group}`}
              </small>
            </span>
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
      {gate === 'change' && (
        <ChangePassword
          onCancel={logout}
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
          <nav className="main-nav" aria-label="Navegación del perfil">
            <span className="nav-caption">
              {sheet.adminRole ? 'PERFIL ADMINISTRADOR' : `TRABAJADOR · ${sheet.group}`}
            </span>
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
                <ClipboardCheck size={19} />
                Gestión del equipo
              </button>
            )}
            <p>
              {sheet.adminRole
                ? 'Gestiona al equipo y registra tus propias horas en Mis horas.'
                : 'Tu calendario, registros y planillas personales.'}
            </p>
          </nav>
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
                role={sheet.adminRole}
                busy={busy}
                onAction={act}
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
