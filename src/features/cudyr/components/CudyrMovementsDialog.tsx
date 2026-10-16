import { BaseModal } from '@/components/shared/BaseModal';
import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import { cudyrMomentLabel, CUDYR_MODALITY_LABELS } from '@/services/cudyr/cudyrReportPresentation';

export const CudyrMovementsDialog = ({
  row,
  onClose,
}: {
  row: CudyrReportRow;
  onClose: () => void;
}) => (
  <BaseModal isOpen onClose={onClose} title="Movimientos de camas" size="lg">
    <div className="space-y-3 text-sm">
      <p className="font-semibold text-slate-900">{row.patientName}</p>
      <div className="rounded-lg bg-teal-50 p-3 text-teal-900">
        <p className="text-xs">Primer ingreso registrado a Hospitalizados</p>
        <p className="font-semibold">
          {row.hospitalAdmissionAt ? cudyrMomentLabel(row.hospitalAdmissionAt) : 'Por confirmar'}
        </p>
        <p className="mt-1 text-xs">{row.hospitalAdmissionSource}</p>
      </div>
      {row.hospitalStayAdmissionAt && row.hospitalStayAdmissionAt !== row.hospitalAdmissionAt && (
        <p className="text-xs text-slate-600">
          Tramo continuo para las 8 horas: {cudyrMomentLabel(row.hospitalStayAdmissionAt)}. No
          incluye permanencia intermedia en UEA, CMA o cuna.
        </p>
      )}
      <p className="text-xs text-slate-500">
        Asignaciones archivadas en HHR desde Eloísa para este episodio. La lista puede estar
        incompleta; un inicio de cama puede ser un traslado interno. Horario de Rapa Nui.
      </p>
      {row.bedHistory?.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-slate-50 text-slate-500">
              <tr>
                {['Cama · Eloísa', 'Entrada', 'Salida', 'Evidencia'].map(label => (
                  <th key={label} scope="col" className="p-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {row.bedHistory.map(item => (
                <tr key={item.key} className="border-b border-slate-100">
                  <td className="p-2">
                    <span className="font-medium">{item.bed}</span>
                    <div className="text-[11px] text-slate-500">
                      {item.service || CUDYR_MODALITY_LABELS[item.modality]}
                    </div>
                  </td>
                  <td className="p-2 tabular-nums">{cudyrMomentLabel(item.startAt)}</td>
                  <td className="p-2 tabular-nums">
                    {item.endAt ? cudyrMomentLabel(item.endAt) : 'No informada'}
                  </td>
                  <td
                    className="p-2"
                    title={`Última captura: ${cudyrMomentLabel(item.observedAt)}`}
                  >
                    {item.status === 'anulada'
                      ? 'Anulada'
                      : item.status === 'contradictoria'
                        ? 'Datos contradictorios'
                        : item.status === 'finalizada'
                          ? 'Intervalo cerrado'
                          : 'Sin cierre informado'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-xs text-slate-600">
          No hay movimientos de camas archivados para este episodio. Esto no significa que no haya
          tenido movimientos.
        </p>
      )}
    </div>
  </BaseModal>
);
