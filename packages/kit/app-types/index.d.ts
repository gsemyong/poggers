type AnyFunction = (...args: any[]) => any;

export const nav: Record<string, AnyFunction>;

export function useScreen(): Record<string, any>;

export function usePreset(): string;

export function setPreset(preset: string): void;

export function useTheme(): Record<string, any>;

export function setThemeParam(param: string, value: any): void;

export function start(connect?: any): void;

export function Root(props?: any): any;

export default Root;
