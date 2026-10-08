import { MONTHS, YEARS, periodInfo } from '../domain/calendar.mjs';
export function PeriodPicker({ period, onChange }) {
  const { year, month } = periodInfo(period);
  return (
    <section className="period-picker" aria-label="Período de horas extras">
      <label>
        Año
        <select
          value={year}
          onChange={event => onChange(`${event.target.value}-${String(month).padStart(2, '0')}`)}
        >
          {YEARS.map(value => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label>
        Mes
        <select
          value={month}
          onChange={event => onChange(`${year}-${event.target.value.padStart(2, '0')}`)}
        >
          {MONTHS.map((name, index) => (
            <option key={name} value={index + 1}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <p>Selecciona el mes y luego los días trabajados.</p>
    </section>
  );
}
