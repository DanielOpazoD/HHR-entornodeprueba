import { useEffect, useRef, useState } from 'react';
import type { ClinicalActionResult } from '@/features/rayen-import';

export const ClinicalAntecedentDauLogin = ({
  auth,
  onComplete,
  onCancel,
}: {
  auth: NonNullable<ClinicalActionResult['auth']>;
  onComplete: () => void;
  onCancel: () => void;
}) => {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(340);
  useEffect(() => {
    const url = new URL(auth.url);
    const expectedOrigin = `${url.protocol}//${url.host}`;
    const onMessage = (event: MessageEvent): void => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== expectedOrigin ||
        event.data?.type !== 'HHR_URGENCY_LOGIN_STATE' ||
        event.data.flowId !== auth.flowId
      )
        return;
      if (event.data.state === 'authenticated') onComplete();
      if (event.data.state === 'cancelled') onCancel();
      if (
        event.data.state === 'resize' &&
        typeof event.data.height === 'number' &&
        Number.isFinite(event.data.height)
      )
        setHeight(Math.min(520, Math.max(180, event.data.height)));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [auth, onComplete, onCancel]);
  return (
    <div className="mt-2 rounded-md border border-teal-200 bg-slate-50">
      <iframe
        ref={frame}
        title="Acceso seguro a Rayen Urgencias"
        src={auth.url}
        sandbox="allow-scripts allow-forms allow-same-origin"
        referrerPolicy="no-referrer"
        style={{ height }}
        className="block w-full rounded-md border-0"
      />
      <button type="button" onClick={onCancel} className="px-2 pb-2 text-slate-600 underline">
        Cerrar acceso
      </button>
    </div>
  );
};
