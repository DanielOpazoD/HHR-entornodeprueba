import { createCachedRuntimeLoader } from '@/services/runtime/createCachedRuntimeLoader';

export type HeicConverter = (options: {
  blob: Blob;
  toType: string;
  quality?: number;
}) => Promise<Blob | Blob[]>;

export class HeicConverterLoadFailure extends Error {
  constructor(cause: unknown) {
    super('HEIC/HEIF converter runtime could not be loaded.', { cause });
    this.name = 'HeicConverterLoadFailure';
  }
}

const resolveHeicConverter = async (): Promise<HeicConverter> => {
  const { default: heic2any } = await import('heic2any');
  return heic2any as HeicConverter;
};

export const loadHeicConverter = createCachedRuntimeLoader(
  resolveHeicConverter,
  error => new HeicConverterLoadFailure(error)
);
