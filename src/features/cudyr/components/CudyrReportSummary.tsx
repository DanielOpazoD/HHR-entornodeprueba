import type { CudyrReportTotals } from '@/types/domain/cudyrReport';

export const CudyrReportSummary = ({ totals }: { totals: CudyrReportTotals }) => (
  <>
    <section
      aria-label="Totales de la vista filtrada"
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      {[
        ['Elegibles conocidos', totals.eligible, 'text-slate-900'],
        ['Categorizados elegibles', totals.categorized, 'text-teal-800'],
        ['No elegibles', totals.excluded, 'text-slate-600'],
        ['Elegibilidad por revisar', totals.review, 'text-amber-800'],
      ].map(([label, value, color]) => (
        <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className={'mt-1 text-3xl font-bold ' + color}>{value}</p>
        </div>
      ))}
    </section>
    <p className="text-sm text-slate-600">
      {totals.withoutConfirmedResult} elegibles sin CUDYR disponible. «No registrado» indica
      ausencia comprobada; «Verificación pendiente» indica una consulta aún incompleta.
    </p>
    <details className="rounded-xl border bg-white p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Categorías por medias e intermedias
      </summary>
      <table className="mt-3 w-full max-w-xl text-center text-sm">
        <caption className="pb-2 text-left text-xs text-slate-500">
          Categorizados elegibles de la vista filtrada
        </caption>
        <thead className="bg-slate-50">
          <tr>
            <th scope="col" className="p-2">
              Categoría
            </th>
            <th scope="col">Intermedias</th>
            <th scope="col">Medias</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(totals.categories).map(([category, count]) => (
            <tr key={category} className="border-b border-slate-100">
              <th scope="row" className="p-1.5 font-medium">
                {category}
              </th>
              <td>{count.intermedia}</td>
              <td>{count.media}</td>
              <td>{count.intermedia + count.media}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  </>
);
