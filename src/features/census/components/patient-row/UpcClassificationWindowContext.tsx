import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { useOptionalDailyRecordBeds } from '@/context/DailyRecordContext';
import { PanelModuleRetry, RecoverableClinicalPanelModule } from './RecoverableClinicalPanelModule';

interface UpcCellSubjectLike {
  patientName?: string;
  clinicalEpisodeId?: string;
  documentType?: 'RUT' | 'Pasaporte' | string;
  rut?: string;
  neonatalMaternalRut?: string;
  firstSeenDate?: string;
  admissionDate?: string;
  admissionTime?: string;
}

const isAccreditedEpisodeId = (episode: string): boolean =>
  Boolean(episode) && !episode.startsWith('legacy_ep_');

/**
 * Fingerprints the patient occupying a clicked UPC cell even when the name is still empty
 * (e.g. a bed or crib with only RUT/document and clinicalEpisodeId) so turnover during a
 * deferred load or retry never opens the round on a replacement patient, while completing the
 * name of the same accredited or legacy episode preserves the pending open.
 */
export const resolveUpcCellSubjectIdentity = (
  subject?: UpcCellSubjectLike | null
): string | null => {
  if (!subject) return null;
  const episode = subject.clinicalEpisodeId?.trim() || '';
  if (isAccreditedEpisodeId(episode)) {
    return episode;
  }
  const docType = subject.documentType?.trim() || 'RUT';
  const name = subject.patientName?.trim() || '';
  const rut = subject.rut?.trim() || '';
  const firstSeenDate = subject.firstSeenDate?.trim() || '';
  const admissionDate = subject.admissionDate?.trim() || '';
  const admissionTime = subject.admissionTime?.trim() || '';
  const maternalRut = subject.neonatalMaternalRut?.trim() || '';
  if (
    !episode &&
    !name &&
    !rut &&
    !firstSeenDate &&
    !admissionDate &&
    !admissionTime &&
    !maternalRut
  ) {
    return null;
  }
  return JSON.stringify([
    'legacy',
    episode,
    docType,
    rut,
    name,
    firstSeenDate,
    admissionDate,
    admissionTime,
    maternalRut,
  ]);
};

type LegacyUpcSubjectTuple = [
  tag: 'legacy',
  episode: string,
  docType: string,
  rut: string,
  name: string,
  firstSeenDate: string,
  admissionDate: string,
  admissionTime: string,
  maternalRut: string,
];

const isSameUpcCellSubjectIdentity = (expected: string | null, current: string | null): boolean => {
  if (expected === current) return true;
  if (!expected || !current) return false;
  if (!expected.startsWith('["legacy",') || !current.startsWith('["legacy",')) {
    return false;
  }
  try {
    const [
      ,
      expectedEpisode,
      expectedDocType,
      expectedRut,
      expectedName,
      expectedFirstSeenDate,
      expectedAdmissionDate,
      expectedTime,
      expectedMaternalRut,
    ] = JSON.parse(expected) as LegacyUpcSubjectTuple;
    const [
      ,
      currentEpisode,
      currentDocType,
      currentRut,
      currentName,
      currentFirstSeenDate,
      currentAdmissionDate,
      currentTime,
      currentMaternalRut,
    ] = JSON.parse(current) as LegacyUpcSubjectTuple;
    return (
      expectedName === '' &&
      currentName !== '' &&
      (expectedEpisode !== '' || expectedRut !== '') &&
      expectedEpisode === currentEpisode &&
      expectedDocType === currentDocType &&
      expectedRut === currentRut &&
      expectedFirstSeenDate === currentFirstSeenDate &&
      expectedAdmissionDate === currentAdmissionDate &&
      expectedTime === currentTime &&
      expectedMaternalRut === currentMaternalRut
    );
  } catch {
    return false;
  }
};

const loadUpcClassificationWindow = () =>
  import('./UpcClassificationWindow').then(module => ({
    default: module.UpcClassificationWindow,
  }));

let UpcClassificationWindowModule = React.lazy(loadUpcClassificationWindow);
const resetUpcClassificationWindowModule = () => {
  UpcClassificationWindowModule = React.lazy(loadUpcClassificationWindow);
};

interface OpenUpcWindowOptions {
  crib?: boolean;
  /** Episode occupying the clicked bed/crib at trigger time; cancels pending open if it changes. */
  episodeIdentity?: string | null;
  /** Trigger button that opened the window so pointer clicks in WebKit also restore focus to it. */
  triggerElement?: HTMLElement | null;
}

interface UpcClassificationWindowContextValue {
  /** The census header opens the round; a patient cell selects its bed or clinical crib. */
  openUpcWindow: (bedId?: string, options?: OpenUpcWindowOptions) => void;
}

const UpcClassificationWindowContext =
  React.createContext<UpcClassificationWindowContextValue | null>(null);

export const useUpcClassificationWindowOpener = (): UpcClassificationWindowContextValue => {
  const context = React.useContext(UpcClassificationWindowContext);
  // Sin proveedor la celda queda inerte en vez de tumbar el censo completo: en un tablero clínico
  // un botón que no abre es un fallo recuperable, una tabla en blanco no.
  return context ?? { openUpcWindow: () => undefined };
};

const UpcClassificationWindowLoadingFallback: React.FC<{
  onClose: () => void;
}> = ({ onClose }) => (
  <BaseModal
    isOpen
    onClose={onClose}
    title="Abriendo ronda UPC…"
    icon={<ShieldCheck aria-hidden="true" />}
    headerIconColor="text-medical-700"
    size="md"
    closeOnBackdrop
    dataTestId="upc-window-module-loading"
  >
    <div role="status" aria-busy="true" className="text-xs text-slate-600">
      Cargando clasificación UPC…
    </div>
  </BaseModal>
);

const UpcClassificationWindowErrorFallback: React.FC<{
  onClose: () => void;
  onRetry: () => void;
}> = ({ onClose, onRetry }) => (
  <BaseModal
    isOpen
    onClose={onClose}
    title="Clasificación UPC"
    icon={<ShieldCheck aria-hidden="true" />}
    headerIconColor="text-medical-700"
    size="md"
    closeOnBackdrop
  >
    <PanelModuleRetry onRetry={onRetry} />
  </BaseModal>
);

const UpcResolvedWindowBoundary: React.FC<{
  onResolvedChange: (resolved: boolean) => void;
  children: React.ReactNode;
}> = ({ onResolvedChange, children }) => {
  useLayoutEffect(() => {
    onResolvedChange(true);
    return () => onResolvedChange(false);
  }, [onResolvedChange]);
  return <>{children}</>;
};

interface UpcWindowHostProps {
  currentDateString: string;
  readOnly: boolean;
  rawBedId: string | null;
  isCrib: boolean;
  initialBedId: string | null;
  hasExpectedEpisode: boolean;
  expectedEpisodeIdentity: string | null;
  onClose: () => void;
  onCancelStaleOpen: () => void;
}

/**
 * Mounted only while a UPC window request is active so normal census editing does not subscribe
 * to bed updates through the provider. Cancels any pending load or retry before the dialog mounts
 * if the clicked bed or crib changed occupant on the same census day.
 */
const UpcWindowHost: React.FC<UpcWindowHostProps> = ({
  currentDateString,
  readOnly,
  rawBedId,
  isCrib,
  initialBedId,
  hasExpectedEpisode,
  expectedEpisodeIdentity,
  onClose,
  onCancelStaleOpen,
}) => {
  const beds = useOptionalDailyRecordBeds();
  const [hasResolvedWindow, setHasResolvedWindow] = useState(false);

  const currentSubject =
    rawBedId && beds ? (isCrib ? beds[rawBedId]?.clinicalCrib : beds[rawBedId]) : undefined;
  const currentEpisodeIdentity = resolveUpcCellSubjectIdentity(currentSubject);
  const currentParentSubject = rawBedId && beds && isCrib ? beds[rawBedId] : undefined;
  const currentParentIdentity = isCrib ? resolveUpcCellSubjectIdentity(currentParentSubject) : null;
  const [hasTrackableContextBed] = useState(
    () =>
      beds !== undefined &&
      (currentEpisodeIdentity !== null || (beds !== null && Object.keys(beds).length > 0))
  );
  const [latchedEpisodeIdentity, setLatchedEpisodeIdentity] = useState<string | null>(
    () => expectedEpisodeIdentity
  );
  const [latchedParentIdentity, setLatchedParentIdentity] = useState<string | null>(
    () => currentParentIdentity
  );

  const subjectStillMatches = isSameUpcCellSubjectIdentity(
    latchedEpisodeIdentity,
    currentEpisodeIdentity
  );
  const parentStillMatches =
    !isCrib || isSameUpcCellSubjectIdentity(latchedParentIdentity, currentParentIdentity);
  const isStalePendingEpisode =
    !hasResolvedWindow &&
    hasExpectedEpisode &&
    hasTrackableContextBed &&
    (!subjectStillMatches || !parentStillMatches);

  // Once an unnamed legacy occupant receives its name, latch it monotonically so a second
  // replacement (unnamed -> A -> B) cannot pass through the initial empty-name allowance.
  if (
    !hasResolvedWindow &&
    hasExpectedEpisode &&
    hasTrackableContextBed &&
    !isStalePendingEpisode
  ) {
    if (currentEpisodeIdentity !== latchedEpisodeIdentity) {
      setLatchedEpisodeIdentity(currentEpisodeIdentity);
    }
    if (isCrib && currentParentIdentity !== latchedParentIdentity) {
      setLatchedParentIdentity(currentParentIdentity);
    }
  }

  useLayoutEffect(() => {
    if (isStalePendingEpisode) {
      onCancelStaleOpen();
    }
  }, [isStalePendingEpisode, onCancelStaleOpen]);

  if (isStalePendingEpisode) {
    return null;
  }

  return (
    <RecoverableClinicalPanelModule
      resetModule={resetUpcClassificationWindowModule}
      fallback={retry =>
        retry ? (
          <UpcClassificationWindowErrorFallback onClose={onClose} onRetry={retry} />
        ) : (
          <UpcClassificationWindowLoadingFallback onClose={onClose} />
        )
      }
      render={() => (
        <UpcResolvedWindowBoundary onResolvedChange={setHasResolvedWindow}>
          <UpcClassificationWindowModule
            currentDateString={currentDateString}
            readOnly={readOnly}
            initialBedId={initialBedId}
            onClose={onClose}
          />
        </UpcResolvedWindowBoundary>
      )}
    />
  );
};

interface UpcClassificationWindowProviderProps {
  currentDateString: string;
  readOnly?: boolean;
  children: React.ReactNode;
}

interface UpcWindowOpenState {
  openSeq: number;
  isOpen: boolean;
  rawBedId: string | null;
  isCrib: boolean;
  bedId: string | null;
  openedForDate: string | null;
  hasExpectedEpisode: boolean;
  expectedEpisodeIdentity: string | null;
}

const CLOSED_UPC_WINDOW_STATE: UpcWindowOpenState = {
  openSeq: 0,
  isOpen: false,
  rawBedId: null,
  isCrib: false,
  bedId: null,
  openedForDate: null,
  hasExpectedEpisode: false,
  expectedEpisodeIdentity: null,
};

/**
 * Holds the single day-level UPC window so every UPC cell in the census opens the same panel
 * instead of rendering its own anchored popover.
 *
 * The dialog module loads only on open so initial census paint does not parse the checklist
 * panel until a clinician requests it. Pending or open requests are scoped to the census date
 * (and, when opened from a bed or crib cell, to that episode) so changing days or replacing a
 * bed occupant during load never opens another patient's episode.
 */
export const UpcClassificationWindowProvider: React.FC<UpcClassificationWindowProviderProps> = ({
  currentDateString,
  readOnly = false,
  children,
}) => {
  const [openState, setOpenState] = useState<UpcWindowOpenState>(CLOSED_UPC_WINDOW_STATE);
  const openSeqRef = useRef(0);
  const openerRef = useRef<HTMLElement | null>(null);
  const priorActiveBeforeOpenRef = useRef<HTMLElement | null>(null);
  const restoreOpenerOnCloseRef = useRef<HTMLElement | null>(null);

  if (openState.isOpen && openState.openedForDate !== currentDateString) {
    setOpenState(CLOSED_UPC_WINDOW_STATE);
  }
  const isWindowOpen = openState.isOpen && openState.openedForDate === currentDateString;

  const openUpcWindow = useCallback(
    (bedId?: string, options?: OpenUpcWindowOptions) => {
      const activeElement =
        typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const trigger =
        options?.triggerElement instanceof HTMLElement
          ? options.triggerElement
          : activeElement &&
              activeElement !== document.body &&
              !activeElement.closest('[role="dialog"]')
            ? activeElement
            : null;
      if (trigger) {
        openerRef.current = trigger;
      }
      priorActiveBeforeOpenRef.current = activeElement;
      restoreOpenerOnCloseRef.current = null;
      const isCrib = Boolean(bedId && options?.crib);
      const hasExpectedEpisode = Boolean(options && 'episodeIdentity' in options);
      openSeqRef.current += 1;
      setOpenState({
        openSeq: openSeqRef.current,
        isOpen: true,
        rawBedId: bedId ?? null,
        isCrib,
        bedId: bedId && isCrib ? `${bedId}:crib` : (bedId ?? null),
        openedForDate: currentDateString,
        hasExpectedEpisode,
        expectedEpisodeIdentity: options?.episodeIdentity ?? null,
      });
    },
    [currentDateString]
  );

  const closeUpcWindow = useCallback(() => {
    restoreOpenerOnCloseRef.current = openerRef.current;
    openerRef.current = null;
    setOpenState(CLOSED_UPC_WINDOW_STATE);
  }, []);

  const cancelStaleOpen = useCallback(() => {
    restoreOpenerOnCloseRef.current = null;
    openerRef.current = null;
    priorActiveBeforeOpenRef.current = null;
    setOpenState(CLOSED_UPC_WINDOW_STATE);
  }, []);

  useLayoutEffect(() => {
    if (isWindowOpen) return;
    const openerToRestore = restoreOpenerOnCloseRef.current;
    const priorActive = priorActiveBeforeOpenRef.current;
    restoreOpenerOnCloseRef.current = null;
    priorActiveBeforeOpenRef.current = null;
    if (!openerToRestore) {
      openerRef.current = null;
      return;
    }
    if (
      openerToRestore.isConnected &&
      typeof document !== 'undefined' &&
      !document.activeElement?.closest('[role="dialog"]') &&
      (!document.activeElement ||
        document.activeElement === document.body ||
        !document.activeElement.isConnected ||
        document.activeElement === priorActive)
    ) {
      openerToRestore.focus();
    }
  }, [isWindowOpen]);

  const value = useMemo(() => ({ openUpcWindow }), [openUpcWindow]);

  return (
    <UpcClassificationWindowContext.Provider value={value}>
      {children}
      {isWindowOpen && (
        <UpcWindowHost
          key={openState.openSeq}
          currentDateString={currentDateString}
          readOnly={readOnly}
          rawBedId={openState.rawBedId}
          isCrib={openState.isCrib}
          initialBedId={openState.bedId}
          hasExpectedEpisode={openState.hasExpectedEpisode}
          expectedEpisodeIdentity={openState.expectedEpisodeIdentity}
          onClose={closeUpcWindow}
          onCancelStaleOpen={cancelStaleOpen}
        />
      )}
    </UpcClassificationWindowContext.Provider>
  );
};
