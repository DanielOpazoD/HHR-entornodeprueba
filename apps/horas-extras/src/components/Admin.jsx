import { useState } from 'react';
import { Check, Download, Printer, LockKeyhole, RotateCcw, Search } from 'lucide-react';
import { hours, totals, periodInfo } from '../domain/overtime.mjs';
import { Badge, ShiftList, Totals } from './Shared.jsx';

export const ADMIN_ROLES = [
  'Jefatura de Hospitalizados',
  'Subrogancia de Jefatura',
  'Enfermera Coordinadora',
  'Subrogancia de Coordinación',
  'Enfermera Diurna',
];
const ACTION_LABELS = {
  save: 'Turno guardado',
  delete: 'Turno eliminado',
  submit: 'Mes enviado',
  approve: 'Mes aprobado',
  return: 'Corrección solicitada',
  close: 'Mes cerrado',
  reopen: 'Mes reabierto',
  'no-extras': 'Sin horas extras declarado',
};

export function Admin({ month, role, onAction, onExport, busy }) {
  const [group, setGroup] = useState('TENS');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('ana');
  const [reason, setReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const visible = month.sheets.filter(
    sheet =>
      sheet.group === group &&
      sheet.name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'))
  );
  const selected = visible.find(sheet => sheet.id === selectedId) || visible[0];
  const groupSheets = month.sheets.filter(sheet => sheet.group === group);
  const approved = groupSheets.filter(sheet => sheet.status === 'approved').length;
  return (
    <div className="admin-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRACIÓN</span>
          <h1>Revisión mensual</h1>
          <p>Hospitalizados · {periodInfo(month.period).label}</p>
        </div>
        <span className={`badge ${month.closed ? 'approved' : 'draft'}`}>
          {month.closed ? 'Mes cerrado' : 'Cierre del mes abierto'}
        </span>
      </header>
      <div className="admin-toolbar">
        <label className="search">
          <Search size={18} />
          <input
            type="search"
            placeholder="Buscar funcionario"
            aria-label="Buscar funcionario"
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              setReason('');
            }}
          />
        </label>
        <div className="tabs group-tabs" role="group" aria-label="Estamento del equipo">
          {['TENS', 'Enfermería'].map(item => (
            <button
              key={item}
              className={group === item ? 'active' : ''}
              aria-pressed={group === item}
              onClick={() => {
                setGroup(item);
                setReason('');
              }}
            >
              {item} · {month.sheets.filter(sheet => sheet.group === item).length}
            </button>
          ))}
        </div>
        <div className="export-actions">
          {['TENS', 'Enfermería'].map(item => (
            <button className="secondary" disabled={busy} key={item} onClick={() => onExport(item)}>
              <Download size={17} />
              Excel {item}
            </button>
          ))}
        </div>
      </div>
      <div className="admin-grid">
        <section className="card roster">
          <div className="section-heading">
            <h2>{group}</h2>
            <span>
              {approved} de {groupSheets.length} aprobados
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Funcionario</th>
                  <th>Grupo</th>
                  <th>Horas</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(sheet => (
                  <tr key={sheet.id} className={selected?.id === sheet.id ? 'selected' : ''}>
                    <td>
                      <button
                        className="person-button"
                        aria-pressed={selected?.id === sheet.id}
                        onClick={() => {
                          setSelectedId(sheet.id);
                          setReason('');
                        }}
                      >
                        {sheet.name}
                      </button>
                      {sheet.noExtras && <small>Sin horas declarado</small>}
                    </td>
                    <td>{sheet.group}</td>
                    <td>
                      {sheet.shifts.length || sheet.noExtras
                        ? `${hours(totals(sheet.shifts).total)} h`
                        : 'Pendiente'}
                    </td>
                    <td>
                      <Badge status={sheet.status} closed={month.closed} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!visible.length && <p className="empty">No se encontraron funcionarios.</p>}
          <p className="hint roster-hint">
            Sin registros no significa sin horas extras: el funcionario debe declararlo y enviar su
            mes.
          </p>
        </section>
        <section className="card detail" aria-label="Detalle del funcionario">
          {selected ? (
            <>
              <h2>{selected.name}</h2>
              <p className="muted">
                {selected.group} · Hospitalizados · {periodInfo(month.period).label}
              </p>
              <p className="print-only">
                {month.closed ? 'CERRADO' : 'BORRADOR'} · DEMOSTRACIÓN · RUT {selected.rut}
              </p>
              <button className="secondary print-button" onClick={() => window.print()}>
                <Printer size={17} />
                Imprimir resumen
              </button>
              <Badge status={selected.status} closed={month.closed} />
              <Totals compact value={totals(selected.shifts)} />
              {selected.noExtras ? (
                <p className="notice">
                  Declaración: no realizó horas extras en{' '}
                  {periodInfo(month.period).label.toLocaleLowerCase('es')}.
                </p>
              ) : (
                <ShiftList shifts={selected.shifts} />
              )}
              {selected.reason && <p className="notice warning">{selected.reason}</p>}
              {!month.closed && ['submitted', 'approved'].includes(selected.status) && (
                <div className="review-actions">
                  {selected.status === 'submitted' && (
                    <button
                      className="primary wide"
                      onClick={() => onAction({ type: 'approve', sheetId: selected.id })}
                    >
                      <Check size={18} />
                      Aprobar mes
                    </button>
                  )}
                  <label>
                    Corrección solicitada
                    <textarea
                      rows={2}
                      maxLength={500}
                      value={reason}
                      placeholder="Indica qué debe revisar el funcionario"
                      onChange={event => setReason(event.target.value)}
                    />
                  </label>
                  <button
                    className="secondary wide"
                    disabled={!reason.trim()}
                    onClick={() => {
                      onAction({ type: 'return', sheetId: selected.id, reason });
                      setReason('');
                    }}
                  >
                    Solicitar corrección
                  </button>
                </div>
              )}
            </>
          ) : (
            <p>Selecciona un funcionario.</p>
          )}
        </section>
      </div>
      <section className="card closing">
        <div>
          <h2>Cierre administrativo</h2>
          <p>
            Todos los administradores, incluida Enfermería Diurna, pueden cerrar y reabrir el mes.
          </p>
          <p className="hint">Perfil activo: {role}</p>
        </div>
        <div>
          {month.closed ? (
            <>
              <label>
                Motivo de reapertura
                <textarea
                  rows={2}
                  maxLength={500}
                  value={reopenReason}
                  onChange={event => setReopenReason(event.target.value)}
                />
              </label>
              <button
                className="secondary wide"
                disabled={!reopenReason.trim()}
                onClick={() => {
                  onAction({ type: 'reopen', reason: reopenReason });
                  setReopenReason('');
                }}
              >
                <RotateCcw size={18} />
                Reabrir mes
              </button>
            </>
          ) : (
            <>
              <p className="hint">El cierre requiere todas las planillas aprobadas.</p>
              <button className="primary wide" onClick={() => onAction({ type: 'close' })}>
                <LockKeyhole size={18} />
                Cerrar {periodInfo(month.period).label.toLocaleLowerCase('es')}
              </button>
            </>
          )}
        </div>
      </section>
      {month.audit.length > 0 && (
        <section className="card activity">
          <h2>Actividad de esta demostración</h2>
          <ol>
            {month.audit.slice(0, 8).map((event, index) => (
              <li key={index}>
                <strong>{ACTION_LABELS[event.type]}</strong>
                <span>
                  {event.actor}
                  {event.sheetId
                    ? ` · ${month.sheets.find(sheet => sheet.id === event.sheetId)?.name}`
                    : ''}
                </span>
                {event.reason && <p>{event.reason}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
