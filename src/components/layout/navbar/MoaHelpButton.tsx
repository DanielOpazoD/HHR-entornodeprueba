import { MoaIcon } from './MoaIcon';
import type { ModuleType } from '@/constants/navigationConfig';
import { setMoaVisible, useMoaVisibility } from '@/shared/ui/useMoaVisibility';

export const MoaHelpButton = ({ currentModule }: { currentModule?: ModuleType }) => {
  const visible = useMoaVisibility();
  if (currentModule && currentModule !== 'CENSUS') return null;
  const label = visible ? 'Ocultar Moa' : 'Mostrar Moa';
  return (
    <button
      type="button"
      data-moa-toggle
      onClick={() => setMoaVisible(!visible)}
      aria-label={label}
      aria-pressed={visible}
      aria-controls={visible ? 'census-moa' : undefined}
      title={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/20 text-white/90 transition-colors hover:bg-white/10 aria-pressed:border-white/40 aria-pressed:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none print:hidden"
    >
      <MoaIcon />
    </button>
  );
};

export default MoaHelpButton;
