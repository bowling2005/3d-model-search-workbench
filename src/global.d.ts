import type { SourceApi } from '../core/types';

declare global {
  interface Window {
    modelSearch?: SourceApi;
  }
}

export {};
