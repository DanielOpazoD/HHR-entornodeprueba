import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, FileWarning, GitCommitHorizontal } from 'lucide-react';

type ReleaseEvidenceStatus = 'current' | 'stale' | 'unavailable';

interface ReleaseEvidenceManifest {
  generatedAt: string | null;
  gitSha: string | null;
  status: ReleaseEvidenceStatus;
  summary: {
    decisionReports: number;
    currentReports: number;
    staleReports: number;
  };
}

const unavailableManifest: ReleaseEvidenceManifest = {
  generatedAt: null,
  gitSha: null,
  status: 'unavailable',
  summary: { decisionReports: 0, currentReports: 0, staleReports: 0 },
};

const formatGeneratedAt = (generatedAt: string | null) => {
  if (!generatedAt) return 'Sin fecha verificable';
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) return 'Fecha inválida';
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Pacific/Easter',
  }).format(date);
};

const statusPresentation = {
  current: {
    label: 'Vigente',
    detail: 'La evidencia corresponde al código de este build.',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    Icon: CheckCircle2,
  },
  stale: {
    label: 'Desactualizada',
    detail: 'No usar estos informes para aprobar un release.',
    className: 'border-amber-200 bg-amber-50 text-amber-900',
    Icon: FileWarning,
  },
  unavailable: {
    label: 'No generada',
    detail: 'Este build no incluye un contrato de evidencia verificable.',
    className: 'border-slate-200 bg-slate-50 text-slate-700',
    Icon: FileWarning,
  },
} as const;

export const ReleaseEvidenceStatusPanel = () => {
  const [manifest, setManifest] = useState<ReleaseEvidenceManifest>(unavailableManifest);

  useEffect(() => {
    const controller = new AbortController();
    const loadManifest = async () => {
      try {
        const response = await fetch('/release-evidence.json', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as ReleaseEvidenceManifest;
        if (!['current', 'stale', 'unavailable'].includes(payload.status)) {
          throw new Error('Estado de evidencia inválido');
        }
        setManifest(payload);
      } catch (loadError) {
        if (!controller.signal.aborted) setManifest(unavailableManifest);
      }
    };
    void loadManifest();
    return () => controller.abort();
  }, []);

  const presentation = statusPresentation[manifest.status];
  const StatusIcon = presentation.Icon;

  return (
    <section className={`rounded-xl border p-4 ${presentation.className}`} aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <StatusIcon className="mt-0.5 shrink-0" size={22} aria-hidden="true" />
          <div>
            <h2 className="font-semibold">Evidencia del release</h2>
            <p className="text-sm opacity-80">{presentation.detail}</p>
          </div>
        </div>
        <span className="rounded-full border border-current/20 px-3 py-1 text-sm font-semibold">
          {presentation.label}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="flex items-center gap-1.5 font-medium opacity-70">
            <GitCommitHorizontal size={16} aria-hidden="true" /> SHA
          </dt>
          <dd className="mt-1 font-mono">{manifest.gitSha?.slice(0, 12) || 'No disponible'}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 font-medium opacity-70">
            <Clock3 size={16} aria-hidden="true" /> Generada
          </dt>
          <dd className="mt-1">{formatGeneratedAt(manifest.generatedAt)}</dd>
        </div>
        <div>
          <dt className="font-medium opacity-70">Informes de decisión vigentes</dt>
          <dd className="mt-1 font-semibold">
            {manifest.summary.currentReports}/{manifest.summary.decisionReports}
          </dd>
        </div>
      </dl>
    </section>
  );
};
