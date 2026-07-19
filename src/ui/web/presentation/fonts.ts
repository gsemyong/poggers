import type { FontAsset, FontAssetSource } from "./language";

export type WebFontLease = Readonly<{
  key: string;
  release(): void;
}>;

export type WebFontRegistry = Readonly<{
  acquire(document: Document, font: FontAsset): WebFontLease;
}>;

type SharedFont = {
  readonly faces: readonly FontFace[];
  references: number;
};

/** Resolves one stable CSS family without exposing browser naming in Presentation source. */
export function webFontFamily(font: FontAsset): string | undefined {
  if (font.family) return font.family;
  if (!font.sources?.length) return undefined;
  return `poggers-${hash(fontKey(font))}`;
}

export function webFontKey(font: FontAsset): string {
  return fontKey(font);
}

/** Shares native FontFace ownership per document and releases the last lease exactly once. */
export function createWebFontRegistry(): WebFontRegistry {
  const documents = new WeakMap<Document, Map<string, SharedFont>>();

  return {
    acquire(document, font) {
      const key = fontKey(font);
      const fonts = documents.get(document) ?? new Map<string, SharedFont>();
      if (!documents.has(document)) documents.set(document, fonts);
      const existing = fonts.get(key);
      if (existing) {
        existing.references += 1;
        return lease(key, () => release(document, fonts, key, existing));
      }

      const family = webFontFamily(font);
      const FontFaceClass = globalThis.FontFace;
      const faces =
        family && FontFaceClass && document.fonts
          ? (font.sources ?? []).map((source) => createFace(FontFaceClass, family, source, font))
          : [];
      for (const face of faces) {
        document.fonts.add(face);
        void face.load().catch(() => undefined);
      }
      const shared = { faces, references: 1 };
      fonts.set(key, shared);
      return lease(key, () => release(document, fonts, key, shared));
    },
  };
}

function createFace(
  FontFaceClass: typeof FontFace,
  family: string,
  source: FontAssetSource,
  font: FontAsset,
): FontFace {
  const weight = Array.isArray(source.weight) ? source.weight.join(" ") : String(source.weight);
  return new FontFaceClass(
    family,
    `url(${JSON.stringify(source.file)}) format(${JSON.stringify(source.format)})`,
    {
      display: font.display,
      style: source.style,
      unicodeRange: source.unicodeRange,
      weight,
    },
  );
}

function release(
  document: Document,
  fonts: Map<string, SharedFont>,
  key: string,
  shared: SharedFont,
): void {
  if (fonts.get(key) !== shared || shared.references === 0) return;
  shared.references -= 1;
  if (shared.references > 0) return;
  fonts.delete(key);
  for (const face of shared.faces) document.fonts.delete(face);
}

function lease(key: string, release: () => void): WebFontLease {
  let active = true;
  return {
    key,
    release() {
      if (!active) return;
      active = false;
      release();
    },
  };
}

function fontKey(font: FontAsset): string {
  return JSON.stringify({
    display: font.display,
    family: font.family,
    sources: font.sources,
  });
}

function hash(value: string): string {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return (result >>> 0).toString(36);
}
