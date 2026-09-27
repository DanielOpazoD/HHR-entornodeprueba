/**
 * useCensusTableDragDrop
 *
 * Encapsulates HTML5 native drag & drop for moving patients between
 * beds. Shows a confirmation dialog before executing the move.
 *
 * @param onMoveToBed - Callback to execute the actual bed move
 * @param bedsRecord - Current beds map to resolve patient names
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import type { DragEvent } from 'react';
import type {
  DragDropVisualState,
  PendingBedMove,
  CensusTableDragDropBundle,
} from '@/features/census/drag-drop/dragDropContracts';
import {
  DRAG_DATA_FORMAT,
  buildPendingBedMove,
} from '@/features/census/drag-drop/dragDropController';

export function useCensusTableDragDrop(
  onMoveToBed: (sourceBedId: string, targetBedId: string) => void,
  bedsRecord: Record<string, { patientName?: string } | undefined>
): CensusTableDragDropBundle {
  const [dragSourceBedId, setDragSourceBedId] = useState<string | null>(null);
  const [dragOverBedId, setDragOverBedId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingBedMove | null>(null);
  const dragCounterRef = useRef(0);
  const dragStartHandlersRef = useRef(new Map<string, (event: DragEvent) => void>());

  // ---- Patient row handlers ----

  const onDragStart = useCallback((bedId: string) => {
    const cached = dragStartHandlersRef.current.get(bedId);
    if (cached) return cached;
    const handler = (event: DragEvent) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(DRAG_DATA_FORMAT, bedId);
      setDragSourceBedId(bedId);
    };
    dragStartHandlersRef.current.set(bedId, handler);
    return handler;
  }, []);

  const onDragEnd = useCallback(() => {
    setDragSourceBedId(null);
    setDragOverBedId(null);
    dragCounterRef.current = 0;
  }, []);

  // ---- Empty bed handlers ----

  const onDragOver = useCallback(
    (_bedId: string) => (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    []
  );

  const onDragEnter = useCallback(
    (bedId: string) => (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current++;
      setDragOverBedId(bedId);
    },
    []
  );

  const onDragLeave = useCallback(() => {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      setDragOverBedId(null);
      dragCounterRef.current = 0;
    }
  }, []);

  const onDrop = useCallback(
    (targetBedId: string) => (e: DragEvent) => {
      e.preventDefault();
      const sourceBedId = e.dataTransfer.getData(DRAG_DATA_FORMAT);
      setDragSourceBedId(null);
      setDragOverBedId(null);
      dragCounterRef.current = 0;

      const move = buildPendingBedMove(sourceBedId, targetBedId, bedsRecord);
      if (move) {
        setPendingMove(move);
      }
    },
    [bedsRecord]
  );

  // ---- Confirmation handlers ----

  const onConfirm = useCallback(() => {
    if (pendingMove) {
      onMoveToBed(pendingMove.sourceBedId, pendingMove.targetBedId);
      setPendingMove(null);
    }
  }, [pendingMove, onMoveToBed]);

  const onCancel = useCallback(() => {
    setPendingMove(null);
  }, []);

  // ---- Bundle ----

  const state = useMemo(
    (): DragDropVisualState => ({ dragSourceBedId, dragOverBedId, pendingMove }),
    [dragSourceBedId, dragOverBedId, pendingMove]
  );

  return {
    state,
    patientHandlers: { onDragStart, onDragEnd },
    emptyBedHandlers: { onDragOver, onDragEnter, onDragLeave, onDrop },
    confirmationHandlers: { onConfirm, onCancel },
  };
}
