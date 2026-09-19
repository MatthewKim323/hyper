// Ambient types shared by the engine.

declare module "troika-three-text" {
  // troika ships no types; the engine treats it as untyped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Text: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function preloadFont(options: any, callback: () => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function getSelectionRects(textRenderInfo: any, start: number, end: number): any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function configureTextBuilder(config: any): void;
}

interface Window {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store?: any;
  globalData?: { publicUrl?: string; assetsUrl?: string; [key: string]: unknown };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Typekit?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  projects?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  worldData?: any;
}
