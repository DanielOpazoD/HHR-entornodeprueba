import { TrackballRotateTool } from '@cornerstonejs/tools';

/** Viewport sizing belongs to our world-position-preserving observer, not a camera reset. */
export class DicomTrackballRotateTool extends TrackballRotateTool {
  constructor(...args: ConstructorParameters<typeof TrackballRotateTool>) {
    super(...args);
    // Core tools 4.22 installs resize/global viewport listeners here, including for later
    // groups reusing the same id. Their resetCamera loses the reviewed slice/orientation.
    this.onSetToolActive = () => {};
    const disable = this.onSetToolDisabled;
    this.onSetToolDisabled = () => {
      disable.call(this);
      if (this.cleanUp) {
        document.removeEventListener('mouseup', this.cleanUp);
        this.cleanUp();
      }
    };
  }
}
