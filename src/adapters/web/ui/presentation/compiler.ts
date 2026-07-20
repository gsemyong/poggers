import type { PresentationSourceIR } from "../../../../core/compiler/presentation";
import type {
  WebElementPresentation,
  WebFeedback,
  WebImageAsset,
  WebLayoutContinuity,
  WebColor,
  WebCondition,
  WebFill,
  WebGradientStop,
  WebGridTrack,
  WebLayout,
  WebLength,
  WebLogicalBox,
  WebMeasure,
  WebPaint,
  WebQueryLength,
  WebShadow,
  WebStyle,
  WebStyleFragment,
  WebText,
} from "./language";

type CSSDeclarations = Record<string, string>;
const webStyleRoots = new Set([
  "layout",
  "paint",
  "text",
  "media",
  "transform",
  "affordance",
  "rules",
  "image",
  "feedback",
  "presence",
  "continuity",
]);

/** Rejects temporal web output that cannot remain on the compositor-safe path. */
export function validateWebPresentationSource(source: PresentationSourceIR): void {
  for (const declaration of source.declarations) {
    if (isCompositorTemporalDestination(declaration.destination)) continue;
    const { file, line, column } = declaration.span;
    throw new TypeError(
      `${file}:${line}:${column}: Web temporal output ${JSON.stringify(declaration.destination)} ` +
        "is not compositor-safe. Change layout and paint discretely, then use layout " +
        "continuity or animate only presence, opacity, translate, scale, and rotate.",
    );
  }
}

function isCompositorTemporalDestination(destination: string): boolean {
  const path = destination.split("/");
  const root = path.findLastIndex((segment) => webStyleRoots.has(segment));
  if (path[root] === "presence") return true;
  if (path[root] === "paint" && path[root + 1] === "opacity") return true;
  return (
    path[root] === "transform" && ["translate", "scale", "rotate"].includes(path[root + 1] ?? "")
  );
}

export type CompiledWebStyle = Readonly<{
  className: string;
  css: string;
}>;

export type CompiledWebDynamicStyle = Readonly<{
  compiled: CompiledWebStyle;
  variables: Readonly<Record<string, string>>;
}>;

export type WebArtifactExecution =
  | Readonly<{ kind: "static" }>
  | Readonly<{ kind: "canonical"; reason: "dynamic-declaration" }>;

export type WebElementArtifact = Readonly<{
  className: string;
  css: string;
  variables: Readonly<Record<string, string>>;
  properties: readonly string[];
  ownership: Readonly<Record<string, "presentation" | "layout">>;
  execution: WebArtifactExecution;
  image?: WebImageAsset;
  feedback?: WebFeedback;
  presence?: WebElementPresentation["presence"];
  continuity?: WebLayoutContinuity;
}>;

export type WebPresentationArtifactPlan<ElementName extends string = string> = Readonly<{
  dynamic: boolean;
  elements: Readonly<Partial<Record<ElementName, WebElementArtifact>>>;
}>;

type DynamicCollector = { readonly values: string[] };
let dynamicCollector: DynamicCollector | undefined;

/** Compiles one canonical declaration into deterministic, minified native CSS. */
export function compileWebStyle(style: WebStyle): CompiledWebStyle {
  const template = styleTemplate(style);
  const className = `p${hash(template)}`;
  return Object.freeze({ className, css: template.replaceAll("&", `.${className}`) });
}

/** @internal Compiles one stable CSS template and its frame-local numeric channels. */
export function compileWebDynamicStyle(style: WebStyle): CompiledWebDynamicStyle {
  if (dynamicCollector) throw new Error("Dynamic web Presentation compilation is not reentrant.");
  const collector: DynamicCollector = { values: [] };
  dynamicCollector = collector;
  let template: string;
  try {
    template = styleTemplate(style);
  } finally {
    dynamicCollector = undefined;
  }
  const className = `p${hash(template)}`;
  const placeholder = "--poggers-value-";
  const prefix = `--${className}-`;
  const css = template.replaceAll(placeholder, prefix).replaceAll("&", `.${className}`);
  return Object.freeze({
    compiled: Object.freeze({ className, css }),
    variables: Object.freeze(
      Object.fromEntries(collector.values.map((value, index) => [`${prefix}${index}`, value])),
    ),
  });
}

/** Plans one complete web Presentation frame without creating a native resource. */
export function planWebPresentationArtifacts<ElementName extends string>(
  declarations: Readonly<Partial<Record<ElementName, Readonly<WebElementPresentation>>>>,
  options: Readonly<{ dynamic: boolean }>,
): WebPresentationArtifactPlan<ElementName> {
  const elements: Partial<Record<ElementName, WebElementArtifact>> = {};
  for (const name of Object.keys(declarations).sort() as ElementName[]) {
    const declaration = declarations[name];
    if (!declaration) continue;
    const style = options.dynamic ? compileWebDynamicStyle(declaration) : undefined;
    const compiled = style?.compiled ?? compileWebStyle(declaration);
    const properties = authoredProperties(declaration);
    const ownership: Record<string, "presentation" | "layout"> = Object.fromEntries(
      properties.map((property) => [property, "presentation" as const]),
    );
    const continuity = declaration.continuity
      ? Object.freeze({
          ...declaration.continuity,
          strategy: declaration.continuity.strategy ?? "position",
        })
      : undefined;
    if (continuity) {
      claim(ownership, "transform", "layout", name);
      claim(ownership, "transform-origin", "layout", name);
    }
    elements[name] = Object.freeze({
      className: compiled.className,
      css: compiled.css,
      variables: style?.variables ?? Object.freeze({}),
      properties,
      ownership: Object.freeze(ownership),
      execution: options.dynamic
        ? Object.freeze({ kind: "canonical", reason: "dynamic-declaration" })
        : Object.freeze({ kind: "static" }),
      ...(declaration.image ? { image: declaration.image } : {}),
      ...(declaration.feedback ? { feedback: declaration.feedback } : {}),
      ...(declaration.presence !== undefined ? { presence: declaration.presence } : {}),
      ...(continuity ? { continuity } : {}),
    });
  }
  return Object.freeze({ dynamic: options.dynamic, elements: Object.freeze(elements) });
}

function authoredProperties(style: WebStyle): readonly string[] {
  const result = new Set(Object.keys(declarations(style)));
  for (const rule of style.rules ?? []) {
    for (const property of Object.keys(declarations(rule.use))) result.add(property);
  }
  return Object.freeze([...result].sort());
}

function claim(
  ownership: Record<string, "presentation" | "layout">,
  property: string,
  owner: "presentation" | "layout",
  element: string,
): void {
  const current = ownership[property];
  if (current && current !== owner) {
    throw new TypeError(
      `Web Presentation Element ${JSON.stringify(element)} gives ${JSON.stringify(property)} to both ${current} and ${owner}.`,
    );
  }
  ownership[property] = owner;
}

function styleTemplate(style: WebStyle): string {
  const templates: string[] = [];
  const base = declarations(style);
  if (Object.keys(base).length) templates.push(rule("&", base));

  for (const conditional of style.rules ?? []) {
    const applied = declarations(conditional.use);
    if (!Object.keys(applied).length) {
      throw new TypeError("A web Presentation condition must apply at least one style.");
    }
    templates.push(conditionalRule(conditional.when, applied));
  }
  return templates.join("");
}

/** @internal Compiles one dynamic frame without allocating a class or stylesheet rule. */
export function compileWebStyleDeclarations(
  style: WebStyleFragment,
): Readonly<Record<string, string>> {
  return Object.freeze(declarations(style));
}

function declarations(style: WebStyleFragment): CSSDeclarations {
  const result: CSSDeclarations = {};
  layout(result, style.layout);
  paint(result, style.paint);
  text(result, style.text);
  media(result, style.media);
  transform(result, style.transform);
  affordance(result, style.affordance);
  return result;
}

function layout(result: CSSDeclarations, value: WebLayout | undefined): void {
  if (!value) return;
  const model = value.model;
  if (model?.kind === "flow") {
    result.display = "flex";
    result["flex-direction"] =
      `${model.direction === "block" ? "column" : "row"}${model.reverse ? "-reverse" : ""}`;
    assign(result, "gap", length(model.gap));
    assign(result, "align-items", align(model.align, true));
    assign(result, "justify-content", distribute(model.distribute));
    if (model.wrap !== undefined) result["flex-wrap"] = model.wrap ? "wrap" : "nowrap";
  } else if (model?.kind === "grid") {
    result.display = "grid";
    if (model.columns) result["grid-template-columns"] = model.columns.map(gridTrack).join(" ");
    if (model.rows) result["grid-template-rows"] = model.rows.map(gridTrack).join(" ");
    assign(result, "gap", length(model.gap));
    assign(result, "column-gap", length(model.columnGap));
    assign(result, "row-gap", length(model.rowGap));
    assign(result, "align-items", align(model.align));
    assign(result, "justify-items", align(model.distribute));
    if (model.autoFlow) {
      result["grid-auto-flow"] = {
        row: "row",
        column: "column",
        "dense-row": "row dense",
        "dense-column": "column dense",
      }[model.autoFlow];
    }
  } else if (model?.kind === "overlay") {
    result.display = "grid";
    assign(result, "align-items", align(model.align));
    assign(result, "justify-items", align(model.distribute));
  } else if (model?.kind === "contents") {
    result.display = "contents";
  } else if (model?.kind === "hidden") {
    result.display = "none";
  }

  assign(result, "inline-size", measure(value.inlineSize));
  assign(result, "block-size", measure(value.blockSize));
  assign(result, "min-inline-size", measure(value.minInlineSize));
  assign(result, "max-inline-size", measure(value.maxInlineSize));
  assign(result, "min-block-size", measure(value.minBlockSize));
  assign(result, "max-block-size", measure(value.maxBlockSize));
  if (value.aspectRatio !== undefined) result["aspect-ratio"] = number(value.aspectRatio);
  logicalBox(result, "padding", value.padding, length);
  logicalBox(result, "margin", value.margin, measure);

  if (value.position) {
    result.position = value.position.kind;
    logicalBox(result, "inset", value.position.inset, measure);
    if (value.position.layer !== undefined) result["z-index"] = number(value.position.layer);
  }
  if (value.item) {
    assign(result, "align-self", align(value.item.align));
    assign(result, "justify-self", align(value.item.distribute));
    if (value.item.order !== undefined) result.order = number(value.item.order);
    if (value.item.grow !== undefined) result["flex-grow"] = number(value.item.grow);
    if (value.item.shrink !== undefined) result["flex-shrink"] = number(value.item.shrink);
    assign(result, "flex-basis", measure(value.item.basis));
    if (value.item.overlay) result["grid-area"] = "1/1";
  }
  if (value.overflow) {
    if (value.overflow.inline) result["overflow-inline"] = value.overflow.inline;
    if (value.overflow.block) result["overflow-block"] = value.overflow.block;
    if (value.overflow.overscroll) result["overscroll-behavior"] = value.overflow.overscroll;
    if (value.overflow.gutter) {
      result["scrollbar-gutter"] =
        value.overflow.gutter === "stable-both" ? "stable both-edges" : value.overflow.gutter;
    }
  }
  if (value.containment) result.contain = value.containment;
  if (value.visibility === "visible") result.visibility = "visible";
  if (value.visibility === "hidden") result.visibility = "hidden";
  if (value.visibility === "deferred") result["content-visibility"] = "auto";
  if (value.container) {
    result["container-type"] = value.container.axis === "inline" ? "inline-size" : "size";
    if (value.container.name) result["container-name"] = identifier(value.container.name);
  }
}

function paint(result: CSSDeclarations, value: WebPaint | undefined): void {
  if (!value) return;
  const background = fill(value.fill);
  if (background) {
    result[background.includes("gradient(") ? "background-image" : "background-color"] = background;
  }
  if (value.opacity !== undefined) result.opacity = number(value.opacity, 0, 1);
  if (value.stroke === "none") {
    result.border = "none";
  } else if (value.stroke) {
    result.border = `${length(value.stroke.width)} ${value.stroke.style ?? "solid"} ${color(value.stroke.color)}`;
  }
  if (value.radius !== undefined) {
    if (isLength(value.radius)) {
      result["border-radius"] = requiredLength(value.radius);
    } else {
      assign(result, "border-start-start-radius", length(value.radius.startStart));
      assign(result, "border-start-end-radius", length(value.radius.startEnd));
      assign(result, "border-end-start-radius", length(value.radius.endStart));
      assign(result, "border-end-end-radius", length(value.radius.endEnd));
    }
  }
  if (value.shadow === "none") result["box-shadow"] = "none";
  else if (value.shadow) {
    const shadows: readonly WebShadow[] = Array.isArray(value.shadow)
      ? (value.shadow as readonly WebShadow[])
      : [value.shadow as WebShadow];
    result["box-shadow"] = shadows.map(shadow).join(",");
  }
  if (value.outline === "none") result.outline = "none";
  else if (value.outline) {
    result.outline = `${length(value.outline.width)} ${value.outline.style ?? "solid"} ${color(value.outline.color)}`;
    assign(result, "outline-offset", length(value.outline.offset));
  }
  if (value.clip === "none") result["clip-path"] = "none";
  else if (value.clip === "content") result.overflow = "clip";
  else if (value.clip && "circle" in value.clip) {
    result["clip-path"] = `circle(${ratioPercent(value.clip.circle)})`;
  } else if (value.clip && "inset" in value.clip) {
    const { top = 0, right = 0, bottom = 0, left = 0 } = value.clip.inset;
    result["clip-path"] =
      `inset(${length(top)} ${length(right)} ${length(bottom)} ${length(left)})`;
  }
  const filters = filter(value.filter);
  if (filters) result.filter = filters;
  const backdrop = filter(value.backdrop);
  if (backdrop) result["backdrop-filter"] = backdrop;
  if (value.blend) result["mix-blend-mode"] = value.blend;
}

function text(result: CSSDeclarations, value: WebText | undefined): void {
  if (!value) return;
  assign(result, "color", value.color ? color(value.color) : undefined);
  if (value.family) {
    const families: readonly string[] = Array.isArray(value.family)
      ? value.family
      : [value.family as string];
    result["font-family"] = families.map(fontFamily).join(",");
  }
  assign(result, "font-size", length(value.size));
  if (value.weight !== undefined) {
    result["font-weight"] = fontWeight(value.weight);
  }
  if (value.style) result["font-style"] = value.style;
  if (value.lineHeight !== undefined) {
    result["line-height"] =
      typeof value.lineHeight === "number"
        ? number(value.lineHeight)
        : requiredLength(value.lineHeight);
  }
  assign(result, "letter-spacing", length(value.letterSpacing));
  if (value.align) result["text-align"] = value.align;
  if (value.wrap) {
    if (value.wrap === "nowrap") result["white-space"] = "nowrap";
    else result["text-wrap"] = value.wrap === "wrap" ? "wrap" : value.wrap;
  }
  if (value.overflow) result["text-overflow"] = value.overflow;
  if (value.wordBreak) result["word-break"] = value.wordBreak;
  if (value.hyphens) result.hyphens = value.hyphens;
  if (value.decoration) result["text-decoration-line"] = value.decoration;
  if (value.case) result["text-transform"] = value.case;
}

function media(result: CSSDeclarations, value: WebStyleFragment["media"]): void {
  if (!value) return;
  if (value.fit) result["object-fit"] = value.fit;
  if (value.position) {
    result["object-position"] =
      `${ratioPercent(value.position.inline)} ${ratioPercent(value.position.block)}`;
  }
  if (value.rendering) {
    result["image-rendering"] = value.rendering === "crisp" ? "crisp-edges" : value.rendering;
  }
}

function transform(result: CSSDeclarations, value: WebStyleFragment["transform"]): void {
  if (!value) return;
  if (value.translate) {
    result.translate = `${length(value.translate.x ?? 0)} ${length(value.translate.y ?? 0)}`;
  }
  if (value.scale !== undefined) {
    result.scale =
      typeof value.scale === "number"
        ? number(value.scale)
        : `${number(value.scale.x)} ${number(value.scale.y)}`;
  }
  if (value.rotate !== undefined) result.rotate = numericToken(value.rotate, "deg");
  if (value.origin)
    result["transform-origin"] = `${ratioPercent(value.origin.x)} ${ratioPercent(value.origin.y)}`;
}

function affordance(result: CSSDeclarations, value: WebStyleFragment["affordance"]): void {
  if (!value) return;
  if (value.cursor) result.cursor = value.cursor;
  if (value.selection) result["user-select"] = value.selection;
  assign(result, "caret-color", value.caret ? color(value.caret) : undefined);
  assign(result, "accent-color", value.accent ? color(value.accent) : undefined);
}

function conditionalRule(condition: WebCondition, value: CSSDeclarations): string {
  if (!condition.pseudo && !condition.container && !condition.preference && !condition.pointer) {
    throw new TypeError("A web Presentation condition cannot be empty.");
  }
  let selector = "&";
  if (condition.pseudo) selector += `:where(:${condition.pseudo})`;
  let result = rule(selector, value);

  if (condition.container) {
    const query: string[] = [];
    withoutDynamicValues(() => {
      containerRange(query, "inline-size", ">=", condition.container?.minInlineSize);
      containerRange(query, "inline-size", "<=", condition.container?.maxInlineSize);
      containerRange(query, "block-size", ">=", condition.container?.minBlockSize);
      containerRange(query, "block-size", "<=", condition.container?.maxBlockSize);
    });
    if (!query.length) throw new TypeError("A container condition must define a size range.");
    const name = condition.container.name ? ` ${identifier(condition.container.name)}` : "";
    result = `@container${name} (${query.join(") and (")}){${result}}`;
  }

  const media: string[] = [];
  const preference = condition.preference;
  if (preference?.colorScheme) media.push(`(prefers-color-scheme:${preference.colorScheme})`);
  if (preference?.contrast) media.push(`(prefers-contrast:${preference.contrast})`);
  if (preference?.motion) {
    media.push(
      `(prefers-reduced-motion:${preference.motion === "reduced" ? "reduce" : "no-preference"})`,
    );
  }
  if (preference?.forcedColors !== undefined) {
    media.push(`(forced-colors:${preference.forcedColors ? "active" : "none"})`);
  }
  if (condition.pointer?.accuracy) media.push(`(pointer:${condition.pointer.accuracy})`);
  if (condition.pointer?.hover !== undefined) {
    media.push(`(hover:${condition.pointer.hover ? "hover" : "none"})`);
  }
  if (media.length) result = `@media ${media.join(" and ")}{${result}}`;
  return result;
}

function rule(selector: string, value: CSSDeclarations): string {
  return `${selector}{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([property, declaration]) => `${property}:${declaration}`)
    .join(";")}}`;
}

function logicalBox<Value>(
  result: CSSDeclarations,
  property: string,
  value: WebLogicalBox<Value> | undefined,
  compile: (input: Value | undefined) => string | undefined,
): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || isLength(value)) {
    assign(result, property, compile(value as Value));
    return;
  }
  if ("block" in value || "inline" in value) {
    assign(result, `${property}-block`, compile(value.block));
    assign(result, `${property}-inline`, compile(value.inline));
    return;
  }
  const sides = value as Readonly<{
    blockStart?: Value;
    blockEnd?: Value;
    inlineStart?: Value;
    inlineEnd?: Value;
  }>;
  assign(result, `${property}-block-start`, compile(sides.blockStart));
  assign(result, `${property}-block-end`, compile(sides.blockEnd));
  assign(result, `${property}-inline-start`, compile(sides.inlineStart));
  assign(result, `${property}-inline-end`, compile(sides.inlineEnd));
}

function gridTrack(value: WebGridTrack): string {
  if (typeof value === "object" && value !== null && "fraction" in value) {
    return numericToken(value.fraction, "fr");
  }
  if (typeof value === "object" && value !== null && "fit" in value) {
    return `fit-content(${requiredLength(value.fit)})`;
  }
  if (typeof value === "object" && value !== null && "minmax" in value) {
    return `minmax(${gridTrack(value.minmax[0])},${gridTrack(value.minmax[1])})`;
  }
  if (typeof value === "object" && value !== null && "repeat" in value) {
    const count =
      value.repeat.count === "fit"
        ? "auto-fit"
        : value.repeat.count === "fill"
          ? "auto-fill"
          : number(value.repeat.count, 1);
    return `repeat(${count},${gridTrack(value.repeat.track)})`;
  }
  return value === "min-content" || value === "max-content"
    ? value
    : requiredLength(value as WebLength);
}

function fill(value: WebFill | undefined): string | undefined {
  if (value === undefined) return;
  if (typeof value === "string" || "oklch" in value || "srgb" in value) return color(value);
  if ("linear" in value) {
    return `linear-gradient(${numericToken(value.linear.angle ?? 180, "deg")},${stops(value.linear.stops)})`;
  }
  if ("radial" in value) {
    return `radial-gradient(${value.radial.shape ?? "ellipse"},${stops(value.radial.stops)})`;
  }
  return `conic-gradient(from ${numericToken(value.conic.angle ?? 0, "deg")},${stops(value.conic.stops)})`;
}

function stops(values: readonly WebGradientStop[]): string {
  return values.map((stop) => `${color(stop.color)} ${ratioPercent(stop.at)}`).join(",");
}

function color(value: WebColor): string {
  if (typeof value === "string") return value === "current" ? "currentColor" : value;
  if ("oklch" in value) {
    const [lightness, chroma, hue, alpha] = value.oklch;
    const channels = `${number(lightness, 0, 1)} ${number(chroma, 0)} ${number(hue)}`;
    return `oklch(${channels}${alpha === undefined ? "" : `/${number(alpha, 0, 1)}`})`;
  }
  const [red, green, blue, alpha] = value.srgb;
  const channels = `${ratioPercent(red)} ${ratioPercent(green)} ${ratioPercent(blue)}`;
  return `rgb(${channels}${alpha === undefined ? "" : `/${number(alpha, 0, 1)}`})`;
}

function shadow(value: WebShadow): string {
  return `${value.inset ? "inset " : ""}${length(value.x ?? 0)} ${length(value.y ?? 0)} ${length(value.blur ?? 0)} ${length(value.spread ?? 0)} ${color(value.color)}`;
}

function filter(
  value:
    | Readonly<{
        blur?: WebLength;
        brightness?: number;
        contrast?: number;
        saturation?: number;
      }>
    | undefined,
): string | undefined {
  if (!value) return;
  const result: string[] = [];
  if (value.blur !== undefined) result.push(`blur(${length(value.blur)})`);
  if (value.brightness !== undefined) result.push(`brightness(${number(value.brightness, 0)})`);
  if (value.contrast !== undefined) result.push(`contrast(${number(value.contrast, 0)})`);
  if (value.saturation !== undefined) result.push(`saturate(${number(value.saturation, 0)})`);
  return result.length ? result.join(" ") : undefined;
}

function length(value: WebLength | undefined): string | undefined {
  if (value === undefined) return;
  if (typeof value === "number") return numericToken(value, "px", true);
  if ("percent" in value) return numericToken(value.percent, "%");
  if ("font" in value) return numericToken(value.font, "em");
  if ("rootFont" in value) return numericToken(value.rootFont, "rem");
  if ("viewport" in value) {
    const prefix = { small: "s", large: "l", dynamic: "d" }[value.viewport.mode ?? "dynamic"];
    const suffix = { inline: "vi", block: "vb", minimum: "vmin", maximum: "vmax" }[
      value.viewport.axis
    ];
    return numericToken(value.viewport.percent, `${prefix}${suffix}`);
  }
  const unit = { inline: "cqi", block: "cqb", minimum: "cqmin", maximum: "cqmax" }[
    value.container.axis
  ];
  return numericToken(value.container.percent, unit);
}

function requiredLength(value: WebLength): string {
  const result = length(value);
  if (result === undefined) throw new TypeError("A web Presentation length is required.");
  return result;
}

function measure(value: WebMeasure | undefined): string | undefined {
  if (value === undefined) return;
  if (value === "fill") return "100%";
  return typeof value === "string" ? value : length(value);
}

function align(value: string | undefined, flex = false): string | undefined {
  if (flex && value === "start") return "flex-start";
  if (flex && value === "end") return "flex-end";
  return value;
}

function distribute(value: string | undefined): string | undefined {
  return value
    ? {
        start: "flex-start",
        center: "center",
        end: "flex-end",
        between: "space-between",
        around: "space-around",
        evenly: "space-evenly",
      }[value]
    : undefined;
}

function fontFamily(value: string): string {
  const generic: Record<string, string> = {
    system: "system-ui",
    sans: "ui-sans-serif",
    serif: "ui-serif",
    monospace: "ui-monospace",
    rounded: "ui-rounded",
  };
  return generic[value] ?? JSON.stringify(value);
}

function fontWeight(value: NonNullable<WebText["weight"]>): string {
  if (typeof value === "number") return number(value);
  return { normal: "400", medium: "500", semibold: "600", bold: "700" }[value];
}

function containerRange(
  result: string[],
  dimension: string,
  operator: ">=" | "<=",
  value: WebQueryLength | undefined,
): void {
  if (value !== undefined) result.push(`${dimension}${operator}${length(value)}`);
}

function isLength(value: unknown): value is WebLength {
  return (
    typeof value === "number" ||
    (!!value &&
      typeof value === "object" &&
      ("percent" in value ||
        "font" in value ||
        "rootFont" in value ||
        "viewport" in value ||
        "container" in value))
  );
}

function number(value: number, minimum?: number, maximum?: number): string {
  return numericToken(value, "", false, minimum, maximum);
}

function numericToken(
  value: number,
  unit = "",
  zeroUnitless = false,
  minimum?: number,
  maximum?: number,
): string {
  if (!Number.isFinite(value)) throw new RangeError(`Expected a finite number, received ${value}.`);
  if (minimum !== undefined && value < minimum) {
    throw new RangeError(`Expected ${value} to be at least ${minimum}.`);
  }
  if (maximum !== undefined && value > maximum) {
    throw new RangeError(`Expected ${value} to be at most ${maximum}.`);
  }
  const normalized = Object.is(value, -0) ? 0 : value;
  const result = `${normalized}${zeroUnitless && normalized === 0 ? "" : unit}`;
  if (!dynamicCollector) return result;
  const index = dynamicCollector.values.push(result) - 1;
  return `var(--poggers-value-${index})`;
}

function ratioPercent(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Expected ${value} to be between 0 and 1.`);
  }
  return numericToken(value * 100, "%", true);
}

function withoutDynamicValues<Output>(run: () => Output): Output {
  const current = dynamicCollector;
  dynamicCollector = undefined;
  try {
    return run();
  } finally {
    dynamicCollector = current;
  }
}

function identifier(value: string): string {
  if (!/^-?[_a-zA-Z][_a-zA-Z0-9-]*$/.test(value)) {
    throw new TypeError(`Invalid web Presentation identifier ${JSON.stringify(value)}.`);
  }
  return value;
}

function assign(result: CSSDeclarations, property: string, value: string | undefined): void {
  if (value !== undefined) result[property] = value;
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(36);
}
