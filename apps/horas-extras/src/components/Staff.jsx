import { useState } from 'react';
import { CalendarDays, Download, List, Plus, Send } from 'lucide-react';
import { dateLabel, HOLIDAYS, isNonBusiness, totals, periodInfo } from '../domain/overtime.mjs';
import { editable } from '../domain/month.mjs';
import { Badge, ShiftList, Totals } from './Shared.jsx';

export function Staff({ month, sheet, onAdd, onEdit, onAction, onExport, busy }) {
  const [tab, setTab] = useState('calendar');
  const calendar = periodInfo(month.period);
  const [day, setDay] = useState(calendar.first);
  const canEdit = editable(month, sheet);
  const selected = sheet.shifts.filter(shift => shift.date === day);
  return (
    <div className="staff-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">HOSPITALIZADOS · {sheet.group}</span>
          <h1>Mis horas</h1>
          <p>{calendar.label}</p>
        </div>
        <Badge status={sheet.status} closed={month.closed} />
      </header>
      <Totals value={totals(sheet.shifts)} />
      {sheet.reason && (
        <div className="notice warning">
          <strong>Corrección solicitada</strong>
          <p>{sheet.reason}</p>
        </div>
      )}
      {sheet.status === 'submitted' && (
        <p className="notice">Mes enviado. Está pendiente de revisión por administración.</p>
      )}
      {sheet.status === 'approved' && !month.closed && (
        <p className="notice success">
          Tu mes está aprobado y pendiente del cierre administrativo.
        </p>
      )}
      <div className="staff-grid">
        <section className="card calendar-card">
          <div className="tabs" role="group" aria-label="Vista de horas">
            <button
              aria-pressed={tab === 'calendar'}
              className={tab === 'calendar' ? 'active' : ''}
              onClick={() => setTab('calendar')}
            >
              <CalendarDays size={18} />
              Calendario
            </button>
            <button
              aria-pressed={tab === 'list'}
              className={tab === 'list' ? 'active' : ''}
              onClick={() => setTab('list')}
            >
              <List size={18} />
              Mis registros
            </button>
          </div>
          {tab === 'calendar' ? (
            <>
              <div className="calendar" aria-label={calendar.label}>
                {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((label, i) => (
                  <span key={`h${i}`} className="weekday">
                    {label}
                  </span>
                ))}
                {Array.from({ length: calendar.offset }, (_, i) => (
                  <span key={`empty${i}`} />
                ))}
                {Array.from({ length: calendar.count }, (_, i) => {
                  const date = `${month.period}-${String(i + 1).padStart(2, '0')}`;
                  const hasShifts = sheet.shifts.some(shift => shift.date === date);
                  return (
                    <button
                      key={date}
                      aria-label={`${dateLabel(date)}${HOLIDAYS.has(date) ? ', festivo' : ''}${hasShifts ? ', con horas extras' : ''}`}
                      aria-pressed={day === date}
                      onClick={() => setDay(date)}
                      className={`${day === date ? 'selected' : ''} ${isNonBusiness(date) ? 'nonbusiness' : ''} ${hasShifts ? 'has-shifts' : ''}`}
                    >
                      {i + 1}
                      {hasShifts && <span className="calendar-dot" />}
                    </button>
                  );
                })}
              </div>
              <div className="calendar-legend">
                <span>
                  <i /> Con registros
                </span>
                <span>Fondo suave: inhábiles</span>
              </div>
              <p className="hint">
                Festivos del mes:{' '}
                {[...HOLIDAYS]
                  .filter(date => date.startsWith(month.period))
                  .map(date => Number(date.slice(-2)))
                  .join(', ') || 'ninguno'}
                .
              </p>
              <div className="selected-day">
                <h3>{dateLabel(day)}</h3>
                {selected.length ? (
                  <ShiftList
                    shifts={selected}
                    onEdit={canEdit ? onEdit : undefined}
                    onDelete={canEdit ? id => onAction({ type: 'delete', id }) : undefined}
                  />
                ) : (
                  <p className="muted">Sin registros para este día.</p>
                )}
              </div>
            </>
          ) : (
            <ShiftList
              shifts={sheet.shifts}
              onEdit={canEdit ? onEdit : undefined}
              onDelete={canEdit ? id => onAction({ type: 'delete', id }) : undefined}
            />
          )}
          {canEdit && (
            <button className="primary wide" onClick={() => onAdd(day)}>
              <Plus size={19} />
              Registrar turno
            </button>
          )}
        </section>
        <aside className="card month-card">
          <span className="eyebrow">TU PLANILLA</span>
          <h2>Revisa y envía tu mes</h2>
          <p>
            Registra únicamente las horas extras realizadas. Podrás corregirlas mientras el mes esté
            en borrador o tenga observaciones.
          </p>
          <dl>
            <div>
              <dt>Funcionario</dt>
              <dd>{sheet.name}</dd>
            </div>
            <div>
              <dt>Servicio</dt>
              <dd>Hospitalizados</dd>
            </div>
            <div>
              <dt>Registros</dt>
              <dd>
                {sheet.shifts.length} {sheet.shifts.length === 1 ? 'turno' : 'turnos'}
              </dd>
            </div>
          </dl>
          {sheet.noExtras && <p className="notice">Declaraste que no realizaste horas extras.</p>}
          {canEdit && (
            <>
              {!sheet.shifts.length && !sheet.noExtras && (
                <button className="secondary wide" onClick={() => onAction({ type: 'no-extras' })}>
                  No realicé horas extras
                </button>
              )}
              <button className="primary wide" onClick={() => onAction({ type: 'submit' })}>
                <Send size={18} />
                Enviar mes a revisión
              </button>
            </>
          )}
          <button
            className="secondary wide"
            disabled={busy || (!sheet.shifts.length && !sheet.noExtras)}
            onClick={onExport}
          >
            <Download size={18} />
            {busy ? 'Preparando…' : 'Descargar mi Excel'}
          </button>
          <p className="hint">La descarga se identifica como borrador hasta el cierre del mes.</p>
        </aside>
      </div>
    </div>
  );
}
