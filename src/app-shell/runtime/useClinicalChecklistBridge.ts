import { useEffect } from 'react';
import type { AuthContextType } from '@/context/AuthContext';
import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import type { ExtensionChecklistRequest } from '@/services/clinical-checklists/checklistService';

export function useClinicalChecklistBridge(auth: AuthContextType) {
  const uid = auth.isAuthorizedSession ? auth.authorizedUser?.uid : undefined;
  useEffect(() => {
    if (!uid) return;
    let active = true;
    async function serve(event: MessageEvent) {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.type !== 'HHR_CHECKLIST_REQUEST'
      )
        return;
      const { requestId, request } = event.data;
      if (
        typeof requestId !== 'string' ||
        requestId.length !== 36 ||
        !['templates', 'apply'].includes(request?.action)
      )
        return;
      const reply = (result: object) =>
        window.postMessage(
          { type: 'HHR_CHECKLIST_RESPONSE', requestId, ...result },
          location.origin
        );
      const sameUser = () => active && defaultAuthRuntime.getCurrentUser()?.uid === uid;
      try {
        if (!sameUser() || (request.action === 'apply' && request.uid !== uid))
          throw new Error('Cambió la sesión de HHR.');
        const { clinicalChecklist } =
          await import('@/services/clinical-checklists/checklistService');
        if (!sameUser()) throw new Error('Cambió la sesión de HHR.');
        const data = await clinicalChecklist(request as ExtensionChecklistRequest);
        if (sameUser()) reply({ data });
      } catch (error) {
        if (active)
          reply({
            error: error instanceof Error ? error.message : 'HHR no confirmó la operación.',
          });
      }
    }
    document.documentElement.setAttribute('data-hhr-checklists-ready', '');
    window.addEventListener('message', serve);
    return () => {
      active = false;
      document.documentElement.removeAttribute('data-hhr-checklists-ready');
      window.removeEventListener('message', serve);
    };
  }, [uid]);
}
