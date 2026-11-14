import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DicomVolumeVideoControls } from '@/components/radiology/DicomVolumeVideoControls';
import type { DicomRuntime } from '@/services/radiology/dicomRuntimeTypes';

const runtime = (slices = { current: 4, total: 10 }) =>
  ({
    sessionId: 'synthetic',
    mprSlices: vi.fn(() => slices),
    onReconstruction: (listener: (state: unknown) => void) => {
      listener({ planes: [{ label: 'MIP · 10 mm' }, { label: 'Oblicuo · Corte fino' }] });
      return () => undefined;
    },
    openVideo: vi.fn(),
  }) as unknown as DicomRuntime;
const props = { disabled: false, busyChanged: vi.fn(), identity: 'PACIENTE SINTÉTICO · 1-9' };

describe('MPR and 3D video controls', () => {
  it('sweeps the whole active plane by default, anonymously, and counts back-and-forth frames', () => {
    render(<DicomVolumeVideoControls {...props} runtime={runtime()} mode="mpr" plane={0} />);
    expect(screen.getByLabelText('Plano del barrido')).toHaveTextContent(
      'Axial · MIP · 10 mm · corte actual 5 de 10'
    );
    expect(screen.getByLabelText('Corte inicial')).toHaveValue(1);
    expect(screen.getByLabelText('Corte final')).toHaveValue(10);
    expect(screen.getByLabelText('Perfil anónimo')).toBeChecked();
    expect(screen.getByLabelText('Resolución del video')).toHaveValue('720p');
    expect(screen.getByLabelText('Duración del video')).toHaveTextContent('10 cuadros · 1,0 s');
    fireEvent.change(screen.getByLabelText('Secuencia del video'), {
      target: { value: 'pingpong' },
    });
    expect(screen.getByLabelText('Duración del video')).toHaveTextContent('18 cuadros · 1,8 s');
  });
  it('names an oblique plane and resets the range when the plane changes', () => {
    const view = render(
      <DicomVolumeVideoControls {...props} runtime={runtime()} mode="mpr" plane={0} />
    );
    fireEvent.change(screen.getByLabelText('Corte final'), { target: { value: '6' } });
    view.rerender(
      <DicomVolumeVideoControls
        {...props}
        runtime={runtime({ current: 30, total: 64 })}
        mode="mpr"
        plane={1}
      />
    );
    expect(screen.getByLabelText('Plano del barrido')).toHaveTextContent(
      'Coronal · Oblicuo · Corte fino · corte actual 31 de 64'
    );
    expect(screen.getByLabelText('Corte final')).toHaveValue(64);
  });
  it('turns 360° in 48 frames by default and keeps the anonymous profile without identity', () => {
    render(
      <DicomVolumeVideoControls {...props} identity="" runtime={runtime()} mode="3d" plane={0} />
    );
    expect(screen.getByLabelText('Eje de giro 3D')).toHaveValue('vertical');
    expect(screen.getByLabelText('Giro 3D')).toHaveValue('360');
    expect(screen.getByLabelText('Duración del video')).toHaveTextContent('48 cuadros · 3,2 s');
    expect(screen.getByLabelText('Perfil anónimo')).toBeChecked();
    expect(screen.getByLabelText('Perfil anónimo')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Cuadros del giro 3D'), { target: { value: '2' } });
    expect(screen.queryByLabelText('Duración del video')).toBeNull();
  });
});
