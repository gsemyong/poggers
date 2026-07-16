import { validateVisualTokenUsage, type MaterializedVisualPreset } from "#ui/compiler/preset";

type RawCode = { readonly $code: string };
type CodeValue = string | number | boolean | null | RawCode | CodeValue[] | CodeObject;
type CodeObject = { readonly [key: string]: CodeValue };

type ValueArgument = {
  readonly name: string;
  readonly kind: string;
  readonly parameter: string;
  readonly expression?: unknown;
};

type StyleEntry = {
  readonly key: string;
  readonly style: CodeObject;
  readonly values: readonly ValueArgument[];
};

type RuntimePredicate = {
  readonly theme?: string;
  readonly state?: string;
  readonly expression?: unknown;
  readonly not?: true;
};

type RuntimeCondition = {
  readonly all: readonly RuntimePredicate[];
};

type ConditionLeaf = {
  readonly selector: string;
  readonly value: unknown;
  readonly not: boolean;
};

type PartPlan = {
  readonly always: readonly StyleEntry[];
  readonly conditions: readonly {
    readonly when: RuntimeCondition;
    readonly entry: StyleEntry;
  }[];
  readonly motion: unknown;
  readonly collection: unknown;
  readonly layout: {
    readonly base: Readonly<Record<string, unknown>>;
    readonly conditions: readonly {
      readonly when: unknown;
      readonly apply: Readonly<Record<string, unknown>>;
    }[];
  };
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
  readonly collection: Record<string, unknown>;
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

  declarations.push(fontRuntimeSource(presets), "");

  for (const preset of [...presets].sort((a, b) => a.name.localeCompare(b.name))) {
    const id = identifier(preset.name);
    const varsName = `${id}Vars`;
    declarations.push(
      `export const ${varsName} = stylex.defineVars(${printCode(tokenVariableDefinitions(preset))});`,
      "",
    );

    const themeReferences: Record<string, RawCode | null> = { default: null };
    for (const [themeName, themeValue] of Object.entries(preset.themes)) {
      const overrides = themeVariableDefinitions(preset, themeName, themeValue);
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
    validateVisualTokenUsage(preset.name, preset.tokens, preset.themes, {
      components: preset.components,
      parameters: preset.parameters,
      interactions: preset.interactions,
    });

    presetEntries.push(
      `${JSON.stringify(preset.name)}: ${printCode({
        themes: themeReferences as unknown as CodeObject,
        motion: recordAt(preset.tokens.motion) as CodeObject,
        themeMotion: themeMotionDefinitions(preset),
        metrics: metricDefinitions(preset),
        themeMetrics: themeMetricDefinitions(preset),
        fonts: fontDefinitions(preset),
        themeFonts: themeFontDefinitions(preset),
        containers: preset.containers as CodeObject,
        parameters: preset.parameters as CodeObject,
        interactions: preset.interactions as unknown as CodeObject,
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
        unwrapMetricToken(resolveTokenAlias(preset, group, name, value), group),
        `${preset.name}.tokens.${group}.${name}`,
        preset,
      );
    }
  }
  return result;
}

function themeVariableDefinitions(
  preset: MaterializedVisualPreset,
  themeName: string,
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
        unwrapMetricToken(resolveTokenAlias(preset, group, name, value, theme), group),
        `${preset.name}.themes.${themeName}.${group}.${name}`,
        preset,
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

const metricGroups = new Set(["space", "size", "radius", "blur", "z"]);

function metricDefinitions(preset: MaterializedVisualPreset): CodeObject {
  const metrics: Record<string, CodeValue> = {};
  for (const [group, values] of Object.entries(preset.tokens)) {
    if (!metricGroups.has(group)) continue;
    const resolved: Record<string, CodeValue> = {};
    for (const [name, value] of Object.entries(values)) {
      resolved[name] = numberAt(
        unwrapMetricToken(resolveTokenAlias(preset, group, name, value), group),
        `${preset.name}.tokens.${group}.${name}`,
      );
    }
    metrics[group] = resolved;
  }
  return metrics;
}

function themeMetricDefinitions(preset: MaterializedVisualPreset): CodeObject {
  const themes: Record<string, CodeValue> = {};
  for (const [themeName, rawTheme] of Object.entries(preset.themes)) {
    const theme = recordAt(rawTheme);
    const metrics: Record<string, CodeValue> = {};
    for (const [group, rawValues] of Object.entries(theme)) {
      if (!metricGroups.has(group)) continue;
      const values: Record<string, CodeValue> = {};
      for (const [name, value] of Object.entries(recordAt(rawValues))) {
        values[name] = numberAt(
          unwrapMetricToken(resolveTokenAlias(preset, group, name, value, theme), group),
          `${preset.name}.themes.${themeName}.${group}.${name}`,
        );
      }
      metrics[group] = values;
    }
    if (Object.keys(metrics).length) themes[themeName] = metrics;
  }
  return themes;
}

function fontDefinitions(preset: MaterializedVisualPreset): CodeObject {
  const fonts: Record<string, CodeValue> = {};
  for (const [name, value] of Object.entries(recordAt(preset.tokens.font))) {
    fonts[name] = resolveTokenAlias(preset, "font", name, value) as CodeObject;
  }
  return fonts;
}

function themeFontDefinitions(preset: MaterializedVisualPreset): CodeObject {
  const themes: Record<string, CodeValue> = {};
  for (const [themeName, rawTheme] of Object.entries(preset.themes)) {
    const theme = recordAt(rawTheme);
    const fonts: Record<string, CodeValue> = {};
    for (const [name, value] of Object.entries(recordAt(theme.font))) {
      fonts[name] = resolveTokenAlias(preset, "font", name, value, theme) as CodeObject;
    }
    if (Object.keys(fonts).length) themes[themeName] = fonts;
  }
  return themes;
}

function tokenDefinitionCode(
  group: string,
  value: unknown,
  path: string,
  preset: MaterializedVisualPreset,
): CodeValue {
  switch (group) {
    case "color":
      return raw(`stylex.types.color(${JSON.stringify(colorLiteral(value, path))})`);
    case "space":
    case "size":
    case "radius":
    case "blur":
      return raw(
        `stylex.types.length(${JSON.stringify(lengthLiteral(numberInRange(value, 0, Infinity, path), path))})`,
      );
    case "z":
      return raw(`stylex.types.integer(${integerAt(value, path)})`);
    case "gradient":
      return raw(`stylex.types.image(${JSON.stringify(gradientLiteral(value, path))})`);
    case "stroke":
      return strokeTokenLiteral(value, path);
    case "shadow":
      return shadowLiteral(value, path);
    case "font":
      return fontLiteral(value, path, preset);
    default:
      throw new Error(`Unknown visual token group ${JSON.stringify(group)}.`);
  }
}

function unwrapMetricToken(value: unknown, group: string): unknown {
  if (!metricGroups.has(group)) return value;
  const token = requiredRecord(value, `${group} token`);
  assertKnownKeys(token, ["kind", "value"], `${group} token`);
  if (token.kind !== group)
    throw new Error(`${group} token has mismatched kind ${String(token.kind)}.`);
  return token.value;
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
    assertKnownKeys(
      spring,
      ["duration", "bounce", "mass", "stiffness", "damping", "velocity"],
      `${path}.spring`,
    );
    if (spring.duration != null) {
      numberInRange(spring.duration, 0, 60_000, `${path}.spring.duration`);
    }
    if (spring.bounce != null) {
      numberInRange(spring.bounce, -0.5, 0.5, `${path}.spring.bounce`);
    }
    if (spring.mass != null) numberInRange(spring.mass, 0.001, 10_000, `${path}.spring.mass`);
    if (spring.stiffness != null) {
      numberInRange(spring.stiffness, 0.001, 100_000, `${path}.spring.stiffness`);
    }
    if (spring.damping != null) {
      numberInRange(spring.damping, 0.001, 100_000, `${path}.spring.damping`);
    }
    if (spring.velocity != null) {
      numberInRange(spring.velocity, -100_000, 100_000, `${path}.spring.velocity`);
    }
    const perceptual = spring.duration != null || spring.bounce != null;
    const physical =
      spring.mass != null ||
      spring.stiffness != null ||
      spring.damping != null ||
      spring.velocity != null;
    if (perceptual && physical) {
      throw new Error(
        `${path}.spring cannot mix perceptual duration/bounce with physical spring parameters.`,
      );
    }
    if (perceptual && spring.duration == null) {
      throw new Error(`${path}.spring.duration is required for a perceptual spring.`);
    }
    if (physical && (spring.stiffness == null || spring.damping == null)) {
      throw new Error(`${path}.spring requires physical stiffness and damping.`);
    }
    if (!perceptual && !physical) {
      throw new Error(`${path}.spring requires perceptual or physical spring parameters.`);
    }
  } else {
    assertKnownKeys(token, ["duration", "easing", "delay"], path);
    numberInRange(token.duration, 0, 60_000, `${path}.duration`);
    if (token.easing != null) {
      if (typeof token.easing === "string") {
        enumAt(token.easing, ["linear", "smooth", "accelerate", "decelerate"], `${path}.easing`);
      } else {
        const easing = requiredRecord(token.easing, `${path}.easing`);
        assertKnownKeys(easing, ["cubic"], `${path}.easing`);
        if (!Array.isArray(easing.cubic) || easing.cubic.length !== 4) {
          throw new Error(`${path}.easing.cubic must contain four control-point numbers.`);
        }
        numberInRange(easing.cubic[0], 0, 1, `${path}.easing.cubic[0]`);
        numberInRange(easing.cubic[1], -10, 10, `${path}.easing.cubic[1]`);
        numberInRange(easing.cubic[2], 0, 1, `${path}.easing.cubic[2]`);
        numberInRange(easing.cubic[3], -10, 10, `${path}.easing.cubic[3]`);
      }
    }
  }
  if (token.delay != null) numberInRange(token.delay, 0, 60_000, `${path}.delay`);
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
    const baseSource = part.base;
    const baseExtra: Record<string, CodeValue> = {};
    if (partName === "Root" && hasContainers) baseExtra.containerType = "inline-size";
    if (anchorNames[partName]) baseExtra.anchorName = anchorNames[partName]!;
    Object.assign(
      baseExtra,
      motionTransitionStyle(
        cssTransitionDomains(recordAt(part.motion)),
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
      const branches = conditionBranches(condition);
      for (const [branchIndex, branch] of branches.entries()) {
        const key = `${partName}_when_${index}_${branchIndex}`;
        const wrappers: string[] = [];
        const predicates: RuntimePredicate[] = [];
        for (const leaf of branch) {
          const wrapper = staticConditionWrapper(leaf, preset);
          if (wrapper) {
            wrappers.push(wrapper);
            continue;
          }
          const predicate = runtimePredicate(leaf);
          if (!predicate) {
            throw new Error(
              `${preset.name}.${component}.${partName}.when[${index}] cannot be lowered.`,
            );
          }
          predicates.push(predicate);
        }
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
          wrappers,
        );
        entries.push(entry);
        if (predicates.length) conditions.push({ when: { all: predicates }, entry });
        else always.push(entry);
      }
    }

    plans[partName] = {
      always,
      conditions,
      motion: Object.keys(part.motion).length ? part.motion : null,
      collection: Object.keys(part.collection).length ? part.collection : null,
      layout: {
        base: pickLayoutProgram(part.base),
        conditions: part.when.flatMap((value) => {
          const condition = recordAt(value);
          const apply = pickLayoutProgram(recordAt(condition.apply));
          if (!Object.keys(apply).length) return [];
          const { apply: _apply, ...when } = condition;
          return [{ when, apply }];
        }),
      },
    };
  }

  return { stylesName, entries, parts: plans };
}

function cssTransitionDomains(motion: Record<string, unknown>): Record<string, unknown> {
  const transition = { ...recordAt(motion.transition) };
  const target = recordAt(motion.target);
  if (target.opacity != null) delete transition.opacity;
  if (
    ["inline", "block", "depth", "scale", "scaleInline", "scaleBlock", "rotate"].some(
      (property) => target[property] != null,
    )
  ) {
    delete transition.transform;
  }
  return transition;
}

function validatePartShape(
  part: Record<string, unknown>,
  preset: MaterializedVisualPreset,
  path: string,
): void {
  assertKnownKeys(part, [...visualStyleKeys, "use", "when", "motion", "collection"], path);
  validateMotionShape(part.motion, preset, `${path}.motion`);
  validateCollectionShape(part.collection, preset, `${path}.collection`);
  if (part.when == null) return;
  if (!Array.isArray(part.when)) throw new Error(`${path}.when must be an array.`);
  const selectors = [
    "state",
    "context",
    "input",
    "native",
    "container",
    "theme",
    "preference",
    "capability",
    "all",
    "any",
    "not",
    "expression",
  ];
  for (const [index, rawCondition] of part.when.entries()) {
    const conditionPath = `${path}.when[${index}]`;
    const condition = requiredRecord(rawCondition, conditionPath);
    assertKnownKeys(condition, [...selectors, "apply"], conditionPath);
    const { apply: _apply, ...selector } = condition;
    validateConditionSelector(selector, conditionPath);
    requiredRecord(condition.apply, `${conditionPath}.apply`);
  }
}

function validateConditionSelector(condition: Record<string, unknown>, path: string): void {
  const selectors = [
    "state",
    "context",
    "input",
    "native",
    "container",
    "theme",
    "preference",
    "capability",
    "all",
    "any",
    "not",
    "expression",
  ];
  assertKnownKeys(condition, selectors, path);
  const active = selectors.filter((selector) => condition[selector] != null);
  if (active.length !== 1) {
    throw new Error(`${path} must contain exactly one condition selector.`);
  }
  const selector = active[0]!;
  if (selector === "all" || selector === "any") {
    const children = condition[selector];
    if (!Array.isArray(children) || children.length === 0) {
      throw new Error(`${path}.${selector} must be a non-empty array.`);
    }
    for (const [index, child] of children.entries()) {
      validateConditionSelector(
        requiredRecord(child, `${path}.${selector}[${index}]`),
        `${path}.${selector}[${index}]`,
      );
    }
  } else if (selector === "not") {
    validateConditionSelector(requiredRecord(condition.not, `${path}.not`), `${path}.not`);
  }
}

function validateMotionShape(value: unknown, preset: MaterializedVisualPreset, path: string): void {
  if (value == null) return;
  const motion = requiredRecord(value, path);
  assertKnownKeys(motion, ["target", "presence", "transition", "layout", "reduceMotion"], path);

  const validateTarget = (value: unknown, targetPath: string) => {
    const target = requiredRecord(value, targetPath);
    assertKnownKeys(
      target,
      ["opacity", "inline", "block", "depth", "scale", "scaleInline", "scaleBlock", "rotate"],
      targetPath,
    );
    if (target.opacity != null && !isExpression(target.opacity)) {
      numberInRange(target.opacity, 0, 1, `${targetPath}.opacity`);
    }
  };
  if (motion.target != null) validateTarget(motion.target, `${path}.target`);
  if (motion.presence != null) {
    const presence = requiredRecord(motion.presence, `${path}.presence`);
    assertKnownKeys(presence, ["enterFrom", "exitTo", "layout"], `${path}.presence`);
    if (presence.enterFrom != null) {
      validateTarget(presence.enterFrom, `${path}.presence.enterFrom`);
    }
    if (presence.exitTo != null) validateTarget(presence.exitTo, `${path}.presence.exitTo`);
    if (presence.layout != null) {
      enumAt(presence.layout, ["preserve", "pop"], `${path}.presence.layout`);
    }
  }
  if (motion.transition != null) {
    const transition = requiredRecord(motion.transition, `${path}.transition`);
    assertKnownKeys(transition, Object.keys(transitionProperties), `${path}.transition`);
    for (const [domain, reference] of Object.entries(transition)) {
      motionToken(preset, reference, `${path}.transition.${domain}`);
    }
  }
  if (motion.layout != null) motionToken(preset, motion.layout, `${path}.layout`);
  if (motion.reduceMotion != null) {
    enumAt(motion.reduceMotion, ["instant", "crossfade"], `${path}.reduceMotion`);
  }
}

function numberInRange(value: unknown, minimum: number, maximum: number, path: string): number {
  const number = numberAt(value, path);
  if (number < minimum || number > maximum) {
    throw new Error(`${path} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function validateCollectionShape(
  value: unknown,
  preset: MaterializedVisualPreset,
  path: string,
): void {
  if (value == null) return;
  const collection = requiredRecord(value, path);
  assertKnownKeys(collection, ["axis", "estimate", "gap", "lanes"], path);
  if (collection.axis != null) enumAt(collection.axis, ["block", "inline"], `${path}.axis`);
  metricAt(collection.estimate, preset, ["size", "space"], `${path}.estimate`);
  if (collection.gap != null) metricAt(collection.gap, preset, ["space"], `${path}.gap`);
  if (collection.lanes != null) {
    const lanes = numberAt(collection.lanes, `${path}.lanes`);
    if (!Number.isInteger(lanes) || lanes < 1) throw new Error(`${path}.lanes must be positive.`);
  }
}

function metricAt(
  value: unknown,
  preset: MaterializedVisualPreset,
  groups: readonly string[],
  path: string,
): number | unknown {
  if (typeof value === "number") return numberAt(value, path);
  const reference = requiredRecord(value, path);
  if (
    reference.$visual !== "token" ||
    typeof reference.group !== "string" ||
    !groups.includes(reference.group) ||
    typeof reference.name !== "string" ||
    !(reference.name in recordAt(preset.tokens[reference.group]))
  ) {
    throw new Error(`${path} must be a number or ${groups.join("/")} token.`);
  }
  return value;
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
  opacity: ["opacity"],
  transform: ["translate", "scale", "rotate", "transform"],
};

function motionTransitionStyle(
  value: unknown,
  preset: MaterializedVisualPreset,
  path: string,
): Record<string, CodeValue> {
  const transition = recordAt(value);
  if (!Object.keys(transition).length) return {};
  const owners = new Map<string, { driver: unknown; domain: string }>();
  for (const [domain, reference] of Object.entries(transition)) {
    const properties = transitionProperties[domain];
    if (!properties)
      throw new Error(`${path}.motion.transition contains unknown domain ${domain}.`);
    const driver = motionToken(preset, reference, `${path}.motion.transition.${domain}`);
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

function motionCssTiming(value: unknown): {
  duration: string;
  delay: string;
  easing: string;
} {
  if (value === "none") return { duration: "0ms", delay: "0ms", easing: "linear" };
  const driver = recordAt(value);
  const delay = `${numberOr(driver.delay, 0)}ms`;
  const spring = recordAt(driver.spring);
  if (Object.keys(spring).length) {
    const duration = numberOr(spring.duration, 400);
    const bounce = Math.max(-0.5, Math.min(0.5, numberOr(spring.bounce, 0)));
    return {
      duration: `${duration}ms`,
      delay,
      // Keep static native-state transitions compositor eligible. Retained
      // lifecycle springs are driven by the motion runtime instead.
      easing:
        bounce > 0
          ? `cubic-bezier(.2, ${1 + bounce * 0.9}, .3, 1)`
          : bounce < 0
            ? `cubic-bezier(.3, 0, ${0.7 - bounce * 0.2}, 1)`
            : "cubic-bezier(.2, .8, .2, 1)",
    };
  }
  const easings: Readonly<Record<string, string>> = {
    linear: "linear",
    smooth: "cubic-bezier(.65, 0, .35, 1)",
    accelerate: "cubic-bezier(.32, 0, .67, 0)",
    decelerate: "cubic-bezier(.33, 1, .68, 1)",
  };
  const cubic = recordAt(driver.easing).cubic;
  return {
    duration: `${numberOr(driver.duration, 180)}ms`,
    delay,
    easing:
      Array.isArray(cubic) && cubic.length === 4
        ? `cubic-bezier(${cubic.join(", ")})`
        : (easings[String(driver.easing)] ?? easings.decelerate!),
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function createStyleEntry(
  key: string,
  source: Record<string, unknown>,
  base: Omit<LoweringContext, "values">,
  extra?: Readonly<Record<string, CodeValue>>,
  wrappers: readonly string[] = [],
): StyleEntry {
  const values: ValueArgument[] = [];
  const context: LoweringContext = { ...base, values };
  const style = lowerVisualFragment(source, context);
  if (extra) Object.assign(style, extra);
  const wrapped = wrappers.reduceRight<Record<string, CodeValue>>(
    (current, wrapper) => ({ [wrapper]: current }),
    style,
  );
  return {
    key,
    style: wrapped,
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
          return `${JSON.stringify(partName)}: { always: [${always.join(", ")}], conditions: [${conditions.join(", ")}], motion: ${JSON.stringify(part.motion)}, collection: ${JSON.stringify(part.collection)}, layout: ${JSON.stringify(part.layout)} }`;
        })
        .join(",\n      ");
      return `${JSON.stringify(componentName)}: {\n      ${parts}\n    }`;
    })
    .join(",\n    ");
  return `{\n    ${components}\n  }`;
}

const retainedLayoutKeys = new Set([
  "layout",
  "frame",
  "place",
  "padding",
  "margin",
  "position",
  "scroll",
  "text",
]);

function pickLayoutProgram(source: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => retainedLayoutKeys.has(key)));
}

function entryManifestSource(stylesName: string, entry: StyleEntry): string {
  return `{ style: ${stylesName}[${JSON.stringify(entry.key)}], values: ${JSON.stringify(
    entry.values.map(({ name, kind, expression }) => ({
      name,
      kind,
      expression,
    })),
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

function recordAt(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
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
  if (layout.gap != null) style.gap = cssLength(layout.gap, childPath(context, "gap"), ["space"]);
  if (layout.columnGap != null) {
    style.columnGap = cssLength(layout.columnGap, childPath(context, "columnGap"), ["space"]);
  }
  if (layout.rowGap != null) {
    style.rowGap = cssLength(layout.rowGap, childPath(context, "rowGap"), ["space"]);
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
    style[prefix] = cssLength(value, context, ["space"]);
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
    style[target] = cssLength(rawValue, childPath(context, name), ["space"]);
  }
}

function lowerLogicalInset(
  value: unknown,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  if (!isPlainRecord(value) || isVisualReference(value)) {
    const length = cssLength(value, context, ["space"]);
    style.insetInlineStart = length;
    style.insetInlineEnd = length;
    style.insetBlockStart = length;
    style.insetBlockEnd = length;
    return;
  }

  const inset = value as Record<string, unknown>;
  assertKnownKeys(
    inset,
    ["inline", "block", "inlineStart", "inlineEnd", "blockStart", "blockEnd"],
    context.path,
  );
  const sides = [
    ["insetInlineStart", "inlineStart", inset.inlineStart ?? inset.inline],
    ["insetInlineEnd", "inlineEnd", inset.inlineEnd ?? inset.inline],
    ["insetBlockStart", "blockStart", inset.blockStart ?? inset.block],
    ["insetBlockEnd", "blockEnd", inset.blockEnd ?? inset.block],
  ] as const;
  for (const [property, name, rawValue] of sides) {
    if (rawValue != null)
      style[property] = cssLength(rawValue, childPath(context, name), ["space"]);
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
  if (text.size != null)
    style.fontSize = cssLength(text.size, childPath(context, "size"), ["size"]);
  if (text.weight != null) style.fontWeight = numberAt(text.weight, `${context.path}.weight`);
  if (text.line != null) {
    if (typeof text.line === "number") {
      const ratio = numberAt(text.line, `${context.path}.line`);
      if (ratio <= 0 || ratio > 4) {
        throw new Error(
          `${context.path}.line unitless ratio must be greater than 0 and at most 4; use a size token for an absolute line height.`,
        );
      }
      style.lineHeight = ratio;
    } else {
      style.lineHeight = cssLength(text.line, childPath(context, "line"), ["size"]);
    }
  }
  if (text.tracking != null) {
    style.letterSpacing = cssLength(text.tracking, childPath(context, "tracking"), ["space"]);
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
    style.lineClamp = lines;
    style.overflow = "hidden";
  }
  if (text.decoration === "strike") style.textDecorationLine = "line-through";
  else if (text.decoration != null) {
    style.textDecorationLine = stringAt(text.decoration, `${context.path}.decoration`);
  }
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
  else if (media.rendering != null) {
    style.imageRendering = stringAt(media.rendering, `${context.path}.rendering`);
  }
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
    assertKnownKeys(stroke, [...logicalSides, "alignment"], context.path);
    if (stroke.alignment != null && stroke.alignment !== "inside") {
      throw new Error(`${context.path}.alignment must be inside for logical-side strokes.`);
    }
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
  if (stroke.value != null) {
    assertKnownKeys(stroke, ["value", "alignment"], context.path);
    if (stroke.alignment != null && stroke.alignment !== "inside") {
      throw new Error(
        `${context.path}.alignment must be inside when using a compound stroke token.`,
      );
    }
    style.border = cssToken(stroke.value, childPath(context, "value"), "stroke");
    return;
  }
  assertKnownKeys(stroke, ["width", "line", "color", "alignment"], context.path);
  if (stroke.alignment === "center" || stroke.alignment === "outside") {
    lowerOuterStroke(stroke, style, context);
    return;
  }
  if (stroke.alignment != null && stroke.alignment !== "inside") {
    throw new Error(`${context.path}.alignment is invalid.`);
  }
  lowerStrokeLine(stroke, style, "border", context);
}

function lowerOuterStroke(
  stroke: Record<string, unknown>,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  if (stroke.width == null || stroke.line == null || stroke.color == null) {
    throw new Error(`${context.path} requires width, line, and color for aligned strokes.`);
  }
  const width = cssLength(stroke.width, childPath(context, "width"), ["size"]);
  const line = strokeLine(stroke.line, `${context.path}.line`);
  const color = cssColor(stroke.color, childPath(context, "color"));
  if (stroke.alignment === "center") {
    const half = cssTemplate(["calc(", width, " / 2)"]);
    style.borderWidth = half;
    style.borderStyle = line;
    style.borderColor = color;
    style.outlineWidth = half;
  } else {
    style.borderWidth = 0;
    style.outlineWidth = width;
  }
  style.outlineStyle = line;
  style.outlineColor = color;
  style.outlineOffset = 0;
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
    style[`${prefix}Width`] = cssLength(stroke.width, childPath(context, "width"), ["size"]);
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
  assertKnownKeys(shape, ["radius", "corners", "clip", "mask"], context.path);
  if (shape.radius != null) {
    if (!isPlainRecord(shape.radius) || isVisualReference(shape.radius)) {
      style.borderRadius = cssLength(shape.radius, childPath(context, "radius"), ["radius"]);
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
        style[property] = cssLength(rawValue, childPath(context, `radius.${corner}`), ["radius"]);
      }
    }
  }
  if (shape.corners != null) lowerContinuousCorners(shape.corners, style, context);
  if (shape.clip === "content") style.overflow = "clip";
  else if (shape.clip === "none") style.clipPath = "none";
  else if (isPlainRecord(shape.clip)) {
    const clip = shape.clip as Record<string, unknown>;
    assertKnownKeys(clip, ["circle", "inset"], `${context.path}.clip`);
    if (clip.circle != null)
      style.clipPath = `circle(${numberInRange(clip.circle, 0, 1, `${context.path}.clip.circle`) * 100}%)`;
    else if (clip.inset != null) {
      style.clipPath = cssInset(clip.inset, childPath(context, "clip.inset"));
    }
  }
  if (shape.mask != null) style.maskImage = cssToken(shape.mask, context, "gradient");
}

function lowerContinuousCorners(
  value: unknown,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  const corners = requiredRecord(value, `${context.path}.corners`);
  if (corners.radius != null) {
    validateContinuousCorner(corners, `${context.path}.corners`);
    style.borderRadius = cssLength(corners.radius, childPath(context, "corners.radius"), [
      "radius",
    ]);
    style.cornerShape = continuousCornerShape(corners, `${context.path}.corners`);
    return;
  }
  const names = ["startStart", "startEnd", "endStart", "endEnd"];
  assertKnownKeys(corners, names, `${context.path}.corners`);
  const properties: Record<string, string> = {
    startStart: "borderStartStartRadius",
    startEnd: "borderStartEndRadius",
    endStart: "borderEndStartRadius",
    endEnd: "borderEndEndRadius",
  };
  const shapeProperties: Record<string, string> = {
    startStart: "cornerStartStartShape",
    startEnd: "cornerStartEndShape",
    endStart: "cornerEndStartShape",
    endEnd: "cornerEndEndShape",
  };
  for (const [name, rawCorner] of Object.entries(corners)) {
    const corner = requiredRecord(rawCorner, `${context.path}.corners.${name}`);
    validateContinuousCorner(corner, `${context.path}.corners.${name}`);
    style[properties[name]!] = cssLength(
      corner.radius,
      childPath(context, `corners.${name}.radius`),
      ["radius"],
    );
    style[shapeProperties[name]!] = continuousCornerShape(
      corner,
      `${context.path}.corners.${name}`,
    );
  }
}

function continuousCornerShape(corner: Record<string, unknown>, path: string): string {
  const continuity = numberInRange(corner.continuity ?? 0, 0, 1, `${path}.continuity`);
  return `superellipse(${1 + continuity})`;
}

function validateContinuousCorner(corner: Record<string, unknown>, path: string): void {
  assertKnownKeys(corner, ["radius", "continuity", "preserveContinuity"], path);
  if (corner.continuity != null) numberInRange(corner.continuity, 0, 1, `${path}.continuity`);
  if (corner.preserveContinuity != null && typeof corner.preserveContinuity !== "boolean") {
    throw new Error(`${path}.preserveContinuity must be a boolean.`);
  }
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
  if (effect.opacity != null) {
    style.opacity =
      typeof effect.opacity === "number"
        ? numberInRange(effect.opacity, 0, 1, `${context.path}.opacity`)
        : cssNumber(effect.opacity, childPath(context, "opacity"));
  }
  if (effect.shadow != null) {
    style.boxShadow =
      effect.shadow === "none" ? "none" : cssToken(effect.shadow, context, "shadow");
  }
  const filters: CodeValue[] = [];
  if (effect.blur != null)
    filters.push(cssFunction("blur", cssLength(effect.blur, childPath(context, "blur"), ["blur"])));
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
      cssFunction("blur", cssLength(backdrop.blur, childPath(context, "backdrop.blur"), ["blur"])),
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
      transform.inline == null
        ? "0px"
        : cssLength(transform.inline, childPath(context, "inline"), ["size"]);
    const block =
      transform.block == null
        ? "0px"
        : cssLength(transform.block, childPath(context, "block"), ["size"]);
    const depth =
      transform.depth == null
        ? undefined
        : cssLength(transform.depth, childPath(context, "depth"), ["size"]);
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
    style.perspective = cssLength(transform.perspective, childPath(context, "perspective"), [
      "size",
    ]);
}

function lowerPosition(
  value: unknown,
  style: Record<string, CodeValue>,
  context: LoweringContext,
): void {
  const position = requiredRecord(value, context.path);
  assertKnownKeys(position, ["kind", "inset", "layer", "anchor", "place"], context.path);
  style.position = stringAt(position.kind, `${context.path}.kind`);
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
    if (place === "center") {
      style.inset = 0;
      style.margin = "auto";
      style.positionArea = "none";
    } else {
      // Conditional styles compose with the base style. Clear every centering
      // longhand before applying a new edge placement so `inset: 0` cannot
      // survive from a base `place: "center"` declaration.
      style.insetBlockStart = "auto";
      style.insetBlockEnd = "auto";
      style.insetInlineStart = "auto";
      style.insetInlineEnd = "auto";
      style.margin = 0;
      style.positionArea = place === "auto" ? "none" : place;
    }
    if (anchor.part != null && place !== "auto" && place !== "center") {
      const axis = place.startsWith("block") ? "block" : "inline";
      style.positionTryFallbacks = `flip-${axis}`;
      style.positionTryOrder = `most-${axis}-size`;
    }
  }
  if (position.inset != null) {
    lowerLogicalInset(position.inset, style, childPath(context, "inset"));
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
  else if (scroll.gutter != null) {
    style.scrollbarGutter = stringAt(scroll.gutter, `${context.path}.gutter`);
  }
  if (scroll.scrollbar === "hidden") style.scrollbarWidth = "none";
  else if (scroll.scrollbar != null) {
    style.scrollbarWidth = stringAt(scroll.scrollbar, `${context.path}.scrollbar`);
  }
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
      outlineWidth: cssLength(ring.width, childPath(context, "focusRing.width"), ["size"]),
    };
    if (ring.offset != null)
      focus.outlineOffset = cssLength(ring.offset, childPath(context, "focusRing.offset"), [
        "space",
      ]);
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
    track: "::slider-track",
    thumb: "::slider-thumb",
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

function cssLength(
  value: unknown,
  context: LoweringContext,
  tokenGroups: readonly string[] = ["space", "size"],
): CodeValue {
  if (typeof value === "number") return lengthLiteral(value, context.path);
  if (isTokenReference(value)) {
    const group = stringAt(value.group, `${context.path}.group`);
    if (!tokenGroups.includes(group)) {
      const name = stringAt(value.name, `${context.path}.name`);
      throw new Error(
        `${context.path} requires a ${tokenGroups.join("/")} token, received ${group}.${name}.`,
      );
    }
    return cssToken(value, context);
  }
  if (isExpression(value)) return expressionArgument(value, context);
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
      cssLength(fluid.min, childPath(context, "fluid.min"), tokenGroups),
      ", ",
      cssLength(fluid.ideal, childPath(context, "fluid.ideal"), tokenGroups),
      ", ",
      cssLength(fluid.max, childPath(context, "fluid.max"), tokenGroups),
      ")",
    ]);
  }
  if (Array.isArray(length.add) && length.add.length === 2) {
    return cssTemplate([
      "calc(",
      cssLength(length.add[0], childPath(context, "add[0]"), tokenGroups),
      " + ",
      cssLength(length.add[1], childPath(context, "add[1]"), tokenGroups),
      ")",
    ]);
  }
  if (Array.isArray(length.subtract) && length.subtract.length === 2) {
    return cssTemplate([
      "calc(",
      cssLength(length.subtract[0], childPath(context, "subtract[0]"), tokenGroups),
      " - ",
      cssLength(length.subtract[1], childPath(context, "subtract[1]"), tokenGroups),
      ")",
    ]);
  }
  if (Array.isArray(length.multiply) && length.multiply.length === 2) {
    return cssTemplate([
      "calc(",
      cssLength(length.multiply[0], childPath(context, "multiply[0]"), tokenGroups),
      " * ",
      cssNumber(length.multiply[1], childPath(context, "multiply[1]")),
      ")",
    ]);
  }
  if (length.negate != null) {
    return cssTemplate([
      "calc(-1 * ",
      cssLength(length.negate, childPath(context, "negate"), tokenGroups),
      ")",
    ]);
  }
  throw new Error(`${context.path} is not a valid visual length.`);
}

function cssNumber(value: unknown, context: LoweringContext): CodeValue {
  if (typeof value === "number") return numberAt(value, context.path);
  if (isTokenReference(value)) return cssToken(value, context, "z");
  if (isExpression(value)) return expressionArgument(value, context);
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
  if (isExpression(value)) return expressionArgument(value, context);
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
    const by =
      typeof color.by === "number"
        ? numberInRange(color.by, 0, 1, `${context.path}.by`)
        : cssNumber(color.by, childPath(context, "by"));
    if (typeof by !== "number") {
      return cssTemplate([
        "color-mix(in oklch, ",
        cssColor(color.mix[0], childPath(context, "mix[0]")),
        " calc((1 - ",
        by,
        ") * 100%), ",
        cssColor(color.mix[1], childPath(context, "mix[1]")),
        " calc(",
        by,
        " * 100%))",
      ]);
    }
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
      return cssTemplate([
        "fit-content(",
        cssLength(value.fit, childPath(context, "fit"), ["size"]),
        ")",
      ]);
    }
  }
  return cssLength(value, context, ["size"]);
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
    return cssTemplate(["inset(", cssLength(value, context, ["space"]), ")"]);
  }
  const inset = value as Record<string, unknown>;
  const values = [
    inset.blockStart ?? inset.block ?? 0,
    inset.inlineEnd ?? inset.inline ?? 0,
    inset.blockEnd ?? inset.block ?? 0,
    inset.inlineStart ?? inset.inline ?? 0,
  ].map((item, index) => cssLength(item, childPath(context, `[${index}]`), ["space"]));
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

function expressionArgument(value: Record<string, unknown>, context: LoweringContext): RawCode {
  const serialized = JSON.stringify(value);
  const kind = typeof value.kind === "string" ? value.kind : "number";
  let argument = context.values.find(
    (candidate) =>
      candidate.expression != null && JSON.stringify(candidate.expression) === serialized,
  );
  if (!argument) {
    argument = {
      name: `expression${context.values.length}`,
      kind,
      parameter: `value${context.values.length}`,
      expression: value,
    };
    context.values.push(argument);
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
  rawSource: Record<string, unknown>,
  path: string,
  preset: MaterializedVisualPreset,
  ancestors: ReadonlySet<object> = new Set(),
): ResolvedPart {
  let source = rawSource;
  if (source.$visual === "recipe") source = expandRecipe(source, path);
  else if (isExpression(source.when)) {
    const { when, ...apply } = source;
    source = { when: [{ expression: when, apply }] };
  }
  source = normalizeSemanticPart(source, path);
  if (ancestors.has(source)) throw new Error(`${path}.use contains a cycle.`);
  validatePartShape(source, preset, path);
  const nextAncestors = new Set(ancestors).add(source);
  const uses = Array.isArray(source.use) ? source.use : source.use == null ? [] : [source.use];
  let base: Record<string, unknown> = {};
  let motion: Record<string, unknown> = {};
  let collection: Record<string, unknown> = {};
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
    collection = deepMerge(collection, resolved.collection);
    when.push(...resolved.when);
  }
  const own = { ...source };
  delete own.use;
  delete own.when;
  delete own.motion;
  delete own.collection;
  base = deepMerge(base, own);
  motion = deepMerge(motion, recordAt(source.motion));
  collection = deepMerge(collection, recordAt(source.collection));
  if (Array.isArray(source.when)) when.push(...source.when);
  return { base, motion, collection, when };
}

function normalizeSemanticPart(
  source: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const layout = recordAt(source.layout);
  const isSemantic =
    source.paint != null ||
    source.typography != null ||
    source.decorations != null ||
    [
      "flow",
      "grid",
      "overlay",
      "display",
      "size",
      "item",
      "padding",
      "margin",
      "position",
      "scroll",
      "collection",
    ].some((key) => layout[key] != null) ||
    ["opacity", "translation", "scale", "scaleInline", "scaleBlock", "rotate"].some(
      (key) => recordAt(source.motion)[key] != null,
    );
  if (!isSemantic) {
    const removed = [
      "frame",
      "place",
      "padding",
      "margin",
      "surface",
      "text",
      "media",
      "stroke",
      "effect",
      "transform",
      "position",
      "scroll",
      "interaction",
      "decor",
      "collection",
    ].filter((key) => source[key] != null);
    if (recordAt(source.layout).kind != null) removed.push("layout.kind");
    if (recordAt(source.motion).target != null) removed.push("motion.target");
    if (removed.length) {
      throw new Error(
        `${path} uses removed visual fields ${removed.join(", ")}; use the six semantic algebras.`,
      );
    }
    return normalizeSemanticConditions(source, path);
  }

  validateSemanticPart(source, path);

  const result: Record<string, unknown> = {};
  if (source.use != null) result.use = source.use;
  if (source.when != null) result.when = source.when;
  if (source.shape != null) result.shape = source.shape;

  if (layout.flow != null) {
    const flow = requiredRecord(layout.flow, `${path}.layout.flow`);
    result.layout = {
      ...flow,
      kind: flow.axis === "inline" ? "row" : "stack",
    };
    delete recordAt(result.layout).axis;
  }
  if (layout.grid != null) result.layout = { ...recordAt(layout.grid), kind: "grid" };
  if (layout.overlay != null) result.layout = { ...recordAt(layout.overlay), kind: "overlay" };
  if (layout.display != null) result.layout = { kind: layout.display };
  if (layout.size != null) result.frame = layout.size;
  if (layout.item != null) result.place = layout.item;
  if (layout.padding != null) result.padding = layout.padding;
  if (layout.margin != null) result.margin = layout.margin;
  if (layout.position != null) result.position = layout.position;
  if (layout.scroll != null) result.scroll = layout.scroll;
  if (layout.collection != null) result.collection = layout.collection;

  const paint = recordAt(source.paint);
  if (paint.fill != null) result.surface = { fill: paint.fill };
  if (paint.stroke != null) result.stroke = paint.stroke;
  if (paint.media != null) result.media = paint.media;
  const effect = pickFields(paint, [
    "opacity",
    "shadow",
    "blur",
    "backdrop",
    "brightness",
    "contrast",
    "saturation",
    "blend",
  ]);
  if (Object.keys(effect).length) result.effect = effect;
  const interaction = pickFields(paint, ["cursor", "select", "caret", "focusRing"]);
  if (Object.keys(interaction).length) result.interaction = interaction;

  const typography = { ...recordAt(source.typography) };
  if (typography.color != null) {
    result.surface = { ...recordAt(result.surface), text: typography.color };
    delete typography.color;
  }
  if (Object.keys(typography).length) result.text = typography;

  if (source.motion != null) result.motion = normalizeSemanticMotion(recordAt(source.motion));
  if (source.decorations != null) {
    const decorations = recordAt(source.decorations);
    const decor: Record<string, unknown> = {};
    const names: Readonly<Record<string, string>> = {
      background: "before",
      overlay: "after",
      backdrop: "backdrop",
      placeholder: "placeholder",
      selection: "selection",
      track: "track",
      thumb: "thumb",
    };
    for (const [semanticName, backendName] of Object.entries(names)) {
      if (decorations[semanticName] == null) continue;
      const normalized = normalizeSemanticPart(
        requiredRecord(decorations[semanticName], `${path}.decorations.${semanticName}`),
        `${path}.decorations.${semanticName}`,
      );
      decor[backendName] =
        semanticName === "background" || semanticName === "overlay"
          ? { content: "", ...normalized }
          : normalized;
    }
    if (Object.keys(decor).length) result.decor = decor;
  }

  return normalizeSemanticConditions(result, path);
}

function validateSemanticPart(source: Record<string, unknown>, path: string): void {
  assertKnownKeys(
    source,
    ["layout", "shape", "paint", "typography", "motion", "decorations", "use", "when"],
    path,
  );
  assertKnownKeys(
    recordAt(source.layout),
    [
      "flow",
      "grid",
      "overlay",
      "display",
      "size",
      "item",
      "padding",
      "margin",
      "position",
      "scroll",
      "collection",
    ],
    `${path}.layout`,
  );
  const algorithms = ["flow", "grid", "overlay", "display"].filter(
    (name) => recordAt(source.layout)[name] != null,
  );
  if (algorithms.length > 1) {
    throw new Error(
      `${path}.layout must declare one layout algorithm, received ${algorithms.join(", ")}.`,
    );
  }
  if (recordAt(source.layout).flow != null) {
    const flow = requiredRecord(recordAt(source.layout).flow, `${path}.layout.flow`);
    assertKnownKeys(
      flow,
      ["axis", "gap", "align", "distribute", "wrap", "reverse"],
      `${path}.layout.flow`,
    );
    enumAt(flow.axis, ["inline", "block"], `${path}.layout.flow.axis`);
  }
  assertKnownKeys(
    recordAt(source.paint),
    [
      "fill",
      "stroke",
      "opacity",
      "shadow",
      "blur",
      "backdrop",
      "brightness",
      "contrast",
      "saturation",
      "blend",
      "media",
      "cursor",
      "select",
      "caret",
      "focusRing",
    ],
    `${path}.paint`,
  );
  assertKnownKeys(
    recordAt(source.typography),
    [
      "color",
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
    `${path}.typography`,
  );
  const motion = recordAt(source.motion);
  assertKnownKeys(
    motion,
    [
      "opacity",
      "translation",
      "scale",
      "scaleInline",
      "scaleBlock",
      "rotate",
      "presence",
      "transition",
      "layout",
      "reduceMotion",
    ],
    `${path}.motion`,
  );
  assertKnownKeys(
    recordAt(motion.translation),
    ["inline", "block", "depth"],
    `${path}.motion.translation`,
  );
  const presence = recordAt(motion.presence);
  assertKnownKeys(presence, ["enter", "exit", "layout"], `${path}.motion.presence`);
  if (presence.enter != null) {
    assertKnownKeys(
      requiredRecord(presence.enter, `${path}.motion.presence.enter`),
      ["from"],
      `${path}.motion.presence.enter`,
    );
  }
  if (presence.exit != null) {
    assertKnownKeys(
      requiredRecord(presence.exit, `${path}.motion.presence.exit`),
      ["to"],
      `${path}.motion.presence.exit`,
    );
  }
  assertKnownKeys(
    recordAt(source.decorations),
    ["background", "overlay", "backdrop", "placeholder", "selection", "track", "thumb"],
    `${path}.decorations`,
  );
}

function normalizeSemanticMotion(motion: Record<string, unknown>): Record<string, unknown> {
  if (motion.target != null) return motion;
  const target: Record<string, unknown> = {};
  if (motion.opacity != null) target.opacity = motion.opacity;
  const translation = recordAt(motion.translation);
  for (const axis of ["inline", "block", "depth"] as const) {
    if (translation[axis] != null) target[axis] = translation[axis];
  }
  for (const property of ["scale", "scaleInline", "scaleBlock", "rotate"] as const) {
    if (motion[property] != null) target[property] = motion[property];
  }
  const result = pickFields(motion, ["transition", "layout", "reduceMotion"]);
  if (Object.keys(target).length) result.target = target;
  const presence = recordAt(motion.presence);
  if (Object.keys(presence).length) {
    const normalizedPresence: Record<string, unknown> = {};
    if (presence.enter != null) {
      normalizedPresence.enterFrom = requiredRecord(presence.enter, "motion.presence.enter").from;
    }
    if (presence.exit != null) {
      normalizedPresence.exitTo = requiredRecord(presence.exit, "motion.presence.exit").to;
    }
    if (presence.layout != null) normalizedPresence.layout = presence.layout;
    result.presence = normalizedPresence;
  }
  return result;
}

function normalizeSemanticConditions(
  source: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  if (!Array.isArray(source.when)) return source;
  return {
    ...source,
    when: source.when.map((rawCondition, index) => {
      const condition = requiredRecord(rawCondition, `${path}.when[${index}]`);
      return {
        ...condition,
        apply: normalizeSemanticPart(
          requiredRecord(condition.apply, `${path}.when[${index}].apply`),
          `${path}.when[${index}].apply`,
        ),
      };
    }),
  };
}

function pickFields(
  source: Record<string, unknown>,
  names: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    names.flatMap((name) => (source[name] == null ? [] : [[name, source[name]]])),
  );
}

function expandRecipe(source: Record<string, unknown>, path: string): Record<string, unknown> {
  const definition = requiredRecord(source.definition, `${path}.definition`);
  const variants = requiredRecord(definition.variants, `${path}.definition.variants`);
  const defaults = recordAt(definition.defaults);
  const values = requiredRecord(source.values, `${path}.values`);
  const use: unknown[] = [];
  const when: unknown[] = [];
  if (definition.base != null) use.push(definition.base);

  for (const [variant, rawBranches] of Object.entries(variants)) {
    const branches = requiredRecord(rawBranches, `${path}.definition.variants.${variant}`);
    const selected = values[variant] ?? defaults[variant];
    if (isExpression(selected)) {
      for (const [value, apply] of Object.entries(branches)) {
        when.push({
          expression: expressionEquals(selected, recipeValue(value)),
          apply,
        });
      }
      continue;
    }
    const branch = branches[String(selected)];
    if (branch != null) use.push(branch);
  }

  const combinations = definition.combinations;
  if (combinations != null && !Array.isArray(combinations)) {
    throw new Error(`${path}.definition.combinations must be an array.`);
  }
  for (const [index, rawCombination] of (combinations ?? []).entries()) {
    const combination = requiredRecord(rawCombination, `${path}.definition.combinations[${index}]`);
    const matches = requiredRecord(
      combination.when,
      `${path}.definition.combinations[${index}].when`,
    );
    const conditions: unknown[] = [];
    let rejected = false;
    for (const [variant, expected] of Object.entries(matches)) {
      const selected = values[variant] ?? defaults[variant];
      const choices = Array.isArray(expected) ? expected : [expected];
      if (isExpression(selected)) {
        const alternatives = choices.map((choice) => expressionEquals(selected, choice));
        conditions.push(
          alternatives.length === 1 ? alternatives[0] : expressionBoolean("or", alternatives),
        );
      } else if (!choices.some((choice) => Object.is(choice, selected))) {
        rejected = true;
        break;
      }
    }
    if (rejected) continue;
    if (!conditions.length) use.push(combination.use);
    else {
      when.push({
        expression: conditions.length === 1 ? conditions[0] : expressionBoolean("and", conditions),
        apply: combination.use,
      });
    }
  }
  return { use, when };
}

function expressionEquals(left: unknown, right: unknown): Record<string, unknown> {
  return {
    $visual: "expression",
    kind: "boolean",
    operation: "equal",
    left,
    right,
  };
}

function expressionBoolean(operation: "and" | "or", values: unknown[]): Record<string, unknown> {
  return { $visual: "expression", kind: "boolean", operation, values };
}

function recipeValue(value: string): string | boolean | number {
  if (value === "true") return true;
  if (value === "false") return false;
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) ? number : value;
}

function isExpression(value: unknown): value is Record<string, unknown> {
  return isPlainRecord(value) && value.$visual === "expression";
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

function runtimePredicate(leaf: ConditionLeaf): RuntimePredicate | undefined {
  const predicate =
    leaf.selector === "state" && typeof leaf.value === "string"
      ? { state: leaf.value }
      : leaf.selector === "context"
        ? { context: requiredRecord(leaf.value, "when.context") }
        : leaf.selector === "input"
          ? { input: requiredRecord(leaf.value, "when.input") }
          : leaf.selector === "theme" && typeof leaf.value === "string"
            ? { theme: leaf.value }
            : leaf.selector === "expression"
              ? { expression: leaf.value }
              : undefined;
  return predicate && leaf.not ? { ...predicate, not: true } : predicate;
}

function conditionBranches(
  condition: Record<string, unknown>,
  negated = false,
): readonly (readonly ConditionLeaf[])[] {
  if (condition.expression != null) {
    return expressionBranches(requiredRecord(condition.expression, "when.expression"), negated);
  }
  if (condition.not != null) {
    return conditionBranches(requiredRecord(condition.not, "when.not"), !negated);
  }
  const compound = condition.all != null ? "all" : condition.any != null ? "any" : undefined;
  if (compound) {
    const children = condition[compound];
    if (!Array.isArray(children) || children.length === 0) {
      throw new Error(`when.${compound} must be a non-empty array.`);
    }
    const joinWithAll = (compound === "all") !== negated;
    const branches = children.map((child) =>
      conditionBranches(requiredRecord(child, `when.${compound}`), negated),
    );
    if (!joinWithAll) return branches.flat();
    return branches.reduce<readonly (readonly ConditionLeaf[])[]>(
      (products, choices) =>
        products.flatMap((product) => choices.map((choice) => [...product, ...choice])),
      [[]],
    );
  }
  const selectors = [
    "active",
    "state",
    "input",
    "native",
    "container",
    "theme",
    "preference",
    "capability",
    "expression",
  ];
  const selector = selectors.find((candidate) => condition[candidate] != null);
  if (!selector) throw new Error("Visual condition is missing a selector.");
  return [[{ selector, value: condition[selector], not: negated }]];
}

function expressionBranches(
  expression: Record<string, unknown>,
  negated: boolean,
): readonly (readonly ConditionLeaf[])[] {
  const operation = String(expression.operation ?? "");
  if (operation === "not") {
    return expressionBranches(requiredRecord(expression.value, "expression.not"), !negated);
  }
  if (operation === "and" || operation === "or") {
    const values = expression.values;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`expression.${operation} must contain values.`);
    }
    const joinWithAll = (operation === "and") !== negated;
    const branches = values.map((value) =>
      expressionBranches(requiredRecord(value, `expression.${operation}`), negated),
    );
    if (!joinWithAll) return branches.flat();
    return branches.reduce<readonly (readonly ConditionLeaf[])[]>(
      (products, choices) =>
        products.flatMap((product) => choices.map((choice) => [...product, ...choice])),
      [[]],
    );
  }
  if (operation === "matches" && expression.source === "state") {
    return [[{ selector: "state", value: expression.name, not: negated }]];
  }
  if (operation === "equal") {
    const left = requiredRecord(expression.left, "expression.equal.left");
    const right = expression.right;
    if (left.kind === "boolean" && typeof right === "boolean") {
      return expressionBranches(left, right ? negated : !negated);
    }
    if (left.source === "context" && typeof left.name === "string") {
      return [[{ selector: "context", value: { [left.name]: right }, not: negated }]];
    }
    if (left.source === "input" && typeof left.name === "string") {
      return [[{ selector: "input", value: { [left.name]: right }, not: negated }]];
    }
    if (left.source === "state" && left.name === "value") {
      return [[{ selector: "state", value: right, not: negated }]];
    }
  }
  return [[{ selector: "expression", value: expression, not: negated }]];
}

function staticConditionWrapper(
  leaf: ConditionLeaf,
  preset: MaterializedVisualPreset,
): string | undefined {
  let wrapper: string | undefined;
  if (leaf.selector === "native") wrapper = nativeSelector(leaf.value);
  else if (leaf.selector === "container") {
    const name = stringAt(leaf.value, "when.container");
    const definition = recordAt(preset.containers[name]);
    if (!Object.keys(definition).length) {
      throw new Error(`${preset.name} references unknown container ${JSON.stringify(name)}.`);
    }
    wrapper = `@container ${containerQuery(definition, `${preset.name}.containers.${name}`)}`;
  } else if (leaf.selector === "preference") wrapper = preferenceQuery(leaf.value);
  else if (leaf.selector === "capability") wrapper = capabilityQuery(leaf.value);
  else if (leaf.selector === "expression") wrapper = staticExpressionWrapper(leaf.value, preset);
  else if (
    leaf.selector !== "active" &&
    leaf.selector !== "state" &&
    leaf.selector !== "input" &&
    leaf.selector !== "theme"
  ) {
    throw new Error(`${preset.name} contains an unknown visual condition.`);
  }
  return wrapper && leaf.not ? negateStaticWrapper(wrapper) : wrapper;
}

function staticExpressionWrapper(
  value: unknown,
  preset: MaterializedVisualPreset,
): string | undefined {
  const expression = requiredRecord(value, "when.expression");
  if (expression.source === "interaction") {
    const native: Record<string, string> = {
      hovered: "tracked-hover",
      pressed: "active",
      focusVisible: "focus-visible",
      focusWithin: "focus-within",
      selected: "selected",
      disabled: "disabled",
      expanded: "expanded",
    };
    const state = native[String(expression.name)];
    return state ? nativeSelector(state) : undefined;
  }
  if (expression.source === "environment") {
    const preference: Record<string, string> = {
      reducedMotion: "reduced-motion",
      moreContrast: "more-contrast",
      forcedColors: "forced-colors",
      dark: "dark",
    };
    const capability: Record<string, string> = {
      hover: "hover",
      finePointer: "fine-pointer",
      coarsePointer: "coarse-pointer",
    };
    const name = String(expression.name);
    if (preference[name]) return preferenceQuery(preference[name]);
    if (capability[name]) return capabilityQuery(capability[name]);
  }
  if (["below", "at-most", "above", "at-least"].includes(String(expression.operation))) {
    const left = requiredRecord(expression.left, "when.expression.left");
    if (left.source !== "geometry") return;
    const right = expression.right;
    const length = expressionMetric(right, preset);
    const axis = left.name === "blockSize" ? "block-size" : "inline-size";
    const operator: Record<string, string> = {
      below: "<",
      "at-most": "<=",
      above: ">",
      "at-least": ">=",
    };
    return `@container (${axis} ${operator[String(expression.operation)]} ${length}px)`;
  }
  return;
}

function expressionMetric(value: unknown, preset: MaterializedVisualPreset): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const reference = requiredRecord(value, "condition metric");
  if (
    reference.$visual !== "token" ||
    typeof reference.group !== "string" ||
    typeof reference.name !== "string"
  ) {
    throw new Error("A geometry condition must compare with a metric token or number.");
  }
  const token = recordAt(preset.tokens[reference.group])[reference.name];
  const definition = requiredRecord(token, `tokens.${reference.group}.${reference.name}`);
  return numberAt(definition.value, `tokens.${reference.group}.${reference.name}.value`);
}

function negateStaticWrapper(wrapper: string): string {
  if (wrapper.startsWith(":")) return `:not(${wrapper})`;
  for (const prefix of ["@media ", "@supports ", "@container "] as const) {
    if (wrapper.startsWith(prefix)) return `${prefix}not ${wrapper.slice(prefix.length)}`;
  }
  throw new Error(`Visual condition ${JSON.stringify(wrapper)} cannot be negated.`);
}

function nativeSelector(value: unknown): string {
  const name = stringAt(value, "when.native");
  const selectors: Record<string, string> = {
    hover: ":hover",
    "tracked-hover": ':is([data-hovered="true"])',
    active: ":active",
    focus: ":focus",
    "focus-visible": ":focus-visible",
    "focus-within": ":focus-within",
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
    hover: "@media (hover: hover)",
    "fine-pointer": "@media (pointer: fine)",
    "coarse-pointer": "@media (pointer: coarse)",
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
  return part.when.some((condition) => {
    const source = recordAt(condition);
    return typeof source.container === "string" || containsGeometryExpression(source.expression);
  });
}

function containsGeometryExpression(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  if (value.source === "geometry") return true;
  return Object.values(value).some((child) =>
    Array.isArray(child)
      ? child.some(containsGeometryExpression)
      : containsGeometryExpression(child),
  );
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
  return isTokenReference(value) || isValueReference(value) || isExpression(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isMeasureObject(value: unknown): value is Record<string, unknown> {
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

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error(`${path} must be an object.`);
  return value;
}

function numberAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function integerAt(value: unknown, path: string): number {
  const number = numberAt(value, path);
  if (!Number.isInteger(number)) throw new Error(`${path} must be an integer.`);
  return number;
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
  const l = numberInRange(color.l, 0, 1, `${path}.l`);
  const c = numberInRange(color.c, 0, 0.5, `${path}.c`);
  const h = numberInRange(color.h, 0, 360, `${path}.h`);
  const alpha =
    color.alpha == null ? "" : ` / ${numberInRange(color.alpha, 0, 1, `${path}.alpha`)}`;
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
      return `${colorLiteral(stop.color, `${path}.stops[${index}].color`)} ${numberInRange(stop.at, 0, 1, `${path}.stops[${index}].at`) * 100}%`;
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

function fontLiteral(value: unknown, path: string, preset: MaterializedVisualPreset): string {
  const font = requiredRecord(value, path);
  assertKnownKeys(font, ["asset", "features"], path);
  const name = stringAt(font.asset, `${path}.asset`);
  const asset = fontAsset(preset, name, fontAssetSourcePath(preset.name, name));
  const families = asset.sources.length ? [fontFamilyName(preset.name, name)] : [];
  families.push(...asset.fallback);
  return families.map((family) => JSON.stringify(family)).join(", ");
}

function fontRuntimeSource(presets: readonly MaterializedVisualPreset[]): string {
  const rules: string[] = [];
  const preloads = new Set<string>();
  for (const preset of [...presets].sort((left, right) => left.name.localeCompare(right.name))) {
    for (const name of Object.keys(preset.assets.fonts).sort()) {
      const path = fontAssetSourcePath(preset.name, name);
      const asset = fontAsset(preset, name, path);
      for (const [index, source] of asset.sources.entries()) {
        const weight = Array.isArray(source.weight)
          ? `${source.weight[0]} ${source.weight[1]}`
          : String(source.weight);
        rules.push(
          `@font-face{font-family:${JSON.stringify(fontFamilyName(preset.name, name))};src:url(${JSON.stringify(source.file)}) format(${JSON.stringify(source.format)});font-weight:${weight};font-style:${source.style};font-display:${asset.display}${source.unicodeRange ? `;unicode-range:${source.unicodeRange}` : ""}}`,
        );
        if (source.preload) preloads.add(source.file);
        void index;
      }
    }
  }
  const css = rules.join("\n");
  const urls = [...preloads].sort();
  return `export const compiledFontCss = ${JSON.stringify(css)};
export const compiledFontPreloads = ${JSON.stringify(urls)};
if (typeof document !== "undefined") {
  const id = "poggers-font-assets";
  let style = document.getElementById(id);
  if (!style && compiledFontCss) {
    style = document.createElement("style");
    style.id = id;
    document.head.append(style);
  }
  if (style) style.textContent = compiledFontCss;
  for (const href of compiledFontPreloads) {
    const loaded = Array.from(document.head.querySelectorAll("link[data-poggers-font]")).some(
      (candidate) => candidate instanceof HTMLLinkElement && candidate.dataset.poggersFont === href,
    );
    if (loaded) continue;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "font";
    link.crossOrigin = "anonymous";
    link.href = href;
    link.dataset.poggersFont = href;
    document.head.append(link);
  }
}`;
}

function fontFamilyName(preset: string, asset: string): string {
  return `poggers-${preset.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}-${asset.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function fontAssetSourcePath(preset: string, name: string): string {
  const separator = name.indexOf("::");
  return separator < 0
    ? `${preset}.theme.font.${name}`
    : `${preset}.themes.${name.slice(0, separator)}.font.${name.slice(separator + 2)}`;
}

function fontAsset(
  preset: MaterializedVisualPreset,
  name: string,
  path: string,
): {
  fallback: string[];
  display: string;
  sources: Array<{
    file: string;
    format: string;
    weight: number | readonly [number, number];
    style: string;
    preload: boolean;
    unicodeRange?: string;
  }>;
} {
  const asset = requiredRecord(preset.assets.fonts[name], path);
  assertKnownKeys(asset, ["sources", "fallback", "display"], path);
  const fallback = arrayAt(asset.fallback, `${path}.fallback`).map((value, index) =>
    stringAt(value, `${path}.fallback[${index}]`),
  );
  if (!fallback.length) throw new Error(`${path}.fallback requires at least one family.`);
  const allowedFallbacks = new Set([
    "system-ui",
    "ui-serif",
    "ui-sans-serif",
    "ui-monospace",
    "ui-rounded",
    "serif",
    "sans-serif",
    "monospace",
  ]);
  for (const value of fallback) {
    if (!allowedFallbacks.has(value)) {
      throw new Error(`${path}.fallback contains unsupported family ${JSON.stringify(value)}.`);
    }
  }
  const display = asset.display === undefined ? "swap" : stringAt(asset.display, `${path}.display`);
  if (!["auto", "block", "swap", "fallback", "optional"].includes(display)) {
    throw new Error(`${path}.display has unsupported value ${JSON.stringify(display)}.`);
  }
  const sources = arrayAt(asset.sources ?? [], `${path}.sources`).map((raw, index) => {
    const sourcePath = `${path}.sources[${index}]`;
    const source = requiredRecord(raw, sourcePath);
    assertKnownKeys(
      source,
      ["file", "format", "weight", "style", "preload", "unicodeRange"],
      sourcePath,
    );
    const format = stringAt(source.format, `${sourcePath}.format`);
    if (!["woff2", "woff", "opentype", "truetype"].includes(format)) {
      throw new Error(`${sourcePath}.format has unsupported value ${JSON.stringify(format)}.`);
    }
    const weight = fontWeight(source.weight, `${sourcePath}.weight`);
    const style =
      source.style === undefined ? "normal" : stringAt(source.style, `${sourcePath}.style`);
    if (!["normal", "italic", "oblique"].includes(style)) {
      throw new Error(`${sourcePath}.style has unsupported value ${JSON.stringify(style)}.`);
    }
    const unicodeRange =
      source.unicodeRange === undefined
        ? undefined
        : stringAt(source.unicodeRange, `${sourcePath}.unicodeRange`);
    return {
      file: stringAt(source.file, `${sourcePath}.file`),
      format,
      weight,
      style,
      preload: source.preload === true,
      ...(unicodeRange ? { unicodeRange } : {}),
    };
  });
  return { fallback, display, sources };
}

function fontWeight(value: unknown, path: string): number | readonly [number, number] {
  if (Array.isArray(value)) {
    if (value.length !== 2) throw new Error(`${path} must contain a minimum and maximum.`);
    const minimum = numberInRange(value[0], 1, 1000, `${path}[0]`);
    const maximum = numberInRange(value[1], minimum, 1000, `${path}[1]`);
    return [minimum, maximum];
  }
  return numberInRange(value, 1, 1000, path);
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
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
