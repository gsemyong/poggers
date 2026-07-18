import { webFontFamily } from "./font";
import type { FontAsset, WebPresentationDeclaration, WebPresentationTokens } from "./language";

type UnknownRecord = Record<string, unknown>;
export type WebStyleMap = Readonly<Record<string, string>>;

/** Deterministically translates web presentation meaning into logical CSS properties. */
export function translateWebPresentationStyle<Theme extends WebPresentationTokens>(
  declaration: Pick<WebPresentationDeclaration<Theme>, "layout" | "shape" | "paint" | "typography">,
): WebStyleMap {
  const styles: Record<string, string> = {};
  const layout = record(declaration.layout);
  const shape = record(declaration.shape);
  const paint = record(declaration.paint);
  const typography = record(declaration.typography);

  translateLayout(styles, layout);
  translateShape(styles, shape);
  translatePaint(styles, paint);
  translateTypography(styles, typography);
  return styles;
}

function translateLayout(styles: Record<string, string>, layout: UnknownRecord): void {
  const flow = record(layout.flow);
  const grid = record(layout.grid);
  const overlay = record(layout.overlay);
  if (Object.keys(flow).length) {
    styles.display = "flex";
    styles.flexDirection = `${flow.axis === "block" ? "column" : "row"}${flow.reverse ? "-reverse" : ""}`;
    assign(styles, "gap", length(flow.gap));
    assign(styles, "alignItems", alignment(flow.align));
    assign(styles, "justifyContent", distribution(flow.distribute));
    if (flow.wrap !== undefined) styles.flexWrap = flow.wrap ? "wrap" : "nowrap";
  } else if (Object.keys(grid).length) {
    styles.display = "grid";
    if (Array.isArray(grid.columns)) {
      styles.gridTemplateColumns = grid.columns.map(track).join(" ");
    }
    if (Array.isArray(grid.rows)) styles.gridTemplateRows = grid.rows.map(track).join(" ");
    assign(styles, "gap", length(grid.gap));
    assign(styles, "columnGap", length(grid.columnGap));
    assign(styles, "rowGap", length(grid.rowGap));
    assign(styles, "alignItems", alignment(grid.align));
    assign(styles, "justifyContent", distribution(grid.distribute));
    const autoFlow = {
      row: "row",
      column: "column",
      "dense-row": "row dense",
      "dense-column": "column dense",
    }[String(grid.autoFlow)];
    assign(styles, "gridAutoFlow", autoFlow);
  } else if (Object.keys(overlay).length) {
    styles.display = "grid";
    assign(styles, "alignItems", alignment(overlay.align));
    assign(styles, "justifyItems", alignment(overlay.distribute));
  }

  if (layout.display === "contents") styles.display = "contents";
  if (layout.display === "hidden") styles.display = "none";

  const size = record(layout.size);
  translateMeasure(styles, "width", "minWidth", "maxWidth", size.inline);
  translateMeasure(styles, "height", "minHeight", "maxHeight", size.block);
  if (typeof size.aspect === "number") styles.aspectRatio = String(size.aspect);
  const contain = { none: "none", layout: "layout", paint: "paint", strict: "strict" }[
    String(size.contain)
  ];
  assign(styles, "contain", contain);
  if (size.visibility === "deferred") styles.contentVisibility = "auto";
  if (size.visibility === "visible") styles.contentVisibility = "visible";

  const item = record(layout.item);
  assign(styles, "alignSelf", alignment(item.align));
  assign(styles, "justifySelf", alignment(item.distribute));
  if (typeof item.order === "number") styles.order = String(item.order);
  const flex = record(item.flex);
  if (typeof flex.grow === "number") styles.flexGrow = String(flex.grow);
  if (typeof flex.shrink === "number") styles.flexShrink = String(flex.shrink);
  assign(styles, "flexBasis", measure(flex.basis));
  const gridItem = record(item.grid);
  assign(styles, "gridColumn", gridLine(gridItem.column));
  assign(styles, "gridRow", gridLine(gridItem.row));
  if (item.overlay) styles.gridArea = "1 / 1";

  translateLogicalSpace(styles, "padding", layout.padding);
  translateLogicalSpace(styles, "margin", layout.margin);

  const position = record(layout.position);
  if (typeof position.kind === "string") styles.position = position.kind;
  translateLogicalSpace(styles, "inset", position.inset);
  const layer =
    typeof position.layer === "number" ? String(position.layer) : metric(position.layer);
  if (layer !== undefined) styles.zIndex = layer.endsWith("px") ? layer.slice(0, -2) : layer;
  if (position.place === "center") {
    styles.insetInlineStart = "50%";
    styles.insetBlockStart = "50%";
    styles.translate = "-50% -50%";
  } else if (position.place === "block-start") {
    styles.insetBlockStart = "0";
  } else if (position.place === "block-end") {
    styles.insetBlockEnd = "0";
  } else if (position.place === "inline-start") {
    styles.insetInlineStart = "0";
  } else if (position.place === "inline-end") {
    styles.insetInlineEnd = "0";
  }

  const scroll = record(layout.scroll);
  assign(styles, "overflowX", overflow(scroll.inline));
  assign(styles, "overflowY", overflow(scroll.block));
  if (typeof scroll.overscroll === "string") {
    styles.overscrollBehavior = scroll.overscroll;
  }
  const snap = {
    inline: "x mandatory",
    block: "y mandatory",
    both: "both mandatory",
    none: "none",
  }[String(scroll.snap)];
  assign(styles, "scrollSnapType", snap);
  if (typeof scroll.snapAlign === "string") styles.scrollSnapAlign = scroll.snapAlign;
  const gutter = { auto: "auto", stable: "stable", "stable-both": "stable both-edges" }[
    String(scroll.gutter)
  ];
  assign(styles, "scrollbarGutter", gutter);
  if (scroll.scrollbar === "thin") styles.scrollbarWidth = "thin";
  if (scroll.scrollbar === "hidden") styles.scrollbarWidth = "none";
}

function translateShape(styles: Record<string, string>, shape: UnknownRecord): void {
  const radius = shape.radius;
  if (isMetric(radius) || typeof radius === "number") {
    assign(styles, "borderRadius", length(radius));
  } else {
    const corners = record(radius);
    assign(styles, "borderStartStartRadius", length(corners.startStart));
    assign(styles, "borderStartEndRadius", length(corners.startEnd));
    assign(styles, "borderEndStartRadius", length(corners.endStart));
    assign(styles, "borderEndEndRadius", length(corners.endEnd));
  }
  const continuous = record(shape.corners);
  if ("radius" in continuous) assign(styles, "borderRadius", length(continuous.radius));
  for (const [name, property] of [
    ["startStart", "borderStartStartRadius"],
    ["startEnd", "borderStartEndRadius"],
    ["endStart", "borderEndStartRadius"],
    ["endEnd", "borderEndEndRadius"],
  ] as const) {
    assign(styles, property, length(record(continuous[name]).radius));
  }
  const clip = shape.clip;
  if (clip === "none") styles.clipPath = "none";
  if (clip === "content") styles.overflow = "clip";
  const clipRecord = record(clip);
  if (typeof clipRecord.circle === "number")
    styles.clipPath = `circle(${clipRecord.circle * 100}%)`;
  if (clipRecord.inset !== undefined) {
    const inset = logicalSpaceValues(clipRecord.inset);
    styles.clipPath = `inset(${inset.blockStart} ${inset.inlineEnd} ${inset.blockEnd} ${inset.inlineStart})`;
  }
}

function translatePaint(styles: Record<string, string>, paint: UnknownRecord): void {
  const fill = color(paint.fill);
  if (fill) {
    if (fill.includes("gradient(")) styles.backgroundImage = fill;
    else styles.backgroundColor = fill;
  }
  translateStroke(styles, paint.stroke);
  if (typeof paint.opacity === "number") styles.opacity = String(paint.opacity);
  assign(styles, "boxShadow", shadow(paint.shadow));
  const filters: string[] = [];
  const blur = length(paint.blur);
  if (blur) filters.push(`blur(${blur})`);
  if (typeof paint.brightness === "number") filters.push(`brightness(${paint.brightness})`);
  if (typeof paint.contrast === "number") filters.push(`contrast(${paint.contrast})`);
  if (typeof paint.saturation === "number") filters.push(`saturate(${paint.saturation})`);
  if (filters.length) styles.filter = filters.join(" ");
  const backdrop = record(paint.backdrop);
  const backdropFilters: string[] = [];
  const backdropBlur = length(backdrop.blur);
  if (backdropBlur) backdropFilters.push(`blur(${backdropBlur})`);
  if (typeof backdrop.saturation === "number") {
    backdropFilters.push(`saturate(${backdrop.saturation})`);
  }
  if (typeof backdrop.brightness === "number") {
    backdropFilters.push(`brightness(${backdrop.brightness})`);
  }
  if (backdropFilters.length) styles.backdropFilter = backdropFilters.join(" ");
  if (typeof paint.blend === "string") styles.mixBlendMode = paint.blend;
  if (typeof paint.cursor === "string") styles.cursor = paint.cursor;
  if (typeof paint.select === "string") styles.userSelect = paint.select;
  assign(styles, "caretColor", color(paint.caret));
  const focusRing = record(paint.focusRing);
  if (paint.focusRing === "none") styles.outline = "none";
  if (Object.keys(focusRing).length) {
    styles.outline = `${length(focusRing.width) ?? "1px"} solid ${color(focusRing.color) ?? "currentColor"}`;
    assign(styles, "outlineOffset", length(focusRing.offset));
  }
  const media = record(paint.media);
  if (typeof media.fit === "string") styles.objectFit = media.fit;
  if (media.position) {
    const position = record(media.position);
    styles.objectPosition = `${Number(position.inline) * 100}% ${Number(position.block) * 100}%`;
  }
  const rendering = { auto: "auto", crisp: "crisp-edges", pixelated: "pixelated" }[
    String(media.rendering)
  ];
  assign(styles, "imageRendering", rendering);
}

function translateTypography(styles: Record<string, string>, typography: UnknownRecord): void {
  const font = record(typography.font);
  const families = [
    webFontFamily(font as FontAsset),
    ...(Array.isArray(font.fallback)
      ? font.fallback.map((name) => fontFallback(String(name)))
      : []),
  ].filter((family): family is string => Boolean(family));
  assign(styles, "fontFamily", families.map(cssFamily).join(", ") || undefined);
  assign(styles, "fontSize", length(typography.size));
  if (typeof typography.weight === "number") styles.fontWeight = String(typography.weight);
  if (typeof typography.line === "number") styles.lineHeight = String(typography.line);
  else assign(styles, "lineHeight", length(typography.line));
  assign(styles, "letterSpacing", length(typography.tracking));
  if (typeof typography.align === "string") styles.textAlign = typography.align;
  if (typeof typography.transform === "string") styles.textTransform = typography.transform;
  const wrap = { wrap: "normal", nowrap: "nowrap", balance: "balance", pretty: "pretty" }[
    String(typography.wrap)
  ];
  if (wrap === "balance" || wrap === "pretty") styles.textWrap = wrap;
  else if (wrap) styles.whiteSpace = wrap;
  if (typography.overflow === "ellipsis") {
    styles.overflow = "hidden";
    styles.textOverflow = "ellipsis";
  }
  if (typeof typography.lines === "number") {
    styles.display = "-webkit-box";
    styles.WebkitBoxOrient = "vertical";
    styles.WebkitLineClamp = String(typography.lines);
    styles.overflow = "hidden";
  }
  const decoration = { none: "none", underline: "underline", strike: "line-through" }[
    String(typography.decoration)
  ];
  assign(styles, "textDecoration", decoration);
  if (typography.smoothing === "grayscale") styles.WebkitFontSmoothing = "antialiased";
  assign(styles, "color", color(typography.color));
  if (typography.features && typeof typography.features === "object") {
    styles.fontFeatureSettings = Object.entries(typography.features)
      .map(([name, value]) => `"${name}" ${value === true ? 1 : value === false ? 0 : value}`)
      .join(", ");
  }
}

function translateStroke(styles: Record<string, string>, value: unknown): void {
  if (value === undefined) return;
  const stroke = record("value" in record(value) ? record(value).value : value);
  const line = (target: UnknownRecord, prefix: string) => {
    assign(styles, `${prefix}Width`, length(target.width));
    if (target.line === "dash") styles[`${prefix}Style`] = "dashed";
    else if (target.line === "dot") styles[`${prefix}Style`] = "dotted";
    else if (target.line === "none" || target.line === "solid") {
      styles[`${prefix}Style`] = target.line;
    }
    assign(styles, `${prefix}Color`, color(target.color));
  };
  if ("all" in stroke) {
    line(record(stroke.all), "border");
    line(record(stroke.inlineStart), "borderInlineStart");
    line(record(stroke.inlineEnd), "borderInlineEnd");
    line(record(stroke.blockStart), "borderBlockStart");
    line(record(stroke.blockEnd), "borderBlockEnd");
  } else {
    line(stroke, "border");
  }
}

function translateMeasure(
  styles: Record<string, string>,
  property: string,
  minimum: string,
  maximum: string,
  value: unknown,
): void {
  const range = record(value);
  if ("min" in range || "max" in range) {
    assign(styles, minimum, measure(range.min));
    assign(styles, maximum, measure(range.max));
  } else {
    assign(styles, property, measure(value));
  }
}

function translateLogicalSpace(
  styles: Record<string, string>,
  prefix: "padding" | "margin" | "inset",
  value: unknown,
): void {
  if (value === undefined) return;
  if (typeof value === "number" || isMetric(value) || isLengthExpression(value)) {
    assign(styles, prefix, length(value));
    return;
  }
  const logical = record(value);
  assign(styles, `${prefix}Inline`, length(logical.inline));
  assign(styles, `${prefix}Block`, length(logical.block));
  assign(styles, `${prefix}InlineStart`, length(logical.inlineStart));
  assign(styles, `${prefix}InlineEnd`, length(logical.inlineEnd));
  assign(styles, `${prefix}BlockStart`, length(logical.blockStart));
  assign(styles, `${prefix}BlockEnd`, length(logical.blockEnd));
}

function logicalSpaceValues(value: unknown): Readonly<Record<string, string>> {
  const logical = record(value);
  const all = length(value) ?? "0";
  const inline = length(logical.inline) ?? all;
  const block = length(logical.block) ?? all;
  return {
    inlineStart: length(logical.inlineStart) ?? inline,
    inlineEnd: length(logical.inlineEnd) ?? inline,
    blockStart: length(logical.blockStart) ?? block,
    blockEnd: length(logical.blockEnd) ?? block,
  };
}

function measure(value: unknown): string | undefined {
  if (value === "auto") return "auto";
  if (value === "content") return "fit-content";
  if (value === "min-content" || value === "max-content") return value;
  if (value === "fill") return "100%";
  const object = record(value);
  if (typeof object.fraction === "number") return `${object.fraction}fr`;
  if (object.fit !== undefined) return `fit-content(${length(object.fit)})`;
  return length(value);
}

function track(value: unknown): string {
  const object = record(value);
  if (Array.isArray(object.minmax)) {
    return `minmax(${track(object.minmax[0])}, ${track(object.minmax[1])})`;
  }
  const repeat = record(object.repeat);
  if (Object.keys(repeat).length) {
    const count =
      repeat.count === "fit" ? "auto-fit" : repeat.count === "fill" ? "auto-fill" : repeat.count;
    return `repeat(${count}, ${track(repeat.track)})`;
  }
  return measure(value) ?? "auto";
}

function gridLine(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  const object = record(value);
  if (typeof object.from === "number" && typeof object.to === "number") {
    return `${object.from} / ${object.to}`;
  }
  if (typeof object.span === "number") return `span ${object.span}`;
  return undefined;
}

function length(value: unknown): string | undefined {
  if (typeof value === "number") return `${value}px`;
  const direct = metric(value);
  if (direct !== undefined) return direct;
  const object = record(value);
  if (typeof object.percent === "number") return `${object.percent}%`;
  const container = record(object.container);
  if (typeof container.percent === "number") {
    return `${container.percent}${container.axis === "block" ? "cqb" : "cqi"}`;
  }
  const viewport = record(object.viewport);
  if (typeof viewport.percent === "number") {
    return `${viewport.percent}${viewport.axis === "block" ? "dvb" : "dvi"}`;
  }
  const fluid = record(object.fluid);
  if (Object.keys(fluid).length) {
    return `clamp(${length(fluid.min)}, ${length(fluid.ideal)}, ${length(fluid.max)})`;
  }
  if (Array.isArray(object.add)) return `calc(${length(object.add[0])} + ${length(object.add[1])})`;
  if (Array.isArray(object.subtract)) {
    return `calc(${length(object.subtract[0])} - ${length(object.subtract[1])})`;
  }
  if (Array.isArray(object.multiply)) {
    return `calc(${length(object.multiply[0])} * ${Number(object.multiply[1])})`;
  }
  if (object.negate !== undefined) return `calc(-1 * ${length(object.negate)})`;
  return undefined;
}

function metric(value: unknown): string | undefined {
  const object = record(value);
  return typeof object.value === "number" ? `${object.value}px` : undefined;
}

function color(value: unknown): string | undefined {
  if (value === "transparent") return "transparent";
  if (value === "current") return "currentColor";
  const object = record(value);
  if (
    typeof object.l === "number" &&
    typeof object.c === "number" &&
    typeof object.h === "number"
  ) {
    const alpha = typeof object.alpha === "number" ? ` / ${object.alpha}` : "";
    return `oklch(${object.l} ${object.c} ${object.h}${alpha})`;
  }
  const gradient = object.kind;
  if (
    (gradient === "linear" || gradient === "radial" || gradient === "conic") &&
    Array.isArray(object.stops)
  ) {
    const stops = object.stops
      .map((stop) => `${color(record(stop).color)} ${Number(record(stop).at) * 100}%`)
      .join(", ");
    if (gradient === "linear")
      return `linear-gradient(${Number(object.angle ?? 180)}deg, ${stops})`;
    if (gradient === "conic")
      return `conic-gradient(from ${Number(object.angle ?? 0)}deg, ${stops})`;
    return `radial-gradient(${String(object.shape ?? "ellipse")}, ${stops})`;
  }
  return undefined;
}

function shadow(value: unknown): string | undefined {
  if (value === "none") return "none";
  const layers = Array.isArray(value) ? value : value === undefined ? [] : [value];
  if (!layers.length) return undefined;
  return layers
    .map((layer) => {
      const item = record(layer);
      return [
        item.inset ? "inset" : "",
        length(item.x ?? 0),
        length(item.y ?? 0),
        length(item.blur ?? 0),
        length(item.spread ?? 0),
        color(item.color),
      ]
        .filter(Boolean)
        .join(" ");
    })
    .join(", ");
}

function alignment(value: unknown): string | undefined {
  return value === "start"
    ? "flex-start"
    : value === "end"
      ? "flex-end"
      : typeof value === "string"
        ? value
        : undefined;
}

function distribution(value: unknown): string | undefined {
  return {
    start: "flex-start",
    center: "center",
    end: "flex-end",
    between: "space-between",
    around: "space-around",
    evenly: "space-evenly",
  }[String(value)];
}

function overflow(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function fontFallback(value: string): string {
  return value === "ui-rounded" ? "ui-rounded" : value;
}

function cssFamily(value: string): string {
  return /^(?:system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|serif|sans-serif|monospace)$/u.test(
    value,
  )
    ? value
    : JSON.stringify(value);
}

function assign(target: Record<string, string>, property: string, value: string | undefined): void {
  if (value !== undefined) target[property] = value;
}

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function isMetric(value: unknown): boolean {
  return typeof record(value).value === "number";
}

function isLengthExpression(value: unknown): boolean {
  const object = record(value);
  return [
    "percent",
    "container",
    "viewport",
    "fluid",
    "add",
    "subtract",
    "multiply",
    "negate",
  ].some((key) => key in object);
}
