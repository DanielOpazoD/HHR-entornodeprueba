import { useState } from 'react';
import { ArrowLeft, ArrowRight, Clock3, Moon, Sun } from 'lucide-react';
import { calculate, dateLabel, isNonBusiness, makeShift, hours } from '../domain/overtime.mjs';

export function ShiftForm({ initial, initialDate, onSave, onCancel }) {
  const [date, setDate] = useState(initial?.date || initialDate || '2026-09-04');
  const [kind, setKind] = useState(initial?.kind || 'night');
  const [start, setStart] = useState(initial?.start || '17:00');
  const [end, setEnd] = useState(initial?.end || '20:00');
  const [nextDay, setNextDay] = useState(initial ? initial.endDate !== initial.date : false);
  const [note, setNote] = useState(initial?.note || '');
  const [error, setError] = useState('');
  let shift, validation;
  try {
    shift = makeShift({ date, kind, start, end, nextDay, note, id: initial?.id });
  } catch (cause) {
    validation = cause.message;
  }
  const total = shift && calculate(shift);
  return (
    <div className="form-page">
      <button className="back text-button" onClick={onCancel}>
        <ArrowLeft size={18} /> Volver a mis horas
      </button>
      <h1>{initial ? 'Editar turno' : 'Registrar horas extras'}</h1>
      <form
        onSubmit={event => {
          event.preventDefault();
          if (!shift) return;
          try {
            onSave({
              date,
              kind,
              start,
              end,
              nextDay,
              note,
              id: initial?.id || crypto.randomUUID(),
            });
          } catch (cause) {
            setError(cause.message);
          }
        }}
      >
        <label>
          Fecha del turno
          <input
            type="date"
            min="2026-09-01"
            max="2026-09-30"
            value={date}
            onInput={event => {
              setDate(event.currentTarget.value);
              setError('');
            }}
            required
          />
        </label>
        <fieldset className="turn-options">
          <legend className="sr-only">Tipo de turno</legend>
          {[
            ['long', 'Turno largo', Sun],
            ['night', 'Turno noche', Moon],
            ['custom', 'Otro horario', Clock3],
          ].map(([value, text, Icon]) => (
            <button
              type="button"
              key={value}
              aria-pressed={kind === value}
              className={kind === value ? 'selected' : ''}
              onClick={() => {
                setKind(value);
                setError('');
              }}
            >
              <Icon size={27} />
              <span>{text}</span>
            </button>
          ))}
        </fieldset>
        {kind === 'custom' && (
          <div className="custom-time">
            <label>
              Entrada
              <input
                type="time"
                value={start}
                onInput={event => setStart(event.currentTarget.value)}
                required
              />
            </label>
            <label>
              Salida
              <input
                type="time"
                value={end}
                onInput={event => setEnd(event.currentTarget.value)}
                required
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={nextDay}
                onChange={event => setNextDay(event.target.checked)}
              />{' '}
              Termina al día siguiente
            </label>
          </div>
        )}
        {shift && (
          <>
            <div className="time-preview">
              <span>Horario del turno</span>
              <strong>
                {shift.start}
                <ArrowRight className="accent" size={31} />
                {shift.end}
              </strong>
              <p>
                Termina {dateLabel(shift.endDate)} ·{' '}
                {isNonBusiness(shift.endDate) ? 'día inhábil' : 'día hábil'}
              </p>
            </div>
            <div className="form-total">
              <span>Total de horas extras</span>
              <strong>
                {hours(total.total)} <small>h</small>
              </strong>
              <p>
                {hours(total.diurnal)} h diurnas · {hours(total.nocturnal)} h nocturnas/festivas
              </p>
            </div>
          </>
        )}
        <label>
          <span>
            Motivo u observación <span className="muted">(opcional)</span>
          </span>
          <textarea
            value={note}
            maxLength={200}
            rows={3}
            placeholder="Ej. Reemplazo de turno, necesidad de servicio…"
            onChange={event => setNote(event.target.value)}
          />
          <small className="counter">{note.length}/200</small>
        </label>
        {(error || validation) && (
          <p className="error" role="alert">
            {error || validation}
          </p>
        )}
        <button className="primary wide" disabled={!shift}>
          Guardar turno
        </button>
        <button type="button" className="text-button wide" onClick={onCancel}>
          Cancelar
        </button>
      </form>
    </div>
  );
}
