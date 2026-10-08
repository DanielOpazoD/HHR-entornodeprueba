import { CheckCircle2, Clock3, Moon, Send, Sun, AlertCircle } from 'lucide-react';
import { hours, shiftLabel, dateLabel, calculate } from '../domain/overtime.mjs';
import { STATUS } from '../domain/month.mjs';

export function Badge({ status, closed }) {
  const Icon =
    closed || status === 'approved'
      ? CheckCircle2
      : status === 'submitted'
        ? Send
        : status === 'observed'
          ? AlertCircle
          : Clock3;
  return (
    <span className={`badge ${closed ? 'approved' : status}`}>
      <Icon size={14} />
      {closed ? 'Mes cerrado' : STATUS[status]}
    </span>
  );
}
export function Totals({ value, compact = false }) {
  return (
    <div className={`totals ${compact ? 'compact' : ''}`}>
      <div className="total-primary">
        <span>Total de horas extras</span>
        <strong>
          {hours(value.total)} <small>h</small>
        </strong>
      </div>
      <div>
        <Sun size={17} />
        <strong>{hours(value.diurnal)} h</strong>
        <span>Diurnas</span>
      </div>
      <div>
        <Moon size={17} />
        <strong>{hours(value.nocturnal)} h</strong>
        <span>Nocturnas y festivas</span>
      </div>
    </div>
  );
}
export function ShiftList({ shifts, onEdit, onDelete }) {
  if (!shifts.length)
    return (
      <div className="empty">
        <Clock3 size={30} />
        <h3>Aún no hay turnos registrados</h3>
        <p>Agrega las horas extras realizadas durante este mes.</p>
      </div>
    );
  return (
    <ul className="shift-list">
      {shifts.map(shift => {
        const total = calculate(shift);
        const Icon = shift.kind === 'night' ? Moon : shift.kind === 'long' ? Sun : Clock3;
        return (
          <li key={shift.id}>
            <span className={`shift-icon ${shift.kind}`}>
              <Icon size={21} />
            </span>
            <div className="shift-description">
              <strong>{dateLabel(shift.date)}</strong>
              <span>{shiftLabel(shift)}</span>
              {shift.endDate !== shift.date && <small>Termina {dateLabel(shift.endDate)}</small>}
              {shift.note && <small>{shift.note}</small>}
              <small>
                {hours(total.diurnal)} h diurnas · {hours(total.nocturnal)} h nocturnas/festivas
              </small>
              {onEdit && (
                <div className="inline-actions">
                  <button className="text-button" onClick={() => onEdit(shift)}>
                    Editar
                  </button>
                  <button className="text-button danger-text" onClick={() => onDelete(shift.id)}>
                    Eliminar
                  </button>
                </div>
              )}
            </div>
            <strong className="shift-hours">{hours(total.total)} h</strong>
          </li>
        );
      })}
    </ul>
  );
}
