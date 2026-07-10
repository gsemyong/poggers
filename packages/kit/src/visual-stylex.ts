import type { MaterializedVisualPreset } from "./visual-compiler";
import { spring as animeSpring, waapi } from "animejs";

type RawCode = { readonly $code: string };
type CodeValue = string | number | boolean | null | RawCode | CodeValue[] | CodeObject;
type CodeObject = { readonly [key: string]: CodeValue };

type ValueArgument = {
  readonly name: string;
  readonly kind: string;
  readonly parameter: string;
};

type StyleEntry = {
  readonly key: string;
  readonly style: CodeObject;
  readonly values: readonly ValueArgument[];
};

type RuntimeCondition = {
  readonly state?: Readonly<Record<string, unknown>>;
  readonly variant?: Readonly<Record<string, unknown>>;
  readonly theme?: string;
};

type PartPlan = {
  readonly always: readonly StyleEntry[];
  readonly conditions: readonly {
    readonly when: RuntimeCondition;
    readonly entry: StyleEntry;
  }[];
  readonly motion: unknown;
};

type ComponentPlan = {
  readonly stylesName: string;
  readonly entries: readonly StyleEntry[];
  readonly parts: Readonly<Record<string, PartPlan>>;
};

type ResolvedPart = {
  readonly base: Record<string, unknown>;
  readonly when: readonly unknown[];
  readonly motion: Record<string, unknown>;
};

type LoweringContext = {
  readonly path: string;
  readonly varsName: string;
  readonly component: string;
  readonly anchorNames: Readonly<Record<string, string>>;
  readonly values: ValueArgument[];
};

const visualStyleKeys = new Set([
  "layout",
  "frame",
  "place",
  "padding",
  "margin",
  "surface",
  "text",
  "media",
  "stroke",
  "shape",
  "effect",
  "transform",
  "position",
  "scroll",
  "interaction",
  "decor",
]);

export function generateVisualStylexModule(presets: readonly MaterializedVisualPreset[]): string {
  const declarations: string[] = ['import * as stylex from "@stylexjs/stylex";', ""];
  const presetEntries: string[] = [];

  for (const preset of [...presets].sort((a, b) => a.name.localeCompare(b.name))) {
    const id = identifier(preset.name);
    const varsName = `${id}Vars`;
    declarations.push(
      `export const ${varsName} = stylex.defineVars(${printCode(tokenVariableDefinitions(preset))});`,
      "",
    );

    const themeReferences: Record<string, RawCode | null> = { default: null };
    for (const [themeName, themeValue] of Object.entries(preset.themes)) {
      const overrides = themeVariableDefinitions(preset, themeValue);
      if (!Object.keys(overrides).length || themeName === "default") {
        themeReferences[themeName] = null;
        continue;
      }
      const themeConst = `${id}Theme${identifier(themeName, true)}`;
      declarations.push(
        `export const ${themeConst} = stylex.createTheme(${varsName}, ${printCode(overrides)});`,
        "",
      );
      themeReferences[themeName] = raw(themeConst);
    }

    const componentPlans: Record<string, ComponentPlan> = {};
    for (const [componentName, parts] of Object.entries(preset.components)) {
      const plan = planComponent(preset, componentName, parts, varsName);
      componentPlans[componentName] = plan;
      declarations.push(stylexCreateSource(plan), "");
    }

    presetEntries.push(
      `${JSON.stringify(preset.name)}: ${printCode({
        themes: themeReferences as unknown as CodeObject,
        motion: recordAt(preset.tokens.motion),
        themeMotion: themeMotionDefinitions(preset),
        components: raw(componentManifestSource(componentPlans)),
      })}`,
    );
  }

  declarations.push(
    "export const compiledVisuals = {",
    ...presetEntries.map((entry) => `  ${entry},`),
    "};",
    "",
  );
  return declarations.join("\n");
}

function tokenVariableDefinitions(preset: MaterializedVisualPreset): CodeObject {
  const result: Record<string, CodeValue> = {};
  for (const [group, values] of Object.entries(preset.tokens)) {
    if (group === "motion") {
      for (const [name, value] of Object.entries(values)) {
        validateMotionTokenDefinition(value, `${preset.name}.tokens.motion.${name}`);
      }
      continue;
    }
    for (const [name, value] of Object.entries(values)) {
      result[tokenVariableName(group, name)] = tokenDefinitionCode(
        group,
        resolveTokenAlias(preset, group, name, value),
      );
    }
  }
  return result;
}

function themeVariableDefinitions(
  preset: MaterializedVisualPreset,
  themeValue: unknown,
): CodeObject {
  const result: Record<string, CodeValue> = {};
  const theme = recordAt(themeValue);
  for (const [group, values] of Object.entries(theme)) {
    if (!(group in preset.tokens)) {
      throw new Error(`${preset.name}.themes contains unknown token group ${group}.`);
    }
    if (group === "motion") continue;
    for (const [name, value] of Object.entries(recordAt(values))) {
      if (!(name in recordAt(preset.tokens[group]))) {
        throw new Error(`${preset.name}.themes contains unknown token ${group}.${name}.`);
      }
      result[tokenVariableName(group, name)] = tokenDefinitionCode(
        group,
        resolveTokenAlias(preset, group, name, value, theme),
      );
    }
  }
  return result;
}

function themeMotionDefinitions(preset: MaterializedVisualPreset): CodeObject {
  const result: Record<string, CodeValue> = {};
  for (const [themeName, value] of Object.entries(preset.themes)) {
    const motion = recordAt(recordAt(value).motion);
    if (Object.keys(motion).length) {
      for (const [name, driver] of Object.entries(motion)) {
        if (!(name in recordAt(preset.tokens.motion))) {
          throw new Error(
            `${preset.name}.themes.${themeName}.motion contains unknown token ${name}.`,
          );
        }
        validateMotionTokenDefinition(driver, `${preset.name}.themes.${themeName}.motion.${name}`);
      }
      result[themeName] = motion as CodeObject;
    }
  }
  return result;
}

function tokenDefinitionCode(group: string, value: unknown): CodeValue {
  switch (group) {
    case "color":
      return raw(`stylex.types.color(${JSON.stringify(colorLiteral(value, "token color"))})`);
    case "space":
    case "size":
    case "radius":
    case "blur":
      return raw(`stylex.types.length(${JSON.stringify(lengthLiteral(value, "token length"))})`);
    case "z":
      return raw(`stylex.types.integer(${numberAt(value, "z token")})`);
    case "gradient":
      return raw(`stylex.types.image(${JSON.stringify(gradientLiteral(value, "gradient token"))})`);
    case "stroke":
      return strokeTokenLiteral(value, "stroke token");
    case "shadow":
      return shadowLiteral(value, "shadow token");
    case "font":
      return fontLiteral(value, "font token");
    default:
      throw new Error(`Unknown visual token group ${JSON.stringify(group)}.`);
  }
}

function resolveTokenAlias(
  preset: MaterializedVisualPreset,
  group: string,
  name: string,
  value: unknown,
  theme: Record<string, unknown> = {},
  seen = new Set<string>(),
): unknown {
  const alias = recordAt(value).token;
  if (typeof alias !== "string") return value;
  assertKnownKeys(recordAt(value), ["token"], `${preset.name}.tokens.${group}.${name}`);
  const key = `${group}.${name}`;
  if (seen.has(key)) throw new Error(`${preset.name} contains a circular token alias at ${key}.`);
  seen.add(key);
  const themedGroup = recordAt(theme[group]);
  const baseGroup = recordAt(preset.tokens[group]);
  const target = alias in themedGroup ? themedGroup[alias] : baseGroup[alias];
  if (target == null) {
    throw new Error(`${preset.name} token ${key} aliases unknown token ${group}.${alias}.`);
  }
  return resolveTokenAlias(preset, group, alias, target, theme, seen);
}

function validateMotionTokenDefinition(value: unknown, path: string): void {
  if (value === "none") return;
  const token = requiredRecord(value, path);
  if (token.spring != null) {
    assertKnownKeys(token, ["spring", "delay"], path);
    const spring = requiredRecord(token.spring, `${path}.spring`);
    assertKnownKeys(spring, ["duration", "bounce"], `${path}.spring`);
    numberAt(spring.duration, `${path}.spring.duration`);
    if (spring.bounce != null) numberAt(spring.bounce, `${path}.spring.bounce`);
  } else {
    assertKnownKeys(token, ["duration", "easing", "delay"], path);
    numberAt(token.duration, `${path}.duration`);
    if (token.easing != null) {
      enumAt(token.easing, ["linear", "smooth", "accelerate", "decelerate"], `${path}.easing`);
    }
  }
  if (token.delay != null) numberAt(token.delay, `${path}.delay`);
}

function planComponent(
  preset: MaterializedVisualPreset,
  component: string,
  parts: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  varsName: string,
): ComponentPlan {
  const stylesName = `${identifier(preset.name)}${identifier(component, true)}Styles`;
  const entries: StyleEntry[] = [];
  const plans: Record<string, PartPlan> = {};
  const resolvedParts = Object.fromEntries(
    Object.entries(parts).map(([partName, source]) => [
      partName,
      resolvePart(recordAt(source), `${preset.name}.${component}.${partName}`, preset),
    ]),
  ) as Record<string, ResolvedPart>;
  const anchorNames = collectAnchorNames(preset.name, component, resolvedParts);
  const hasContainers = Object.values(resolvedParts).some(partUsesContainer);

  for (const [partName, part] of Object.entries(resolvedParts)) {
    const partPath = `${preset.name}.${component}.${partName}`;
    const baseSource = part.base;
    validateMotionSafety({ motion: part.motion }, baseSource, partPath);
    const baseExtra: Record<string, CodeValue> = {};
    if (partName === "Root" && hasContainers) baseExtra.containerType = "inline-size";
    if (anchorNames[partName]) baseExtra.anchorName = anchorNames[partName]!;
    Object.assign(
      baseExtra,
      motionTransitionStyle(
        recordAt(part.motion).change,
        preset,
        `${preset.name}.${component}.${partName}`,
      ),
    );
    const base = createStyleEntry(
      `${partName}_base`,
      baseSource,
      {
        path: `${preset.name}.${component}.${partName}`,
        varsName,
        component,
        anchorNames,
      },
      baseExtra,
    );
    entries.push(base);

    const always: StyleEntry[] = [base];
    const conditions: Array<{ when: RuntimeCondition; entry: StyleEntry }> = [];
    const when = part.when;
    for (const [index, conditionValue] of when.entries()) {
      const condition = recordAt(conditionValue);
      const apply = recordAt(condition.apply);
      const key = `${partName}_when_${index}`;
      const staticWrapper = staticConditionWrapper(condition, preset);
      const entry = createStyleEntry(
        key,
        apply,
        {
          path: `${preset.name}.${component}.${partName}.when[${index}]`,
          varsName,
          component,
          anchorNames,
        },
        undefined,
        staticWrapper,
      );
      entries.push(entry);
      const runtime = runtimeCondition(condition);
      if (runtime) conditions.push({ when: runtime, entry });
      else always.push(entry);
    }

    plans[partName] = {
      always,
      conditions,
      motion: Object.keys(part.motion).length ? part.motion : null,
    };
  }

  return { stylesName, entries, parts: plans };
}

function validatePartShape(
  part: Record<string, unknown>,
  preset: MaterializedVisualPreset,
  path: string,
): void {
  assertKnownKeys(part, [...visualStyleKeys, "use", "when", "motion"], path);
  validateMotionShape(part.motion, preset, `${path}.motion`);
  if (part.when == null) return;
  if (!Array.isArray(part.when)) throw new Error(`${path}.when must be an array.`);
  const selectors = [
    "state",
    "variant",
    "native",
    "container",
    "theme",
    "preference",
    "capability",
  ];
  for (const [index, rawCondition] of part.when.entries()) {
    const conditionPath = `${path}.when[${index}]`;
    const condition = requiredRecord(rawCondition, conditionPath);
    assertKnownKeys(condition, [...selectors, "apply"], conditionPath);
    const active = selectors.filter((selector) => condition[selector] != null);
    if (active.length !== 1) {
      throw new Error(`${conditionPath} must contain exactly one condition selector.`);
    }
    requiredRecord(condition.apply, `${conditionPath}.apply`);
  }
}

function validateMotionShape(value: unknown, preset: MaterializedVisualPreset, path: string): void {
  if (value == null) return;
  const motion = requiredRecord(value, path);
  assertKnownKeys(motion, ["change", "enter", "exit", "layout", "shared", "gesture"], path);

  if (motion.change != null) {
    const change = requiredRecord(motion.change, `${path}.change`);
    assertKnownKeys(change, Object.keys(transitionProperties), `${path}.change`);
    for (const [domain, reference] of Object.entries(change)) {
      motionToken(preset, reference, `${path}.change.${domain}`);
    }
  }
  for (const lifecycle of ["enter", "exit"] as const) {
    if (motion[lifecycle] == null) continue;
    const item = requiredRecord(motion[lifecycle], `${path}.${lifecycle}`);
    assertKnownKeys(item, [lifecycle === "enter" ? "from" : "to", "using"], `${path}.${lifecycle}`);
    const frameName = lifecycle === "enter" ? "from" : "to";
    const frame = requiredRecord(item[frameName], `${path}.${lifecycle}.${frameName}`);
    assertKnownKeys(frame, ["effect", "transform"], `${path}.${lifecycle}.${frameName}`);
    if (frame.effect != null) {
      const effect = requiredRecord(frame.effect, `${path}.${lifecycle}.${frameName}.effect`);
      assertKnownKeys(effect, ["opacity"], `${path}.${lifecycle}.${frameName}.effect`);
      if (effect.opacity != null) {
        numberAt(effect.opacity, `${path}.${lifecycle}.${frameName}.effect.opacity`);
      }
    }
    if (frame.transform != null) {
      const transform = requiredRecord(
        frame.transform,
        `${path}.${lifecycle}.${frameName}.transform`,
      );
      assertKnownKeys(
        transform,
        ["inline", "block", "scale", "rotate"],
        `${path}.${lifecycle}.${frameName}.transform`,
      );
      for (const [name, rawValue] of Object.entries(transform)) {
        numberAt(rawValue, `${path}.${lifecycle}.${frameName}.transform.${name}`);
      }
    }
    motionToken(preset, item.using, `${path}.${lifecycle}.using`);
  }
  if (motion.layout != null) {
    const layout = requiredRecord(motion.layout, `${path}.layout`);
    assertKnownKeys(layout, ["geometry", "content", "using"], `${path}.layout`);
    enumAt(
      layout.geometry,
      ["position", "size", "frame", "tracks", "text"],
      `${path}.layout.geometry`,
    );
    if (layout.content != null) {
      enumAt(layout.content, ["preserve", "scale"], `${path}.layout.content`);
    }
    motionToken(preset, layout.using, `${path}.layout.using`);
  }
  if (motion.shared != null) {
    const shared = requiredRecord(motion.shared, `${path}.shared`);
    assertKnownKeys(shared, ["id", "using"], `${path}.shared`);
    stringAt(shared.id, `${path}.shared.id`);
    motionToken(preset, shared.using, `${path}.shared.using`);
  }
  if (motion.gesture != null) {
    const gesture = requiredRecord(motion.gesture, `${path}.gesture`);
    assertKnownKeys(
      gesture,
      ["axis", "value", "handle", "bounds", "rubberBand", "dismiss", "settle"],
      `${path}.gesture`,
    );
    enumAt(gesture.axis, ["inline", "block", "both"], `${path}.gesture.axis`);
    if (!isValueReference(gesture.value) || gesture.value.kind !== "length") {
      throw new Error(`${path}.gesture.value must reference a length component value.`);
    }
    if (gesture.handle != null) stringAt(gesture.handle, `${path}.gesture.handle`);
    if (
      gesture.bounds != null &&
      (!Array.isArray(gesture.bounds) ||
        gesture.bounds.length !== 2 ||
        gesture.bounds.some((bound) => typeof bound !== "number" || Number.isNaN(bound)))
    ) {
      throw new Error(`${path}.gesture.bounds must contain two numeric bounds.`);
    }
    if (gesture.rubberBand != null) numberAt(gesture.rubberBand, `${path}.gesture.rubberBand`);
    if (gesture.dismiss != null) {
      const dismiss = requiredRecord(gesture.dismiss, `${path}.gesture.dismiss`);
      assertKnownKeys(dismiss, ["distance", "velocity"], `${path}.gesture.dismiss`);
      numberAt(dismiss.distance, `${path}.gesture.dismiss.distance`);
      numberAt(dismiss.velocity, `${path}.gesture.dismiss.velocity`);
    }
    motionToken(preset, gesture.settle, `${path}.gesture.settle`);
  }
}

function motionToken(preset: MaterializedVisualPreset, value: unknown, path: string): unknown {
  const reference = requiredRecord(value, path);
  if (
    reference.$visual !== "token" ||
    reference.group !== "motion" ||
    typeof reference.name !== "string" ||
    !(reference.name in recordAt(preset.tokens.motion))
  ) {
    throw new Error(`${path} must reference a motion token.`);
  }
  return recordAt(preset.tokens.motion)[reference.name];
}

const transitionProperties: Readonly<Record<string, readonly string[]>> = {
  surface: ["background-color", "background-image", "color"],
  text: ["color", "font-size", "font-weight", "line-height", "letter-spacing"],
  stroke: ["border-color", "border-width"],
  shape: ["border-radius", "clip-path"],
  effect: ["opacity"],
  transform: ["translate", "scale", "rotate", "transform"],
};

function motionTransitionStyle(
  value: unknown,
  preset: MaterializedVisualPreset,
  path: string,
): Record<string, CodeValue> {
  const change = recordAt(value);
  if (!Object.keys(change).length) return {};
  const owners = new Map<string, { driver: unknown; domain: string }>();
  for (const [domain, reference] of Object.entries(change)) {
    const properties = transitionProperties[domain];
    if (!properties) throw new Error(`${path}.motion.change contains unknown domain ${domain}.`);
    const driver = motionToken(preset, reference, `${path}.motion.change.${domain}`);
    for (const property of properties) {
      const current = owners.get(property);
      if (current && JSON.stringify(current.driver) !== JSON.stringify(driver)) {
        throw new Error(
          `${path}.motion.change gives ${property} competing owners through ${current.domain} and ${domain}.`,
        );
      }
      owners.set(property, { driver, domain });
    }
  }
  const properties = [...owners.keys()];
  const drivers = properties.map((property) => owners.get(property)!.driver);
  return {
    transitionProperty: properties.join(", "),
    transitionDuration: {
      default: drivers.map((driver) => motionCssTiming(driver).duration).join(", "),
      "@media (prefers-reduced-motion: reduce)": "0ms",
    },
    transitionTimingFunction: drivers.map((driver) => motionCssTiming(driver).easing).join(", "),
    transitionDelay: drivers.map((driver) => motionCssTiming(driver).delay).join(", "),
  };
}

function motionCssTiming(value: unknown): { duration: string; delay: string; easing: string } {
  if (value === "none") return { duration: "0ms", delay: "0ms", easing: "linear" };
  const driver = recordAt(value);
  const delay = `${numberOr(driver.delay, 0)}ms`;
  const spring = recordAt(driver.spring);
  if (Object.keys(spring).length) {
    const duration = numberOr(spring.duration, 400);
    return {
      duration: `${duration}ms`,
      delay,
      easing: waapi.convertEase(
        animeSpring({ duration, bounce: numberOr(spring.bounce, 0) }).ease,
        24,
      ),
    };
  }
  const easings: Readonly<Record<string, string>> = {
    linear: "linear",
    smooth: "cubic-bezier(.65, 0, .35, 1)",
    accelerate: "cubic-bezier(.32, 0, .67, 0)",
    decelerate: "cubic-bezier(.33, 1, .68, 1)",
  };
  return {
    duration: `${numberOr(driver.duration, 180)}ms`,
    delay,
    easing: easings[String(driver.easing)] ?? easings.decelerate!,
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function validateMotionSafety(
  part: Record<string, unknown>,
  resolved: Record<string, unknown>,
  path: string,
): void {
  const motion = recordAt(part.motion);
  const layout = recordAt(motion.layout);
  if (!Object.keys(layout).length) return;
  const geometry = layout.geometry;
  if (geometry === "size" || geometry === "frame" || geometry === "tracks" || geometry === "text") {
    const contain = recordAt(resolved.frame).contain;
    if (contain !== "layout" && contain !== "strict") {
      throw new Error(`${path}.motion.layout with ${geometry} geometry requires frame.contain.`);
    }
  }
  if (geometry === "text" && layout.content === "scale") {
    throw new Error(`${path}.motion.layout text geometry cannot scale glyph content.`);
  }
  const transform = recordAt(resolved.transform);
  if (transform.skewInline != null || transform.skewBlock != null) {
    throw new Error(`${path} cannot combine layout motion with an authored transform matrix.`);
  }
}

function createStyleEntry(
  key: string,
  source: Record<string, unknown>,
  base: Omit<LoweringContext, "values">,
  extra?: Readonly<Record<string, CodeValue>>,
  wrapper?: string,
): StyleEntry {
  const values: ValueArgument[] = [];
  const context: LoweringContext = { ...base, values };
  const style = lowerVisualFragment(source, context);
  if (extra) Object.assign(style, extra);
  return {
    key,
    style: wrapper ? { [wrapper]: style } : style,
    values,
  };
}

function stylexCreateSource(plan: ComponentPlan): string {
  const entries = plan.entries
    .map((entry) => {
      const key = JSON.stringify(entry.key);
      if (!entry.values.length) return `  ${key}: ${printCode(entry.style)},`;
      const parameters = entry.values.map((value) => value.parameter).join(", ");
      return `  ${key}: (${parameters}) => (${printCode(entry.style)}),`;
    })
    .join("\n");
  return `const ${plan.stylesName} = stylex.create({\n${entries}\n});`;
}

function componentManifestSource(plans: Readonly<Record<string, ComponentPlan>>): string {
  const components = Object.entries(plans)
    .map(([componentName, plan]) => {
      const parts = Object.entries(plan.parts)
        .map(([partName, part]) => {
          const always = part.always.map((entry) => entryManifestSource(plan.stylesName, entry));
          const conditions = part.conditions.map(
            ({ when, entry }) =>
              `{ when: ${JSON.stringify(when)}, entry: ${entryManifestSource(plan.stylesName, entry)} }`,
          );
          return `${JSON.stringify(partName)}: { always: [${always.join(", ")}], conditions: [${conditions.join(", ")}], motion: ${JSON.stringify(part.motion)} }`;
        })
        .join(",\n      ");
      return `${JSON.stringify(componentName)}: {\n      ${parts}\n    }`;
    })
    .join(",\n    ");
  return `{\n    ${components}\n  }`;
}

function entryManifestSource(stylesName: string, entry: StyleEntry): string {
  return `{ style: ${stylesName}[${JSON.stringify(entry.key)}], values: ${JSON.stringify(
    entry.values.map(({ name, kind }) => ({ name, kind })),
  )} }`;
}

function raw(code: string): RawCode {
  return { $code: code };
}

function printCode(value: CodeValue): string {
  if (isRawCode(value)) return value.$code;
  if (Array.isArray(value)) return `[${value.map(printCode).join(", ")}]`;
  if (value && typeof value === "object") {
    return `{ ${Object.entries(value)
      .map(([key, child]) => `${JSON.stringify(key)}: ${printCode(child)}`)
      .join(", ")} }`;
  }
  return JSON.stringify(value);
}

function isRawCode(value: unknown): value is RawCode {
  return Boolean(
    value &&
    typeof value === "object" &&
    Object.keys(value).length === 1 &&
    typeof (value as RawCode).$code === "string",
  );
}

function identifier(value: string, capitalize = false): string {
  const words = value.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const joined = words
    .map((word, index) => {
      if (index === 0 && !capitalize) return word[0]?.toLowerCase() + word.slice(1);
      return word[0]?.toUpperCase() + word.slice(1);
    })
    .join("");
  const safe = joined || "visual";
  return /^\d/.test(safe) ? `visual${safe}` : safe;
}

function tokenVariableName(group: string, name: string): string {
  return `${group}_${name}`;
}

function recordAt(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function lowerVisualFragment(
  source: Record<string, unknown>,
  context: LoweringContext,
): Record<string, CodeValue> {
  const style: Record<string, CodeValue> = {};
  for (const key of Object.keys(source)) {
    if (key === "use" || key === "when" || key === "motion") continue;
    if (!visualStyleKeys.has(key)) {
      throw new Error(`${context.path} contains unknown visual domain ${JSON.stringify(key)}.`);
    }
  }

  if (source.layout != null) lowerLayout(source.layout, style, childPath(context, "layout"));
  if (source.frame != null) lowerFrame(source.frame, style, childPath(context, "frame"));
  if (source.place != null) lowerPlace(source.place, style, childPath(context, "place"));
  if (source.padding != null) {
    lowerLogicalSpace(source.padding, style, "padding", childPath(context, "padding"));
  }
  if (source.margin != null) {
    lowerLogicalSpace(source.margin, style, "margin", childPath(context, "margin"));
  }
  if (source.surface != null) lowerSurface(source.surface, style, childPath(context, "surface"));
  if (source.text != null) lowerText(source.text, style, childPath(context, "text"));
  if (source.media != null) lowerMedia(source.media, style, childPath(context, "media"));
  if (source.stroke != null) lowerStroke(source.stroke, style, childPath(context, "stroke"));
  if (source.shape != null) lowerShape(source.shape, style, childPath(context, "shape"));
  if (source.effect != null) lowerEffect(source.effect, style, childPath(context, "effect"));
  if (source.transform != null) {
    lowerTransform(source.transform, style, childPath(context, "transform"));
  }
  if (source.position != null) {
    lowerPosition(source.position, style, childPath(context, "position"));
  }
  if (source.scroll != null) lowerScroll(source.scroll, style, childPath(context, "scroll"));
  if (source.interaction != null) {
    lowerInteraction(source.interaction, style, childPath(context, "interaction"));
  }
  if (source.decor != null) lowerDecor(source.decor, style, childPath(context, "decor"));
  return style;
}

function lowerLayout(
  value: unknown,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  const layout = requiredRecord(value, context.path);
  assertKnownKeys(
    layout,
    [
      "kind",
      "gap",
      "align",
      "distribute",
      "wrap",
      "reverse",
      "columns",
      "rows",
      "columnGap",
      "rowGap",
      "autoFlow",
      "subgrid",
    ],
    context.path,
  );
  const kind = stringAt(layout.kind, `${context.path}.kind`);
  switch (kind) {
    case "row":
    case "stack":
      style.display = "flex";
      style.flexDirection =
        kind === "row"
          ? layout.reverse
            ? "row-reverse"
            : "row"
          : layout.reverse
            ? "column-reverse"
            : "column";
      if (layout.wrap != null) style.flexWrap = layout.wrap ? "wrap" : "nowrap";
      break;
    case "grid":
      style.display = "grid";
      if (Array.isArray(layout.columns)) {
        style.gridTemplateColumns = cssList(
          layout.columns.map((track, index) =>
            cssGridTrack(track, childPath(context, `columns[${index}]`)),
          ),
        );
      }
      if (Array.isArray(layout.rows)) {
        style.gridTemplateRows = cssList(
          layout.rows.map((track, index) =>
            cssGridTrack(track, childPath(context, `rows[${index}]`)),
          ),
        );
      }
      if (layout.autoFlow != null) {
        const autoFlow: Record<string, string> = {
          row: "row",
          column: "column",
          "dense-row": "row dense",
          "dense-column": "column dense",
        };
        style.gridAutoFlow = autoFlow[stringAt(layout.autoFlow, `${context.path}.autoFlow`)]!;
      }
      if (layout.subgrid === "columns" || layout.subgrid === "both") {
        style.gridTemplateColumns = "subgrid";
      }
      if (layout.subgrid === "rows" || layout.subgrid === "both") {
        style.gridTemplateRows = "subgrid";
      }
      break;
    case "overlay":
      style.display = "grid";
      style.gridTemplateColumns = "minmax(0, 1fr)";
      style.gridTemplateRows = "minmax(0, 1fr)";
      break;
    case "contents":
      style.display = "contents";
      break;
    case "hidden":
      style.display = "none";
      break;
    default:
      throw new Error(`${context.path}.kind has unsupported value ${JSON.stringify(kind)}.`);
  }
  if (layout.gap != null) style.gap = cssLength(layout.gap, childPath(context, "gap"));
  if (layout.columnGap != null) {
    style.columnGap = cssLength(layout.columnGap, childPath(context, "columnGap"));
  }
  if (layout.rowGap != null) {
    style.rowGap = cssLength(layout.rowGap, childPath(context, "rowGap"));
  }
  if (layout.align != null) style.alignItems = alignValue(layout.align, `${context.path}.align`);
  if (layout.distribute != null) {
    style.justifyContent = distributeValue(layout.distribute, `${context.path}.distribute`);
  }
}

function lowerFrame(
  value: unknown,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  const frame = requiredRecord(value, context.path);
  assertKnownKeys(frame, ["inline", "block", "aspect", "contain", "visibility"], context.path);
  lowerFrameAxis(frame.inline, style, "inline", context);
  lowerFrameAxis(frame.block, style, "block", context);
  if (frame.aspect != null) style.aspectRatio = numberAt(frame.aspect, `${context.path}.aspect`);
  if (frame.contain != null && frame.contain !== "none") {
    style.contain = stringAt(frame.contain, `${context.path}.contain`);
  }
  if (frame.visibility === "deferred" || frame.visibility === "auto") {
    style.contentVisibility = "auto";
  } else if (frame.visibility === "visible") {
    style.contentVisibility = "visible";
  }
}

function lowerFrameAxis(
  value: unknown,
  style: Record<string, CodeValue>,
  axis: "inline" | "block",
  context: LoweringContext,
): void {
  if (value == null) return;
  const property = axis === "inline" ? "inlineSize" : "blockSize";
  if (isMeasureObject(value) && ("min" in value || "max" in value)) {
    assertKnownKeys(value, ["min", "max"], `${context.path}.${axis}`);
    if (value.min != null) {
      style[axis === "inline" ? "minInlineSize" : "minBlockSize"] = cssMeasure(
        value.min,
        childPath(context, `${axis}.min`),
      );
    }
    if (value.max != null) {
      style[axis === "inline" ? "maxInlineSize" : "maxBlockSize"] = cssMeasure(
        value.max,
        childPath(context, `${axis}.max`),
      );
    }
    return;
  }
  style[property] = cssMeasure(value, childPath(context, axis));
}

function lowerPlace(
  value: unknown,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  const place = requiredRecord(value, context.path);
  assertKnownKeys(place, ["align", "distribute", "order", "flex", "grid", "overlay"], context.path);
  if (place.align != null) style.alignSelf = alignValue(place.align, `${context.path}.align`);
  if (place.distribute != null) {
    style.justifySelf = alignValue(place.distribute, `${context.path}.distribute`);
  }
  if (place.order != null) style.order = numberAt(place.order, `${context.path}.order`);
  const flex = recordAt(place.flex);
  assertKnownKeys(flex, ["grow", "shrink", "basis"], `${context.path}.flex`);
  if (flex.grow != null) style.flexGrow = numberAt(flex.grow, `${context.path}.flex.grow`);
  if (flex.shrink != null) style.flexShrink = numberAt(flex.shrink, `${context.path}.flex.shrink`);
  if (flex.basis != null) {
    style.flexBasis = cssMeasure(flex.basis, childPath(context, "flex.basis"));
  }
  const grid = recordAt(place.grid);
  assertKnownKeys(grid, ["column", "row"], `${context.path}.grid`);
  if (grid.column != null) {
    style.gridColumn = cssGridLine(grid.column, `${context.path}.grid.column`);
  }
  if (grid.row != null) style.gridRow = cssGridLine(grid.row, `${context.path}.grid.row`);
  if (place.overlay === true) style.gridArea = "1 / 1";
}

function lowerLogicalSpace(
  value: unknown,
  style: Record<string, CodeValue>,
  prefix: "padding" | "margin",
  context: LoweringContext,
): void {
  if (!isPlainRecord(value) || isVisualReference(value)) {
    style[prefix] = cssLength(value, context);
    return;
  }
  const space = value as Record<string, unknown>;
  const property: Record<string, string> = {
    inline: `${prefix}Inline`,
    block: `${prefix}Block`,
    inlineStart: `${prefix}InlineStart`,
    inlineEnd: `${prefix}InlineEnd`,
    blockStart: `${prefix}BlockStart`,
    blockEnd: `${prefix}BlockEnd`,
  };
  for (const [name, rawValue] of Object.entries(space)) {
    const target = property[name];
    if (!target) throw new Error(`${context.path} contains unknown logical side ${name}.`);
    style[target] = cssLength(rawValue, childPath(context, name));
  }
}

function lowerSurface(
  value: unknown,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  const surface = requiredRecord(value, context.path);
  assertKnownKeys(surface, ["fill", "text"], context.path);
  if (surface.fill != null) {
    const fillContext = childPath(context, "fill");
    const group = isTokenReference(surface.fill) ? surface.fill.group : "color";
    style[group === "gradient" ? "backgroundImage" : "backgroundColor"] = cssPaint(
      surface.fill,
      fillContext,
    );
  }
  if (surface.text != null) style.color = cssColor(surface.text, childPath(context, "text"));
}

function lowerText(
  value: unknown,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  const text = requiredRecord(value, context.path);
  assertKnownKeys(
    text,
    [
      "font",
      "size",
      "weight",
      "line",
      "tracking",
      "align",
      "transform",
      "wrap",
      "overflow",
      "lines",
      "decoration",
      "smoothing",
      "features",
    ],
    context.path,
  );
  if (text.font != null) style.fontFamily = cssToken(text.font, context, "font");
  if (text.size != null) style.fontSize = cssLength(text.size, childPath(context, "size"));
  if (text.weight != null) style.fontWeight = numberAt(text.weight, `${context.path}.weight`);
  if (text.line != null) {
    style.lineHeight =
      typeof text.line === "number"
        ? numberAt(text.line, `${context.path}.line`)
        : cssLength(text.line, childPath(context, "line"));
  }
  if (text.tracking != null) {
    style.letterSpacing = cssLength(text.tracking, childPath(context, "tracking"));
  }
  if (text.align != null) style.textAlign = stringAt(text.align, `${context.path}.align`);
  if (text.transform != null) {
    style.textTransform = stringAt(text.transform, `${context.path}.transform`);
  }
  if (text.wrap === "nowrap") style.whiteSpace = "nowrap";
  if (text.wrap === "wrap") style.whiteSpace = "normal";
  if (text.wrap === "balance" || text.wrap === "pretty") style.textWrap = text.wrap;
  if (text.overflow === "ellipsis") {
    style.overflow = "hidden";
    style.textOverflow = "ellipsis";
  } else if (text.overflow === "clip") {
    style.overflow = "hidden";
    style.textOverflow = "clip";
  }
  if (text.lines != null) {
    const lines = numberAt(text.lines, `${context.path}.lines`);
    style.display = "-webkit-box";
    style.WebkitBoxOrient = "vertical";
    style.WebkitLineClamp = lines;
    style.overflow = "hidden";
  }
  if (text.decoration === "strike") style.textDecorationLine = "line-through";
  else if (text.decoration != null) style.textDecorationLine = text.decoration;
  if (text.smoothing === "grayscale") style.WebkitFontSmoothing = "antialiased";
  else if (text.smoothing === "auto") style.WebkitFontSmoothing = "auto";
  if (text.features != null) {
    style.fontFeatureSettings = Object.entries(
      requiredRecord(text.features, `${context.path}.features`),
    )
      .map(
        ([name, enabled]) =>
          `${JSON.stringify(name)} ${enabled === true ? 1 : enabled === false ? 0 : numberAt(enabled, `${context.path}.features.${name}`)}`,
      )
      .join(", ");
  }
}

function lowerMedia(
  value: unknown,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  const media = requiredRecord(value, context.path);
  assertKnownKeys(media, ["fit", "position", "rendering"], context.path);
  if (media.fit != null) style.objectFit = stringAt(media.fit, `${context.path}.fit`);
  if (media.position != null) {
    const position = requiredRecord(media.position, `${context.path}.position`);
    assertKnownKeys(position, ["inline", "block"], `${context.path}.position`);
    style.objectPosition = `${numberAt(position.inline, `${context.path}.position.inline`) * 100}% ${numberAt(position.block, `${context.path}.position.block`) * 100}%`;
  }
  if (media.rendering === "crisp") style.imageRendering = "crisp-edges";
  else if (media.rendering != null) style.imageRendering = media.rendering;
}

function lowerStroke(
  value: unknown,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  if (isTokenReference(value)) {
    style.border = cssToken(value, context, "stroke");
    return;
  }
  const stroke = requiredRecord(value, context.path);
  const logicalSides = ["all", "inlineStart", "inlineEnd", "blockStart", "blockEnd"];
  if (logicalSides.some((side) => side in stroke)) {
    assertKnownKeys(stroke, logicalSides, context.path);
    for (const side of logicalSides) {
      if (stroke[side] == null) continue;
      lowerStrokeLine(
        stroke[side],
        style,
        side === "all" ? "border" : `border${side[0]!.toUpperCase()}${side.slice(1)}`,
        childPath(context, side),
      );
    }
    return;
  }
  assertKnownKeys(stroke, ["width", "line", "color"], context.path);
  lowerStrokeLine(stroke, style, "border", context);
}

function lowerStrokeLine(
  value: unknown,
  style: Record<string, CodeValue>,
  prefix: string,
  context: LoweringContext,
): void {
  const stroke = requiredRecord(value, context.path);
  assertKnownKeys(stroke, ["width", "line", "color"], context.path);
  if (stroke.width != null)
    style[`${prefix}Width`] = cssLength(stroke.width, childPath(context, "width"));
  if (stroke.line != null)
    style[`${prefix}Style`] = strokeLine(stroke.line, `${context.path}.line`);
  if (stroke.color != null)
    style[`${prefix}Color`] = cssColor(stroke.color, childPath(context, "color"));
}

function lowerShape(
  value: unknown,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  const shape = requiredRecord(value, context.path);
  assertKnownKeys(shape, ["radius", "clip", "mask"], context.path);
  if (shape.radius != null) {
    if (!isPlainRecord(shape.radius) || isVisualReference(shape.radius)) {
      style.borderRadius = cssLength(shape.radius, childPath(context, "radius"));
    } else {
      const radius = shape.radius as Record<string, unknown>;
      assertKnownKeys(
        radius,
        ["startStart", "startEnd", "endStart", "endEnd"],
        `${context.path}.radius`,
      );
      const properties: Record<string, string> = {
        startStart: "borderStartStartRadius",
        startEnd: "borderStartEndRadius",
        endStart: "borderEndStartRadius",
        endEnd: "borderEndEndRadius",
      };
      for (const [corner, rawValue] of Object.entries(radius)) {
        const property = properties[corner];
        if (!property) throw new Error(`${context.path}.radius contains unknown corner ${corner}.`);
        style[property] = cssLength(rawValue, childPath(context, `radius.${corner}`));
      }
    }
  }
  if (shape.clip === "content") style.overflow = "clip";
  else if (shape.clip === "none") style.clipPath = "none";
  else if (isPlainRecord(shape.clip)) {
    const clip = shape.clip as Record<string, unknown>;
    assertKnownKeys(clip, ["circle", "inset"], `${context.path}.clip`);
    if (clip.circle != null)
      style.clipPath = `circle(${numberAt(clip.circle, `${context.path}.clip.circle`) * 100}%)`;
    else if (clip.inset != null) {
      style.clipPath = cssInset(clip.inset, childPath(context, "clip.inset"));
    }
  }
  if (shape.mask != null) style.maskImage = cssToken(shape.mask, context, "gradient");
}

function lowerEffect(
  value: unknown,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  const effect = requiredRecord(value, context.path);
  assertKnownKeys(
    effect,
    ["opacity", "shadow", "blur", "backdrop", "brightness", "contrast", "saturation", "blend"],
    context.path,
  );
  if (effect.opacity != null)
    style.opacity = cssNumber(effect.opacity, childPath(context, "opacity"));
  if (effect.shadow != null) {
    style.boxShadow =
      effect.shadow === "none" ? "none" : cssToken(effect.shadow, context, "shadow");
  }
  const filters: CodeValue[] = [];
  if (effect.blur != null)
    filters.push(cssFunction("blur", cssLength(effect.blur, childPath(context, "blur"))));
  if (effect.brightness != null)
    filters.push(`brightness(${numberAt(effect.brightness, `${context.path}.brightness`)})`);
  if (effect.contrast != null)
    filters.push(`contrast(${numberAt(effect.contrast, `${context.path}.contrast`)})`);
  if (effect.saturation != null)
    filters.push(`saturate(${numberAt(effect.saturation, `${context.path}.saturation`)})`);
  if (filters.length) style.filter = cssList(filters);
  const backdrop = recordAt(effect.backdrop);
  assertKnownKeys(backdrop, ["blur", "saturation", "brightness"], `${context.path}.backdrop`);
  const backdropFilters: CodeValue[] = [];
  if (backdrop.blur != null)
    backdropFilters.push(
      cssFunction("blur", cssLength(backdrop.blur, childPath(context, "backdrop.blur"))),
    );
  if (backdrop.saturation != null)
    backdropFilters.push(
      `saturate(${numberAt(backdrop.saturation, `${context.path}.backdrop.saturation`)})`,
    );
  if (backdrop.brightness != null)
    backdropFilters.push(
      `brightness(${numberAt(backdrop.brightness, `${context.path}.backdrop.brightness`)})`,
    );
  if (backdropFilters.length) style.backdropFilter = cssList(backdropFilters);
  if (effect.blend != null) style.mixBlendMode = stringAt(effect.blend, `${context.path}.blend`);
}

function lowerTransform(
  value: unknown,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  const transform = requiredRecord(value, context.path);
  assertKnownKeys(
    transform,
    [
      "inline",
      "block",
      "depth",
      "scale",
      "scaleInline",
      "scaleBlock",
      "rotate",
      "skewInline",
      "skewBlock",
      "origin",
      "perspective",
    ],
    context.path,
  );
  if (transform.inline != null || transform.block != null || transform.depth != null) {
    const inline =
      transform.inline == null ? "0px" : cssLength(transform.inline, childPath(context, "inline"));
    const block =
      transform.block == null ? "0px" : cssLength(transform.block, childPath(context, "block"));
    const depth =
      transform.depth == null ? undefined : cssLength(transform.depth, childPath(context, "depth"));
    style.translate = depth == null ? cssList([inline, block]) : cssList([inline, block, depth]);
  }
  if (transform.scale != null)
    style.scale = cssNumber(transform.scale, childPath(context, "scale"));
  else if (transform.scaleInline != null || transform.scaleBlock != null) {
    style.scale = cssList([
      transform.scaleInline == null
        ? 1
        : cssNumber(transform.scaleInline, childPath(context, "scaleInline")),
      transform.scaleBlock == null
        ? 1
        : cssNumber(transform.scaleBlock, childPath(context, "scaleBlock")),
    ]);
  }
  if (transform.rotate != null)
    style.rotate = cssAngle(transform.rotate, childPath(context, "rotate"));
  const skew: CodeValue[] = [];
  if (transform.skewInline != null)
    skew.push(
      cssFunction("skewX", cssAngle(transform.skewInline, childPath(context, "skewInline"))),
    );
  if (transform.skewBlock != null)
    skew.push(cssFunction("skewY", cssAngle(transform.skewBlock, childPath(context, "skewBlock"))));
  if (skew.length) style.transform = cssList(skew);
  if (transform.origin != null) {
    const origin = requiredRecord(transform.origin, `${context.path}.origin`);
    assertKnownKeys(origin, ["inline", "block"], `${context.path}.origin`);
    style.transformOrigin = `${numberAt(origin.inline, `${context.path}.origin.inline`) * 100}% ${numberAt(origin.block, `${context.path}.origin.block`) * 100}%`;
  }
  if (transform.perspective != null)
    style.perspective = cssLength(transform.perspective, childPath(context, "perspective"));
}

function lowerPosition(
  value: unknown,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  const position = requiredRecord(value, context.path);
  assertKnownKeys(position, ["kind", "inset", "layer", "anchor", "place"], context.path);
  style.position = stringAt(position.kind, `${context.path}.kind`);
  if (position.inset != null)
    lowerLogicalSpace(position.inset, style, "margin", childPath(context, "inset"));
  if (position.inset != null) {
    for (const key of Object.keys(style).filter((key) => key.startsWith("margin"))) {
      const insetKey = key.replace(/^margin/, "inset");
      style[insetKey] = style[key]!;
      delete style[key];
    }
  }
  if (position.layer != null) style.zIndex = cssNumber(position.layer, childPath(context, "layer"));
  const anchor = recordAt(position.anchor);
  if (position.anchor != null && position.anchor !== "none") {
    assertKnownKeys(anchor, ["part"], `${context.path}.anchor`);
  }
  if (position.anchor === "none") style.positionAnchor = "auto";
  else if (anchor.part != null) {
    const anchorName = context.anchorNames[stringAt(anchor.part, `${context.path}.anchor.part`)];
    if (!anchorName) throw new Error(`${context.path}.anchor references an undeclared part.`);
    style.positionAnchor = anchorName;
  }
  if (position.place != null) {
    const place = stringAt(position.place, `${context.path}.place`);
    style.positionArea = place === "auto" ? "none" : place;
    if (anchor.part != null && place !== "auto") {
      const axis = place.startsWith("block") ? "block" : "inline";
      style.positionTryFallbacks = `flip-${axis}`;
      style.positionTryOrder = `most-${axis}-size`;
    }
  }
}

function lowerScroll(
  value: unknown,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  const scroll = requiredRecord(value, context.path);
  assertKnownKeys(
    scroll,
    ["inline", "block", "overscroll", "snap", "snapAlign", "gutter", "scrollbar"],
    context.path,
  );
  if (scroll.inline != null)
    style.overflowInline = stringAt(scroll.inline, `${context.path}.inline`);
  if (scroll.block != null) style.overflowBlock = stringAt(scroll.block, `${context.path}.block`);
  if (scroll.overscroll != null)
    style.overscrollBehavior = stringAt(scroll.overscroll, `${context.path}.overscroll`);
  if (scroll.snap != null && scroll.snap !== "none")
    style.scrollSnapType = `${scroll.snap} mandatory`;
  else if (scroll.snap === "none") style.scrollSnapType = "none";
  if (scroll.snapAlign != null)
    style.scrollSnapAlign = stringAt(scroll.snapAlign, `${context.path}.snapAlign`);
  if (scroll.gutter === "stable-both") style.scrollbarGutter = "stable both-edges";
  else if (scroll.gutter != null) style.scrollbarGutter = scroll.gutter;
  if (scroll.scrollbar === "hidden") style.scrollbarWidth = "none";
  else if (scroll.scrollbar != null) style.scrollbarWidth = scroll.scrollbar;
}

function lowerInteraction(
  value: unknown,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  const interaction = requiredRecord(value, context.path);
  assertKnownKeys(
    interaction,
    ["cursor", "select", "touch", "pointer", "caret", "focusRing"],
    context.path,
  );
  if (interaction.cursor != null)
    style.cursor = stringAt(interaction.cursor, `${context.path}.cursor`);
  if (interaction.select != null)
    style.userSelect = stringAt(interaction.select, `${context.path}.select`);
  if (interaction.touch != null) {
    const touch: Record<string, string> = {
      "pan-inline": "pan-x",
      "pan-block": "pan-y",
    };
    const value = stringAt(interaction.touch, `${context.path}.touch`);
    style.touchAction = touch[value] ?? value;
  }
  if (interaction.pointer != null)
    style.pointerEvents = stringAt(interaction.pointer, `${context.path}.pointer`);
  if (interaction.caret != null)
    style.caretColor = cssColor(interaction.caret, childPath(context, "caret"));
  if (interaction.focusRing === "none") {
    style[":focus-visible"] = { outline: "none" };
  } else if (interaction.focusRing != null) {
    const ring = requiredRecord(interaction.focusRing, `${context.path}.focusRing`);
    assertKnownKeys(ring, ["color", "width", "offset"], `${context.path}.focusRing`);
    const focus: Record<string, CodeValue> = {
      outlineStyle: "solid",
      outlineColor: cssColor(ring.color, childPath(context, "focusRing.color")),
      outlineWidth: cssLength(ring.width, childPath(context, "focusRing.width")),
    };
    if (ring.offset != null)
      focus.outlineOffset = cssLength(ring.offset, childPath(context, "focusRing.offset"));
    style[":focus-visible"] = focus;
  }
}

function lowerDecor(
  value: unknown,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  const decor = requiredRecord(value, context.path);
  const pseudos: Record<string, string> = {
    before: "::before",
    after: "::after",
    backdrop: "::backdrop",
    placeholder: "::placeholder",
    selection: "::selection",
    track: "::-webkit-slider-runnable-track",
    thumb: "::-webkit-slider-thumb",
  };
  assertKnownKeys(decor, Object.keys(pseudos), context.path);
  for (const [name, pseudo] of Object.entries(pseudos)) {
    if (decor[name] == null) continue;
    const source = requiredRecord(decor[name], `${context.path}.${name}`);
    const pseudoSource = { ...source };
    const content = pseudoSource.content;
    delete pseudoSource.content;
    const lowered = lowerVisualFragment(pseudoSource, childPath(context, name));
    if (content != null) lowered.content = JSON.stringify(String(content));
    style[pseudo] = lowered;
  }
}

function cssLength(value: unknown, context: LoweringContext): CodeValue {
  if (typeof value === "number") return lengthLiteral(value, context.path);
  if (isTokenReference(value)) return cssToken(value, context);
  if (isValueReference(value)) return valueArgument(value, context);
  const length = requiredRecord(value, context.path);
  const operators = [
    "percent",
    "container",
    "viewport",
    "fluid",
    "add",
    "subtract",
    "multiply",
    "negate",
  ];
  const active = operators.filter((operator) => length[operator] != null);
  if (active.length !== 1) throw new Error(`${context.path} must contain one length operator.`);
  assertKnownKeys(length, active, context.path);
  if (length.percent != null)
    return `${numberAt(length.percent, `${context.path}.percent`) * 100}%`;
  if (length.container != null) {
    const container = requiredRecord(length.container, `${context.path}.container`);
    assertKnownKeys(container, ["axis", "percent"], `${context.path}.container`);
    enumAt(container.axis, ["inline", "block"], `${context.path}.container.axis`);
    const unit = container.axis === "block" ? "cqb" : "cqi";
    return `${numberAt(container.percent, `${context.path}.container.percent`) * 100}${unit}`;
  }
  if (length.viewport != null) {
    const viewport = requiredRecord(length.viewport, `${context.path}.viewport`);
    assertKnownKeys(viewport, ["axis", "percent"], `${context.path}.viewport`);
    enumAt(viewport.axis, ["inline", "block"], `${context.path}.viewport.axis`);
    const unit = viewport.axis === "block" ? "vb" : "vi";
    return `${numberAt(viewport.percent, `${context.path}.viewport.percent`) * 100}${unit}`;
  }
  if (length.fluid != null) {
    const fluid = requiredRecord(length.fluid, `${context.path}.fluid`);
    assertKnownKeys(fluid, ["min", "ideal", "max"], `${context.path}.fluid`);
    return cssTemplate([
      "clamp(",
      cssLength(fluid.min, childPath(context, "fluid.min")),
      ", ",
      cssLength(fluid.ideal, childPath(context, "fluid.ideal")),
      ", ",
      cssLength(fluid.max, childPath(context, "fluid.max")),
      ")",
    ]);
  }
  if (Array.isArray(length.add) && length.add.length === 2) {
    return cssTemplate([
      "calc(",
      cssLength(length.add[0], childPath(context, "add[0]")),
      " + ",
      cssLength(length.add[1], childPath(context, "add[1]")),
      ")",
    ]);
  }
  if (Array.isArray(length.subtract) && length.subtract.length === 2) {
    return cssTemplate([
      "calc(",
      cssLength(length.subtract[0], childPath(context, "subtract[0]")),
      " - ",
      cssLength(length.subtract[1], childPath(context, "subtract[1]")),
      ")",
    ]);
  }
  if (Array.isArray(length.multiply) && length.multiply.length === 2) {
    return cssTemplate([
      "calc(",
      cssLength(length.multiply[0], childPath(context, "multiply[0]")),
      " * ",
      cssNumber(length.multiply[1], childPath(context, "multiply[1]")),
      ")",
    ]);
  }
  if (length.negate != null) {
    return cssTemplate(["calc(-1 * ", cssLength(length.negate, childPath(context, "negate")), ")"]);
  }
  throw new Error(`${context.path} is not a valid visual length.`);
}

function cssNumber(value: unknown, context: LoweringContext): CodeValue {
  if (typeof value === "number") return numberAt(value, context.path);
  if (isTokenReference(value)) return cssToken(value, context, "z");
  if (isValueReference(value)) return valueArgument(value, context);
  const number = requiredRecord(value, context.path);
  if (Array.isArray(number.mix) && number.mix.length === 2 && number.by != null) {
    assertKnownKeys(number, ["mix", "by"], context.path);
    const from = cssNumber(number.mix[0], childPath(context, "mix[0]"));
    const to = cssNumber(number.mix[1], childPath(context, "mix[1]"));
    const by = cssNumber(number.by, childPath(context, "by"));
    return cssTemplate(["calc(", from, " + (", to, " - ", from, ") * ", by, ")"]);
  }
  if (Array.isArray(number.clamp) && number.clamp.length === 3) {
    assertKnownKeys(number, ["clamp"], context.path);
    return cssTemplate([
      "clamp(",
      cssNumber(number.clamp[0], childPath(context, "clamp[0]")),
      ", ",
      cssNumber(number.clamp[1], childPath(context, "clamp[1]")),
      ", ",
      cssNumber(number.clamp[2], childPath(context, "clamp[2]")),
      ")",
    ]);
  }
  throw new Error(`${context.path} is not a valid visual number.`);
}

function cssAngle(value: unknown, context: LoweringContext): CodeValue {
  if (typeof value === "number") return `${numberAt(value, context.path)}deg`;
  if (isValueReference(value)) return valueArgument(value, context);
  throw new Error(`${context.path} is not a valid visual angle.`);
}

function cssColor(value: unknown, context: LoweringContext): CodeValue {
  if (isTokenReference(value)) return cssToken(value, context, "color");
  if (value === "transparent" || value === "current") {
    return value === "current" ? "currentColor" : value;
  }
  const color = requiredRecord(value, context.path);
  if (Array.isArray(color.mix) && color.mix.length === 2) {
    assertKnownKeys(color, ["mix", "by"], context.path);
    const by = numberAt(color.by, `${context.path}.by`);
    return cssTemplate([
      "color-mix(in oklch, ",
      cssColor(color.mix[0], childPath(context, "mix[0]")),
      ` ${(1 - by) * 100}%, `,
      cssColor(color.mix[1], childPath(context, "mix[1]")),
      ` ${by * 100}%)`,
    ]);
  }
  return colorLiteral(color, context.path);
}

function cssPaint(value: unknown, context: LoweringContext): CodeValue {
  if (isTokenReference(value)) {
    const group = stringAt(value.group, `${context.path}.group`);
    if (group !== "color" && group !== "gradient") {
      throw new Error(`${context.path} requires a color or gradient token.`);
    }
    return cssToken(value, context);
  }
  return cssColor(value, context);
}

function cssMeasure(value: unknown, context: LoweringContext): CodeValue {
  if (typeof value === "string") {
    const measures: Record<string, string> = {
      auto: "auto",
      content: "fit-content",
      "min-content": "min-content",
      "max-content": "max-content",
      fill: "100%",
    };
    const result = measures[value];
    if (!result) throw new Error(`${context.path} contains unknown measure ${value}.`);
    return result;
  }
  if (isMeasureObject(value)) {
    if (value.fraction != null) {
      assertKnownKeys(value, ["fraction"], context.path);
      return `${numberAt(value.fraction, `${context.path}.fraction`)}fr`;
    }
    if (value.fit != null) {
      assertKnownKeys(value, ["fit"], context.path);
      return cssTemplate(["fit-content(", cssLength(value.fit, childPath(context, "fit")), ")"]);
    }
  }
  return cssLength(value, context);
}

function cssGridTrack(value: unknown, context: LoweringContext): CodeValue {
  if (value === "content") return "max-content";
  if (isMeasureObject(value) && Array.isArray(value.minmax)) {
    assertKnownKeys(value, ["minmax"], context.path);
    return cssTemplate([
      "minmax(",
      cssGridTrack(value.minmax[0], childPath(context, "minmax[0]")),
      ", ",
      cssGridTrack(value.minmax[1], childPath(context, "minmax[1]")),
      ")",
    ]);
  }
  if (isMeasureObject(value) && value.repeat != null) {
    assertKnownKeys(value, ["repeat"], context.path);
    const repeat = requiredRecord(value.repeat, `${context.path}.repeat`);
    assertKnownKeys(repeat, ["count", "track"], `${context.path}.repeat`);
    const count =
      repeat.count === "fit"
        ? "auto-fit"
        : repeat.count === "fill"
          ? "auto-fill"
          : numberAt(repeat.count, `${context.path}.repeat.count`);
    return cssTemplate([
      `repeat(${count}, `,
      cssGridTrack(repeat.track, childPath(context, "repeat.track")),
      ")",
    ]);
  }
  return cssMeasure(value, context);
}

function cssGridLine(value: unknown, path: string): CodeValue {
  if (typeof value === "number") return numberAt(value, path);
  const line = requiredRecord(value, path);
  if (line.span != null) {
    assertKnownKeys(line, ["span"], path);
    return `span ${numberAt(line.span, `${path}.span`)}`;
  }
  if (line.from != null && line.to != null) {
    assertKnownKeys(line, ["from", "to"], path);
    return `${numberAt(line.from, `${path}.from`)} / ${numberAt(line.to, `${path}.to`)}`;
  }
  throw new Error(`${path} is not a valid grid line.`);
}

function cssInset(value: unknown, context: LoweringContext): CodeValue {
  if (!isPlainRecord(value) || isVisualReference(value)) {
    return cssTemplate(["inset(", cssLength(value, context), ")"]);
  }
  const inset = value as Record<string, unknown>;
  const values = [
    inset.blockStart ?? inset.block ?? 0,
    inset.inlineEnd ?? inset.inline ?? 0,
    inset.blockEnd ?? inset.block ?? 0,
    inset.inlineStart ?? inset.inline ?? 0,
  ].map((item, index) => cssLength(item, childPath(context, `[${index}]`)));
  return cssTemplate(["inset(", cssList(values), ")"]);
}

function cssToken(value: unknown, context: LoweringContext, expectedGroup?: string): RawCode {
  if (!isTokenReference(value)) throw new Error(`${context.path} requires a token reference.`);
  const group = stringAt(value.group, `${context.path}.group`);
  const name = stringAt(value.name, `${context.path}.name`);
  if (expectedGroup && group !== expectedGroup) {
    throw new Error(
      `${context.path} requires a ${expectedGroup} token, received ${group}.${name}.`,
    );
  }
  return raw(`${context.varsName}[${JSON.stringify(tokenVariableName(group, name))}]`);
}

function valueArgument(value: Record<string, unknown>, context: LoweringContext): RawCode {
  const name = stringAt(value.name, `${context.path}.name`);
  const kind = stringAt(value.kind, `${context.path}.kind`);
  let argument = context.values.find((candidate) => candidate.name === name);
  if (!argument) {
    argument = { name, kind, parameter: `value${context.values.length}` };
    context.values.push(argument);
  } else if (argument.kind !== kind) {
    throw new Error(`${context.path} uses value ${name} with conflicting kinds.`);
  }
  return raw(argument.parameter);
}

function cssFunction(name: string, argument: CodeValue): CodeValue {
  return cssTemplate([`${name}(`, argument, ")"]);
}

function cssList(values: readonly CodeValue[]): CodeValue {
  return cssTemplate(values.flatMap((value, index) => (index === 0 ? [value] : [" ", value])));
}

function cssTemplate(parts: readonly CodeValue[]): CodeValue {
  if (!parts.some(isRawCode)) return parts.map((part) => String(part)).join("");
  const body = parts
    .map((part) => {
      if (isRawCode(part)) return `\${${part.$code}}`;
      return String(part).replaceAll("`", "\\`").replaceAll("${", "\\${");
    })
    .join("");
  return raw(`\`${body}\``);
}

function childPath(context: LoweringContext, suffix: string): LoweringContext {
  return { ...context, path: `${context.path}.${suffix}` };
}

function resolvePart(
  source: Record<string, unknown>,
  path: string,
  preset: MaterializedVisualPreset,
  ancestors: ReadonlySet<object> = new Set(),
): ResolvedPart {
  if (ancestors.has(source)) throw new Error(`${path}.use contains a cycle.`);
  validatePartShape(source, preset, path);
  const nextAncestors = new Set(ancestors).add(source);
  const uses = Array.isArray(source.use) ? source.use : source.use == null ? [] : [source.use];
  let base: Record<string, unknown> = {};
  let motion: Record<string, unknown> = {};
  const when: unknown[] = [];
  for (const [index, use] of uses.entries()) {
    const resolved = resolvePart(
      requiredRecord(use, `${path}.use[${index}]`),
      `${path}.use[${index}]`,
      preset,
      nextAncestors,
    );
    base = deepMerge(base, resolved.base);
    motion = deepMerge(motion, resolved.motion);
    when.push(...resolved.when);
  }
  const own = { ...source };
  delete own.use;
  delete own.when;
  delete own.motion;
  base = deepMerge(base, own);
  motion = deepMerge(motion, recordAt(source.motion));
  if (Array.isArray(source.when)) when.push(...source.when);
  return { base, motion, when };
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] =
      isPlainRecord(current) &&
      isPlainRecord(value) &&
      !isVisualReference(current) &&
      !isVisualReference(value)
        ? deepMerge(current as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return result;
}

function runtimeCondition(condition: Record<string, unknown>): RuntimeCondition | undefined {
  if (condition.state != null) return { state: requiredRecord(condition.state, "when.state") };
  if (condition.variant != null) {
    return { variant: requiredRecord(condition.variant, "when.variant") };
  }
  if (typeof condition.theme === "string") return { theme: condition.theme };
  return undefined;
}

function staticConditionWrapper(
  condition: Record<string, unknown>,
  preset: MaterializedVisualPreset,
): string | undefined {
  if (condition.native != null) return nativeSelector(condition.native);
  if (condition.container != null) {
    const name = stringAt(condition.container, "when.container");
    const definition = recordAt(preset.containers[name]);
    if (!Object.keys(definition).length) {
      throw new Error(`${preset.name} references unknown container ${JSON.stringify(name)}.`);
    }
    return `@container ${containerQuery(definition, `${preset.name}.containers.${name}`)}`;
  }
  if (condition.preference != null) return preferenceQuery(condition.preference);
  if (condition.capability != null) return capabilityQuery(condition.capability);
  if (condition.state != null || condition.variant != null || condition.theme != null) return;
  throw new Error(`${preset.name} contains an unknown visual condition.`);
}

function nativeSelector(value: unknown): string {
  const name = stringAt(value, "when.native");
  const selectors: Record<string, string> = {
    hover: ":hover",
    active: ":active",
    focus: ":focus",
    "focus-visible": ":focus-visible",
    disabled: ":disabled",
    checked: ":checked",
    selected: ':is([aria-selected="true"])',
    pressed: ':is([aria-pressed="true"])',
    expanded: ':is([aria-expanded="true"])',
    "popover-open": ":popover-open",
    "placeholder-shown": ":placeholder-shown",
    invalid: ":invalid",
  };
  const selector = selectors[name];
  if (!selector) throw new Error(`Unknown native visual state ${JSON.stringify(name)}.`);
  return selector;
}

function preferenceQuery(value: unknown): string {
  const name = stringAt(value, "when.preference");
  const queries: Record<string, string> = {
    "reduced-motion": "@media (prefers-reduced-motion: reduce)",
    "more-contrast": "@media (prefers-contrast: more)",
    "forced-colors": "@media (forced-colors: active)",
    dark: "@media (prefers-color-scheme: dark)",
    light: "@media (prefers-color-scheme: light)",
  };
  const query = queries[name];
  if (!query) throw new Error(`Unknown visual preference ${JSON.stringify(name)}.`);
  return query;
}

function capabilityQuery(value: unknown): string {
  const name = stringAt(value, "when.capability");
  const queries: Record<string, string> = {
    "backdrop-filter": "@supports (backdrop-filter: blur(1px))",
    "anchor-positioning": "@supports (anchor-name: --anchor)",
    "view-transitions": "@supports (view-transition-name: none)",
    "scroll-timeline": "@supports (animation-timeline: scroll())",
    "wide-gamut": "@media (color-gamut: p3)",
  };
  const query = queries[name];
  if (!query) throw new Error(`Unknown visual capability ${JSON.stringify(name)}.`);
  return query;
}

function containerQuery(value: Record<string, unknown>, path: string): string {
  if (value.inlineBelow != null)
    return `(inline-size < ${lengthLiteral(value.inlineBelow, `${path}.inlineBelow`)})`;
  if (value.inlineAbove != null)
    return `(inline-size >= ${lengthLiteral(value.inlineAbove, `${path}.inlineAbove`)})`;
  if (value.blockBelow != null)
    return `(block-size < ${lengthLiteral(value.blockBelow, `${path}.blockBelow`)})`;
  if (value.blockAbove != null)
    return `(block-size >= ${lengthLiteral(value.blockAbove, `${path}.blockAbove`)})`;
  if (Array.isArray(value.inlineBetween) && value.inlineBetween.length === 2) {
    return `(inline-size >= ${lengthLiteral(value.inlineBetween[0], `${path}.inlineBetween[0]`)}) and (inline-size < ${lengthLiteral(value.inlineBetween[1], `${path}.inlineBetween[1]`)})`;
  }
  throw new Error(`${path} is not a valid container definition.`);
}

function collectAnchorNames(
  preset: string,
  component: string,
  parts: Readonly<Record<string, ResolvedPart>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of Object.values(parts)) {
    for (const candidate of [part.base, ...part.when.map((item) => recordAt(item).apply)]) {
      const anchor = recordAt(recordAt(recordAt(candidate).position).anchor);
      if (typeof anchor.part !== "string") continue;
      if (!(anchor.part in parts)) {
        throw new Error(
          `${preset}.${component} references unknown anchor part ${JSON.stringify(anchor.part)}.`,
        );
      }
      result[anchor.part] = `--${kebab(preset)}-${kebab(component)}-${kebab(anchor.part)}`;
    }
  }
  return result;
}

function partUsesContainer(part: ResolvedPart): boolean {
  return part.when.some((condition) => typeof recordAt(condition).container === "string");
}

function isTokenReference(value: unknown): value is Record<string, unknown> & {
  $visual: "token";
} {
  return isPlainRecord(value) && value.$visual === "token";
}

function isValueReference(value: unknown): value is Record<string, unknown> & {
  $visual: "value";
} {
  return isPlainRecord(value) && value.$visual === "value";
}

function isVisualReference(value: unknown): boolean {
  return isTokenReference(value) || isValueReference(value);
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isMeasureObject(value: unknown): value is Record<string, any> {
  return isPlainRecord(value) && !isVisualReference(value);
}

function assertKnownKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  path: string,
): void {
  const known = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) throw new Error(`${path} contains unknown field ${JSON.stringify(key)}.`);
  }
}

function enumAt<const Value extends string>(
  value: unknown,
  values: readonly Value[],
  path: string,
): Value {
  const candidate = stringAt(value, path);
  if (!values.includes(candidate as Value)) {
    throw new Error(`${path} has unsupported value ${JSON.stringify(candidate)}.`);
  }
  return candidate as Value;
}

function requiredRecord(value: unknown, path: string): Record<string, any> {
  if (!isPlainRecord(value)) throw new Error(`${path} must be an object.`);
  return value;
}

function numberAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`);
  return value;
}

function lengthLiteral(value: unknown, path: string): string | 0 {
  const number = numberAt(value, path);
  return number === 0 ? 0 : `${number}px`;
}

function colorLiteral(value: unknown, path: string): string {
  if (value === "transparent") return "transparent";
  if (value === "current") return "currentColor";
  const color = requiredRecord(value, path);
  assertKnownKeys(color, ["l", "c", "h", "alpha"], path);
  const l = numberAt(color.l, `${path}.l`);
  const c = numberAt(color.c, `${path}.c`);
  const h = numberAt(color.h, `${path}.h`);
  const alpha = color.alpha == null ? "" : ` / ${numberAt(color.alpha, `${path}.alpha`)}`;
  return `oklch(${l * 100}% ${c} ${h}${alpha})`;
}

function gradientLiteral(value: unknown, path: string): string {
  const gradient = requiredRecord(value, path);
  const kind = stringAt(gradient.kind, `${path}.kind`);
  assertKnownKeys(
    gradient,
    kind === "radial" ? ["kind", "shape", "stops"] : ["kind", "angle", "stops"],
    path,
  );
  if (!Array.isArray(gradient.stops) || gradient.stops.length < 2) {
    throw new Error(`${path}.stops requires at least two stops.`);
  }
  const stops = gradient.stops
    .map((stopValue: unknown, index: number) => {
      const stop = requiredRecord(stopValue, `${path}.stops[${index}]`);
      assertKnownKeys(stop, ["at", "color"], `${path}.stops[${index}]`);
      return `${colorLiteral(stop.color, `${path}.stops[${index}].color`)} ${numberAt(stop.at, `${path}.stops[${index}].at`) * 100}%`;
    })
    .join(", ");
  if (kind === "linear")
    return `linear-gradient(${numberAt(gradient.angle ?? 180, `${path}.angle`)}deg, ${stops})`;
  if (kind === "radial") return `radial-gradient(${gradient.shape ?? "ellipse"}, ${stops})`;
  if (kind === "conic")
    return `conic-gradient(from ${numberAt(gradient.angle ?? 0, `${path}.angle`)}deg, ${stops})`;
  throw new Error(`${path}.kind has unsupported value ${JSON.stringify(kind)}.`);
}

function shadowLiteral(value: unknown, path: string): string {
  if (value === "none") return "none";
  const layers = Array.isArray(value) ? value : [value];
  return layers
    .map((layerValue, index) => {
      const layer = requiredRecord(layerValue, `${path}[${index}]`);
      assertKnownKeys(layer, ["x", "y", "blur", "spread", "color", "inset"], `${path}[${index}]`);
      return [
        layer.inset ? "inset" : "",
        lengthLiteral(layer.x ?? 0, `${path}[${index}].x`),
        lengthLiteral(layer.y ?? 0, `${path}[${index}].y`),
        lengthLiteral(layer.blur ?? 0, `${path}[${index}].blur`),
        lengthLiteral(layer.spread ?? 0, `${path}[${index}].spread`),
        colorLiteral(layer.color, `${path}[${index}].color`),
      ]
        .filter((item) => item !== "")
        .join(" ");
    })
    .join(", ");
}

function strokeTokenLiteral(value: unknown, path: string): string {
  const stroke = requiredRecord(value, path);
  assertKnownKeys(stroke, ["width", "line", "color"], path);
  return `${lengthLiteral(stroke.width, `${path}.width`)} ${strokeLine(stroke.line ?? "solid", `${path}.line`)} ${colorLiteral(stroke.color, `${path}.color`)}`;
}

function fontLiteral(value: unknown, path: string): string {
  const font = requiredRecord(value, path);
  assertKnownKeys(font, ["families", "features"], path);
  if (!Array.isArray(font.families) || !font.families.length) {
    throw new Error(`${path}.families requires at least one named font.`);
  }
  return font.families
    .map((family: unknown, index: number) =>
      JSON.stringify(stringAt(family, `${path}.families[${index}]`)),
    )
    .join(", ");
}

function strokeLine(value: unknown, path: string): string {
  const line = stringAt(value, path);
  const lines: Record<string, string> = {
    none: "none",
    solid: "solid",
    dash: "dashed",
    dot: "dotted",
  };
  const result = lines[line];
  if (!result) throw new Error(`${path} has unsupported stroke line ${JSON.stringify(line)}.`);
  return result;
}

function alignValue(value: unknown, path: string): string {
  const align = stringAt(value, path);
  return align === "auto" ? "auto" : align;
}

function distributeValue(value: unknown, path: string): string {
  const distribute = stringAt(value, path);
  const values: Record<string, string> = {
    start: "start",
    center: "center",
    end: "end",
    between: "space-between",
    around: "space-around",
    evenly: "space-evenly",
    stretch: "stretch",
  };
  const result = values[distribute];
  if (!result)
    throw new Error(`${path} has unsupported distribution ${JSON.stringify(distribute)}.`);
  return result;
}

function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}
