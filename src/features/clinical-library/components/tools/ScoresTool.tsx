import React, { useState } from 'react';
import clsx from 'clsx';
import { ListChecks, RotateCcw } from 'lucide-react';
import { SCORE_DEFINITIONS, findScoreDefinition } from '../../domain/scoreDefinitions';
import { evaluateScore, type ScoreAnswers, type ScoreItem } from '../../domain/scoreEngine';
import { TONE_BADGE_CLASSES, formatClinicalNumber } from '../../controllers/libraryPresentation';
import { ToolFrame, type ToolComponentProps } from './ToolFrame';

const ScoreItemRow: React.FC<{
  scoreId: string;
  item: ScoreItem;
  answer: boolean | string | undefined;
  onAnswer: (itemId: string, value: boolean | string) => void;
}> = ({ scoreId, item, answer, onAnswer }) => {
  if (item.kind === 'boolean') {
    return (
      <label className="flex cursor-pointer items-start gap-2.5 border-b border-slate-100 px-3 py-2 last:border-b-0 hover:bg-slate-50">
        <input
          type="checkbox"
          checked={answer === true}
          onChange={event => onAnswer(item.id, event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-medical-600"
        />
        <span className="flex-1 text-[12px] leading-snug text-slate-700">
          {item.label}
          {item.help && (
            <span className="mt-0.5 block text-[10px] text-slate-400">{item.help}</span>
          )}
        </span>
        <span className="text-[11px] font-bold tabular-nums text-slate-500">
          +{formatClinicalNumber(item.points)}
        </span>
      </label>
    );
  }
  const groupName = `${scoreId}-${item.id}`;
  return (
    <fieldset className="border-b border-slate-100 px-3 py-2 last:border-b-0">
      <legend className="text-[12px] font-semibold text-slate-700">{item.label}</legend>
      {item.help && <p className="text-[10px] text-slate-400">{item.help}</p>}
      <div className="mt-1 space-y-0.5">
        {item.options.map(option => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[12px] text-slate-700 hover:bg-slate-50"
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={answer === option.value}
              onChange={() => onAnswer(item.id, option.value)}
              className="size-3.5 accent-medical-600"
            />
            <span className="flex-1">{option.label}</span>
            <span className="text-[11px] font-bold tabular-nums text-slate-500">
              {option.points}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
};

export const ScoresTool: React.FC<ToolComponentProps> = ({ onBack, onClose }) => {
  const [activeId, setActiveId] = useState(SCORE_DEFINITIONS[0].id);
  const [answersById, setAnswersById] = useState<Record<string, ScoreAnswers>>({});
  const definition = findScoreDefinition(activeId) ?? SCORE_DEFINITIONS[0];
  const answers = answersById[definition.id] ?? {};
  const evaluation = evaluateScore(definition, answers);
  const band = evaluation.band;

  const setAnswer = (itemId: string, value: boolean | string): void => {
    setAnswersById(previous => ({
      ...previous,
      [definition.id]: { ...(previous[definition.id] ?? {}), [itemId]: value },
    }));
  };
  const reset = (): void => {
    setAnswersById(previous => ({ ...previous, [definition.id]: {} }));
  };

  return (
    <ToolFrame
      title="Scores clínicos"
      icon={<ListChecks size={16} aria-hidden="true" />}
      onBack={onBack}
      onClose={onClose}
      reference={definition.reference}
      testId="library-tool-scores"
    >
      <div className="flex flex-wrap gap-1" role="group" aria-label="Score">
        {SCORE_DEFINITIONS.map(item => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.id === definition.id}
            onClick={() => setActiveId(item.id)}
            className={clsx(
              'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600',
              item.id === definition.id
                ? 'border-medical-600 bg-medical-600 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-medical-300 hover:text-medical-700'
            )}
          >
            {item.shortName}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[13px] font-bold text-slate-800">{definition.name}</h4>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{definition.purpose}</p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600"
        >
          <RotateCcw size={12} aria-hidden="true" />
          Limpiar
        </button>
      </div>

      <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {definition.items.map(item => (
          <ScoreItemRow
            key={item.id}
            scoreId={definition.id}
            item={item}
            answer={answers[item.id]}
            onAnswer={setAnswer}
          />
        ))}
      </div>

      <div
        role="status"
        aria-live="polite"
        data-testid="score-result"
        data-band={band?.label ?? ''}
        className={clsx(
          'mt-3 rounded-lg border p-3',
          band ? TONE_BADGE_CLASSES[band.tone] : 'border-slate-200 bg-white text-slate-700'
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
            {definition.shortName}
          </p>
          <p className="text-2xl font-bold tabular-nums">
            {formatClinicalNumber(evaluation.total)}
            <span className="text-xs font-semibold opacity-60">
              {' '}
              / {formatClinicalNumber(evaluation.maxTotal)}
            </span>
          </p>
        </div>
        {band ? (
          <>
            <p className="text-[13px] font-bold">{band.label}</p>
            <p className="mt-0.5 text-[11px] leading-snug">{band.detail}</p>
          </>
        ) : (
          <p className="text-[11px]">
            {evaluation.missingItemIds.length}{' '}
            {evaluation.missingItemIds.length === 1 ? 'ítem pendiente' : 'ítems pendientes'}
          </p>
        )}
      </div>

      {definition.notes && definition.notes.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-slate-500">
          {definition.notes.map(note => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </ToolFrame>
  );
};
