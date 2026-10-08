import { Download } from 'lucide-react';
import { hours, totals } from '../domain/overtime.mjs';

export function Admin({ month, onExport, busy }) {
  return (
    <section className="admin-page">
      <header className="page-heading">
        <h1>Planillas del equipo</h1>
        <p>Descarga las horas registradas del mes seleccionado.</p>
      </header>
      {['TENS', 'Enfermería'].map(group => {
        const people = month.sheets.filter(person => person.group === group);
        return (
          <section className="group-section" key={group} aria-label={group}>
            <div className="section-heading">
              <h2>{group}</h2>
              <button className="secondary" disabled={busy} onClick={() => onExport(group)}>
                <Download size={17} />
                {busy ? 'Preparando…' : `Descargar Excel ${group}`}
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Funcionario</th>
                  <th>Turnos</th>
                  <th>Horas</th>
                </tr>
              </thead>
              <tbody>
                {people.map(person => (
                  <tr key={person.id}>
                    <td>{person.name}</td>
                    <td>{person.shifts.length || 'Sin registros'}</td>
                    <td>
                      {person.shifts.length ? `${hours(totals(person.shifts).total)} h` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </section>
  );
}
