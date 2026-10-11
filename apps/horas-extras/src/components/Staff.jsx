import { useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { dateLabel, HOLIDAYS, isNonBusiness, totals, periodInfo } from '../domain/overtime.mjs';
import { ShiftList, Totals } from './Shared.jsx';

export function Staff({ month, sheet, onAdd, onEdit, onAction, onExport, busy }) {
  const calendar = periodInfo(month.period);
  const [day, setDay] = useState(calendar.first);
  return (
    <section className="staff-page">
      <header className="page-heading staff-heading">
        <div>
          <h1>Mis turnos extras</h1>
          <p>
            {sheet.name} · {sheet.group}
          </p>
        </div>
        <button className="secondary" disabled={busy} onClick={onExport}>
          <Download size={17} /> Descargar mi Excel
        </button>
      </header>
      <Totals value={totals(sheet.shifts)} />
      <div className="staff-grid">
        <section className="calendar-section" aria-label="Elegir día">
          <h2>{calendar.label}</h2>
          <div className="calendar" aria-label={calendar.label}>
            {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((label, i) => (
              <span className="weekday" key={`h${i}`}>
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
          <p className="hint">Fondo suave: fines de semana y festivos.</p>
          <button className="primary wide" disabled={busy} onClick={() => onAdd(day)}>
            <Plus size={18} />
            Registrar turno · {Number(day.slice(-2))}
          </button>
        </section>
        <section className="records-section" aria-label="Turnos del mes">
          <div className="section-heading">
            <h2>Registros del mes</h2>
          </div>
          <ShiftList
            shifts={sheet.shifts}
            disabled={busy}
            onEdit={onEdit}
            onDelete={id => onAction({ type: 'delete', id })}
          />
        </section>
      </div>
    </section>
  );
}
