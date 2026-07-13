import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Mutation = {
  readonly name: string;
  readonly file?: "reference" | "candidate";
  readonly search: string;
  readonly replacement: string;
};

const mutations: readonly Mutation[] = [
  {
    name: "token alias cycle accepted",
    search: "if (cycleIndex >= 0) {",
    replacement: "if (false && cycleIndex >= 0) {",
  },
  {
    name: "token alias type mismatch accepted",
    search: "if (target.type !== definition.type) {",
    replacement: "if (false && target.type !== definition.type) {",
  },
  {
    name: "token output follows insertion order",
    search: "Object.keys(definitions)\n      .sort()",
    replacement: "Object.keys(definitions)",
  },
  {
    name: "duplicate target owner accepted",
    search: "if (existing) {\n      throw new Error(\n        `Target",
    replacement: "if (false && existing) {\n      throw new Error(\n        `Target",
  },
  {
    name: "composition cycle accepted",
    search: "if (result.length !== identities.length) {",
    replacement: "if (false && result.length !== identities.length) {",
  },
  {
    name: "ambiguous shared identity source accepted",
    search: "if (existing) {\n      throw new Error(\n        `Shared identity",
    replacement: "if (false && existing) {\n      throw new Error(\n        `Shared identity",
  },
  {
    name: "candidate shared identity relation discarded",
    file: "candidate",
    search: "matches: resolveReferenceSharedIdentities(matches),",
    replacement: "matches: [],",
  },
  {
    name: "duplicate composition identity accepted",
    search: "if (byIdentity.size !== identities.length) {",
    replacement: "if (false && byIdentity.size !== identities.length) {",
  },
  {
    name: "stale motion revision settles",
    search: "if (!active || active.revision !== revision) return false;",
    replacement: "if (!active) return false;",
  },
  {
    name: "retarget velocity resets",
    search: 'velocity: finite(velocity, "target velocity"),',
    replacement: "velocity: 0,",
  },
  {
    name: "cancel leaves active motion",
    search: 'this.#replaceActive("cancelled");',
    replacement: "void 0;",
  },
  {
    name: "presence reversal creates settled presentation",
    search:
      'if (current === "present" || current === "entering") return current;\n    return "entering";',
    replacement:
      'if (current === "present" || current === "entering") return current;\n    return "present";',
  },
  {
    name: "opposing gesture direction commits",
    search: "!options.cancelled &&\n    allowed &&",
    replacement: "!options.cancelled &&",
  },
  {
    name: "unknown clip member accepted",
    file: "candidate",
    search:
      'if (!known.has(clip.member)) throw new Error(`Unknown clip identity "${clip.member}".`);',
    replacement:
      'if (false && !known.has(clip.member)) throw new Error(`Unknown clip identity "${clip.member}".`);',
  },
  {
    name: "gesture settlement without direct owner accepted",
    file: "candidate",
    search: "if (!direct) {",
    replacement: "if (false && !direct) {",
  },
  {
    name: "different gestures drive and settle one target",
    file: "candidate",
    search: "if (direct !== settlement.gesture) {",
    replacement: "if (false && direct !== settlement.gesture) {",
  },
  {
    name: "multiple layout algorithms own one parent",
    file: "candidate",
    search: "resolveReferenceTargets(arrangementOwners);",
    replacement: "void arrangementOwners;",
  },
  {
    name: "layout hierarchy cycle accepted",
    file: "candidate",
    search: "resolveReferenceComposition(entries, hierarchy);",
    replacement: "void hierarchy;",
  },
  {
    name: "virtual extent without scroll ownership accepted",
    file: "candidate",
    search: 'if (!scroll || (scroll.axis !== "both" && scroll.axis !== relation.axis)) {',
    replacement:
      'if (false && (!scroll || (scroll.axis !== "both" && scroll.axis !== relation.axis))) {',
  },
  {
    name: "inactive reactive branch becomes a dependency",
    file: "candidate",
    search: "return evaluate(condition ? node.whenTrue : node.whenFalse);",
    replacement:
      "const whenTrue = evaluate(node.whenTrue); const whenFalse = evaluate(node.whenFalse); return condition ? whenTrue : whenFalse;",
  },
  {
    name: "unnamed native control accepted",
    search:
      "if (namedRoles.has(node.role) && node.name === undefined && node.labelledBy === undefined) {",
    replacement:
      "if (false && namedRoles.has(node.role) && node.name === undefined && node.labelledBy === undefined) {",
  },
  {
    name: "modal initial focus may live outside the modal",
    search:
      "(initialFocus.identity !== modalIdentity &&\n        !isReferenceSemanticDescendant(initialFocus.identity, modalIdentity, parent))",
    replacement: "false",
  },
  {
    name: "modal return focus need not control the modal",
    search: "returnFocus.controls !== modalIdentity ||",
    replacement: "false ||",
  },
  {
    name: "empty semantic image source accepted",
    search: 'if (typeof node.source !== "string" || !node.source) {',
    replacement: 'if (false && (typeof node.source !== "string" || !node.source)) {',
  },
  {
    name: "candidate image source discarded",
    file: "candidate",
    search: "return {\n            source,\n            ...(decorative",
    replacement: 'return {\n            source: "",\n            ...(decorative',
  },
  {
    name: "decorative web image receives spoken alternative",
    file: "candidate",
    search: 'attributes.alt = node.decorative ? "" : node.name!;',
    replacement: 'attributes.alt = node.name ?? "decorative";',
  },
  {
    name: "reference structure retains a removed descendant as a second root",
    search: "if (!exitRootSet.has(identity)) {",
    replacement: "if (false && !exitRootSet.has(identity)) {",
  },
  {
    name: "candidate structure retains a removed descendant as a second root",
    file: "candidate",
    search: "if (!exitRootIdentities.has(identity)) {",
    replacement: "if (false && !exitRootIdentities.has(identity)) {",
  },
  {
    name: "reference surviving identity changes native contract",
    search: "if (referenceSemanticContract(node) !== referenceSemanticContract(replacement)) {",
    replacement:
      "if (false && referenceSemanticContract(node) !== referenceSemanticContract(replacement)) {",
  },
  {
    name: "candidate surviving identity changes native contract",
    file: "candidate",
    search:
      "if (\n      candidateStructureContract(node) !==\n      candidateStructureContract(nextByIdentity.get(node.identity)!)\n    ) {",
    replacement:
      "if (\n      false && candidateStructureContract(node) !==\n      candidateStructureContract(nextByIdentity.get(node.identity)!)\n    ) {",
  },
  {
    name: "retained structural exit keeps active listeners",
    file: "candidate",
    search: "for (const identity of subtree) release(identity);",
    replacement: "for (const identity of subtree) void identity;",
  },
  {
    name: "retained structural exit stays in accessibility tree",
    file: "candidate",
    search: 'platform.attribute(node, "aria-hidden", true);',
    replacement: 'platform.attribute(node, "aria-hidden", undefined);',
  },
  {
    name: "retained structural exit stays interactive",
    file: "candidate",
    search: 'platform.property(node, "inert", true);',
    replacement: 'platform.property(node, "inert", undefined);',
  },
  {
    name: "stale structural exit settlement removes a reversed node",
    file: "candidate",
    search: "if (!retained || retained.revision !== settledRevision) return false;",
    replacement: "if (!retained) return false;",
  },
  {
    name: "structural reversal recreates retained native identity",
    file: "candidate",
    search: "const existing = nodes.get(identity);",
    replacement: "const existing = undefined;",
  },
  {
    name: "structural reversal does not restore retained presentation",
    file: "candidate",
    search: "platform.restore(node);",
    replacement: "void node;",
  },
  {
    name: "web structure does not activate a newly active native modal",
    file: "candidate",
    search: 'platform.activateModal(modal, destination, "visible");',
    replacement: "void modal; void destination;",
  },
  {
    name: "web structure does not release native modality and return focus",
    file: "candidate",
    search: "platform.deactivateModal(modal, destination);",
    replacement: "void modal; void destination;",
  },
  {
    name: "retained modal hide loses its pending focus return",
    file: "candidate",
    search:
      "if (destination && platform.focusedIdentity() === undefined) platform.focus(destination);",
    replacement: "void destination;",
  },
  {
    name: "retained structure partially reenters without its root",
    file: "candidate",
    search: "if (!owner || !reversing.has(owner)) {",
    replacement: "if (false && (!owner || !reversing.has(owner))) {",
  },
  {
    name: "structural reconciliation omits focus recovery",
    file: "candidate",
    search: "platform.focus(destination);",
    replacement: "void destination;",
  },
  {
    name: "multiple active modal owners accepted",
    search:
      'if (modals.length > 1) throw new Error("A semantic scene cannot have multiple active modals.");',
    replacement:
      'if (false && modals.length > 1) throw new Error("A semantic scene cannot have multiple active modals.");',
  },
  {
    name: "unknown hit-test identity accepted",
    file: "candidate",
    search: 'assertCandidateIdentity(known, contribution.identity, "hit-test");',
    replacement: "void contribution.identity;",
  },
  {
    name: "native layer capability attached to another identity",
    file: "candidate",
    search: "if (contribution.identity.key !== contribution.layer.key) {",
    replacement: "if (false && contribution.identity.key !== contribution.layer.key) {",
  },
  {
    name: "presentation overwrites layout-owned target",
    file: "candidate",
    search: "if (available.has(contribution.target.key)) {",
    replacement: "if (false && available.has(contribution.target.key)) {",
  },
  {
    name: "spring replacement loses compatible velocity",
    search: '(options.source === "direct" || options.previous?.kind === "spring");',
    replacement: 'options.source === "direct";',
  },
  {
    name: "reduced motion leaves an active trajectory",
    search: 'if (options.reducedMotion || options.next.kind === "instant") {',
    replacement: 'if (options.next.kind === "instant") {',
  },
  {
    name: "transition policy changes value type",
    search: "if (options.previous && options.previous.valueType !== options.next.valueType) {",
    replacement:
      "if (false && options.previous && options.previous.valueType !== options.next.valueType) {",
  },
  {
    name: "candidate equality uses object identity",
    file: "candidate",
    search: "return candidateValueEqual(evaluate(node.left), evaluate(node.right));",
    replacement: "return Object.is(evaluate(node.left), evaluate(node.right));",
  },
  {
    name: "boolean conjunction ignores false operands",
    file: "candidate",
    search: 'if (!candidateBoolean(evaluate(value), "and operand")) return false;',
    replacement: 'if (false && !candidateBoolean(evaluate(value), "and operand")) return false;',
  },
  {
    name: "candidate interpolation ignores clamping",
    file: "candidate",
    search: "const resolved = node.clamp ? Math.min(1, Math.max(0, progress)) : progress;",
    replacement: "const resolved = progress;",
  },
  {
    name: "candidate normalization ignores clamping",
    file: "candidate",
    search: "return node.clamp ? Math.min(1, Math.max(0, progress)) : progress;",
    replacement: "return progress;",
  },
  {
    name: "candidate normalization accepts zero extent",
    file: "candidate",
    search:
      'if (startNumber === endNumber)\n        throw new Error("Normalization range cannot have zero extent.");',
    replacement: "if (false) throw new Error();",
  },
  {
    name: "candidate arithmetic accepts mixed dimensions",
    file: "candidate",
    search:
      'typeof left === "number" || typeof right === "number" || left.dimension !== right.dimension',
    replacement: 'typeof left === "number" || typeof right === "number"',
  },
  {
    name: "preset parameter escapes declared bounds",
    file: "candidate",
    search: "(definition.minimum !== undefined && numeric! < definition.minimum) ||",
    replacement: "(false && definition.minimum !== undefined && numeric! < definition.minimum) ||",
  },
  {
    name: "nonphysical spring mass accepted",
    file: "candidate",
    search: "driver.mass <= 0 ||",
    replacement: "false ||",
  },
  {
    name: "presence awaits another identity target",
    file: "candidate",
    search: "if (!target.startsWith(`${contribution.identity.key}:`)) {",
    replacement: "if (false && !target.startsWith(`${contribution.identity.key}:`)) {",
  },
  {
    name: "presence awaits a target without transition policy",
    file: "candidate",
    search: "if (!transitioned.has(target)) {",
    replacement: "if (false && !transitioned.has(target)) {",
  },
  {
    name: "gradient stop order accepted",
    file: "candidate",
    search: "if (stops.some((stop, index) => index > 0 && stop < stops[index - 1]!)) {",
    replacement:
      "if (false && stops.some((stop, index) => index > 0 && stop < stops[index - 1]!)) {",
  },
  {
    name: "normalized visual domain escapes zero-to-one range",
    file: "candidate",
    search:
      "if (number < 0 || number > 1) throw new Error(`${owner} must be within zero and one.`);",
    replacement:
      "if (false && (number < 0 || number > 1)) throw new Error(`${owner} must be within zero and one.`);",
  },
  {
    name: "incompatible path topology morphs silently",
    search: "if (command.kind !== destination[index]?.kind) {",
    replacement: "if (false && command.kind !== destination[index]?.kind) {",
  },
  {
    name: "presentation identity masks itself",
    file: "candidate",
    search: "if (contribution.owner.key === contribution.source.key) {",
    replacement: "if (false && contribution.owner.key === contribution.source.key) {",
  },
  {
    name: "custom focus suppresses forced-color fallback",
    search: "(!options.forcedColors || options.custom.forcedColorsVisible)",
    replacement: "true",
  },
  {
    name: "OKLCH interpolation takes the long hue arc",
    search: "else if (toHue - fromHue < -180) toHue += 360;",
    replacement: "else if (false && toHue - fromHue < -180) toHue += 360;",
  },
  {
    name: "OKLCH interpolation ignores premultiplied alpha",
    search:
      "const premultipliedLightness =\n    from.lightness * from.alpha +\n    (to.lightness * to.alpha - from.lightness * from.alpha) * progress;",
    replacement:
      "const premultipliedLightness =\n    from.lightness + (to.lightness - from.lightness) * progress;",
  },
  {
    name: "candidate OKLCH interpolation diverges from reference hue semantics",
    file: "candidate",
    search: "else if (toHue - fromHue < -180) toHue += 360;",
    replacement: "else if (false && toHue - fromHue < -180) toHue += 360;",
  },
  {
    name: "reference paint interpolation accepts unlike kinds",
    search:
      'if (from.kind !== to.kind) throw new Error("Paint interpolation requires matching kinds.");',
    replacement: "if (false) throw new Error();",
  },
  {
    name: "reference gradient interpolation accepts unlike topology",
    search: "if (gradientFrom.stops.length !== gradientTo.stops.length) {",
    replacement: "if (false) {",
  },
  {
    name: "reference gradient angle takes the long arc",
    search: "else if (end - start < -180) end += 360;",
    replacement: "else if (false && end - start < -180) end += 360;",
  },
  {
    name: "candidate paint interpolation accepts unlike kinds",
    file: "candidate",
    search:
      'if (from.kind !== to.kind) throw new Error("Paint interpolation requires matching kinds.");',
    replacement: "if (false) throw new Error();",
  },
  {
    name: "candidate gradient interpolation accepts unlike topology",
    file: "candidate",
    search: "if (gradientFrom.stops.length !== gradientTo.stops.length) {",
    replacement: "if (false) {",
  },
  {
    name: "candidate gradient angle takes the long arc",
    file: "candidate",
    search: "else if (end - start < -180) end += 360;",
    replacement: "else if (false && end - start < -180) end += 360;",
  },
  {
    name: "reference shape interpolation accepts unlike kinds",
    search:
      'if (from.kind !== to.kind) throw new Error("Shape interpolation requires matching kinds.");',
    replacement: "if (false) throw new Error();",
  },
  {
    name: "candidate shape interpolation accepts unlike kinds",
    file: "candidate",
    search:
      'if (from.kind !== to.kind) throw new Error("Shape interpolation requires matching kinds.");',
    replacement: "if (false) throw new Error();",
  },
  {
    name: "reference rectangle interpolation drops corner smoothing",
    search: "smoothing: interpolate(left.smoothing, right.smoothing),",
    replacement: "smoothing: left.smoothing,",
  },
  {
    name: "candidate rectangle interpolation drops corner smoothing",
    file: "candidate",
    search: "smoothing: number(left.smoothing, right.smoothing),",
    replacement: "smoothing: left.smoothing,",
  },
  {
    name: "reference path interpolation ignores fill semantics",
    search: "pathFrom.fillRule !== pathTo.fillRule ||",
    replacement: "false ||",
  },
  {
    name: "candidate path interpolation ignores fill semantics",
    file: "candidate",
    search: "pathFrom.fillRule !== pathTo.fillRule ||",
    replacement: "false ||",
  },
  {
    name: "candidate path interpolation accepts changed command kind",
    file: "candidate",
    search: "if (command.kind !== destination.kind) {",
    replacement: "if (false) {",
  },
  {
    name: "reference stroke interpolation ignores placement",
    search: "if (from.placement !== to.placement) {",
    replacement: "if (false) {",
  },
  {
    name: "candidate stroke interpolation ignores placement",
    file: "candidate",
    search: "if (from.placement !== to.placement) {",
    replacement: "if (false) {",
  },
  {
    name: "reference stroke interpolation ignores dash count",
    search: "from.dash?.length !== to.dash?.length",
    replacement: "false",
  },
  {
    name: "candidate stroke interpolation ignores dash count",
    file: "candidate",
    search: "from.dash?.length !== to.dash?.length",
    replacement: "false",
  },
  {
    name: "reference shadow interpolation ignores list length",
    search: "if (from.length !== to.length) {",
    replacement: "if (false) {",
  },
  {
    name: "candidate shadow interpolation ignores list length",
    file: "candidate",
    search: "if (from.length !== to.length) {",
    replacement: "if (false) {",
  },
  {
    name: "reference shadow interpolation ignores inner outer kind",
    search: "if (shadow.kind !== destination.kind) {",
    replacement: "if (false) {",
  },
  {
    name: "candidate shadow interpolation ignores inner outer kind",
    file: "candidate",
    search: "if (shadow.kind !== destination.kind) {",
    replacement: "if (false) {",
  },
  {
    name: "reference material interpolation freezes noise",
    search: "noise: interpolateReferenceNumber(from.noise, to.noise, progress),",
    replacement: "noise: from.noise,",
  },
  {
    name: "candidate material interpolation freezes noise",
    file: "candidate",
    search: "noise: candidateInterpolateNumber(from.noise, to.noise, progress),",
    replacement: "noise: from.noise,",
  },
  {
    name: "reference type interpolation ignores wrapping semantics",
    search: "from.wrap !== to.wrap ||",
    replacement: "false ||",
  },
  {
    name: "candidate type interpolation ignores wrapping semantics",
    file: "candidate",
    search: "from.wrap !== to.wrap ||",
    replacement: "false ||",
  },
  {
    name: "reference type interpolation ignores variation axes",
    search: "if (!equalList(axes, Object.keys(to.variations).sort())) {",
    replacement: "if (false) {",
  },
  {
    name: "candidate type interpolation ignores variation axes",
    file: "candidate",
    search: "if (!equalList(axes, Object.keys(to.variations).sort())) {",
    replacement: "if (false) {",
  },
  {
    name: "reference media interpolation ignores fit mode",
    search:
      'if (from.mode !== to.mode) throw new Error("Media-fit interpolation requires matching modes.");',
    replacement: "if (false) throw new Error();",
  },
  {
    name: "candidate media interpolation ignores fit mode",
    file: "candidate",
    search:
      'if (from.mode !== to.mode) throw new Error("Media-fit interpolation requires matching modes.");',
    replacement: "if (false) throw new Error();",
  },
  {
    name: "reference visual transition batch accepts duplicate targets",
    search:
      'throw new Error("A visual transition batch contains the same target more than once.");',
    replacement: "void 0;",
  },
  {
    name: "candidate visual transition batch accepts duplicate targets",
    file: "candidate",
    search:
      'throw new Error("A visual transition batch contains the same target more than once.");',
    replacement: "void 0;",
  },
  {
    name: "reference visual transition batch skips paint compatibility",
    search:
      "interpolateReferencePaint(entry.from as ReferencePaint, entry.to as ReferencePaint, 0.5);",
    replacement: "void 0;",
  },
  {
    name: "candidate visual transition batch skips value compatibility",
    file: "candidate",
    search: "interpolateCandidateValues(entry.from, entry.to, 0.5);",
    replacement: "void 0;",
  },
  {
    name: "reference visual transition batch hides stroke presence",
    search:
      'if (entry.from === "none" || entry.to === "none") {\n        throw new Error("Stroke presence changes require explicit presentation presence.");',
    replacement:
      'if (false) {\n        throw new Error("Stroke presence changes require explicit presentation presence.");',
  },
  {
    name: "candidate visual transition batch hides stroke presence",
    file: "candidate",
    search: 'if (entry.valueType === "stroke" && (entry.from === "none" || entry.to === "none")) {',
    replacement: 'if (false && entry.valueType === "stroke") {',
  },
  {
    name: "zero transform rotation axis accepted",
    file: "candidate",
    search:
      'if (Math.hypot(x, y, z) === 0) throw new Error("Transform rotation axis cannot be zero.");',
    replacement:
      'if (false && Math.hypot(x, y, z) === 0) throw new Error("Transform rotation axis cannot be zero.");',
  },
  {
    name: "rotation Slerp takes the long quaternion path",
    search: "if (dot < 0) {",
    replacement: "if (false && dot < 0) {",
  },
  {
    name: "reference zero rotation axis accepted",
    search: 'if (magnitude === 0) throw new Error("Rotation axis cannot be zero.");',
    replacement: 'if (false && magnitude === 0) throw new Error("Rotation axis cannot be zero.");',
  },
  {
    name: "candidate transform takes the long quaternion path",
    file: "candidate",
    search: "if (dot < 0) {",
    replacement: "if (false && dot < 0) {",
  },
  {
    name: "transition batch accepts duplicate targets",
    search: "if (new Set(identities).size !== identities.length) {",
    replacement: "if (false && new Set(identities).size !== identities.length) {",
  },
  {
    name: "transition batch loses its shared revision",
    search: "revision: transaction.revision,",
    replacement: "revision: 0,",
  },
  {
    name: "transition update accepts implicit channel identity change",
    search: 'if (previousNames.join("\\0") !== nextNames.join("\\0")) {',
    replacement: 'if (false && previousNames.join("\\0") !== nextNames.join("\\0")) {',
  },
  {
    name: "transition update accepts changed value type",
    search: "if (previous.policy.valueType !== next.policy.valueType) {",
    replacement: "if (false && previous.policy.valueType !== next.policy.valueType) {",
  },
  {
    name: "active transition ignores a policy-only change",
    search: "(change.previous.active && change.policyChanged) ||",
    replacement: "false ||",
  },
  {
    name: "active transition ignores reduced-motion settlement",
    search:
      "(change.previous.active && !change.previous.reducedMotion && change.next.reducedMotion);",
    replacement: "false;",
  },
  {
    name: "layout transition restarts from its target geometry",
    search: "from: presented,",
    replacement: "from: target,",
  },
  {
    name: "layout spring loses retained geometry velocity",
    search: 'options.driver === "spring"\n        ? velocity',
    replacement: "false\n        ? velocity",
  },
  {
    name: "layout transition ignores reduced motion",
    search: 'if (options.reducedMotion || options.driver === "instant") {',
    replacement: 'if (options.driver === "instant") {',
  },
  {
    name: "candidate transaction drops its target set",
    file: "candidate",
    search: "transaction: { targets: transaction.targets },",
    replacement: "transaction: { targets: [] },",
  },
  {
    name: "grid placement accepted without a grid parent",
    file: "candidate",
    search: 'if (!owner || owner.arrangement.algorithm !== "grid") {',
    replacement: 'if (false && (!owner || owner.arrangement.algorithm !== "grid")) {',
  },
  {
    name: "grid placement accepted beyond declared tracks",
    file: "candidate",
    search:
      "placement.column.start + placement.column.span - 1 > owner.arrangement.columns.length ||",
    replacement:
      "false && placement.column.start + placement.column.span - 1 > owner.arrangement.columns.length ||",
  },
  {
    name: "sticky attachment accepted outside scroll content",
    file: "candidate",
    search: "if (!inside) {",
    replacement: "if (false && !inside) {",
  },
  {
    name: "stale virtual measurements commit",
    search:
      "if (revision !== this.#revision || this.#pending?.revision !== revision) return false;",
    replacement:
      "if (false && (revision !== this.#revision || this.#pending?.revision !== revision)) return false;",
  },
  {
    name: "retained virtual measurements are discarded",
    search: "if (!nextMeasurements.has(key) && this.#measurements.has(key)) {",
    replacement: "if (false && !nextMeasurements.has(key) && this.#measurements.has(key)) {",
  },
  {
    name: "candidate virtual measurement policy accepts stale results",
    file: "candidate",
    search: 'measurement: { source: "observed", identity: "keyed", stale: "ignore" },',
    replacement: 'measurement: { source: "observed", identity: "keyed", stale: "apply" },',
  },
  {
    name: "layout parent swap is hidden",
    search: "parentChanged: options.previousParent !== options.nextParent,",
    replacement: "parentChanged: false,",
  },
  {
    name: "candidate layout drops resolved parent ownership",
    file: "candidate",
    search:
      "parents: Object.fromEntries(\n      [...parentByChild.entries()].sort(([left], [right]) => left.localeCompare(right)),\n    ),",
    replacement: "parents: {},",
  },
  {
    name: "candidate layout accepts descending logical size constraints",
    file: "candidate",
    search:
      "if (\n          (minimumValue !== undefined && idealValue !== undefined && minimumValue > idealValue) ||",
    replacement:
      "if (false && (\n          (minimumValue !== undefined && idealValue !== undefined && minimumValue > idealValue) ||",
  },
  {
    name: "candidate layout accepts flow participation without a flow parent",
    file: "candidate",
    search: 'if (!parent || !owner || owner.arrangement.algorithm !== "flow") {',
    replacement: 'if (false && (!parent || !owner || owner.arrangement.algorithm !== "flow")) {',
  },
  {
    name: "stale gesture samples mutate the active session",
    search: "revision !== this.#revision ||\n      pointer !== this.#pointer",
    replacement: "pointer !== this.#pointer",
  },
  {
    name: "gesture end retains pointer capture",
    search: "this.#captured = false;\n    this.#pointer = undefined;\n    this.#outcome = reason;",
    replacement:
      "this.#captured = true;\n    this.#pointer = undefined;\n    this.#outcome = reason;",
  },
  {
    name: "candidate gesture lifecycle accepts stale callbacks",
    file: "candidate",
    search: 'stale: "ignore",\n    },\n    drives:',
    replacement: 'stale: "apply",\n    },\n    drives:',
  },
  {
    name: "rubber band exposes raw overshoot",
    search: "return bound + Math.sign(value - bound) * compressed;",
    replacement: "return value;",
  },
  {
    name: "snap selection ignores release velocity",
    search: "const projected = value + velocity * projectionSeconds;",
    replacement: "const projected = value;",
  },
  {
    name: "snap tie chooses the higher destination",
    search: "left.value - right.value ||",
    replacement: "right.value - left.value ||",
  },
  {
    name: "gesture rebase ignores changed geometry",
    search: "value: (value / previousExtent) * nextExtent,",
    replacement: "value,",
  },
  {
    name: "unavailable gesture survives a viewport-mode change",
    search: 'if (!options.available) return { strategy: "cancel" };',
    replacement: 'if (false && !options.available) return { strategy: "cancel" };',
  },
  {
    name: "nested scroll loses inward movement at its boundary",
    search: 'return options.movement === "outward" && atBoundary ? "direct" : "scroll";',
    replacement: 'return atBoundary ? "direct" : "scroll";',
  },
  {
    name: "reference auto-scroll loses quadratic edge response",
    search: "Math.sign(signedProximity) * maximumSpeed * Math.abs(signedProximity) ** 2;",
    replacement: "Math.sign(signedProximity) * maximumSpeed * Math.abs(signedProximity);",
  },
  {
    name: "candidate auto-scroll loses quadratic edge response",
    file: "candidate",
    search: "Math.sign(signed) * maximumSpeed * Math.abs(signed) ** 2;",
    replacement: "Math.sign(signed) * maximumSpeed * Math.abs(signed);",
  },
  {
    name: "reference auto-scroll escapes scroll bounds",
    search:
      "const next = Math.min(maximum, Math.max(minimum, position + requestedVelocity * seconds));",
    replacement: "const next = position + requestedVelocity * seconds;",
  },
  {
    name: "candidate auto-scroll escapes scroll bounds",
    file: "candidate",
    search:
      "const next = Math.min(maximum, Math.max(minimum, position + requestedVelocity * seconds));",
    replacement: "const next = position + requestedVelocity * seconds;",
  },
  {
    name: "reference auto-scroll drops gesture rebase",
    search: "return { requestedVelocity, velocity, delta, position: next, gestureRebase: delta };",
    replacement: "return { requestedVelocity, velocity, delta, position: next, gestureRebase: 0 };",
  },
  {
    name: "candidate auto-scroll drops gesture rebase",
    file: "candidate",
    search: "gestureRebase: delta,",
    replacement: "gestureRebase: 0,",
  },
  {
    name: "reference auto-scroll accepts stale frame revision",
    search: "if (this.#disposed || !this.#active || revision !== this.#revision) return undefined;",
    replacement: "if (this.#disposed || !this.#active) return undefined;",
  },
  {
    name: "candidate auto-scroll accepts stale frame revision",
    file: "candidate",
    search: "if (this.#disposed || !this.#active || revision !== this.#revision) return undefined;",
    replacement: "if (this.#disposed || !this.#active) return undefined;",
  },
  {
    name: "candidate recognizer discards auto-scroll intent",
    file: "candidate",
    search: "...(autoScroll ? { autoScroll } : {}),",
    replacement: "...{},",
  },
  {
    name: "candidate auto-scroll accepts an undeclared parameter",
    file: "candidate",
    search: "if (!declaredParameters.has(parameter)) {",
    replacement: "if (false) {",
  },
  {
    name: "candidate auto-scroll accepts a non-scroll owner",
    file: "candidate",
    search: "if (!scroll) {\n      throw new Error(",
    replacement: "if (false) {\n      throw new Error(",
  },
  {
    name: "gesture settlement reuses one parameter for two meanings",
    file: "candidate",
    search: "if (contribution.projectionTime.key === contribution.resistance.key) {",
    replacement: "if (false && contribution.projectionTime.key === contribution.resistance.key) {",
  },
  {
    name: "gesture resistance escapes its semantic domain",
    file: "candidate",
    search: "if (resistance < 0 || resistance > 1) {",
    replacement: "if (false && (resistance < 0 || resistance > 1)) {",
  },
  {
    name: "missing gesture projection parameter is accepted",
    file: "candidate",
    search: "if (!(settlement.projectionTime in parameters)) {",
    replacement: "if (false && !(settlement.projectionTime in parameters)) {",
  },
  {
    name: "stale presence settlement mutates the current revision",
    search: "if (this.#disposed || revision !== this.#revision || !this.#pending.delete(target))",
    replacement: "if (this.#disposed || !this.#pending.delete(target))",
  },
  {
    name: "presence unmounts after its first settled target",
    search: "if (this.#pending.size > 0) return false;",
    replacement: "if (false && this.#pending.size > 0) return false;",
  },
  {
    name: "exiting presence remains interactive",
    search: "this.#interactive = present;",
    replacement: "this.#interactive = true;",
  },
  {
    name: "candidate presence accepts stale settlement",
    file: "candidate",
    search: 'unmount: "all-settled",\n        stale: "ignore",',
    replacement: 'unmount: "all-settled",\n        stale: "apply",',
  },
  {
    name: "roving focus lands on a disabled item",
    search: "const enabled = items.filter((item) => !item.disabled);",
    replacement: "const enabled = items;",
  },
  {
    name: "roving focus exposes multiple tab stops",
    search: "item.identity === active ? 0 : -1",
    replacement: "0",
  },
  {
    name: "active descendant escapes its semantic owner",
    search: "if (!isReferenceSemanticDescendant(active.identity, node.identity, parent)) {",
    replacement:
      "if (false && !isReferenceSemanticDescendant(active.identity, node.identity, parent)) {",
  },
  {
    name: "active descendant role compatibility is ignored",
    search: "!compatible ||\n        active.hidden ||",
    replacement: "active.hidden ||",
  },
  {
    name: "nested overlay accepts the wrong parent",
    search: "if (options.parent !== undefined && options.parent !== top?.identity) {",
    replacement: "if (false && options.parent !== undefined && options.parent !== top?.identity) {",
  },
  {
    name: "stale overlay close mutates the stack",
    search:
      "close(\n    revision: number,\n    identity: string,\n  ): { readonly closed: string; readonly focus: string } | undefined {\n    if (revision !== this.#revision) return undefined;",
    replacement:
      "close(\n    revision: number,\n    identity: string,\n  ): { readonly closed: string; readonly focus: string } | undefined {\n    if (false && revision !== this.#revision) return undefined;",
  },
  {
    name: "responsive focus preserves a removed identity",
    search: "if (this.#focused !== undefined && available.has(this.#focused)) {",
    replacement: "if (this.#focused !== undefined) {",
  },
  {
    name: "responsive focus accepts a stale return",
    search:
      "returnFocus(revision: number, target: string, nodes: readonly ReferenceFocusableNode[]): boolean {\n    if (revision !== this.#revision) return false;",
    replacement:
      "returnFocus(revision: number, target: string, nodes: readonly ReferenceFocusableNode[]): boolean {\n    if (false && revision !== this.#revision) return false;",
  },
  {
    name: "responsive focus accepts an unavailable destination",
    search: "if (!available.has(preferred)) {",
    replacement: "if (false) {",
  },
  {
    name: "candidate structure drops focus recovery",
    file: "candidate",
    search: "...(focusRecovery.length ? { focusRecovery } : {}),",
    replacement: "...{},",
  },
  {
    name: "candidate focus recovery drops departing branch ownership",
    file: "candidate",
    search:
      "departing: entries.flatMap(([key, entry]) =>\n            key === selected.key ? [] : candidateStructureActiveIdentities(entry.content, reads),\n          ),",
    replacement: "departing: [],",
  },
  {
    name: "candidate selection accepts a partial focus contract",
    file: "candidate",
    search: "if (focused.length !== 0 && focused.length !== entries.length) {",
    replacement: "if (false) {",
  },
  {
    name: "candidate focus recovery accepts destination outside its case",
    file: "candidate",
    search: "if (!candidateStructureContainsIdentity(entry.content, entry.focus!.key)) {",
    replacement: "if (false) {",
  },
  {
    name: "candidate focus recovery accepts nonfocusable destination",
    file: "candidate",
    search: "if (!destination?.focusable || destination.hidden || destination.inert) {",
    replacement: "if (false) {",
  },
  {
    name: "reference measurement accepts a stale transaction",
    search:
      "if (this.#disposed || transaction.revision !== this.#revision) return { accepted: false };",
    replacement: "if (this.#disposed) return { accepted: false };",
  },
  {
    name: "candidate measurement accepts a stale transaction",
    file: "candidate",
    search:
      "if (this.#disposed || transaction.revision !== this.#revision) return { accepted: false };",
    replacement: "if (this.#disposed) return { accepted: false };",
  },
  {
    name: "reference measurement accepts nonpositive geometry",
    search: "if (inlineSize <= 0 || blockSize <= 0) {",
    replacement: "if (false) {",
  },
  {
    name: "candidate measurement accepts nonpositive geometry",
    file: "candidate",
    search: "if (inlineSize <= 0 || blockSize <= 0) {",
    replacement: "if (false) {",
  },
  {
    name: "reference measurement replays unchanged geometry",
    search:
      "!previous ||\n          previous.inlineSize !== entry.inlineSize ||\n          previous.blockSize !== entry.blockSize",
    replacement: "true",
  },
  {
    name: "candidate measurement replays unchanged geometry",
    file: "candidate",
    search:
      "!previous ||\n          previous.inlineSize !== entry.inlineSize ||\n          previous.blockSize !== entry.blockSize",
    replacement: "true",
  },
  {
    name: "reference measurement changes semantic state",
    search: "semanticChanged: false,\n      presenceChanged: false,",
    replacement: "semanticChanged: true,\n      presenceChanged: false,",
  },
  {
    name: "candidate measurement changes presence state",
    file: "candidate",
    search: "semanticChanged: false,\n      presenceChanged: false,",
    replacement: "semanticChanged: false,\n      presenceChanged: true,",
  },
  {
    name: "reference overlay cascade closes parent before child",
    search: "this.#queue = [...this.#cascade].reverse();",
    replacement: "this.#queue = [...this.#cascade];",
  },
  {
    name: "candidate overlay cascade closes parent before child",
    file: "candidate",
    search: "this.#queue = [...this.#cascade].reverse();",
    replacement: "this.#queue = [...this.#cascade];",
  },
  {
    name: "reference overlay cascade accepts out-of-order settlement",
    search:
      "if (revision !== this.#revision || this.#queue[0] !== identity) return { accepted: false };",
    replacement: "if (revision !== this.#revision) return { accepted: false };",
  },
  {
    name: "candidate overlay cascade accepts out-of-order settlement",
    file: "candidate",
    search:
      "if (revision !== this.#revision || this.#queue[0] !== identity) return { accepted: false };",
    replacement: "if (revision !== this.#revision) return { accepted: false };",
  },
  {
    name: "reference overlay reversal keeps old revision live",
    search:
      "const nextRevision = ++this.#revision;\n    return { accepted: true, revision: nextRevision, restore };",
    replacement:
      "const nextRevision = this.#revision;\n    return { accepted: true, revision: nextRevision, restore };",
  },
  {
    name: "candidate overlay reversal keeps old revision live",
    file: "candidate",
    search:
      "const nextRevision = ++this.#revision;\n    return { accepted: true, revision: nextRevision, restore };",
    replacement:
      "const nextRevision = this.#revision;\n    return { accepted: true, revision: nextRevision, restore };",
  },
  {
    name: "reference adjustable maximum disappears off the step lattice",
    search: "bounded === range.minimum || bounded === range.maximum",
    replacement: "false",
  },
  {
    name: "candidate adjustable maximum disappears off the step lattice",
    file: "candidate",
    search: "bounded === this.#range.minimum || bounded === this.#range.maximum",
    replacement: "false",
  },
  {
    name: "reference adjustable value skips step quantization",
    search: "Math.round((bounded - range.minimum) / range.step) * range.step",
    replacement: "bounded - range.minimum",
  },
  {
    name: "candidate adjustable value skips step quantization",
    file: "candidate",
    search: "Math.round((bounded - this.#range.minimum) / this.#range.step) * this.#range.step",
    replacement: "bounded - this.#range.minimum",
  },
  {
    name: "reference adjustable large decrement uses the small step",
    search: "? current - range.largeStep",
    replacement: "? current - range.step",
  },
  {
    name: "candidate adjustable large decrement uses the small step",
    file: "candidate",
    search: "? current - this.#range.largeStep",
    replacement: "? current - this.#range.step",
  },
  {
    name: "reference adjustable range accepts descending bounds",
    search: "range.maximum <= range.minimum",
    replacement: "false",
  },
  {
    name: "candidate adjustable range accepts descending bounds",
    file: "candidate",
    search: "range.maximum <= range.minimum",
    replacement: "false",
  },
  {
    name: "candidate slider drops its large step semantic",
    file: "candidate",
    search:
      'largeStep: candidateStructureValue(adjustableProps.largeStep, reads, "slider large step"),',
    replacement: "largeStep: undefined as never,",
  },
  {
    name: "reference hot reload treats an incompatible contract as compatible",
    search: "const compatible = previous.contract === next.contract;",
    replacement: "const compatible = true;",
  },
  {
    name: "candidate hot reload treats an incompatible contract as compatible",
    file: "candidate",
    search: "const compatible = previous.contract === next.contract;",
    replacement: "const compatible = true;",
  },
  {
    name: "reference hot reload retains removed semantic presence",
    search: "presence.filter((sample) => nextStructure.has(sample.identity))",
    replacement: "presence",
  },
  {
    name: "candidate hot reload retains removed semantic presence",
    file: "candidate",
    search: "presence.filter((sample) => semanticIdentities.has(sample.identity))",
    replacement: "presence",
  },
  {
    name: "reference hot reload hands off a removed motion channel",
    search: "previousTargets.has(sample.identity) && nextTargets.has(sample.identity)",
    replacement: "previousTargets.has(sample.identity)",
  },
  {
    name: "candidate hot reload hands off a removed motion channel",
    file: "candidate",
    search: "oldTargets.has(sample.identity) && newTargets.has(sample.identity)",
    replacement: "oldTargets.has(sample.identity)",
  },
  {
    name: "candidate hot reload resets retained motion velocity",
    file: "candidate",
    search: "? motions.filter((sample) =>",
    replacement: "? motions.map((sample) => ({ ...sample, velocity: 0 })).filter((sample) =>",
  },
  {
    name: "candidate hot reload resets retained presence phase",
    file: "candidate",
    search: "? presence.filter((sample) => semanticIdentities.has(sample.identity))",
    replacement:
      '? presence.map((sample) => ({ ...sample, phase: "present" as const })).filter((sample) => semanticIdentities.has(sample.identity))',
  },
  {
    name: "reference hot reload disposes a task twice",
    search: "tasks: uniqueReferenceIdentities(live.tasks),",
    replacement: "tasks: [...live.tasks].sort(),",
  },
  {
    name: "candidate hot reload disposes a task twice",
    file: "candidate",
    search: "tasks: unique(live.tasks),",
    replacement: "tasks: [...live.tasks].sort(),",
  },
  {
    name: "candidate hot reload contract forgets semantic roles",
    file: "candidate",
    search:
      "identity: node.identity,\n        platformKind: node.platformKind,\n        role: node.role,\n        actions: [...(node.actions ?? [])].sort(",
    replacement:
      'identity: node.identity,\n        platformKind: node.platformKind,\n        role: "semantic",\n        actions: [...(node.actions ?? [])].sort(',
  },
  {
    name: "candidate structure drops native platform kind",
    file: "candidate",
    search: "platformKind: node.element,",
    replacement: "platformKind: undefined,",
  },
  {
    name: "candidate hot reload ignores native platform kind",
    file: "candidate",
    search: "platformKind: node.platformKind,",
    replacement: "platformKind: undefined,",
  },
  {
    name: "candidate web lowering drops native link destination",
    file: "candidate",
    search: "if (node.destination !== undefined) attributes.href = node.destination;",
    replacement: "void node.destination;",
  },
  {
    name: "candidate web lowering drops controlled text value",
    file: "candidate",
    search: "if (node.textValue !== undefined) properties.value = node.textValue;",
    replacement: "void node.textValue;",
  },
  {
    name: "candidate web lowering accepts unsafe native elements",
    file: "candidate",
    search:
      'if (!/^[a-z][a-z0-9-]*$/.test(element) || element === "script" || element === "style") {',
    replacement: "if (false) {",
  },
  {
    name: "candidate visual IR drops target value types",
    file: "candidate",
    search: "valueTypes: Object.fromEntries(",
    replacement: "valueTypes: {}, ignoredValueTypes: Object.fromEntries(",
  },
  {
    name: "candidate visual IR accepts two types for one target",
    file: "candidate",
    search:
      'existingType !== undefined &&\n      existingType !== "unknown" &&\n      nextType !== "unknown" &&\n      existingType !== nextType',
    replacement: "false",
  },
  {
    name: "candidate web lowering ignores retained transition ownership",
    file: "candidate",
    search: "const strategy = transition",
    replacement: "const strategy = false",
  },
  {
    name: "candidate web lowering treats a reactive value as static",
    file: "candidate",
    search: ": isCandidateExpression(value)",
    replacement: ": false",
  },
  {
    name: "candidate web lowering accepts an unknown visual value type",
    file: "candidate",
    search: 'if (valueType === undefined || valueType === "unknown") {',
    replacement: "if (false) {",
  },
  {
    name: "candidate compiler accepts an invalid structured target address",
    file: "candidate",
    search: 'if (!identity || !property || property.includes(":")) {',
    replacement: "if (false) {",
  },
  {
    name: "candidate web lowering drops structured target identity",
    file: "candidate",
    search: "identity: address.identity,",
    replacement: 'identity: "discarded",',
  },
  {
    name: "candidate web lowering drops policy-only derived geometry",
    file: "candidate",
    search: "return [...scene.transaction.targets].sort().map((target) => {",
    replacement: "return Object.keys(scene.targets).sort().map((target) => {",
  },
  {
    name: "candidate web style lowering treats geometry as a CSS declaration",
    file: "candidate",
    search: 'if (target.encoding === "layout") continue;',
    replacement: 'if (false && target.encoding === "layout") continue;',
  },
  {
    name: "candidate web layout lowering drops every retained geometry channel",
    file: "candidate",
    search: '.filter((target) => target.encoding === "layout")',
    replacement: ".filter(() => false)",
  },
  {
    name: "candidate web layout lowering maps block flow to the inline axis",
    file: "candidate",
    search: 'relation.arrangement.axis === "inline" ? "row" : "column"',
    replacement: 'relation.arrangement.axis === "inline" ? "row" : "row"',
  },
  {
    name: "candidate web layout lowering loses intrinsic grid sizing",
    file: "candidate",
    search: 'if (value.size === "intrinsic") return "max-content";',
    replacement: 'if (value.size === "intrinsic") return "auto";',
  },
  {
    name: "candidate web layout lowering scrolls the wrong logical axis",
    file: "candidate",
    search:
      'add(relation.container, "overflow-inline", relation.axis === "block" ? "hidden" : "auto");',
    replacement:
      'add(relation.container, "overflow-inline", relation.axis === "block" ? "auto" : "auto");',
  },
  {
    name: "candidate web layout lowering replaces logical sticky placement with a physical edge",
    file: "candidate",
    search: '? "inset-inline-start"',
    replacement: '? "left"',
  },
  {
    name: "candidate web layout lowering replaces a logical padding edge with a physical edge",
    file: "candidate",
    search: '"padding-inline-start",',
    replacement: '"padding-left",',
  },
  {
    name: "candidate web layout lowering loses available-space size meaning",
    file: "candidate",
    search: 'return value.size === "intrinsic" ? "max-content" : "100%";',
    replacement: 'return value.size === "intrinsic" ? "max-content" : "max-content";',
  },
  {
    name: "candidate web layout lowering drops flow growth",
    file: "candidate",
    search: 'add(relation.identity, "flex-grow", String(relation.flow.grow));',
    replacement: 'add(relation.identity, "flex-grow", "0");',
  },
  {
    name: "candidate web layout lowering keeps the web intrinsic shrink floor",
    file: "candidate",
    search: 'if (relation.flow.shrink > 0) add(relation.identity, "min-inline-size", "0");',
    replacement: 'if (false) add(relation.identity, "min-inline-size", "0");',
  },
  {
    name: "candidate web layout lowering loses viewport anchoring",
    file: "candidate",
    search: 'add(relation.identity, "position", "fixed");',
    replacement: 'add(relation.identity, "position", "absolute");',
  },
  {
    name: "candidate web layout lowering loses local anchor context",
    file: "candidate",
    search: 'add(relation.anchor, "position", "relative");',
    replacement: 'add(relation.anchor, "position", "static");',
  },
  {
    name: "candidate web layout lowering gives an anchored parent two position modes",
    file: "candidate",
    search: "if (!anchoredIdentities.has(relation.anchor)) {",
    replacement: "if (true) {",
  },
  {
    name: "candidate web layout lowering makes local anchoring viewport-relative",
    file: "candidate",
    search: 'add(relation.identity, "position", "absolute");',
    replacement: 'add(relation.identity, "position", "fixed");',
  },
  {
    name: "candidate web scene lets layout resurrect semantically hidden structure",
    file: "candidate",
    search: "instruction.properties.hidden === true",
    replacement: "instruction.properties.hidden === false",
  },
  {
    name: "candidate presence command drops structural reversal",
    file: "candidate",
    search: "reversal: reversed.has(identity),",
    replacement: "reversal: false,",
  },
  {
    name: "candidate generated layer intercepts pointer input",
    file: "candidate",
    search: 'add(instruction.identity, { name: "pointer-events", value: "none" });',
    replacement: "void instruction.identity;",
  },
  {
    name: "candidate local anchor accepts self ownership",
    file: "candidate",
    search: "if (contribution.identity.key === contribution.anchor.key) {",
    replacement: "if (false) {",
  },
  {
    name: "candidate local anchor drops layout parent ownership",
    file: "candidate",
    search: "hierarchy.push({ below: contribution.anchor.key, above: contribution.identity.key });",
    replacement: "void contribution.anchor;",
  },
  {
    name: "candidate hot reload drops policy-only layout geometry",
    file: "candidate",
    search: "targetIdentities: [...artifact.presentation.targets.transaction.targets].sort(),",
    replacement: "targetIdentities: Object.keys(artifact.presentation.targets.targets).sort(),",
  },
  {
    name: "candidate hot reload execution leaves an old motion controller alive",
    file: "candidate",
    search: "for (const identity of resolution.dispose.motions) port.disposeMotion(identity);",
    replacement: "for (const identity of []) port.disposeMotion(identity);",
  },
  {
    name: "candidate hot reload disposes a compatible retained motion channel",
    file: "candidate",
    search: ".filter((sample) => !retainedMotionIdentities.has(sample.identity))",
    replacement: ".filter(() => true)",
  },
  {
    name: "candidate hot reload execution rebinds before disposing old controllers",
    file: "candidate",
    search:
      "const resolution = resolveCandidateHotReload(previous, next, port.snapshot());\n  for (const identity of resolution.dispose.motions)",
    replacement:
      "const resolution = resolveCandidateHotReload(previous, next, port.snapshot());\n  if (!resolution.remount) port.rebind(next, resolution.retain);\n  for (const identity of resolution.dispose.motions)",
  },
  {
    name: "candidate web style leaves a reactive expression unevaluated",
    file: "candidate",
    search: "? evaluateCandidateExpression(target.value, reads).value\n    : target.value;",
    replacement: "? target.value\n    : target.value;",
  },
  {
    name: "candidate web OKLCH lowering forgets the lightness percentage scale",
    file: "candidate",
    search: "color.lightness * 100",
    replacement: "color.lightness",
  },
  {
    name: "candidate web style drops independent foreground paint",
    file: "candidate",
    search: 'if (target.property === "foreground" && target.valueType === "paint") {',
    replacement: 'if (false && target.property === "foreground" && target.valueType === "paint") {',
  },
  {
    name: "candidate web shape lowering turns a capsule into an ellipse",
    file: "candidate",
    search: 'if (shape.kind === "capsule") return [{ name: "border-radius", value: "9999px" }];',
    replacement: 'if (shape.kind === "capsule") return [{ name: "border-radius", value: "50%" }];',
  },
  {
    name: "candidate web material silently disappears instead of failing capability validation",
    file: "candidate",
    search:
      'throw new Error(\n      `Web target "${target.target}" needs node-level material and fill composition lowering.`,\n    );',
    replacement: "return [];",
  },
  {
    name: "candidate web node material overwrites its surface fill",
    file: "candidate",
    search: "const paint = fill",
    replacement: "const paint = false && fill",
  },
  {
    name: "candidate web node material accepts unimplemented generated noise",
    file: "candidate",
    search: "if (value.noise !== 0) {",
    replacement: "if (false && value.noise !== 0) {",
  },
  {
    name: "candidate semantic normalization drops generated layer ownership",
    file: "candidate",
    search: "...(generated.size\n      ? {",
    replacement: "...(false\n      ? {",
  },
  {
    name: "candidate web lowering drops generated layer ownership",
    file: "candidate",
    search: "...(generated ? { generated } : {}),",
    replacement: "...{},",
  },
  {
    name: "candidate semantic normalization accepts conflicting generated owners",
    file: "candidate",
    search: "if (existingOwner !== undefined && existingOwner !== metadata.owner) {",
    replacement: "if (false && existingOwner !== undefined && existingOwner !== metadata.owner) {",
  },
  {
    name: "candidate web node material drops backdrop saturation",
    file: "candidate",
    search: "saturate(${value.backdropSaturation})",
    replacement: "saturate(1)",
  },
  {
    name: "candidate web node material emits an invalid plain-color tint layer",
    file: "candidate",
    search: "return `linear-gradient(${color}, ${color})`;",
    replacement: "return color;",
  },
  {
    name: "candidate web node lets static cleanup own a retained composite declaration",
    file: "candidate",
    search:
      'if (sources.some((source) => source.strategy === "retained-motion")) return "retained-motion";',
    replacement:
      'if (false && sources.some((source) => source.strategy === "retained-motion")) return "retained-motion";',
  },
  {
    name: "candidate web mount drops compiler-issued event bindings",
    file: "candidate",
    search: "for (const binding of instruction.events) {",
    replacement: "for (const binding of []) {",
  },
  {
    name: "candidate web structure mount disposes twice",
    file: "candidate",
    search:
      "if (disposed) return;\n      disposed = true;\n      for (const cleanup of cleanups.splice(0).reverse()) cleanup();",
    replacement:
      "disposed = true;\n      for (const cleanup of cleanups.splice(0).reverse()) cleanup();",
  },
  {
    name: "candidate web mount sends retained motion to reactive lowering",
    file: "candidate",
    search: ": platform.retained(target),",
    replacement: ": platform.reactive(target),",
  },
  {
    name: "candidate web presentation mount disposes twice",
    file: "candidate",
    search:
      "if (disposed) return;\n      disposed = true;\n      for (const cleanup of cleanups.reverse()) cleanup();",
    replacement: "disposed = true;\n      for (const cleanup of cleanups.reverse()) cleanup();",
  },
  {
    name: "candidate web presentation mount disposes in ownership order",
    file: "candidate",
    search:
      "targets,\n    dispose() {\n      if (disposed) return;\n      disposed = true;\n      for (const cleanup of cleanups.reverse()) cleanup();",
    replacement:
      "targets,\n    dispose() {\n      if (disposed) return;\n      disposed = true;\n      for (const cleanup of cleanups) cleanup();",
  },
  {
    name: "candidate web update accepts a changed native structure contract",
    file: "candidate",
    search:
      "previousInstruction.element !== nextInstruction.element ||\n      JSON.stringify(previousInstruction.content) !== JSON.stringify(nextInstruction.content) ||\n      JSON.stringify(previousInstruction.events) !== JSON.stringify(nextInstruction.events)",
    replacement: "false",
  },
  {
    name: "candidate web update rewrites unchanged attributes",
    file: "candidate",
    search: "if (Object.is(before, after)) continue;",
    replacement: "if (false) continue;",
  },
  {
    name: "candidate web update reports but does not apply an attribute",
    file: "candidate",
    search: "platform.attribute(node, name, after);",
    replacement: "void after;",
  },
  {
    name: "semantic control accepts an invalid form owner",
    search: 'if (form?.role !== "form") {',
    replacement: 'if (false && form?.role !== "form") {',
  },
  {
    name: "candidate structure accepts an incompatible native role",
    file: "candidate",
    search: "if (!candidateRoleAllowed(element, role)) {",
    replacement: "if (false && !candidateRoleAllowed(element, role)) {",
  },
  {
    name: "candidate structure loses semantic child ownership",
    file: "candidate",
    search: "...(children.length ? { children: children.map((child) => child.identity) } : {}),",
    replacement: "children: [],",
  },
  {
    name: "candidate structure drops authored text content",
    file: "candidate",
    search: "...(content.length ? { content } : {}),",
    replacement: "...{},",
  },
  {
    name: "candidate structure drops native focus defaults",
    file: "candidate",
    search: "props.focusable ?? candidateRoleFocusable(node.role),",
    replacement: "props.focusable ?? false,",
  },
  {
    name: "candidate structure returns an unevaluated reactive semantic value",
    file: "candidate",
    search: "return evaluateCandidateExpression(value as CandidateExpression<Value>, reads).value;",
    replacement: "return value as Value;",
  },
  {
    name: "candidate structure collection accepts duplicate domain keys",
    file: "candidate",
    search: "if (identities.has(itemKey)) {",
    replacement: "if (false && identities.has(itemKey)) {",
  },
  {
    name: "candidate structure collection substitutes positional identity",
    file: "candidate",
    search: "part({ ...props, role, key: itemKey } as never, ...children)",
    replacement: "part({ ...props, role, key: index } as never, ...children)",
  },
  {
    name: "candidate structure collection ignores the reactive active key",
    file: "candidate",
    search: "key: candidateExpressionNode(itemKey),",
    replacement: 'key: { kind: "literal", value: "missing" },',
  },
  {
    name: "candidate component boundary drops its semantic roots",
    file: "candidate",
    search: "for (const root of componentRoots) visit(root);",
    replacement: "void componentRoots;",
  },
  {
    name: "candidate structure silently ignores a forged component instance",
    file: "candidate",
    search:
      'throw new Error("Structure received a component instance not issued by its compiler.");',
    replacement: "return;",
  },
  {
    name: "candidate structure selection ignores its reactive value",
    file: "candidate",
    search: "const key = String(value);",
    replacement: "const key = Object.keys(selection.cases).sort()[0]!;",
  },
  {
    name: "candidate structure selection accepts an unknown runtime case",
    file: "candidate",
    search:
      'const entry = selection.cases[key];\n  if (!entry) throw new Error(`Structural selection has no case "${key}".`);\n  return { key, entry };',
    replacement:
      "const entry = selection.cases[key] ?? Object.values(selection.cases)[0]!;\n  return { key, entry };",
  },
  {
    name: "candidate structure selection leaks dormant semantic cases",
    file: "candidate",
    search:
      'visit(candidateSelectedStructureCase(child, reads).entry.content);\n      return;\n    }\n    if (typeof child === "object" && child !== null) {',
    replacement:
      'for (const entry of Object.values(child.cases)) visit(entry.content);\n      return;\n    }\n    if (typeof child === "object" && child !== null) {',
  },
  {
    name: "statechart command records pre-commit state",
    search: "state: this.#state,",
    replacement: "state: this.#definition.initial,",
  },
  {
    name: "statechart command drain repeats effects",
    search: "this.#commands = [];",
    replacement: "void 0;",
  },
  {
    name: "statechart accepts an empty command name",
    search: 'if (!command.name) throw new Error("Reference command name cannot be empty.");',
    replacement:
      'if (false && !command.name) throw new Error("Reference command name cannot be empty.");',
  },
  {
    name: "compound state accepts no initial child",
    search:
      'if (!initial) throw new Error(`Compound state "${owner}" needs an initial direct child.`);',
    replacement:
      'if (false && !initial) throw new Error(`Compound state "${owner}" needs an initial direct child.`);',
  },
  {
    name: "compound state accepts a non-child initial",
    search: "if (!children.includes(initial)) {",
    replacement: "if (false && !children.includes(initial)) {",
  },
  {
    name: "parallel state accepts an initial child",
    search: "} else if (initial !== undefined) {",
    replacement: "} else if (false && initial !== undefined) {",
  },
  {
    name: "final state accepts active behavior",
    search: 'kind === "final" &&',
    replacement: 'false && kind === "final" &&',
  },
  {
    name: "hierarchical transition accepts an unknown target",
    search: "if (!nodes.has(target)) {",
    replacement: "if (false && !nodes.has(target)) {",
  },
  {
    name: "compound regions accept simultaneous targets",
    search: 'referenceChartCommonOwnerKind(left, right, nodes, rootKind) !== "parallel"',
    replacement: "false",
  },
  {
    name: "candidate delayed string target is discarded",
    file: "candidate",
    search: 'if (typeof transition === "string") return { target: transition };',
    replacement: 'if (typeof transition === "string") return {};',
  },
  {
    name: "candidate statechart drops invoked task names",
    file: "candidate",
    search: "const name = String(invocation.run);",
    replacement: 'const name = "";',
  },
  {
    name: "candidate statechart drops root events tasks and delays",
    file: "candidate",
    search: "const root = candidateReferenceChartNode(definition);",
    replacement:
      "const root = { ...candidateReferenceChartNode(definition), on: undefined, tasks: undefined, after: undefined };",
  },
  {
    name: "parallel initial configuration enters one region",
    search:
      ".filter((node) => node.parent === undefined)\n          .flatMap((node) => enterReferenceChartNode(node.path, nodes))",
    replacement:
      ".filter((node) => node.parent === undefined)\n          .slice(0, 1)\n          .flatMap((node) => enterReferenceChartNode(node.path, nodes))",
  },
  {
    name: "hierarchical event lookup skips the active leaf",
    search: "let current: string | undefined = leaf;",
    replacement: "let current: string | undefined = nodes.get(leaf)?.parent;",
  },
  {
    name: "parallel transition discards unaffected regions",
    search: "const next = active.filter((leaf) =>",
    replacement: "const next: string[] = []; active.filter((leaf) =>",
  },
  {
    name: "statechart topology follows declaration insertion order",
    search: "for (const name of Object.keys(states).sort()) {",
    replacement: "for (const name of Object.keys(states)) {",
  },
  {
    name: "statechart guards are ignored",
    search:
      "(alternative) => alternative.guard === undefined || guards[alternative.guard] === true,",
    replacement: "() => true,",
  },
  {
    name: "root completion never settles",
    search: 'return [...completed, ...(rootComplete ? ["root"] : [])].sort();',
    replacement: "return [...completed].sort();",
  },
  {
    name: "delayed transition loses state ownership",
    search: "this.#timers.push({\n          owner,",
    replacement: 'this.#timers.push({\n          owner: "root",',
  },
  {
    name: "delay misses its exact deadline",
    search: ".filter((entry) => entry.due <= target)",
    replacement: ".filter((entry) => entry.due < target)",
  },
  {
    name: "candidate transition drops guard identity",
    file: "candidate",
    search: '...("allow" in record ? { guard } : {}),',
    replacement: "...{},",
  },
  {
    name: "candidate transition drops context update resolver",
    file: "candidate",
    search: '...("update" in record ? { update: `${guard}.update` } : {}),',
    replacement: "...{},",
  },
  {
    name: "candidate transition drops ordered command requests",
    file: "candidate",
    search: "...(commands.length ? { commands } : {}),",
    replacement: "...{},",
  },
  {
    name: "statechart accepts an unknown hierarchical command",
    search: "if (!declaredCommands.has(command.name)) {",
    replacement: "if (false && !declaredCommands.has(command.name)) {",
  },
  {
    name: "candidate gesture drops recognizer kind",
    file: "candidate",
    search: "recognizer: contribution.gesture.kind,",
    replacement: 'recognizer: "drag",',
  },
  {
    name: "candidate gesture intent accepts incomplete outcomes",
    file: "candidate",
    search:
      'if (outcomes.map((outcome) => outcome.outcome).join("\\0") !== semanticOutcomes.join("\\0")) {',
    replacement:
      'if (false && outcomes.map((outcome) => outcome.outcome).join("\\0") !== semanticOutcomes.join("\\0")) {',
  },
  {
    name: "candidate gesture intent skips arbitration graph validation",
    file: "candidate",
    search: "resolveReferenceGestureArbitration(\n      regionNames,\n      relations",
    replacement: "void (\n      regionNames,\n      relations",
  },
  {
    name: "candidate recognizer accepts missing accessible action",
    file: "candidate",
    search: 'else if (alternative.kind !== "action" || !declaredActions.has(alternative.action)) {',
    replacement:
      'else if (false && (alternative.kind !== "action" || !declaredActions.has(alternative.action))) {',
  },
  {
    name: "hover intent loses focus equivalence",
    file: "candidate",
    search: 'if (alternative.kind !== "focus") {',
    replacement: 'if (false && alternative.kind !== "focus") {',
  },
  {
    name: "hover intent accepts an unknown handoff destination",
    file: "candidate",
    search: "if (!declaredParts.has(handoff.destination) || handoff.destination === region) {",
    replacement:
      "if (false && (!declaredParts.has(handoff.destination) || handoff.destination === region)) {",
  },
  {
    name: "long press accepts a nonpositive duration",
    file: "candidate",
    search: 'duration.dimension !== "time" || duration.value <= 0',
    replacement: 'duration.dimension !== "time" || false',
  },
  {
    name: "direct manipulation drops its typed projection",
    file: "candidate",
    search: "value: { ...record, projection: contribution.projection },",
    replacement: "value: record,",
  },
  {
    name: "fixed recognizer accepts an inconsistent generated outcome contract",
    file: "candidate",
    search: 'if (declared.join("\\0") !== fixed.join("\\0")) {',
    replacement: 'if (false && declared.join("\\0") !== fixed.join("\\0")) {',
  },
  {
    name: "hover adapter loses immediate focus equivalence",
    file: "candidate",
    search: "const engaged = this.#focused || this.#intentActive;",
    replacement: "const engaged = this.#intentActive;",
  },
  {
    name: "hover adapter removes delayed leave",
    file: "candidate",
    search: "this.#time - this.#leaveAt >= this.#leaveDelay",
    replacement: "this.#time - this.#leaveAt >= 0",
  },
  {
    name: "hover adapter ignores its safe-polygon handoff",
    file: "candidate",
    search: 'if (path === "safe-polygon") {',
    replacement: 'if (false && path === "safe-polygon") {',
  },
  {
    name: "long-press adapter recognizes before duration",
    file: "candidate",
    search: "this.#time - this.#startedAt < this.#duration",
    replacement: "false",
  },
  {
    name: "long-press adapter ignores movement tolerance",
    file: "candidate",
    search: "if (distance <= this.#tolerance) return undefined;",
    replacement: "if (true) return undefined;",
  },
  {
    name: "web gesture recognizes before its activation threshold",
    file: "candidate",
    search: 'return distance >= threshold ? "eligible" : "possible";',
    replacement: 'return distance >= 0 ? "eligible" : "possible";',
  },
  {
    name: "web gesture ignores responsive unavailability",
    file: "candidate",
    search: 'intent.available && this.#available[intent.name] === false ? "failed" : "possible",',
    replacement: 'false ? "failed" : "possible",',
  },
  {
    name: "web gesture reverses explicit exclusive preference",
    file: "candidate",
    search: "eligible.delete(relation.second);",
    replacement: "eligible.delete(relation.first);",
  },
  {
    name: "web gesture skips failure dependency",
    file: "candidate",
    search: 'if (required.phase !== "failed") eligible.delete(relation.first);',
    replacement: 'if (false && required.phase !== "failed") eligible.delete(relation.first);',
  },
  {
    name: "web gesture computes multipointer velocity from a stale contact clock",
    file: "candidate",
    search: "const time = Math.max(...contacts.map((contact) => contact.time));",
    replacement: "const time = first.time;",
  },
  {
    name: "web gesture leaks pointer capture after termination",
    file: "candidate",
    search: "this.#captured.delete(pointer);",
    replacement: "void pointer;",
  },
  {
    name: "web gesture treats predicted samples as semantic confirmation",
    file: "candidate",
    search: "const confirmed = packet.coalesced?.length ? packet.coalesced : [packet.current];",
    replacement:
      "const confirmed = [...(packet.coalesced?.length ? packet.coalesced : [packet.current]), ...(packet.predicted ?? [])];",
  },
  {
    name: "web gesture steals movement from native scrolling",
    file: "candidate",
    search: 'if (!outward || !atBoundary) return "failed";',
    replacement: 'if (false && (!outward || !atBoundary)) return "failed";',
  },
  {
    name: "web gesture mount drops capture and release effects",
    file: "candidate",
    search: "for (const effect of result.effects) {",
    replacement: "for (const effect of []) {",
  },
  {
    name: "web gesture mount omits semantic touch-action ownership",
    file: "candidate",
    search: "cleanups.push(platform.touchAction(node, region.touchAction));",
    replacement: "void region.touchAction;",
  },
  {
    name: "web gesture mount disposes without cancelling an active recognizer",
    file: "candidate",
    search: "for (const current of active.values()) {",
    replacement: "for (const current of []) {",
  },
  {
    name: "candidate final output resolver is discarded",
    file: "candidate",
    search: "...(node.output ? { output: { resolver: `${owner}.output` } } : {}),",
    replacement: "...{},",
  },
  {
    name: "candidate always transition is discarded",
    file: "candidate",
    search:
      "...(node.always\n      ? { always: candidateReferenceChartTransition(node.always, `${owner}.always`) }\n      : {}),",
    replacement: "...{},",
  },
  {
    name: "hierarchical task accepts stale completion",
    search:
      "const active = this.#tasks.get(key);\n    if (!active || active.revision !== revision) return false;",
    replacement: "const active = this.#tasks.get(key);\n    if (!active) return false;",
  },
  {
    name: "hierarchical task survives state exit",
    search: "if (!nextOwners.has(task.owner)) this.#tasks.delete(key);",
    replacement: "if (false && !nextOwners.has(task.owner)) this.#tasks.delete(key);",
  },
  {
    name: "hierarchical task failure uses done transition",
    search: "selectReferenceChartAlternative(definition[outcome], guards)",
    replacement: "selectReferenceChartAlternative(definition.done, guards)",
  },
  {
    name: "candidate task result transitions are discarded",
    file: "candidate",
    search: "...(invocation.done\n                ? {",
    replacement: "...(false && invocation.done\n                ? {",
  },
  {
    name: "reference disjunction ignores its right operand",
    search:
      'return left ? true : expectReferenceBoolean(evaluate(current.right), "or right operand");',
    replacement: "return left;",
  },
  {
    name: "reference less comparison becomes less-or-equal",
    search: 'if (current.relation === "less") return left.value < right.value;',
    replacement: 'if (current.relation === "less") return left.value <= right.value;',
  },
  {
    name: "reference clamp ignores its upper bound",
    search: "value: Math.min(maximum.value, Math.max(minimum.value, value.value)),",
    replacement: "value: Math.max(minimum.value, value.value),",
  },
  {
    name: "reference clamp accepts reversed bounds",
    search:
      'if (minimum.value > maximum.value) throw new RangeError("Clamp bounds are reversed.");',
    replacement:
      'if (false && minimum.value > maximum.value) throw new RangeError("Clamp bounds are reversed.");',
  },
  {
    name: "candidate clamp ignores its upper bound",
    file: "candidate",
    search: "const clamped = Math.min(maximumNumber, Math.max(minimumNumber, valueNumber));",
    replacement: "const clamped = Math.max(minimumNumber, valueNumber);",
  },
  {
    name: "candidate structure drops semantic action bindings",
    file: "candidate",
    search: "...(actions.length ? { actions } : {}),",
    replacement: "...{},",
  },
  {
    name: "candidate structure accepts an unidentified callback",
    file: "candidate",
    search:
      'if (!identity) {\n      throw new Error(\n        `Semantic ${event} binding on "${node.identity}" was not issued by the compiler.`,\n      );\n    }',
    replacement: "if (!identity) return [];",
  },
  {
    name: "candidate compiler preserves author expression helpers",
    file: "candidate",
    search: "if (isCandidateExpression(value)) {",
    replacement: "if (false && isCandidateExpression(value)) {",
  },
  {
    name: "candidate compiler follows object insertion order",
    file: "candidate",
    search:
      "Object.entries(value)\n        .filter(([, entry]) => entry !== undefined)\n        .sort(([left], [right]) => left.localeCompare(right))",
    replacement: "Object.entries(value)\n        .filter(([, entry]) => entry !== undefined)",
  },
  {
    name: "candidate capability manifest drops semantic actions",
    file: "candidate",
    search:
      "for (const action of node.actions ?? []) capabilities.add(`semantic.action.${action.event}`);",
    replacement: "void node.actions;",
  },
  {
    name: "candidate capability validator ignores missing meaning",
    file: "candidate",
    search: "if (!supported.has(capability)) {",
    replacement: "if (false && !supported.has(capability)) {",
  },
  {
    name: "candidate capability manifest drops read expressions",
    file: "candidate",
    search: '      "literal",\n      "read",\n      "structure-reference",',
    replacement: '      "literal",\n      "structure-reference",',
  },
  {
    name: "hover intent ignores dwell time",
    search: "this.#time - this.#enteredAt >= this.#dwell &&",
    replacement: "true &&",
  },
  {
    name: "hover intent loses focus equivalence",
    search: "engaged: this.#focused || this.#intent,",
    replacement: "engaged: this.#intent,",
  },
  {
    name: "hover intent ignores delayed leave",
    search: "this.#time - this.#leaveAt >= this.#leaveDelay",
    replacement: "true",
  },
  {
    name: "long press ignores movement tolerance",
    search: "if (distance > this.#tolerance) {",
    replacement: "if (false && distance > this.#tolerance) {",
  },
  {
    name: "long press recognizes repeatedly",
    search: 'this.#phase = "recognized";\n    return "recognized";',
    replacement: 'void 0;\n    return "recognized";',
  },
];

const oracle = String.raw`
import { describe, expect, test } from "bun:test";
import {
  ReferenceAutoScrollSession,
  ReferenceMotionChannel,
  ReferencePresenceCoordinator,
  ReferenceOverlayStack,
  ReferenceOverlayCloseCascade,
  ReferenceStatechart,
  ReferenceChartRuntime,
  ReferenceGestureSession,
  ReferenceFocusRecoveryCoordinator,
  ReferenceHoverIntent,
  ReferenceLongPress,
  ReferenceMeasurementCoordinator,
  ReferenceVirtualLayoutRegistry,
  resolveReferenceAdjustableCommand,
  resolveReferenceAdjustableValue,
  interpolateReferenceOklch,
  interpolateReferenceMaterial,
  interpolateReferenceMediaFit,
  interpolateReferencePaint,
  interpolateReferenceRotation,
  interpolateReferenceShape,
  interpolateReferenceShadows,
  interpolateReferenceStroke,
  interpolateReferenceTypeStyle,
  interpolateReferenceTransform,
  resolveReferenceVisualTransitionBatch,
  evaluateReferenceExpression,
  normalizeReferenceChart,
  resolveReferenceComposition,
  resolveReferenceAutoScroll,
  resolveReferenceChartEvent,
  resolveReferenceChartInitial,
  resolveReferenceFocusIndicator,
  resolveReferenceHotReload,
  resolveReferenceGestureRelease,
  resolveReferenceRubberBand,
  resolveReferenceRovingFocus,
  resolveReferenceSharedIdentities,
  resolveReferenceStructureReconciliation,
  resolveReferenceGestureRebase,
  resolveReferenceScrollCompetition,
  resolveReferenceSnapSet,
  resolveReferenceLayoutProjection,
  resolveReferenceLayoutTransition,
  resolveReferencePathMorph,
  resolveReferenceTargets,
  resolveReferenceTransitionHandoff,
  resolveReferenceTransitionBatch,
  resolveReferenceTransitionUpdate,
  resolveReferenceTokens,
  targetReferencePresence,
  validateReferenceSemanticTree,
} from "./ui-language-reference.ts";
import {
  CandidateAdjustableAdapter,
  CandidateAutoScrollAdapter,
  CandidateMeasurementAdapter,
  CandidateOverlayCloseAdapter,
  addCandidate,
  andCandidate,
  clampCandidate,
  compileCandidateComponentArtifact,
  deriveCandidateArtifactCapabilities,
  deriveCandidateHotReloadDescriptor,
  arrangeCandidate,
  selectCandidateStructure,
  clipCandidate,
  constrainCandidateSize,
  CandidateWebGestureAdapter,
  CandidateHoverIntentAdapter,
  CandidateLongPressAdapter,
  createCandidateCollectionHandle,
  createCandidateDerivedTargetHandle,
  createCandidateRecognizerHandle,
  createCandidateLayer,
  createCandidatePresentationIdentity,
  createCandidateReadExpression,
  createCandidateTargetHandle,
  createCandidateTransitionPolicy,
  driveCandidate,
  evaluateCandidateExpression,
  equalCandidate,
  executeCandidateHotReload,
  flowCandidate,
  gridCandidate,
  hitTestCandidate,
  issueCandidateNativeLayerHandle,
  issueCandidateAction,
  issueCandidateParameterHandle,
  issueCandidateStructureComponentInstance,
  issueCandidateStructureCollection,
  issueCandidateStructurePart,
  interpolateCandidate,
  lowerCandidateLayoutToWebStyle,
  lowerCandidatePresentationToWeb,
  lowerCandidatePresentationToWebLayout,
  lowerCandidatePresentationSceneToWebStyle,
  lowerCandidatePresentationTargetToWebStyle,
  lowerCandidateStructureToWeb,
  lowerCandidateWebSceneToStyle,
  mountCandidatePresentationToWeb,
  mountCandidateReconciledStructureToWeb,
  mountCandidateGesturesToWeb,
  mountCandidateStructureToWeb,
  maskCandidate,
  matchCandidate,
  nativeLayerCandidate,
  normalizeCandidateDirectManipulation,
  normalizeCandidate,
  normalizeCandidateTransitionCompatibility,
  normalizeSemanticLayout,
  normalizeSemanticOperations,
  normalizeSemanticRelationships,
  normalizeCandidateParameters,
  normalizeCandidatePresence,
  normalizeCandidateStatechart,
  normalizeCandidateRecognizers,
  normalizeCandidateStructure,
  notCandidate,
  overlayCandidate,
  padCandidate,
  participateCandidate,
  anchorCandidate,
  placeCandidate,
  planCandidateStructureReconciliation,
  planCandidatePresenceCommands,
  scrollCandidate,
  settleCandidate,
  setCandidateParameter,
  retainCandidate,
  resolveCandidateHotReload,
  setCandidateTarget,
  stickCandidate,
  transitionCandidateTarget,
  virtualizeCandidate,
  validateCandidateDirectManipulationParameters,
  validateCandidateArtifactCapabilities,
  validateCandidateAutoScrollOwnership,
  validateCandidateAutoScrollParameters,
  updateCandidateStructureOnWeb,
} from "./candidate.ts";

type OracleChartApp = {
  Components: {
    Workflow: {
      States: "left" | "right" | "sync" | "sync.idle" | "sync.busy";
      Actions: { reset(): void };
      Context: { count: number };
      Commands: { announce: { Input: { message: string } } };
      Output: { done: boolean };
      Tasks: { sync: { Input: void; Output: void; Error: Error } };
      Parts: { Root: "div" };
    };
  };
  Styles: { Presets: "plain" };
};

type OracleGestureApp = {
  Components: {
    Canvas: {
      Actions: { move(): void; cancel(): void; commit(): void; zoom(): void; reset(): void };
      Recognizers: {
        drag: { Kind: "drag"; Outcomes: "cancel" | "commit" };
        pinch: { Kind: "pinch"; Outcomes: "reset" };
      };
      Parts: { Surface: "div" };
    };
  };
  Styles: { Presets: "plain" };
};

type OracleGestureCycleApp = {
  Components: {
    Canvas: {
      Actions: {
        move(): void;
        cancel(): void;
        commit(): void;
        zoom(): void;
        reset(): void;
        turn(): void;
        finish(): void;
      };
      Recognizers: {
        drag: { Kind: "drag"; Outcomes: "cancel" | "commit" };
        pinch: { Kind: "pinch"; Outcomes: "reset" };
        rotate: { Kind: "rotate"; Outcomes: "finish" };
      };
      Parts: { Surface: "div" };
    };
  };
  Styles: { Presets: "plain" };
};

type OracleInteractionApp = {
  Components: {
    Disclosure: {
      Actions: { open(): void; close(): void; keyboard(): void; cancel(): void };
      Recognizers: {
        preview: { Kind: "hoverIntent" };
        inspect: { Kind: "longPress" };
      };
      Parts: { Trigger: "button"; Panel: "div" };
    };
  };
  Styles: { Presets: "plain" };
};

describe("mutation oracle", () => {
  test("tokens", () => {
    expect(Object.keys(resolveReferenceTokens({
      b: { type: "length", value: 2 },
      a: { type: "length", value: 1 },
    }))).toEqual(["a", "b"]);
    expect(() => resolveReferenceTokens({
      a: { type: "length", value: { alias: "b" } },
      b: { type: "length", value: { alias: "a" } },
    })).toThrow("Token alias cycle");
    expect(() => resolveReferenceTokens({
      color: { type: "color", value: "black" },
      length: { type: "length", value: { alias: "color" } },
    })).toThrow("aliases");
  });

  test("ownership and composition", () => {
    expect(() => resolveReferenceTargets([
      { identity: "x", property: "opacity", source: "a", value: 1 },
      { identity: "x", property: "opacity", source: "b", value: 0 },
    ])).toThrow("owned by both");
    expect(() => resolveReferenceComposition(
      [{ identity: "a", documentOrder: 0 }, { identity: "b", documentOrder: 1 }],
      [{ below: "a", above: "b" }, { below: "b", above: "a" }],
    )).toThrow("Composition cycle");
    expect(() => resolveReferenceComposition(
      [{ identity: "a", documentOrder: 0 }, { identity: "a", documentOrder: 1 }],
      [],
    )).toThrow("Duplicate composition identity");
  });

  test("motion lifecycle", () => {
    const channel = new ReferenceMotionChannel("x", "owner", 0);
    channel.direct(2, 5);
    const first = channel.target(10, "spring");
    expect(first.velocity).toBe(5);
    channel.sample(first.revision, 4, 3);
    const second = channel.target(20, "spring");
    expect(second.velocity).toBe(3);
    expect(channel.settle(first.revision)).toBe(false);
    channel.cancel();
    expect(channel.outcome(second.revision)).toBe("cancelled");
  });

  test("presence and gesture direction", () => {
    expect(targetReferencePresence("exiting", true)).toBe("entering");
    expect(resolveReferenceGestureRelease({
      progress: 2,
      velocity: -10,
      direction: "positive",
      distanceThreshold: 0.5,
      velocityThreshold: 2,
    }).committed).toBe(false);
  });

  test("statechart command lifecycle", () => {
    const machine = new ReferenceStatechart({
      initial: "list",
      states: {
        list: {
          on: {
            open: {
              target: "detail",
              commands: [{ name: "navigate", value: { id: "one" } }],
            },
            invalid: { target: "detail", commands: [{ name: "" }] },
          },
        },
        detail: { on: { close: "list" } },
      },
    });
    expect(machine.send("open")).toBe(true);
    expect(machine.send("close")).toBe(true);
    expect(machine.drainCommands()).toEqual([{
      revision: 1,
      index: 0,
      state: "detail",
      name: "navigate",
      value: { id: "one" },
    }]);
    expect(machine.drainCommands()).toEqual([]);
    expect(() => machine.send("invalid")).toThrow("command name cannot be empty");
    expect(machine.state).toBe("list");
  });

  test("hierarchical and parallel statechart topology", () => {
    const candidate = normalizeCandidateStatechart<OracleChartApp, "Workflow">(
      {
        type: "parallel",
        on: { reset: { target: ["left", "right"] } },
        task: { run: "sync", input: () => undefined },
        after: { wait: 20, transition: "sync.idle" },
        states: {
          left: {
            always: { allow: () => false, target: "right" },
            on: {
              reset: [
                {
                  allow: () => false,
                  target: ["left", "right"],
                  update: ({ context }) => ({ count: context.count + 1 }),
                  commands: {
                    run: "announce",
                    input: () => ({ message: "reset" }),
                  },
                },
                { target: ["left", "right"] },
              ],
            },
          },
          right: { type: "final", output: () => ({ done: true }) },
          sync: {
            initial: "sync.idle",
            states: {
              idle: {},
              busy: {
                task: {
                  run: "sync",
                  input: () => undefined,
                  done: "sync.idle",
                  fail: "sync.idle",
                },
                after: { wait: 10, transition: "sync.idle" },
              },
            },
          },
        },
      },
      ["sync"],
      ["announce"],
    );
    expect(candidate.nodes.find((node) => node.path === "sync.busy")).toMatchObject({
      tasks: ["sync"],
      delays: [{ wait: 10, targets: ["sync.idle"] }],
    });
    expect(candidate).toMatchObject({
      tasks: ["sync"],
      events: [{ event: "reset", alternatives: [{ targets: ["left", "right"] }] }],
      delays: [{ wait: 20, targets: ["sync.idle"] }],
    });
    expect(candidate.nodes.find((node) => node.path === "left")?.events).toEqual([{
      event: "reset",
      alternatives: [
        {
          guard: "left.on.reset.0",
          targets: ["left", "right"],
          update: "left.on.reset.0.update",
          commands: [
            { name: "announce", input: "left.on.reset.0.command.0.input" },
          ],
        },
        { targets: ["left", "right"] },
      ],
    }]);
    expect(candidate.nodes.find((node) => node.path === "left")?.always).toEqual([
      { guard: "left.always.0", targets: ["right"] },
    ]);
    expect(candidate.nodes.find((node) => node.path === "sync.busy")?.taskResults).toEqual([
      {
        task: "sync",
        done: [{ targets: ["sync.idle"] }],
        fail: [{ targets: ["sync.idle"] }],
      },
    ]);
    expect(candidate.nodes.find((node) => node.path === "right")?.output).toEqual({
      resolver: "right.output",
    });

    expect(() => normalizeReferenceChart({ states: { idle: {} } })).toThrow("needs an initial");
    expect(() => normalizeReferenceChart({
      initial: "panel",
      states: { panel: { initial: "idle", states: { idle: {} } } },
    })).toThrow("not a direct child");
    expect(() => normalizeReferenceChart({
      type: "parallel",
      initial: "left",
      states: { left: {}, right: {} },
    })).toThrow("cannot declare an initial");
    expect(() => normalizeReferenceChart({
      initial: "done",
      states: { done: { type: "final", on: { retry: "done" } } },
    })).toThrow("cannot own events");
    expect(() => normalizeReferenceChart({
      initial: "idle",
      states: { idle: { on: { open: "missing" } } },
    })).toThrow("unknown state");
    expect(() => normalizeReferenceChart({
      initial: "left",
      states: {
        left: { on: { reset: { target: ["left", "right"] } } },
        right: {},
      },
    })).toThrow("non-orthogonal targets");

    const trace = normalizeReferenceChart({
      type: "parallel",
      states: {
        workspace: {
          initial: "workspace.list",
          states: {
            list: { on: { open: "workspace.detail" } },
            detail: {},
          },
        },
        sync: {
          initial: "sync.idle",
          states: {
            idle: { on: { start: "sync.busy" } },
            busy: {},
          },
        },
      },
    });
    const initial = resolveReferenceChartInitial(trace);
    expect(initial).toEqual(["sync.idle", "workspace.list"]);
    const detail = resolveReferenceChartEvent(trace, initial, "open");
    expect(detail).toEqual(["sync.idle", "workspace.detail"]);
    expect(resolveReferenceChartEvent(trace, detail, "start")).toEqual([
      "sync.busy",
      "workspace.detail",
    ]);
    const ordered = normalizeReferenceChart({
      type: "parallel",
      states: { zeta: {}, alpha: {}, middle: {} },
    });
    expect(ordered.nodes.map((node) => node.path)).toEqual(["alpha", "middle", "zeta"]);
  });

  test("guarded completion and virtual clock semantics", () => {
    const guarded = normalizeReferenceChart({
      initial: "idle",
      states: {
        idle: {
          on: {
            submit: [
              { guard: "allowed", target: "accepted" },
              "denied",
            ],
          },
        },
        accepted: {},
        denied: {},
      },
    });
    expect(resolveReferenceChartEvent(
      guarded,
      resolveReferenceChartInitial(guarded),
      "submit",
    )).toEqual(["denied"]);
    expect(() => normalizeReferenceChart({
      initial: "idle",
      states: {
        idle: { on: { submit: { target: "done", commands: [{ name: "missing" }] } } },
        done: {},
      },
    })).toThrow("unknown command");

    const routed = new ReferenceChartRuntime(normalizeReferenceChart({
      initial: "routing",
      states: {
        routing: { always: "ready" },
        ready: {},
      },
    }));
    expect(routed.snapshot.active).toEqual(["ready"]);

    const completion = new ReferenceChartRuntime(normalizeReferenceChart({
      initial: "flow",
      states: {
        flow: {
          initial: "flow.editing",
          done: "success",
          states: {
            editing: { on: { finish: "flow.done" } },
            done: { type: "final", output: "nested" },
          },
        },
        success: { type: "final", output: "root" },
      },
    }));
    completion.send("finish");
    expect(completion.snapshot.complete).toBe(true);
    expect(completion.drainOutputs()).toEqual([
      { state: "flow.done", value: "nested" },
      { state: "success", value: "root" },
    ]);

    const delayed = normalizeReferenceChart({
      initial: "waiting",
      states: {
        waiting: {
          on: { cancel: "cancelled" },
          after: [{ wait: 10, target: "expired" }],
        },
        cancelled: {},
        expired: {},
      },
    });
    const cancelled = new ReferenceChartRuntime(delayed);
    cancelled.send("cancel");
    cancelled.advance(10);
    expect(cancelled.snapshot.active).toEqual(["cancelled"]);
    const expired = new ReferenceChartRuntime(delayed);
    expired.advance(10);
    expect(expired.snapshot.active).toEqual(["expired"]);

    const taskRuntime = new ReferenceChartRuntime(normalizeReferenceChart({
      initial: "idle",
      states: {
        idle: { on: { start: "saving" } },
        saving: {
          on: { cancel: "idle" },
          tasks: [{ task: "save", done: "saved", fail: "failed" }],
        },
        saved: {},
        failed: {},
      },
    }, new Set(["save"])));
    taskRuntime.send("start");
    const stale = taskRuntime.activeTasks[0]!;
    taskRuntime.send("cancel");
    expect(taskRuntime.completeTask("saving", "save", stale.revision, "done")).toBe(false);
    taskRuntime.send("start");
    const current = taskRuntime.activeTasks[0]!;
    expect(taskRuntime.completeTask("saving", "save", stale.revision, "done")).toBe(false);
    expect(taskRuntime.completeTask("saving", "save", current.revision, "fail")).toBe(true);
    expect(taskRuntime.snapshot.active).toEqual(["failed"]);
  });

  test("multi-target presence reversal and release", () => {
    const presence = new ReferencePresenceCoordinator("content");
    const targets = ["content:opacity", "content:transform"];
    const enter = presence.target(true, targets);
    expect(presence.settle(enter, targets[0])).toBe(false);
    expect(presence.settle(enter, targets[1])).toBe(true);
    const exit = presence.target(false, targets);
    expect(presence.snapshot.interactive).toBe(false);
    const reversal = presence.target(true, targets);
    expect(presence.settle(exit, targets[0])).toBe(false);
    expect(presence.snapshot.pending).toEqual([...targets].sort());
    expect(presence.settle(reversal, targets[0])).toBe(false);
    expect(presence.snapshot.mounted).toBe(true);
    expect(presence.settle(reversal, targets[1])).toBe(true);
  });

  test("gesture capture lifecycle", () => {
    const gesture = new ReferenceGestureSession();
    const first = gesture.begin(1);
    expect(gesture.sample(first, 1, 10, 20)).toBe(true);
    expect(gesture.end(first, "commit")).toBe(true);
    expect(gesture.snapshot.captured).toBe(false);
    const second = gesture.begin(2);
    expect(gesture.sample(first, 2, 100, 200)).toBe(false);
    expect(gesture.sample(second, 2, 20, 30)).toBe(true);

    const target = createCandidateTargetHandle("gesture", "value");
    const recognizer = createCandidateRecognizerHandle("gesture", "drag");
    expect(normalizeCandidateDirectManipulation([
      driveCandidate(target, recognizer, recognizer.translation.block),
    ]).lifecycle.stale)
      .toBe("ignore");
  });

  test("interaction intent timing and cancellation", () => {
    const hover = new ReferenceHoverIntent({
      dwell: 100,
      maximumSpeed: 80,
      leaveDelay: 50,
    });
    hover.enter(0, 0, 0);
    hover.advance(50);
    expect(hover.snapshot.intent).toBe(false);
    hover.advance(100);
    expect(hover.snapshot.intent).toBe(true);
    hover.leave(110);
    hover.advance(130);
    expect(hover.snapshot.intent).toBe(true);
    hover.advance(160);
    expect(hover.snapshot.intent).toBe(false);
    hover.focus(170);
    expect(hover.snapshot.engaged).toBe(true);

    expect(() => new ReferenceLongPress({
      duration: 0,
      movementTolerance: 8,
    })).toThrow("duration must be positive");
    const press = new ReferenceLongPress({ duration: 100, movementTolerance: 8 });
    const first = press.down(1, 0, 0, 0);
    expect(press.advance(100)).toBe("recognized");
    expect(press.advance(110)).toBeUndefined();
    expect(press.up(first, 1, 120)).toBe("commit");
    const second = press.down(2, 130, 0, 0);
    expect(press.move(second, 2, 140, 9, 0)).toBe(true);
    expect(press.snapshot.phase).toBe("failed");
    expect(press.advance(300)).toBeUndefined();
  });

  test("gesture resistance and snap semantics", () => {
    expect(resolveReferenceRubberBand({
      value: 120,
      minimum: 0,
      maximum: 100,
      extent: 400,
      coefficient: 0.5,
    })).toBeLessThan(120);
    expect(resolveReferenceSnapSet({
      value: 40,
      velocity: 300,
      projectionSeconds: 0.2,
      points: [
        { outcome: "closed", value: 0 },
        { outcome: "half", value: 50 },
        { outcome: "open", value: 100 },
      ],
    }).outcome).toBe("open");
    expect(resolveReferenceSnapSet({
      value: 75,
      velocity: 0,
      projectionSeconds: 0.2,
      points: [
        { outcome: "open", value: 100 },
        { outcome: "half", value: 50 },
      ],
    }).outcome).toBe("half");
  });

  test("gesture environment and nested scroll handoff", () => {
    expect(resolveReferenceGestureRebase({
      value: 200,
      velocity: 400,
      previousExtent: 800,
      nextExtent: 600,
      available: true,
    })).toEqual({ strategy: "rebase", value: 150, velocity: 300 });
    expect(resolveReferenceGestureRebase({
      value: 200,
      velocity: 400,
      previousExtent: 800,
      nextExtent: 600,
      available: false,
    })).toEqual({ strategy: "cancel" });
    expect(resolveReferenceScrollCompetition({
      boundary: "start",
      position: 0,
      minimum: 0,
      maximum: 500,
      movement: "inward",
    })).toBe("scroll");
  });

  test("edge auto-scroll normalization and differential", () => {
    const contract = { reorder: { kind: "drag", outcomes: ["cancelled", "dropped"] } };
    const definition = {
      reorder: {
        region: "Item",
        activation: { axis: "block", threshold: { dimension: "length", value: 4 } },
        autoScroll: {
          owner: "Viewport",
          edgeFraction: "edge",
          maximumViewportPerSecond: "speed",
        },
        outcomes: {
          cancelled: { action: "cancel" },
          dropped: { action: "drop" },
        },
        alternative: { kind: "action", action: "keyboard" },
      },
    };
    const scene = normalizeCandidateRecognizers(
      "List",
      definition,
      contract,
      new Set(["Item", "Viewport"]),
      new Set(["cancel", "drop", "keyboard"]),
      new Set(["edge", "speed"]),
    );
    expect(scene.intents[0].autoScroll).toEqual({
      owner: "Viewport",
      edgeFraction: "edge",
      maximumViewportPerSecond: "speed",
    });
    expect(() => normalizeCandidateRecognizers(
      "List",
      definition,
      contract,
      new Set(["Item", "Viewport"]),
      new Set(["cancel", "drop", "keyboard"]),
    )).toThrow("unknown auto-scroll parameter");
    expect(() => validateCandidateAutoScrollOwnership(scene, { scrolls: [] }))
      .toThrow("is not a scroll container");
    validateCandidateAutoScrollOwnership(scene, {
      scrolls: [{ container: "Viewport", content: "Content", axis: "block" }],
    });
    expect(() => validateCandidateAutoScrollParameters(scene, { edge: 0.6, speed: 2.5 }))
      .toThrow("no more than one half");

    const adapter = new CandidateAutoScrollAdapter(scene.intents[0].autoScroll, {
      edge: 0.2,
      speed: 2.5,
    });
    const first = adapter.start();
    const revision = adapter.start();
    const frame = {
      pointer: 360,
      viewportStart: 0,
      viewportEnd: 400,
      seconds: 0.016,
      position: 500,
      minimum: 0,
      maximum: 1_000,
    };
    expect(adapter.step(first, frame)).toBeUndefined();
    expect(adapter.step(revision, frame)).toEqual(resolveReferenceAutoScroll({
      ...frame,
      edgeExtent: 80,
      maximumSpeed: 1_000,
    }));
    expect(adapter.step(revision, { ...frame, pointer: 500, position: 1_000 })).toMatchObject({
      requestedVelocity: 1_000,
      velocity: 0,
      delta: 0,
      gestureRebase: 0,
    });
    const reference = new ReferenceAutoScrollSession();
    const stale = reference.start();
    const current = reference.start();
    expect(reference.step(stale, {
      ...frame,
      edgeExtent: 80,
      maximumSpeed: 1_000,
    })).toBeUndefined();
    expect(reference.step(current, {
      ...frame,
      edgeExtent: 80,
      maximumSpeed: 1_000,
    })?.gestureRebase).toBe(4);
    expect(resolveReferenceAutoScroll({
      ...frame,
      pointer: 500,
      position: 1_000,
      edgeExtent: 80,
      maximumSpeed: 1_000,
    })).toMatchObject({ requestedVelocity: 1_000, velocity: 0, delta: 0, gestureRebase: 0 });
  });

  test("semantic accessibility ownership", () => {
    expect(() => validateReferenceSemanticTree([
      { identity: "action", role: "button" },
    ], { root: "action" })).toThrow("has no accessible name");
    expect(() => validateReferenceSemanticTree([
      { identity: "root", role: "generic", children: ["first", "second"] },
      { identity: "first", role: "dialog", name: "First", modal: true },
      { identity: "second", role: "dialog", name: "Second", modal: true },
    ], {
      root: "root",
      activeModal: { identity: "first", initialFocus: "first", returnFocus: "root" },
    })).toThrow("multiple active modals");
    const modalNodes = [
      { identity: "root", role: "generic", children: ["trigger", "dialog"] },
      {
        identity: "trigger",
        role: "button",
        name: "Open",
        focusable: true,
        controls: "dialog",
      },
      {
        identity: "dialog",
        role: "dialog",
        name: "Dialog",
        modal: true,
        children: ["close"],
      },
      { identity: "close", role: "button", name: "Close", focusable: true },
    ];
    expect(() => validateReferenceSemanticTree(modalNodes, {
      root: "root",
      activeModal: { identity: "dialog", initialFocus: "trigger", returnFocus: "trigger" },
    })).toThrow("invalid initial focus");
    expect(() => validateReferenceSemanticTree(
      modalNodes.map((node) =>
        node.identity === "trigger" ? { ...node, controls: undefined } : node
      ),
      {
        root: "root",
        activeModal: { identity: "dialog", initialFocus: "close", returnFocus: "trigger" },
      },
    )).toThrow("invalid return focus");
    expect(resolveReferenceFocusIndicator({
      focusVisible: true,
      forcedColors: true,
      custom: { visible: true, forcedColorsVisible: false },
    })).toEqual({ kind: "native" });
  });

  test("composite accessibility semantics", () => {
    const roving = resolveReferenceRovingFocus([
      { identity: "first" },
      { identity: "disabled", disabled: true },
      { identity: "last" },
    ], "first", "next");
    expect(roving.active).toBe("last");
    expect(Object.values(roving.tabStops).filter((value) => value === 0)).toHaveLength(1);
    expect(() => validateReferenceSemanticTree([
      { identity: "root", role: "generic", children: ["list", "outside"] },
      {
        identity: "list",
        role: "listbox",
        name: "Commands",
        focusable: true,
        activeDescendant: "outside",
      },
      { identity: "outside", role: "option" },
    ], { root: "root" })).toThrow();
    expect(() => validateReferenceSemanticTree([
      { identity: "list", role: "listbox", name: "Commands", focusable: true, activeDescendant: "cell", children: ["cell"] },
      { identity: "cell", role: "gridcell" },
    ], { root: "list" })).toThrow("incompatible");
    expect(() => validateReferenceSemanticTree([
      { identity: "root", role: "generic", children: ["control"] },
      { identity: "control", role: "textbox", name: "Query", formOwner: "root" },
    ], { root: "root" })).toThrow("invalid form");
  });

  test("responsive structural focus recovery", () => {
    const Root = issueCandidateStructurePart("Navigation", "Root", "nav");
    const Wide = issueCandidateStructurePart("Navigation", "Wide", "button");
    const Compact = issueCandidateStructurePart("Navigation", "Compact", "button");
    const Group = issueCandidateStructurePart("Navigation", "Group", "div");
    const wide = Wide({ name: "Current section", activate: issueCandidateAction("wide") });
    const compact = Compact({ name: "Open navigation", activate: issueCandidateAction("compact") });
    const responsive = Root({}, selectCandidateStructure(
      createCandidateReadExpression("navigation.wide"),
      {
        true: { content: wide, focus: wide.reference },
        false: { content: compact, focus: compact.reference },
      },
    ));
    const compactScene = normalizeCandidateStructure(responsive, {
      reads: { "navigation.wide": false },
    });
    expect(compactScene.focusRecovery).toEqual([{
      selection: "Navigation.Compact / Navigation.Wide",
      departing: ["Navigation.Wide"],
      destination: "Navigation.Compact",
    }]);
    const invalidBranch = Root({}, selectCandidateStructure(
      createCandidateReadExpression("navigation.wide"),
      {
        true: { content: wide, focus: compact.reference },
        false: { content: compact, focus: wide.reference },
      },
    ));
    expect(() => normalizeCandidateStructure(invalidBranch, {
      reads: { "navigation.wide": true },
    })).toThrow("outside case");
    const invalidDormantBranch = Root({}, selectCandidateStructure(
      createCandidateReadExpression("navigation.wide"),
      {
        true: { content: wide, focus: compact.reference },
        false: { content: compact, focus: compact.reference },
      },
    ));
    expect(() => normalizeCandidateStructure(invalidDormantBranch, {
      reads: { "navigation.wide": false },
    })).toThrow("outside case");
    const group = Group({ role: "group", name: "Navigation group" });
    const nonfocusable = Root({}, selectCandidateStructure(
      createCandidateReadExpression("navigation.wide"),
      {
        true: { content: group, focus: group.reference },
        false: { content: compact, focus: compact.reference },
      },
    ));
    expect(() => normalizeCandidateStructure(nonfocusable, {
      reads: { "navigation.wide": true },
    })).toThrow("is not available");

    const focus = new ReferenceFocusRecoveryCoordinator("Navigation.Wide");
    focus.replace([{ identity: "Navigation.Wide", focusable: true }], "Navigation.Wide");
    const stale = focus.capture();
    expect(focus.replace([{ identity: "Navigation.Compact", focusable: true }], "Navigation.Compact"))
      .toMatchObject({ focused: "Navigation.Compact", strategy: "replace" });
    expect(focus.returnFocus(stale, "Navigation.Wide", [
      { identity: "Navigation.Wide", focusable: true },
    ])).toBe(false);
    const missingFocus = new ReferenceFocusRecoveryCoordinator("removed");
    expect(() => missingFocus.replace(
      [{ identity: "Navigation.Compact", focusable: true }],
      "missing",
    )).toThrow("is not available");
  });

  test("exhaustive multi-view structural selection", () => {
    const Root = issueCandidateStructurePart("Family", "Root", "main");
    const Default = issueCandidateStructurePart("Family", "DefaultAction", "button");
    const Key = issueCandidateStructurePart("Family", "KeyAction", "button");
    const Phrase = issueCandidateStructurePart("Family", "PhraseAction", "button");
    const Remove = issueCandidateStructurePart("Family", "RemoveAction", "button");
    const action = (Part, name) =>
      Part({ name, activate: issueCandidateAction("Family." + name) }, name);
    const views = {
      default: action(Default, "Default"),
      key: action(Key, "Key"),
      phrase: action(Phrase, "Phrase"),
      remove: action(Remove, "Remove"),
    };
    const cases = {
      default: { content: views.default, focus: views.default.reference },
      key: { content: views.key, focus: views.key.reference },
      phrase: { content: views.phrase, focus: views.phrase.reference },
      remove: { content: views.remove, focus: views.remove.reference },
    };
    const hierarchy = Root(
      {},
      selectCandidateStructure(createCandidateReadExpression("family.view"), cases),
    );
    const phrase = normalizeCandidateStructure(hierarchy, {
      reads: { "family.view": "phrase" },
    });
    expect(phrase.nodes.map((node) => node.identity)).toEqual([
      "Family.Root",
      "Family.PhraseAction",
    ]);
    expect(phrase.focusRecovery).toEqual([{
      selection:
        "Family.DefaultAction / Family.KeyAction / Family.PhraseAction / Family.RemoveAction",
      departing: ["Family.DefaultAction", "Family.KeyAction", "Family.RemoveAction"],
      destination: "Family.PhraseAction",
    }]);
    expect(() => normalizeCandidateStructure(hierarchy, {
      reads: { "family.view": "unknown" },
    })).toThrow('has no case "unknown"');

    const partial = Root(
      {},
      selectCandidateStructure(createCandidateReadExpression("family.partial"), {
        true: { content: views.default, focus: views.default.reference },
        false: { content: views.remove },
      }),
    );
    expect(() => normalizeCandidateStructure(partial, {
      reads: { "family.partial": true },
    })).toThrow("focus for every case or no case");
  });

  test("adjustable semantics share bounds, quantization, and commands across every source", () => {
    const range = { minimum: -1, maximum: 1, step: 0.1, largeStep: 0.5 };
    const candidate = new CandidateAdjustableAdapter(range);
    for (const source of ["pointer", "keyboard", "programmatic"] as const) {
      expect(candidate.resolve(0, 0.26, source)).toEqual(
        resolveReferenceAdjustableValue(0, 0.26, range, source),
      );
      expect(candidate.resolve(0, 7, source).value).toBe(1);
    }
    expect(candidate.command(0.3, "largeDecrement")).toEqual(
      resolveReferenceAdjustableCommand(0.3, "largeDecrement", range),
    );
    expect(candidate.command(0.3, "largeDecrement").value).toBe(-0.2);
    const unevenRange = { minimum: 0, maximum: 1, step: 0.8, largeStep: 0.8 };
    expect(new CandidateAdjustableAdapter(unevenRange).command(0, "maximum").value).toBe(1);
    expect(resolveReferenceAdjustableCommand(0, "maximum", unevenRange).value).toBe(1);
    expect(() =>
      resolveReferenceAdjustableValue(0, 0, {
        minimum: 1,
        maximum: 0,
        step: 0.1,
        largeStep: 0.5,
      }, "pointer"),
    ).toThrow("ascending bounds");
    expect(() =>
      new CandidateAdjustableAdapter({ minimum: 1, maximum: 0, step: 0.1, largeStep: 0.5 }),
    ).toThrow("ascending bounds");

    const Slider = issueCandidateStructurePart("Mixer", "Volume", "input");
    const normalized = normalizeCandidateStructure(Slider({
      role: "slider",
      name: "Volume",
      value: 0.3,
      minimum: -1,
      maximum: 1,
      step: 0.1,
      largeStep: 0.5,
      change: issueCandidateAction("Mixer.changeVolume"),
    }));
    expect(normalized.nodes[0]).toMatchObject({
      value: 0.3,
      minimum: -1,
      maximum: 1,
      step: 0.1,
      largeStep: 0.5,
    });
  });

  test("candidate structure preserves typed semantic meaning", () => {
    const Results = issueCandidateStructurePart("Search", "Results", "div");
    const Result = issueCandidateStructurePart("Search", "Result", "div");
    const Field = issueCandidateStructurePart("Search", "Field", "input");
    const results = issueCandidateStructureCollection<
      { readonly id: string; readonly label: string },
      "id",
      "Result",
      "div",
      "option"
    >("Search.results", "id", Result, "option");
    const renderResults = (items: readonly { readonly id: string; readonly label: string }[]) =>
      results.render(items, (item, _index, Item) =>
        Item({ name: item.label }),
      );
    const option = renderResults([{ id: "one", label: "One" }])[0]!;
    const listbox = Results(
      {
        role: "listbox",
        name: "Results",
        activeDescendant: results.reference(createCandidateReadExpression("search.active")),
      },
      option,
    );
    const field = Field({
      name: "Query",
      value: "",
      change: issueCandidateAction("Search.change"),
      invalid: createCandidateReadExpression("search.invalid"),
    });
    const normalized = normalizeCandidateStructure([listbox, field], {
      rootIdentity: "Search.Scene",
      reads: { "search.invalid": true, "search.active": "one" },
    });
    expect(normalized.nodes.find((node) => node.identity === "Search.Field")?.invalid).toBe(true);
    expect(normalized.scene.parent["Search.Result:one"]).toBe("Search.Results");
    expect(() => renderResults([
      { id: "same", label: "One" },
      { id: "same", label: "Two" },
    ])).toThrow("duplicate key");

    const Trigger = issueCandidateStructurePart("Search", "Trigger", "button");
    const unsafeTrigger = Trigger as unknown as (
      props: Readonly<Record<string, unknown>>,
    ) => unknown;
    expect(() => unsafeTrigger({ role: "option", name: "Forged" })).toThrow(
      'Element "button" cannot have semantic role "option".',
    );

    const Page = issueCandidateStructurePart("Page", "Root", "main");
    const Child = issueCandidateStructurePart("Page.child", "Root", "article");
    const child = issueCandidateStructureComponentInstance(
      "Child",
      "one",
      Child({ name: "Child" }),
    );
    expect(normalizeCandidateStructure(Page({}, child)).scene.parent["Page.child.Root"])
      .toBe("Page.Root");
    expect(() => normalizeCandidateStructure(
      Page({}, { component: "Child", key: "forged" } as never),
    )).toThrow("not issued by its compiler");

    const ChoiceRoot = issueCandidateStructurePart("Choice", "Root", "section");
    const Wide = issueCandidateStructurePart("Choice", "Wide", "div");
    const Compact = issueCandidateStructurePart("Choice", "Compact", "div");
    const choice = ChoiceRoot(
      {},
      selectCandidateStructure(createCandidateReadExpression("choice.wide"), {
        true: { content: Wide({ role: "group", name: "Wide" }) },
        false: { content: Compact({ role: "group", name: "Compact" }) },
      }),
    );
    expect(normalizeCandidateStructure(choice, { reads: { "choice.wide": false } }).nodes
      .map((node) => node.identity)).toEqual(["Choice.Root", "Choice.Compact"]);
    expect(normalizeCandidateStructure(choice, { reads: { "choice.wide": true } }).nodes
      .map((node) => node.identity)).toEqual(["Choice.Root", "Choice.Wide"]);
  });

  test("image semantics preserve source and explicit alternative intent", () => {
    const Root = issueCandidateStructurePart("Profile", "Root", "main");
    const Portrait = issueCandidateStructurePart("Profile", "Portrait", "img");
    const Texture = issueCandidateStructurePart("Profile", "Texture", "img");
    const structure = normalizeCandidateStructure(Root({},
      Portrait({ source: "/portrait.webp", alternative: "Profile portrait" }),
      Texture({ source: "/texture.webp", alternative: { kind: "decorative" } }),
    ));
    expect(structure.nodes.find((node) => node.identity === "Profile.Portrait")).toMatchObject({
      source: "/portrait.webp",
      name: "Profile portrait",
    });
    expect(lowerCandidateStructureToWeb(structure)
      .find((node) => node.identity === "Profile.Texture")?.attributes).toMatchObject({
        src: "/texture.webp",
        alt: "",
        "aria-hidden": true,
      });
    expect(() => validateReferenceSemanticTree([
      { identity: "broken", role: "image", source: "", name: "Broken" },
    ], { root: "broken" })).toThrow("needs a source");
  });

  test("structural reconciliation retains only removed roots and preserves contracts", () => {
    const previousNodes = [
      { identity: "root", platformKind: "main", role: "generic", children: ["common", "old"] },
      { identity: "common", platformKind: "p", role: "generic" },
      { identity: "old", platformKind: "section", role: "group", children: ["old-action"] },
      {
        identity: "old-action",
        platformKind: "button",
        role: "button",
        name: "Open",
        actions: [{ event: "activate", action: "open" }],
      },
    ];
    const nextNodes = [
      { identity: "root", platformKind: "main", role: "generic", children: ["common", "next"] },
      { identity: "common", platformKind: "p", role: "generic" },
      { identity: "next", platformKind: "section", role: "group" },
    ];
    const previous = {
      nodes: previousNodes,
      scene: {
        order: previousNodes.map((node) => node.identity),
        parent: { common: "root", old: "root", "old-action": "old" },
      },
    };
    const next = {
      nodes: nextNodes,
      scene: {
        order: nextNodes.map((node) => node.identity),
        parent: { common: "root", next: "root" },
      },
    };
    expect(planCandidateStructureReconciliation(previous, next, ["old"]))
      .toEqual(resolveReferenceStructureReconciliation(previousNodes, nextNodes, ["old"]));
    expect(() => planCandidateStructureReconciliation(previous, next, ["old-action"]))
      .toThrow("not an exiting subtree root");
    expect(() => resolveReferenceStructureReconciliation(previousNodes, nextNodes, ["old-action"]))
      .toThrow("not an exiting subtree root");
    const changedNodes = nextNodes.map((node) =>
      node.identity === "common" ? { ...node, role: "group" } : node
    );
    expect(() => planCandidateStructureReconciliation(previous, { ...next, nodes: changedNodes }))
      .toThrow("changed its native contract");
    expect(() => resolveReferenceStructureReconciliation(previousNodes, changedNodes))
      .toThrow("changed its native contract");
  });

  test("retained web structure releases semantics and reverses native identity", () => {
    const Root = issueCandidateStructurePart("Panel", "Root", "main");
    const Old = issueCandidateStructurePart("Panel", "Old", "div");
    const OldAction = issueCandidateStructurePart("Panel", "OldAction", "button");
    const Next = issueCandidateStructurePart("Panel", "Next", "div");
    const NextAction = issueCandidateStructurePart("Panel", "NextAction", "button");
    const oldActionNode = OldAction(
      { name: "Continue", activate: issueCandidateAction("Panel.continue") }, "Continue",
    );
    const nextActionNode = NextAction(
      { name: "Back", activate: issueCandidateAction("Panel.back") }, "Back",
    );
    const hierarchy = Root({}, selectCandidateStructure(
      createCandidateReadExpression("panel.next"),
      {
        true: {
          content: Next({ role: "group", name: "Next" }, nextActionNode),
          focus: nextActionNode.reference,
        },
        false: {
          content: Old({ role: "group", name: "Old" }, oldActionNode),
          focus: oldActionNode.reference,
        },
      },
    ));
    const structure = (next) => normalizeCandidateStructure(hierarchy, {
      reads: { "panel.next": next },
    });
    const detach = (node) => {
      const index = node.parent?.children.indexOf(node) ?? -1;
      if (index >= 0) node.parent.children.splice(index, 1);
      delete node.parent;
    };
    let focused = "Panel.OldAction";
    const platform = {
      create: (element, identity) => ({
        element, identity, attributes: {}, properties: {}, children: [], listeners: new Map(),
      }),
      text: (value) => ({
        element: "#text", identity: "#text:" + value, value,
        attributes: {}, properties: {}, children: [], listeners: new Map(),
      }),
      textValue(node, value) { node.value = value; },
      attribute(node, name, value) {
        if (value === undefined) delete node.attributes[name]; else node.attributes[name] = value;
      },
      property(node, name, value) {
        if (value === undefined) delete node.properties[name]; else node.properties[name] = value;
      },
      listen(node, event, listener) {
        node.listeners.set(event, listener);
        return () => node.listeners.delete(event);
      },
      append(parent, child) {
        detach(child); parent.children.push(child); child.parent = parent;
      },
      place(parent, child, index) {
        detach(child); parent.children.splice(Math.min(index, parent.children.length), 0, child);
        child.parent = parent;
      },
      remove(node) { detach(node); node.removed = true; },
      retain(node) { detach(node); node.retained = true; },
      restore(node) { node.retained = false; },
      focusedIdentity: () => focused,
      focus(node) { focused = node.identity; },
      activateModal(_node, initialFocus, focusVisibility) {
        if (focusVisibility !== "visible") throw new Error("Modal focus must be visible.");
        focused = initialFocus.identity;
      },
      deactivateModal(_node, returnFocus) { focused = returnFocus.identity; },
    };
    const mounted = mountCandidateReconciledStructureToWeb(structure(false), platform, () => {});
    const old = mounted.nodes.get("Panel.Old");
    const oldAction = mounted.nodes.get("Panel.OldAction");
    const first = mounted.reconcile(structure(true), { retain: ["Panel.Old"] });
    expect(old.attributes["aria-hidden"]).toBe(true);
    expect(old.properties.inert).toBe(true);
    expect(oldAction.listeners.size).toBe(0);
    expect(first.focusRecovery).toEqual({ from: "Panel.OldAction", to: "Panel.NextAction" });
    expect(focused).toBe("Panel.NextAction");
    expect(mounted.settleExit("Panel.Old", first.retained[0].revision - 1)).toBe(false);
    const partial = normalizeCandidateStructure(Root({},
      OldAction({ name: "Continue", activate: issueCandidateAction("Panel.continue") }, "Continue"),
    ));
    expect(() => mounted.reconcile(partial)).toThrow("cannot reenter without subtree root");
    const second = mounted.reconcile(structure(false), { retain: ["Panel.Next"] });
    expect(planCandidatePresenceCommands(second).enter).toEqual([
      { identity: "Panel.Old", reversal: true },
    ]);
    expect(mounted.nodes.get("Panel.Old")).toBe(old);
    expect(old.retained).toBe(false);
    expect(oldAction.listeners.has("click")).toBe(true);
    expect(mounted.settleExit("Panel.Old", first.retained[0].revision)).toBe(false);
    mounted.dispose();

    const ModalRoot = issueCandidateStructurePart("Modal", "Root", "main");
    const ModalTrigger = issueCandidateStructurePart("Modal", "Trigger", "button");
    const ModalDialog = issueCandidateStructurePart("Modal", "Dialog", "dialog");
    const ModalClose = issueCandidateStructurePart("Modal", "Close", "button");
    const modalOpen = createCandidateReadExpression("modal.open");
    const modalPresent = createCandidateReadExpression("modal.present");
    const modalClose = ModalClose({ name: "Close" }, "Close");
    const modalDialog = ModalDialog(
      { name: "Dialog", modal: modalOpen, hidden: notCandidate(modalPresent) },
      modalClose,
    );
    const modalTrigger = ModalTrigger(
      { name: "Open", controls: modalDialog.reference },
      "Open",
    );
    const modalHierarchy = ModalRoot({}, modalTrigger, modalDialog);
    const modalStructure = (isOpen, isPresent) => normalizeCandidateStructure(modalHierarchy, {
      reads: { "modal.open": isOpen, "modal.present": isPresent },
      ...(isOpen ? {
        activeModal: {
          identity: modalDialog.reference,
          initialFocus: modalClose.reference,
          returnFocus: modalTrigger.reference,
        },
      } : {}),
    });
    focused = undefined;
    const modalMounted = mountCandidateReconciledStructureToWeb(
      modalStructure(false, false),
      platform,
      () => {},
    );
    modalMounted.reconcile(modalStructure(true, true));
    expect(focused).toBe("Modal.Close");
    modalMounted.reconcile(modalStructure(false, true));
    expect(focused).toBe("Modal.Trigger");
    focused = undefined;
    modalMounted.reconcile(modalStructure(false, false));
    expect(focused).toBe("Modal.Trigger");
    modalMounted.dispose();
  });

  test("nested overlay ownership and stale close", () => {
    const overlays = new ReferenceOverlayStack();
    overlays.open({ identity: "dialog", returnFocus: "trigger" });
    expect(() => overlays.open({
      identity: "popover",
      parent: "other",
      returnFocus: "action",
    })).toThrow("current top overlay");
    const child = overlays.open({
      identity: "popover",
      parent: "dialog",
      returnFocus: "action",
    });
    expect(overlays.close(child, "popover")?.focus).toBe("action");
    expect(overlays.close(child, "dialog")).toBeUndefined();
  });

  test("nested overlay presence closes descendants first and reverses revision", () => {
    const reference = new ReferenceOverlayCloseCascade();
    const candidate = new CandidateOverlayCloseAdapter();
    const stack = ["Dialog", "Popover"];
    const firstReference = reference.begin(stack, "Dialog");
    const firstCandidate = candidate.begin(stack, "Dialog");
    expect(firstCandidate).toEqual(firstReference);
    expect(firstReference.current).toBe("Popover");
    expect(reference.settle(firstReference.revision, "Dialog")).toEqual({ accepted: false });
    expect(candidate.settle(firstCandidate.revision, "Dialog")).toEqual({ accepted: false });
    const reversedReference = reference.reverse(firstReference.revision);
    const reversedCandidate = candidate.reverse(firstCandidate.revision);
    expect(reversedCandidate).toEqual(reversedReference);
    expect(reversedReference).toEqual({
      accepted: true,
      revision: firstReference.revision + 1,
      restore: ["Dialog", "Popover"],
    });
    expect(reference.settle(firstReference.revision, "Popover")).toEqual({ accepted: false });
    expect(candidate.settle(firstCandidate.revision, "Popover")).toEqual({ accepted: false });
    const finalReference = reference.begin(stack, "Dialog");
    const finalCandidate = candidate.begin(stack, "Dialog");
    expect(reference.settle(finalReference.revision, "Popover")).toEqual({
      accepted: true,
      next: "Dialog",
    });
    expect(candidate.settle(finalCandidate.revision, "Popover")).toEqual({
      accepted: true,
      next: "Dialog",
    });
    expect(reference.settle(finalReference.revision, "Dialog")).toEqual({
      accepted: true,
      complete: true,
    });
    expect(candidate.settle(finalCandidate.revision, "Dialog")).toEqual({
      accepted: true,
      complete: true,
    });
  });

  test("OKLCH interpolation semantics", () => {
    expect(interpolateReferenceOklch(
      { colorSpace: "oklch", lightness: 0.6, chroma: 0.2, hue: 350, alpha: 1 },
      { colorSpace: "oklch", lightness: 0.8, chroma: 0.1, hue: 10, alpha: 1 },
      0.5,
    ).hue).toBe(0);
    expect(interpolateReferenceOklch(
      { colorSpace: "oklch", lightness: 0.8, chroma: 0.2, hue: 40, alpha: 0.8 },
      { colorSpace: "oklch", lightness: 0.2, chroma: 0.1, hue: 40, alpha: 0.2 },
      0.5,
    ).lightness).toBeCloseTo(0.68);
    const from = { colorSpace: "oklch", lightness: 0.6, chroma: 0.2, hue: 350, alpha: 1 };
    const to = { colorSpace: "oklch", lightness: 0.8, chroma: 0.1, hue: 10, alpha: 1 };
    expect(evaluateCandidateExpression(interpolateCandidate(
      0.5,
      [0, 1],
      [from, to],
      { clamp: true },
    ), {}).value).toEqual(interpolateReferenceOklch(from, to, 0.5));
  });

  test("paint interpolation semantics", () => {
    const black = { colorSpace: "oklch", lightness: 0, chroma: 0, hue: 350, alpha: 1 };
    const white = { colorSpace: "oklch", lightness: 1, chroma: 0, hue: 10, alpha: 1 };
    const from = {
      kind: "linear-gradient",
      angle: { dimension: "angle", value: 350 },
      stops: [
        { position: 0, color: black },
        { position: 1, color: white },
      ],
    };
    const to = {
      kind: "linear-gradient",
      angle: { dimension: "angle", value: 10 },
      stops: [
        { position: 0.2, color: white },
        { position: 0.8, color: black },
      ],
    };
    const expected = interpolateReferencePaint(from, to, 0.5);
    expect(expected.angle.value).toBe(0);
    expect(evaluateCandidateExpression(interpolateCandidate(
      0.5,
      [0, 1],
      [from, to],
      { clamp: true },
    ), {}).value).toEqual(expected);
    const differentTopology = {
      ...to,
      stops: [...to.stops, { position: 1, color: white }],
    };
    expect(() => interpolateReferencePaint(from, differentTopology, 0.5))
      .toThrow("matching stop topology");
    expect(() => evaluateCandidateExpression(interpolateCandidate(
      0.5,
      [0, 1],
      [from, differentTopology],
      { clamp: true },
    ), {})).toThrow("matching stop topology");
    const solid = { kind: "solid", color: black };
    expect(() => interpolateReferencePaint(solid, to, 0.5)).toThrow("matching kinds");
    expect(() => evaluateCandidateExpression(interpolateCandidate(
      0.5,
      [0, 1],
      [solid, to],
      { clamp: true },
    ), {})).toThrow("matching kinds");
  });

  test("rotation interpolation semantics", () => {
    expect(interpolateReferenceRotation(
      { axis: { x: 0, y: 0, z: 1 }, degrees: 350 },
      { axis: { x: 0, y: 0, z: 1 }, degrees: 10 },
      0.5,
    ).degrees).toBeCloseTo(0);
    expect(() => interpolateReferenceRotation(
      { axis: { x: 0, y: 0, z: 0 }, degrees: 20 },
      { axis: { x: 0, y: 0, z: 1 }, degrees: 30 },
      0.5,
    )).toThrow("axis cannot be zero");
    const from = {
      translation: {
        inline: { dimension: "length", value: 0 },
        block: { dimension: "length", value: 0 },
        depth: { dimension: "length", value: 0 },
      },
      scale: { inline: 1, block: 1, depth: 1 },
      rotation: { axis: { x: 0, y: 0, z: 1 }, angle: { dimension: "angle", value: 350 } },
      origin: { inline: 0.5, block: 0.5, depth: { dimension: "length", value: 0 } },
      perspective: "none",
    };
    const to = {
      ...from,
      rotation: { axis: { x: 0, y: 0, z: 1 }, angle: { dimension: "angle", value: 10 } },
    };
    expect(evaluateCandidateExpression(interpolateCandidate(
      0.5,
      [0, 1],
      [from, to],
      { clamp: true },
    ), {}).value.rotation.angle.value).toBeCloseTo(0);
  });

  test("transition compatibility and reduced motion", () => {
    const spring = { name: "spring", kind: "spring", valueType: "length" };
    expect(resolveReferenceTransitionHandoff({
      current: 4,
      velocity: 12,
      target: 0,
      source: "transition",
      previous: spring,
      next: spring,
      reducedMotion: false,
    }).velocity).toBe(12);
    expect(resolveReferenceTransitionHandoff({
      current: 4,
      velocity: 12,
      target: 0,
      source: "transition",
      previous: spring,
      next: spring,
      reducedMotion: true,
    }).strategy).toBe("settle");
    expect(() => resolveReferenceTransitionHandoff({
      current: 4,
      velocity: 12,
      target: 0,
      source: "transition",
      previous: spring,
      next: { ...spring, valueType: "opacity" },
      reducedMotion: false,
    })).toThrow("changes value type");
  });

  test("multi-target transition transaction", () => {
    const spring = { name: "spring", kind: "spring", valueType: "number" };
    const entry = {
      targetIdentity: "scale",
      current: 0,
      velocity: 0,
      target: 1,
      source: "none",
      next: spring,
      reducedMotion: false,
    };
    expect(resolveReferenceTransitionBatch([entry], { revision: 9, epoch: 2 })[0].revision).toBe(9);
    expect(() => resolveReferenceTransitionBatch(
      [entry, { ...entry }],
      { revision: 10, epoch: 3 },
    )).toThrow("same target");
    const opacity = createCandidateTargetHandle("root", "opacity");
    expect(normalizeSemanticOperations([setCandidateTarget(opacity, 1)]).transaction.targets)
      .toEqual(["root:opacity"]);

    const previous = {
      opacity: {
        target: 0.4,
        policy: { name: "spring", kind: "spring", valueType: "scalar" },
        active: true,
        reducedMotion: false,
      },
    } as const;
    const presented = { opacity: { value: 0.2, velocity: 0.5 } };
    const policyUpdate = resolveReferenceTransitionUpdate({
      previous,
      next: {
        opacity: {
          ...previous.opacity,
          policy: { name: "soft", kind: "spring", valueType: "scalar" },
        },
      },
      presented,
      transaction: { cause: "theme", revision: 11, epoch: 4 },
    });
    expect(policyUpdate.changes[0]?.handoff).toMatchObject({
      strategy: "retarget",
      velocity: 0.5,
    });
    const reduced = resolveReferenceTransitionUpdate({
      previous,
      next: { opacity: { ...previous.opacity, reducedMotion: true } },
      presented,
      transaction: { cause: "reducedMotion", revision: 12, epoch: 5 },
    });
    expect(reduced.changes[0]?.handoff).toMatchObject({ strategy: "settle", to: 0.4 });
    expect(() => resolveReferenceTransitionUpdate({
      previous,
      next: {
        opacity: {
          ...previous.opacity,
          policy: { ...previous.opacity.policy, valueType: "length" },
        },
      },
      presented,
      transaction: { cause: "preset", revision: 13, epoch: 6 },
    })).toThrow("changes value type");
    expect(() => resolveReferenceTransitionUpdate({
      previous,
      next: {},
      presented,
      transaction: { cause: "semantic", revision: 14, epoch: 7 },
    })).toThrow("explicit presence semantics");
  });

  test("path morph topology", () => {
    expect(() => resolveReferencePathMorph(
      [{ kind: "move", inline: 0, block: 0 }],
      [{ kind: "line", inline: 1, block: 1 }],
    )).toThrow("changes from");
  });

  test("shape interpolation semantics", () => {
    const rectangleFrom = {
      kind: "rectangle",
      corners: {
        startStart: { radius: { dimension: "length", value: 0 }, smoothing: 0 },
        startEnd: { radius: { dimension: "length", value: 0 }, smoothing: 0 },
        endStart: { radius: { dimension: "length", value: 0 }, smoothing: 0 },
        endEnd: { radius: { dimension: "length", value: 0 }, smoothing: 0 },
      },
    };
    const rectangleTo = {
      kind: "rectangle",
      corners: {
        startStart: { radius: { dimension: "length", value: 20 }, smoothing: 1 },
        startEnd: { radius: { dimension: "length", value: 20 }, smoothing: 1 },
        endStart: { radius: { dimension: "length", value: 20 }, smoothing: 1 },
        endEnd: { radius: { dimension: "length", value: 20 }, smoothing: 1 },
      },
    };
    const rectangleExpected = interpolateReferenceShape(rectangleFrom, rectangleTo, 0.5);
    expect(rectangleExpected.corners.startStart).toEqual({
      radius: { dimension: "length", value: 10 },
      smoothing: 0.5,
    });
    expect(evaluateCandidateExpression(interpolateCandidate(
      0.5,
      [0, 1],
      [rectangleFrom, rectangleTo],
      { clamp: true },
    ), {}).value).toEqual(rectangleExpected);
    const pathFrom = {
      kind: "path",
      viewBox: { inlineSize: 1, blockSize: 1 },
      commands: [
        { kind: "move", inline: 0, block: 0 },
        { kind: "line", inline: 1, block: 0 },
      ],
      fillRule: "nonzero",
    };
    const pathTo = {
      ...pathFrom,
      commands: [
        { kind: "move", inline: 0.5, block: 0.5 },
        { kind: "line", inline: 0, block: 1 },
      ],
    };
    expect(evaluateCandidateExpression(interpolateCandidate(
      0.5,
      [0, 1],
      [pathFrom, pathTo],
      { clamp: true },
    ), {}).value).toEqual(interpolateReferenceShape(pathFrom, pathTo, 0.5));
    const fillMismatch = { ...pathTo, fillRule: "even-odd" };
    expect(() => interpolateReferenceShape(pathFrom, fillMismatch, 0.5))
      .toThrow("matching coordinate and fill semantics");
    expect(() => evaluateCandidateExpression(interpolateCandidate(
      0.5,
      [0, 1],
      [pathFrom, fillMismatch],
      { clamp: true },
    ), {})).toThrow("matching coordinate and fill semantics");
    const commandMismatch = {
      ...pathTo,
      commands: [
        { kind: "move", inline: 0.5, block: 0.5 },
        {
          kind: "curve",
          control1: { inline: 0, block: 0 },
          control2: { inline: 1, block: 1 },
          end: { inline: 0, block: 1 },
        },
      ],
    };
    expect(() => evaluateCandidateExpression(interpolateCandidate(
      0.5,
      [0, 1],
      [pathFrom, commandMismatch],
      { clamp: true },
    ), {})).toThrow("changes kind");
    expect(() => interpolateReferenceShape({ kind: "capsule" }, { kind: "ellipse" }, 0.5))
      .toThrow("matching kinds");
    expect(() => evaluateCandidateExpression(interpolateCandidate(
      0.5,
      [0, 1],
      [{ kind: "capsule" }, { kind: "ellipse" }],
      { clamp: true },
    ), {})).toThrow("matching kinds");
  });

  test("visual composite interpolation semantics", () => {
    const length = (value) => ({ dimension: "length", value });
    const dark = { colorSpace: "oklch", lightness: 0.2, chroma: 0.04, hue: 250, alpha: 1 };
    const light = { colorSpace: "oklch", lightness: 0.9, chroma: 0.02, hue: 20, alpha: 0.6 };
    const strokeFrom = {
      paint: { kind: "solid", color: dark },
      width: length(1),
      placement: "inside",
      dash: [length(2), length(4)],
    };
    const strokeTo = {
      paint: { kind: "solid", color: light },
      width: length(3),
      placement: "inside",
      dash: [length(4), length(8)],
    };
    expect(evaluateCandidateExpression(interpolateCandidate(
      0.5,
      [0, 1],
      [strokeFrom, strokeTo],
      { clamp: true },
    ), {}).value).toEqual(interpolateReferenceStroke(strokeFrom, strokeTo, 0.5));
    const placementMismatch = { ...strokeTo, placement: "outside" };
    expect(() => interpolateReferenceStroke(strokeFrom, placementMismatch, 0.5))
      .toThrow("matching placement");
    expect(() => evaluateCandidateExpression(interpolateCandidate(
      0.5, [0, 1], [strokeFrom, placementMismatch], { clamp: true },
    ), {})).toThrow("matching placement");
    const dashMismatch = { ...strokeTo, dash: [length(4)] };
    expect(() => interpolateReferenceStroke(strokeFrom, dashMismatch, 0.5))
      .toThrow("matching dash topology");
    expect(() => evaluateCandidateExpression(interpolateCandidate(
      0.5, [0, 1], [strokeFrom, dashMismatch], { clamp: true },
    ), {})).toThrow("matching dash topology");

    const shadowsFrom = [{
      kind: "outer",
      color: dark,
      offset: { inline: length(0), block: length(2) },
      blur: length(4),
      spread: length(-1),
    }];
    const shadowsTo = [{
      kind: "outer",
      color: light,
      offset: { inline: length(2), block: length(6) },
      blur: length(12),
      spread: length(1),
    }];
    expect(evaluateCandidateExpression(interpolateCandidate(
      0.5, [0, 1], [shadowsFrom, shadowsTo], { clamp: true },
    ), {}).value).toEqual(interpolateReferenceShadows(shadowsFrom, shadowsTo, 0.5));
    expect(() => interpolateReferenceShadows(shadowsFrom, [], 0.5))
      .toThrow("matching list topology");
    expect(() => evaluateCandidateExpression(interpolateCandidate(
      0.5, [0, 1], [shadowsFrom, []], { clamp: true },
    ), {})).toThrow("matching list topology");
    const shadowKindMismatch = [{ ...shadowsTo[0], kind: "inner" }];
    expect(() => interpolateReferenceShadows(shadowsFrom, shadowKindMismatch, 0.5))
      .toThrow("changes kind");
    expect(() => evaluateCandidateExpression(interpolateCandidate(
      0.5, [0, 1], [shadowsFrom, shadowKindMismatch], { clamp: true },
    ), {})).toThrow("changes kind");

    const materialFrom = {
      backdropBlur: length(8), backdropSaturation: 1,
      tint: { kind: "solid", color: dark }, noise: 0,
    };
    const materialTo = {
      backdropBlur: length(24), backdropSaturation: 1.4,
      tint: { kind: "solid", color: light }, noise: 0.2,
    };
    expect(evaluateCandidateExpression(interpolateCandidate(
      0.5, [0, 1], [materialFrom, materialTo], { clamp: true },
    ), {}).value).toEqual(interpolateReferenceMaterial(materialFrom, materialTo, 0.5));

    const typeFrom = {
      families: ["Inter", "sans-serif"], size: length(14), lineHeight: length(20),
      weight: 400, tracking: length(0), align: "start", wrap: "wrap",
      overflow: "clip", decoration: "none", variations: { opsz: 14, wght: 400 },
    };
    const typeTo = {
      ...typeFrom, size: length(18), lineHeight: length(26), weight: 600,
      tracking: length(0.2), variations: { opsz: 18, wght: 600 },
    };
    expect(evaluateCandidateExpression(interpolateCandidate(
      0.5, [0, 1], [typeFrom, typeTo], { clamp: true },
    ), {}).value).toEqual(interpolateReferenceTypeStyle(typeFrom, typeTo, 0.5));
    const wrapMismatch = { ...typeTo, wrap: "balance" };
    expect(() => interpolateReferenceTypeStyle(typeFrom, wrapMismatch, 0.5))
      .toThrow("matching text semantics");
    expect(() => evaluateCandidateExpression(interpolateCandidate(
      0.5, [0, 1], [typeFrom, wrapMismatch], { clamp: true },
    ), {})).toThrow("matching text semantics");
    const axesMismatch = { ...typeTo, variations: { wght: 600 } };
    expect(() => interpolateReferenceTypeStyle(typeFrom, axesMismatch, 0.5))
      .toThrow("matching variation axes");
    expect(() => evaluateCandidateExpression(interpolateCandidate(
      0.5, [0, 1], [typeFrom, axesMismatch], { clamp: true },
    ), {})).toThrow("matching variation axes");

    const mediaFrom = { mode: "cover", focalPoint: { inline: 0.2, block: 0.4 } };
    const mediaTo = { mode: "cover", focalPoint: { inline: 0.8, block: 0.6 } };
    expect(evaluateCandidateExpression(interpolateCandidate(
      0.5, [0, 1], [mediaFrom, mediaTo], { clamp: true },
    ), {}).value).toEqual(interpolateReferenceMediaFit(mediaFrom, mediaTo, 0.5));
    const mediaMismatch = { ...mediaTo, mode: "contain" };
    expect(() => interpolateReferenceMediaFit(mediaFrom, mediaMismatch, 0.5))
      .toThrow("matching modes");
    expect(() => evaluateCandidateExpression(interpolateCandidate(
      0.5, [0, 1], [mediaFrom, mediaMismatch], { clamp: true },
    ), {})).toThrow("matching modes");
  });

  test("visual transition compatibility preflight", () => {
    const black = { colorSpace: "oklch", lightness: 0, chroma: 0, hue: 0, alpha: 1 };
    const white = { colorSpace: "oklch", lightness: 1, chroma: 0, hue: 0, alpha: 1 };
    const number = { target: "surface:opacity", valueType: "number", from: 0, to: 1 };
    const valid = [
      number,
      {
        target: "surface:paint", valueType: "paint",
        from: { kind: "solid", color: black },
        to: { kind: "solid", color: white },
      },
    ];
    expect(normalizeCandidateTransitionCompatibility(valid))
      .toEqual(resolveReferenceVisualTransitionBatch(valid));
    const incompatible = [
      number,
      {
        target: "surface:paint", valueType: "paint",
        from: { kind: "solid", color: black },
        to: {
          kind: "linear-gradient", angle: { dimension: "angle", value: 0 },
          stops: [{ position: 0, color: black }, { position: 1, color: white }],
        },
      },
    ];
    expect(() => normalizeCandidateTransitionCompatibility(incompatible)).toThrow("matching kinds");
    expect(() => resolveReferenceVisualTransitionBatch(incompatible)).toThrow("matching kinds");
    const strokePresence = [{
      target: "surface:stroke", valueType: "stroke", from: "none",
      to: {
        paint: { kind: "solid", color: black },
        width: { dimension: "length", value: 1 }, placement: "inside",
      },
    }];
    expect(() => normalizeCandidateTransitionCompatibility(strokePresence))
      .toThrow("explicit presentation presence");
    expect(() => resolveReferenceVisualTransitionBatch(strokePresence))
      .toThrow("explicit presentation presence");
    expect(() => normalizeCandidateTransitionCompatibility([number, number])).toThrow("same target");
    expect(() => resolveReferenceVisualTransitionBatch([number, number])).toThrow("same target");

    const transformFrom = {
      translation: {
        inline: { dimension: "length", value: 0 },
        block: { dimension: "length", value: 0 },
        depth: { dimension: "length", value: 0 },
      },
      scale: { inline: 1, block: 1, depth: 1 },
      rotation: { axis: { x: 0, y: 0, z: 1 }, angle: { dimension: "angle", value: 350 } },
      origin: { inline: 0.5, block: 0.5, depth: { dimension: "length", value: 0 } },
      perspective: "none",
    };
    const transformTo = {
      ...transformFrom,
      translation: {
        ...transformFrom.translation,
        block: { dimension: "length", value: 100 },
      },
      rotation: { axis: { x: 0, y: 0, z: 1 }, angle: { dimension: "angle", value: 10 } },
      perspective: { dimension: "length", value: 400 },
    };
    expect(evaluateCandidateExpression(interpolateCandidate(
      0.5, [0, 1], [transformFrom, transformTo], { clamp: true },
    ), {}).value).toEqual(interpolateReferenceTransform(transformFrom, transformTo, 0.5));
  });

  test("candidate relationships and direct ownership", () => {
    const page = createCandidatePresentationIdentity("page");
    const missing = createCandidatePresentationIdentity("missing");
    const source = createCandidatePresentationIdentity("list.image");
    const destination = createCandidatePresentationIdentity("detail.image");
    expect(normalizeSemanticRelationships(
      [source, destination],
      [matchCandidate("image", source, destination)],
    ).matches).toEqual([
      { identity: "image", source: "list.image", destination: "detail.image" },
    ]);
    expect(() => resolveReferenceSharedIdentities([
      { identity: "image", side: "source", node: "list.a" },
      { identity: "image", side: "source", node: "list.b" },
    ])).toThrow("two source nodes");
    expect(() => normalizeSemanticRelationships([page], [clipCandidate(page, missing)]))
      .toThrow("Unknown clip identity");
    expect(() => normalizeSemanticRelationships([page], [hitTestCandidate(missing, "auto")]))
      .toThrow("Unknown hit-test identity");
    const modal = issueCandidateNativeLayerHandle("page", "modal");
    expect(() => normalizeSemanticRelationships(
      [page, missing],
      [nativeLayerCandidate(missing, modal)],
    )).toThrow("cannot own");

    const target = createCandidateTargetHandle("surface", "block");
    const dismiss = createCandidateRecognizerHandle("dismiss", "drag");
    const scroll = createCandidateRecognizerHandle("scroll", "pan");
    const spring = createCandidateTransitionPolicy("spring", {
      normal: { kind: "spring", mass: 1, stiffness: 420, damping: 34 },
      reduced: { kind: "instant" },
    });
    const projectionTime = issueCandidateParameterHandle("gesture.projectionTime");
    const resistance = issueCandidateParameterHandle("gesture.resistance");
    const settlement = settleCandidate(target, dismiss, {
      destinations: { open: 0, closed: 100 },
      policy: spring,
      preserve: "velocity",
      projectionTime,
      resistance,
    });
    expect(() => normalizeCandidateDirectManipulation([settlement])).toThrow("has no direct owner");
    expect(() => normalizeCandidateDirectManipulation([
      driveCandidate(target, scroll, scroll.translation.block),
      settlement,
    ]))
      .toThrow("driven by");
    const scene = normalizeCandidateDirectManipulation([
      driveCandidate(target, dismiss, dismiss.translation.block),
      settlement,
    ]);
    expect(scene.drives[0]?.recognizer).toBe("drag");
    expect(scene.drives[0]?.projection).toEqual({
      kind: "read",
      path: "dismiss.translation.block",
    });
    const scrollTarget = createCandidateTargetHandle("viewport", "offset");
    expect(normalizeCandidateDirectManipulation([
      driveCandidate(scrollTarget, scroll, scroll.translation.block),
    ]).drives[0]?.recognizer)
      .toBe("pan");
    expect(() => validateCandidateDirectManipulationParameters(scene, {
      "gesture.resistance": 0.5,
    })).toThrow("projection parameter");
    expect(() => validateCandidateDirectManipulationParameters(scene, {
      "gesture.projectionTime": 0.2,
      "gesture.resistance": 2,
    })).toThrow("within zero and one");
    expect(() => normalizeCandidateDirectManipulation([
      driveCandidate(target, dismiss, dismiss.translation.block),
      settleCandidate(target, dismiss, {
        destinations: { open: 0, closed: 100 },
        policy: spring,
        preserve: "velocity",
        projectionTime,
        resistance: projectionTime,
      }),
    ])).toThrow("distinct parameters");
  });

  test("candidate layout ownership and hierarchy", () => {
    const page = createCandidatePresentationIdentity("page");
    const first = createCandidatePresentationIdentity("first");
    const second = createCandidatePresentationIdentity("second");
    const flow = flowCandidate({
      axis: "block",
      gap: { dimension: "length", value: 8 },
      align: "stretch",
      distribute: "start",
      wrap: false,
    });
    expect(() => normalizeSemanticLayout(
      [page, first, second],
      [arrangeCandidate(page, [first], flow), arrangeCandidate(page, [second], flow)],
    )).toThrow("owned by both");
    expect(() => normalizeSemanticLayout(
      [page, first],
      [arrangeCandidate(page, [first], flow), arrangeCandidate(first, [page], flow)],
    )).toThrow("Composition cycle");

    const records = createCandidateCollectionHandle("records");
    expect(() => normalizeSemanticLayout(
      [page],
      [virtualizeCandidate(records, page, {
        axis: "block",
        estimate: { dimension: "length", value: 44 },
        overscan: 4,
        offscreen: "remove",
      })],
    )).toThrow("needs a compatible scroll relation");

    const content = createCandidatePresentationIdentity("content");
    const virtualScene = normalizeSemanticLayout(
      [page, content],
      [
        scrollCandidate(page, content, {
          axis: "block",
          behavior: "free",
          indicators: "automatic",
        }),
        virtualizeCandidate(records, page, {
          axis: "block",
          estimate: { dimension: "length", value: 44 },
          overscan: 4,
          offscreen: "remove",
        }),
      ],
    );
    expect(virtualScene.virtualized[0].measurement)
      .toEqual({ source: "observed", identity: "keyed", stale: "ignore" });
  });

  test("virtual measurements are revision-safe and keyed", () => {
    const layout = new ReferenceVirtualLayoutRegistry();
    const first = layout.begin(["a", "b"], 40);
    expect(layout.commit(first, [{ key: "b", extent: 60 }])).toBe(true);
    const stale = layout.begin(["a", "b"], 40);
    const current = layout.begin(["b", "c"], 50);
    expect(layout.commit(stale, [{ key: "a", extent: 100 }])).toBe(false);
    expect(layout.commit(current, [])).toBe(true);
    expect(layout.items).toEqual([
      { key: "b", offset: 0, extent: 60, measured: true },
      { key: "c", offset: 60, extent: 50, measured: false },
    ]);
  });

  test("intrinsic measurement transactions are geometry-only and revision-safe", () => {
    const reference = new ReferenceMeasurementCoordinator();
    const candidate = new CandidateMeasurementAdapter();
    const staleReference = reference.begin("font");
    const staleCandidate = candidate.begin("font");
    const currentReference = reference.begin("container");
    const currentCandidate = candidate.begin("container");
    const entries = [
      { identity: "Card.Media", inlineSize: 320, blockSize: 180 },
      { identity: "Card.Content", inlineSize: 320, blockSize: 124 },
    ];
    expect(reference.commit(staleReference, entries)).toEqual({ accepted: false });
    expect(candidate.commit(staleCandidate, entries)).toEqual({ accepted: false });
    const expected = reference.commit(currentReference, entries);
    expect(candidate.commit(currentCandidate, entries)).toEqual(expected);
    expect(expected).toMatchObject({
      accepted: true,
      cause: "geometry",
      semanticChanged: false,
      presenceChanged: false,
    });
    expect(reference.commit(reference.begin("media"), entries)).toMatchObject({ changes: [] });
    expect(candidate.commit(candidate.begin("media"), entries)).toMatchObject({ changes: [] });
    const invalid = [...entries, { identity: "invalid", inlineSize: 0, blockSize: 20 }];
    expect(() => reference.commit(reference.begin("font"), invalid)).toThrow("positive size");
    expect(() => candidate.commit(candidate.begin("font"), invalid)).toThrow("positive size");
  });

  test("layout parent swaps retain identity and target geometry", () => {
    expect(resolveReferenceLayoutProjection({
      identity: "card",
      previousParent: "grid",
      nextParent: "detail",
      previous: { inline: 0, block: 0, inlineSize: 100, blockSize: 50 },
      next: { inline: 100, block: 100, inlineSize: 200, blockSize: 100 },
    })).toMatchObject({
      identity: "card",
      parentChanged: true,
      target: { inline: 100, block: 100, inlineSize: 200, blockSize: 100 },
    });
    const presented = { inline: 40, block: 20, inlineSize: 120, blockSize: 60 };
    const target = { inline: 100, block: 100, inlineSize: 200, blockSize: 100 };
    const velocity = { inline: 30, block: -10, logInlineSize: 0.2, logBlockSize: -0.1 };
    expect(resolveReferenceLayoutTransition({
      identity: "card",
      previousParent: "grid",
      nextParent: "detail",
      presented,
      velocity,
      target,
      driver: "spring",
      reducedMotion: false,
    })).toMatchObject({ from: presented, velocity, strategy: "retarget" });
    expect(resolveReferenceLayoutTransition({
      identity: "card",
      previousParent: "grid",
      nextParent: "detail",
      presented,
      velocity,
      target,
      driver: "spring",
      reducedMotion: true,
    })).toMatchObject({
      from: target,
      projection: { translateInline: 0, translateBlock: 0, scaleInline: 1, scaleBlock: 1 },
      strategy: "settle",
    });
    const grid = createCandidatePresentationIdentity("grid");
    const detail = createCandidatePresentationIdentity("detail");
    const card = createCandidatePresentationIdentity("card");
    expect(normalizeSemanticLayout(
      [grid, detail, card],
      [arrangeCandidate(detail, [card], overlayCandidate({ align: "stretch" }))],
    ).parents).toEqual({ card: "detail" });

    const flow = createCandidatePresentationIdentity("layout.flow");
    const flowChild = createCandidatePresentationIdentity("layout.flow.child");
    expect(lowerCandidateLayoutToWebStyle(normalizeSemanticLayout(
      [flow, flowChild],
      [
        arrangeCandidate(flow, [flowChild], flowCandidate({
          axis: "block",
          gap: { dimension: "length", value: 12 },
          align: "stretch",
          distribute: "between",
          wrap: false,
        })),
        padCandidate(flow, {
          inlineStart: { dimension: "length", value: 20 },
          inlineEnd: { dimension: "length", value: 20 },
          blockStart: { dimension: "length", value: 16 },
          blockEnd: { dimension: "length", value: 24 },
        }),
        constrainCandidateSize(flow, {
          inline: {
            minimum: { dimension: "length", value: 280 },
            ideal: { dimension: "length", value: 420 },
            maximum: { size: "available" },
          },
        }),
        participateCandidate(flowChild, {
          grow: 1,
          shrink: 1,
          basis: { size: "intrinsic" },
        }),
      ],
    ))[0].declarations).toEqual(expect.arrayContaining([
      { name: "flex-direction", value: "column" },
      { name: "max-inline-size", value: "100%" },
      { name: "padding-inline-start", value: "20px" },
    ]));
    const flowChildStyles = lowerCandidateLayoutToWebStyle(normalizeSemanticLayout(
      [flow, flowChild],
      [
        arrangeCandidate(flow, [flowChild], flowCandidate({
          axis: "block",
          gap: { dimension: "length", value: 0 },
          align: "stretch",
          distribute: "start",
          wrap: false,
        })),
        participateCandidate(flowChild, {
          grow: 1,
          shrink: 1,
          basis: { size: "intrinsic" },
        }),
      ],
    )).find((entry) => entry.identity === "layout.flow.child")!;
    expect(flowChildStyles.declarations).toContainEqual({ name: "flex-grow", value: "1" });
    expect(flowChildStyles.declarations).toContainEqual({ name: "min-inline-size", value: "0" });
    const HiddenRoot = issueCandidateStructurePart("Hidden", "Root", "div");
    const HiddenChild = issueCandidateStructurePart("Hidden", "Child", "div");
    const hiddenStructure = normalizeCandidateStructure(
      HiddenRoot({ hidden: true }, HiddenChild({}, "Content")),
    );
    const hiddenRoot = createCandidatePresentationIdentity("Hidden.Root");
    const hiddenChild = createCandidatePresentationIdentity("Hidden.Child");
    const hiddenScene = lowerCandidateWebSceneToStyle({
      structure: hiddenStructure,
      presentation: normalizeSemanticOperations([]),
      layout: normalizeSemanticLayout(
        [hiddenRoot, hiddenChild],
        [
          arrangeCandidate(
            hiddenRoot,
            [hiddenChild],
            flowCandidate({
              axis: "block",
              gap: { dimension: "length", value: 0 },
              align: "stretch",
              distribute: "start",
              wrap: false,
            }),
          ),
        ],
      ),
    });
    expect(hiddenScene.find((entry) => entry.identity === "Hidden.Root")?.declarations)
      .toContainEqual({ name: "display", value: "none" });
    expect(() => normalizeSemanticLayout(
      [flow],
      [constrainCandidateSize(flow, {
        inline: {
          minimum: { dimension: "length", value: 500 },
          maximum: { dimension: "length", value: 300 },
        },
      })],
    )).toThrow("descending");
    expect(() => normalizeSemanticLayout(
      [flowChild],
      [participateCandidate(flowChild, {
        grow: 1,
        shrink: 1,
        basis: { size: "intrinsic" },
      })],
    )).toThrow("needs one flow parent");
    const viewportSurface = createCandidatePresentationIdentity("layout.viewport-surface");
    expect(lowerCandidateLayoutToWebStyle(normalizeSemanticLayout(
      [viewportSurface],
      [anchorCandidate(viewportSurface, "viewport", {
        inline: "stretch",
        block: "end",
        insets: {
          inlineStart: { dimension: "length", value: 12 },
          inlineEnd: { dimension: "length", value: 12 },
          blockStart: { dimension: "length", value: 0 },
          blockEnd: { dimension: "length", value: 16 },
        },
      })],
    ))[0].declarations).toEqual(expect.arrayContaining([
      { name: "position", value: "fixed" },
      { name: "inset-block-end", value: "16px" },
    ]));
    const anchoredClose = createCandidatePresentationIdentity("layout.anchored-close");
    const localAnchorScene = normalizeSemanticLayout(
      [viewportSurface, anchoredClose],
      [anchorCandidate(anchoredClose, viewportSurface, {
        inline: "end",
        block: "start",
        insets: {
          inlineStart: { dimension: "length", value: 0 },
          inlineEnd: { dimension: "length", value: 24 },
          blockStart: { dimension: "length", value: 20 },
          blockEnd: { dimension: "length", value: 0 },
        },
      })],
    );
    expect(localAnchorScene.parents).toEqual({
      "layout.anchored-close": "layout.viewport-surface",
    });
    const localAnchorStyles = lowerCandidateLayoutToWebStyle(localAnchorScene);
    expect(localAnchorStyles).toContainEqual({
      identity: "layout.viewport-surface",
      declarations: [{ name: "position", value: "relative" }],
    });
    expect(localAnchorStyles).toContainEqual({
      identity: "layout.anchored-close",
      declarations: expect.arrayContaining([
        { name: "position", value: "absolute" },
        { name: "inset-inline-end", value: "24px" },
        { name: "inset-block-start", value: "20px" },
      ]),
    });
    const nestedAnchorStyles = lowerCandidateLayoutToWebStyle(normalizeSemanticLayout(
      [viewportSurface, anchoredClose],
      [
        anchorCandidate(viewportSurface, "viewport", {
          inline: "center",
          block: "end",
          insets: {
            inlineStart: { dimension: "length", value: 12 },
            inlineEnd: { dimension: "length", value: 12 },
            blockStart: { dimension: "length", value: 0 },
            blockEnd: { dimension: "length", value: 16 },
          },
        }),
        anchorCandidate(anchoredClose, viewportSurface, {
          inline: "end",
          block: "start",
          insets: {
            inlineStart: { dimension: "length", value: 0 },
            inlineEnd: { dimension: "length", value: 24 },
            blockStart: { dimension: "length", value: 20 },
            blockEnd: { dimension: "length", value: 0 },
          },
        }),
      ],
    ));
    expect(nestedAnchorStyles.find((entry) => entry.identity === "layout.viewport-surface").declarations)
      .toContainEqual({ name: "position", value: "fixed" });
    expect(() => normalizeSemanticLayout(
      [viewportSurface],
      [anchorCandidate(viewportSurface, viewportSurface, {
        inline: "start",
        block: "start",
        insets: {
          inlineStart: { dimension: "length", value: 0 },
          inlineEnd: { dimension: "length", value: 0 },
          blockStart: { dimension: "length", value: 0 },
          blockEnd: { dimension: "length", value: 0 },
        },
      })],
    )).toThrow("cannot anchor to itself");

    const webGrid = createCandidatePresentationIdentity("layout.grid");
    const tile = createCandidatePresentationIdentity("layout.grid.tile");
    expect(lowerCandidateLayoutToWebStyle(normalizeSemanticLayout(
      [webGrid, tile],
      [arrangeCandidate(webGrid, [tile], gridCandidate({
        columns: [{ size: "fraction", value: 1 }],
        rows: [{ size: "intrinsic" }],
        gap: { dimension: "length", value: 8 },
      }))],
    ))[0].declarations).toContainEqual({ name: "grid-template-rows", value: "max-content" });

    const viewport = createCandidatePresentationIdentity("layout.viewport");
    const content = createCandidatePresentationIdentity("layout.content");
    const sticky = createCandidatePresentationIdentity("layout.sticky");
    const scrollStyles = lowerCandidateLayoutToWebStyle(normalizeSemanticLayout(
      [viewport, content, sticky],
      [
        scrollCandidate(viewport, content, {
          axis: "block",
          behavior: "free",
          indicators: "automatic",
        }),
        arrangeCandidate(content, [sticky], overlayCandidate({ align: "start" })),
        stickCandidate(sticky, viewport, {
          edge: "inlineStart",
          inset: { dimension: "length", value: 4 },
        }),
      ],
    ));
    const declarations = Object.fromEntries(
      scrollStyles.map((entry) => [entry.identity, entry.declarations]),
    );
    expect(declarations["layout.viewport"]).toContainEqual({
      name: "overflow-inline",
      value: "hidden",
    });
    expect(declarations["layout.sticky"]).toContainEqual({
      name: "inset-inline-start",
      value: "4px",
    });
  });

  test("candidate expressions subscribe only to the active branch", () => {
    const condition = createCandidateReadExpression("condition");
    const inactive = createCandidateReadExpression("inactive");
    const expression = condition.choose(inactive, 1);
    expect(evaluateCandidateExpression(expression, { condition: false }))
      .toEqual({ value: 1, dependencies: ["condition"] });
    expect(evaluateCandidateExpression(andCandidate(true, false), {}).value).toBe(false);
    expect(evaluateCandidateExpression(equalCandidate(
      { dimension: "length", value: 2 },
      { dimension: "length", value: 2 },
    ), {}).value).toBe(true);
    expect(evaluateCandidateExpression(interpolateCandidate(
      2,
      [0, 1],
      [{ dimension: "length", value: 0 }, { dimension: "length", value: 10 }],
      { clamp: true },
    ), {}).value).toEqual({ dimension: "length", value: 10 });
    const angle = createCandidateReadExpression("angle");
    expect(() => evaluateCandidateExpression(addCandidate(
      angle,
      { dimension: "angle", value: 1 },
    ), { angle: { dimension: "length", value: 2 } })).toThrow("same dimension");
    expect(evaluateCandidateExpression(clampCandidate(12, 0, 10), {}).value).toBe(10);
    expect(() => evaluateCandidateExpression(clampCandidate(1, 2, 0), {}))
      .toThrow("bounds are reversed");
    expect(evaluateCandidateExpression(normalizeCandidate(
      { dimension: "length", value: 14 },
      [{ dimension: "length", value: 0 }, { dimension: "length", value: 10 }],
      { clamp: true },
    ), {}).value).toBe(1);
    expect(() => evaluateCandidateExpression(normalizeCandidate(
      { dimension: "length", value: 5 },
      [{ dimension: "length", value: 5 }, { dimension: "length", value: 5 }],
      { clamp: false },
    ), {})).toThrow("zero extent");
    expect(evaluateReferenceExpression({
      kind: "or",
      left: { kind: "literal", value: false },
      right: { kind: "literal", value: true },
    }, {}).value).toBe(true);
    expect(evaluateReferenceExpression({
      kind: "compare",
      relation: "less",
      left: { kind: "literal", value: { dimension: "scalar", value: 1 } },
      right: { kind: "literal", value: { dimension: "scalar", value: 1 } },
    }, {}).value).toBe(false);
    expect(evaluateReferenceExpression({
      kind: "clamp",
      value: { kind: "literal", value: { dimension: "scalar", value: 12 } },
      minimum: { kind: "literal", value: { dimension: "scalar", value: 0 } },
      maximum: { kind: "literal", value: { dimension: "scalar", value: 10 } },
    }, {}).value).toEqual({ dimension: "scalar", value: 10 });
    expect(() => evaluateReferenceExpression({
      kind: "clamp",
      value: { kind: "literal", value: { dimension: "scalar", value: 1 } },
      minimum: { kind: "literal", value: { dimension: "scalar", value: 2 } },
      maximum: { kind: "literal", value: { dimension: "scalar", value: 0 } },
    }, {})).toThrow("bounds are reversed");
  });

  test("candidate compiler preserves action and expression meaning as canonical data", () => {
    const Button = issueCandidateStructurePart("Compiler", "Button", "button");
    const structure = normalizeCandidateStructure(Button({
      name: "Run",
      activate: issueCandidateAction("Compiler.run"),
    }));
    expect(structure.nodes[0]?.actions).toEqual([
      { event: "activate", action: "Compiler.run" },
    ]);
    expect(() => normalizeCandidateStructure(Button({ name: "Raw", activate() {} })))
      .toThrow("not issued by the compiler");
    const expression = createCandidateReadExpression("interaction.opacity");
    const artifact = compileCandidateComponentArtifact({
      component: "Compiler",
      behavior: normalizeCandidateStatechart<OracleChartApp, "Workflow">({
        initial: "left",
        states: { left: {}, right: {}, sync: {} },
      }, ["sync"]),
      structure,
      targets: {
        targets: { z: 1, a: expression },
        valueTypes: { a: "number", z: "number" },
        transitions: [],
        transaction: { targets: ["a", "z"] },
      },
      relationships: normalizeSemanticRelationships([], []),
      directManipulation: normalizeCandidateDirectManipulation([]),
      layout: normalizeSemanticLayout([], []),
    });
    expect(artifact.json).toContain('"action": "Compiler.run"');
    expect(artifact.json).toContain('"kind": "read"');
    expect(Object.keys(artifact.value.presentation.targets.targets)).toEqual(["a", "z"]);
    expect(artifact.value.structure.nodes[0]?.platformKind).toBe("button");
    expect(lowerCandidateStructureToWeb(artifact.value.structure)[0]).toMatchObject({
      element: "button",
      attributes: { type: "button" },
      events: [{ event: "click", action: "Compiler.run" }],
    });
    const capabilities = deriveCandidateArtifactCapabilities(artifact.value);
    expect(capabilities).toContain("semantic.action.activate");
    expect(capabilities).toContain("expression.read");
    expect(() => validateCandidateArtifactCapabilities(
      artifact.value,
      new Set(capabilities.filter((capability) => capability !== "expression.read")),
    )).toThrow('required UI meaning "expression.read"');
    const live = {
      presence: [
        { identity: "Compiler.Button", phase: "exiting" },
        { identity: "Compiler.Button", phase: "exiting" },
        { identity: "Removed", phase: "present" },
      ],
      motions: [
        { kind: "scalar", identity: "a", value: 0.4, velocity: -1.5 },
        { kind: "scalar", identity: "z", value: 0.8, velocity: 0.25 },
      ],
      tasks: ["Compiler.sync", "Compiler.sync"],
      gestures: ["Compiler.drag"],
    };
    const presentationReload = {
      ...artifact.value,
      presentation: {
        ...artifact.value.presentation,
        targets: {
          ...artifact.value.presentation.targets,
          targets: { a: 0.5, next: 1 },
          valueTypes: { a: "number", next: "number" },
          transaction: { targets: ["a", "next"] },
        },
      },
    };
    const reload = resolveCandidateHotReload(artifact.value, presentationReload, live);
    expect(reload).toEqual(resolveReferenceHotReload(
      deriveCandidateHotReloadDescriptor(artifact.value),
      deriveCandidateHotReloadDescriptor(presentationReload),
      live,
    ));
    expect(reload).toMatchObject({
      cause: "presentation",
      remount: false,
      retain: {
        context: true,
        state: true,
        presence: [{ identity: "Compiler.Button", phase: "exiting" }],
        motion: [{ kind: "scalar", identity: "a", value: 0.4, velocity: -1.5 }],
      },
      dispose: { motions: ["z"], tasks: ["Compiler.sync"] },
    });
    const execution: string[] = [];
    executeCandidateHotReload(artifact.value, presentationReload, {
      snapshot: () => live,
      disposeMotion: (identity) => execution.push("motion:" + identity),
      disposeTask: (identity) => execution.push("task:" + identity),
      disposeGesture: (identity) => execution.push("gesture:" + identity),
      rebind: (_next, retained) =>
        execution.push(
          "rebind:" + retained.presence[0]?.phase + ":" + retained.motion[0]?.velocity,
        ),
      remount: () => execution.push("remount"),
    });
    expect(execution).toEqual([
      "motion:z",
      "task:Compiler.sync",
      "gesture:Compiler.drag",
      "rebind:exiting:-1.5",
    ]);
    const policyOnlyLayout = {
      ...artifact.value,
      presentation: {
        ...artifact.value.presentation,
        targets: {
          ...artifact.value.presentation.targets,
          transaction: { targets: ["a", "Compiler.Root:geometry"] },
          valueTypes: {
            ...artifact.value.presentation.targets.valueTypes,
            "Compiler.Root:geometry": "geometry",
          },
        },
      },
    };
    expect(deriveCandidateHotReloadDescriptor(policyOnlyLayout).targetIdentities).toEqual([
      "Compiler.Root:geometry",
      "a",
    ]);
    const previousDescriptor = deriveCandidateHotReloadDescriptor(artifact.value);
    expect(resolveReferenceHotReload(
      previousDescriptor,
      { ...previousDescriptor, contract: previousDescriptor.contract + ":changed" },
      live,
    )).toMatchObject({
      cause: "contract",
      remount: true,
      retain: { context: false, state: false, presence: [], motion: [] },
    });
    const incompatible = {
      ...presentationReload,
      structure: {
        ...presentationReload.structure,
        nodes: presentationReload.structure.nodes.map((node) => ({ ...node, role: "link" })),
      },
    };
    expect(resolveCandidateHotReload(artifact.value, incompatible, live)).toMatchObject({
      cause: "contract",
      remount: true,
      retain: { context: false, state: false, presence: [], motion: [] },
    });
    const incompatibleElement = {
      ...presentationReload,
      structure: {
        ...presentationReload.structure,
        nodes: presentationReload.structure.nodes.map((node) => ({
          ...node,
          platformKind: "div",
        })),
      },
    };
    expect(resolveCandidateHotReload(artifact.value, incompatibleElement, live)).toMatchObject({
      cause: "contract",
      remount: true,
    });
  });

  test("candidate web structure lowering preserves native meaning", () => {
    const Root = issueCandidateStructurePart("Native", "Root", "main");
    const Query = issueCandidateStructurePart("Native", "Query", "input");
    const Help = issueCandidateStructurePart("Native", "Help", "a");
    const structure = normalizeCandidateStructure(Root(
      {},
      Query({
        name: "Search",
        value: "Ada",
        change: issueCandidateAction("Native.changeQuery"),
      }),
      Help({
        name: "Help",
        destination: "/help",
        activate: issueCandidateAction("Native.openHelp"),
      }),
    ));
    const web = lowerCandidateStructureToWeb(structure);
    expect(web.find((node) => node.identity === "Native.Query")).toMatchObject({
      element: "input",
      properties: { value: "Ada" },
      events: [{ event: "input", action: "Native.changeQuery" }],
    });
    expect(web.find((node) => node.identity === "Native.Help")).toMatchObject({
      element: "a",
      attributes: { href: "/help" },
      events: [{ event: "click", action: "Native.openHelp" }],
    });
    expect(() => lowerCandidateStructureToWeb({
      ...structure,
      nodes: structure.nodes.map((node) => ({ ...node, platformKind: "script" })),
    })).toThrow("unsafe web element");
  });

  test("candidate web presentation lowering preserves target type and execution strategy", () => {
    const opacity = createCandidateTargetHandle("Surface", "opacity", "number");
    const size = createCandidateTargetHandle("Surface", "blockSize", "length");
    const fill = createCandidateTargetHandle("Surface", "fill", "paint");
    const scene = normalizeSemanticOperations([
      setCandidateTarget(fill, {
        kind: "solid",
        color: { colorSpace: "oklch", lightness: 0.8, chroma: 0.1, hue: 20, alpha: 1 },
      }),
      setCandidateTarget(createCandidateTargetHandle("Surface", "foreground", "paint"), {
        kind: "solid",
        color: { colorSpace: "oklch", lightness: 0.2, chroma: 0.02, hue: 20, alpha: 1 },
      }),
      setCandidateTarget(size, createCandidateReadExpression("surface.size")),
      setCandidateTarget(opacity, createCandidateReadExpression("surface.opacity")),
      transitionCandidateTarget(opacity, createCandidateTransitionPolicy("fade", {
        normal: { kind: "spring", mass: 1, stiffness: 400, damping: 32 },
        reduced: { kind: "instant" },
      })),
    ]);
    expect(lowerCandidatePresentationToWeb(scene).map(({ target, identity, valueType, strategy }) => ({
      target,
      identity,
      valueType,
      strategy,
    }))).toEqual([
      { target: "Surface:blockSize", identity: "Surface", valueType: "length", strategy: "reactive-property" },
      { target: "Surface:fill", identity: "Surface", valueType: "paint", strategy: "stylesheet" },
      { target: "Surface:foreground", identity: "Surface", valueType: "paint", strategy: "stylesheet" },
      { target: "Surface:opacity", identity: "Surface", valueType: "number", strategy: "retained-motion" },
    ]);
    expect(() => normalizeSemanticOperations([
      setCandidateTarget(createCandidateTargetHandle("Surface", "conflict", "number"), 1),
      setCandidateTarget(createCandidateTargetHandle("Surface", "conflict", "paint"), {
        kind: "solid",
        color: { colorSpace: "oklch", lightness: 0.8, chroma: 0.1, hue: 20, alpha: 1 },
      }),
    ])).toThrow("has both");
    expect(() => lowerCandidatePresentationToWeb(normalizeSemanticOperations([
      setCandidateTarget(createCandidateTargetHandle("Surface", "unknown"), 1),
    ]))).toThrow("no concrete value type");
    expect(() => createCandidateTargetHandle("", "malformed", "number"))
      .toThrow("non-empty identity");

    const webTargets = lowerCandidatePresentationToWeb(scene);
    expect(lowerCandidatePresentationTargetToWebStyle(
      webTargets.find((target) => target.property === "fill"),
    )).toEqual([{ name: "background", value: "oklch(80% 0.1 20 / 1)" }]);
    expect(lowerCandidatePresentationTargetToWebStyle(
      webTargets.find((target) => target.property === "foreground"),
    )).toEqual([{ name: "color", value: "oklch(20% 0.02 20 / 1)" }]);
    expect(lowerCandidatePresentationTargetToWebStyle(
      webTargets.find((target) => target.property === "opacity"),
      { "surface.opacity": 0.6 },
    )).toEqual([{ name: "opacity", value: "0.6" }]);
    const capsule = lowerCandidatePresentationToWeb(normalizeSemanticOperations([
      setCandidateTarget(createCandidateTargetHandle("Surface", "shape", "shape"), {
        kind: "capsule",
      }),
    ]))[0];
    expect(lowerCandidatePresentationTargetToWebStyle(capsule))
      .toEqual([{ name: "border-radius", value: "9999px" }]);
    const material = lowerCandidatePresentationToWeb(normalizeSemanticOperations([
      setCandidateTarget(createCandidateTargetHandle("Surface", "material", "material"), {
        backdropBlur: { dimension: "length", value: 12 },
        backdropSaturation: 1,
        tint: {
          kind: "solid",
          color: { colorSpace: "oklch", lightness: 0.8, chroma: 0.1, hue: 20, alpha: 1 },
        },
        noise: 0,
      }),
    ]))[0];
    expect(() => lowerCandidatePresentationTargetToWebStyle(material))
      .toThrow("node-level material and fill composition");
    const glassFill = createCandidateTargetHandle("Glass", "fill", "paint");
    const glass = normalizeSemanticOperations([
      setCandidateTarget(glassFill, {
        kind: "solid",
        color: { colorSpace: "oklch", lightness: 0.1, chroma: 0.02, hue: 250, alpha: 0.7 },
      }),
      transitionCandidateTarget(glassFill, createCandidateTransitionPolicy("glass", {
        normal: { kind: "spring", mass: 1, stiffness: 400, damping: 32 },
        reduced: { kind: "instant" },
      })),
      setCandidateTarget(createCandidateTargetHandle("Glass", "material", "material"), {
        backdropBlur: { dimension: "length", value: 18 },
        backdropSaturation: 1.24,
        tint: {
          kind: "solid",
          color: { colorSpace: "oklch", lightness: 0.98, chroma: 0.01, hue: 250, alpha: 0.36 },
        },
        noise: 0,
      }),
    ]);
    expect(lowerCandidatePresentationSceneToWebStyle(glass)[0].declarations).toEqual([
      {
        name: "background",
        value: "linear-gradient(oklch(98% 0.01 250 / 0.36), oklch(98% 0.01 250 / 0.36)), oklch(10% 0.02 250 / 0.7)",
      },
      { name: "backdrop-filter", value: "blur(18px) saturate(1.24)" },
    ]);
    expect(lowerCandidatePresentationSceneToWebStyle(glass)[0].channels).toEqual([
      {
        name: "background",
        strategy: "retained-motion",
        sources: ["Glass:fill", "Glass:material"],
      },
      {
        name: "backdrop-filter",
        strategy: "stylesheet",
        sources: ["Glass:material"],
      },
    ]);
    expect(() => lowerCandidatePresentationSceneToWebStyle(normalizeSemanticOperations([
      setCandidateTarget(createCandidateTargetHandle("Glass", "material", "material"), {
        backdropBlur: { dimension: "length", value: 18 },
        backdropSaturation: 1.24,
        tint: {
          kind: "solid",
          color: { colorSpace: "oklch", lightness: 0.98, chroma: 0.01, hue: 250, alpha: 0.36 },
        },
        noise: 0.1,
      }),
    ]))).toThrow("generated noise-layer lowering");
    const geometry = createCandidateDerivedTargetHandle("Results", "geometry", "geometry");
    const geometryScene = normalizeSemanticOperations([
      transitionCandidateTarget(geometry, createCandidateTransitionPolicy("results-layout", {
        normal: {
          kind: "layout",
          driver: { kind: "spring", mass: 1, stiffness: 360, damping: 32 },
        },
        reduced: { kind: "instant" },
      })),
    ], [geometry]);
    expect(lowerCandidatePresentationToWeb(geometryScene)[0]).toMatchObject({
      target: "Results:geometry",
      identity: "Results",
      encoding: "layout",
    });
    expect(lowerCandidatePresentationSceneToWebStyle(geometryScene)).toEqual([]);
    expect(lowerCandidatePresentationToWebLayout(geometryScene)).toEqual([
      {
        target: "Results:geometry",
        identity: "Results",
        strategy: "retained-layout",
        transition: {
          normal: {
            kind: "layout",
            driver: { kind: "spring", mass: 1, stiffness: 360, damping: 32 },
          },
          reduced: { kind: "instant" },
        },
      },
    ]);
  });

  test("candidate web execution mounts once and disposes every owner once", () => {
    const Button = issueCandidateStructurePart("Mount", "Button", "button");
    const structure = normalizeCandidateStructure(Button({
      name: "Run",
      activate: issueCandidateAction("Mount.run"),
    }, "Run"));
    const listeners = new Map();
    const dispatches = [];
    const cleanups = [];
    const removals = [];
    const mounted = mountCandidateStructureToWeb(structure, {
      create: (element, identity) => ({ element, identity, children: [], attributes: {} }),
      text: (value) => ({ element: "#text", identity: value, children: [] }),
      attribute(node, name, value) {
        if (value === undefined) delete node.attributes[name];
        else node.attributes[name] = value;
      },
      property() {},
      listen(node, event, listener) {
        listeners.set(event, listener);
        return () => {
          listeners.delete(event);
          cleanups.push(node.identity + ":" + event);
        };
      },
      append(parent, child) { parent.children.push(child); },
      remove(node) { removals.push(node.identity); },
    }, (action) => dispatches.push(action));
    listeners.get("click")?.({ type: "click" });
    expect(dispatches).toEqual(["Mount.run"]);
    expect(mounted.nodes.get("Mount.Button").children.map((child) => child.identity))
      .toEqual(["Run"]);
    const expanded = {
      ...structure,
      nodes: structure.nodes.map((node) => ({ ...node, expanded: true })),
    };
    expect(updateCandidateStructureOnWeb(structure, expanded, mounted, {
      attribute(node, name, value) {
        if (value === undefined) delete node.attributes[name];
        else node.attributes[name] = value;
      },
      property() {},
    })).toEqual([{ identity: "Mount.Button", kind: "attribute", name: "aria-expanded" }]);
    expect(mounted.nodes.get("Mount.Button").attributes["aria-expanded"]).toBe(true);
    expect(() => updateCandidateStructureOnWeb(structure, {
      ...structure,
      nodes: structure.nodes.map((node) => ({
        ...node,
        content: [{ kind: "text", value: "Changed" }],
      })),
    }, mounted, { attribute() {}, property() {} })).toThrow("native structure contract");
    mounted.dispose();
    mounted.dispose();
    expect(cleanups).toEqual(["Mount.Button:click"]);
    expect(removals).toEqual(["Mount.Button"]);

    const fill = createCandidateTargetHandle("Mount.Button", "fill", "paint");
    const opacity = createCandidateTargetHandle("Mount.Button", "opacity", "number");
    const scene = normalizeSemanticOperations([
      setCandidateTarget(fill, {
        kind: "solid",
        color: { colorSpace: "oklch", lightness: 0.8, chroma: 0.1, hue: 20, alpha: 1 },
      }),
      setCandidateTarget(opacity, createCandidateReadExpression("mount.opacity")),
      transitionCandidateTarget(opacity, createCandidateTransitionPolicy("fade", {
        normal: { kind: "spring", mass: 1, stiffness: 400, damping: 32 },
        reduced: { kind: "instant" },
      })),
    ]);
    const starts = [];
    const stops = [];
    const visuals = mountCandidatePresentationToWeb(scene, {
      stylesheet(target) {
        starts.push("stylesheet:" + target.property);
        return () => stops.push("stylesheet:" + target.property);
      },
      reactive(target) {
        starts.push("reactive:" + target.property);
        return () => stops.push("reactive:" + target.property);
      },
      retained(target) {
        starts.push("retained:" + target.property);
        return () => stops.push("retained:" + target.property);
      },
    });
    expect(starts).toEqual(["stylesheet:fill", "retained:opacity"]);
    visuals.dispose();
    visuals.dispose();
    expect(stops).toEqual(["retained:opacity", "stylesheet:fill"]);
  });

  test("candidate gesture intent is explicit, exhaustive, and accessible", () => {
    const contract = {
      drag: { kind: "drag", outcomes: ["cancel", "commit"] },
      pinch: { kind: "pinch", outcomes: ["reset"] },
    } as const;
    const definitions = {
      drag: {
        region: "Surface",
        activation: { axis: "both", threshold: { dimension: "length", value: 2 } },
        outcomes: { cancel: { action: "cancel" }, commit: { action: "commit" } },
        alternative: { kind: "action", action: "move" },
        relations: [{ kind: "simultaneous", with: "pinch" }],
      },
      pinch: {
        region: "Surface",
        activation: { threshold: 0.04 },
        outcomes: { reset: { action: "reset" } },
        alternative: { kind: "action", action: "zoom" },
      },
    } as const;
    const parts = new Set(["Surface"]);
    const actions = new Set(["move", "cancel", "commit", "zoom", "reset"]);
    expect(normalizeCandidateRecognizers<OracleGestureApp, "Canvas">(
      "Canvas",
      definitions,
      contract,
      parts,
      actions,
    ).relations).toEqual([{ kind: "simultaneous", first: "drag", second: "pinch" }]);
    expect(() => normalizeCandidateRecognizers<OracleGestureApp, "Canvas">(
      "Canvas",
      { ...definitions, drag: { ...definitions.drag, relations: [] } },
      contract,
      parts,
      actions,
    )).toThrow("no explicit relationship");
    expect(() => normalizeCandidateRecognizers<OracleGestureApp, "Canvas">(
      "Canvas",
      definitions,
      { ...contract, drag: { kind: "drag", outcomes: ["cancel"] } } as never,
      parts,
      actions,
    )).toThrow("outcomes do not match");
    expect(() => normalizeCandidateRecognizers<OracleGestureApp, "Canvas">(
      "Canvas",
      {
        ...definitions,
        drag: {
          ...definitions.drag,
          alternative: { kind: "action", action: "missing" },
        },
      } as never,
      contract,
      parts,
      actions,
    )).toThrow("declared alternative action");

    expect(() => normalizeCandidateRecognizers<OracleGestureCycleApp, "Canvas">(
      "Canvas",
      {
        drag: {
          region: "Surface",
          activation: { axis: "both", threshold: { dimension: "length", value: 2 } },
          outcomes: { cancel: { action: "cancel" }, commit: { action: "commit" } },
          alternative: { kind: "action", action: "move" },
          relations: [{ kind: "afterFailure", with: "pinch" }],
        },
        pinch: {
          region: "Surface",
          activation: { threshold: 0.04 },
          outcomes: { reset: { action: "reset" } },
          alternative: { kind: "action", action: "zoom" },
          relations: [{ kind: "afterFailure", with: "rotate" }],
        },
        rotate: {
          region: "Surface",
          activation: { threshold: { dimension: "angle", value: 2 } },
          outcomes: { finish: { action: "finish" } },
          alternative: { kind: "action", action: "turn" },
          relations: [{ kind: "afterFailure", with: "drag" }],
        },
      },
      {
        drag: { kind: "drag", outcomes: ["cancel", "commit"] },
        pinch: { kind: "pinch", outcomes: ["reset"] },
        rotate: { kind: "rotate", outcomes: ["finish"] },
      },
      parts,
      new Set([...actions, "turn", "finish"]),
    )).toThrow("Composition cycle");
  });

  test("derived interaction recognizers retain accessibility and geometry laws", () => {
    const definitions = {
      preview: {
        region: "Trigger",
        activation: {
          dwell: { dimension: "time", value: 0.1 },
          maximumSpeed: { perSecond: { dimension: "length", value: 80 } },
          leaveDelay: { dimension: "time", value: 0.08 },
        },
        handoff: { destination: "Panel", corridor: "safe-polygon" },
        outcomes: {
          engaged: { action: "open" },
          disengaged: { action: "close" },
        },
        alternative: { kind: "focus" },
        relations: [{ kind: "simultaneous", with: "inspect" }],
      },
      inspect: {
        region: "Trigger",
        activation: {
          duration: { dimension: "time", value: 0.45 },
          movementTolerance: { dimension: "length", value: 8 },
        },
        outcomes: {
          recognized: { action: "open" },
          released: { action: "close" },
          cancelled: { action: "cancel" },
        },
        alternative: { kind: "action", action: "keyboard" },
      },
    } as const;
    const contract = {
      preview: { kind: "hoverIntent", outcomes: ["engaged", "disengaged"] },
      inspect: { kind: "longPress", outcomes: ["recognized", "released", "cancelled"] },
    } as const;
    const parts = new Set(["Trigger", "Panel"]);
    const actions = new Set(["open", "close", "keyboard", "cancel"]);
    const interactionScene = normalizeCandidateRecognizers<OracleInteractionApp, "Disclosure">(
      "Disclosure",
      definitions,
      contract,
      parts,
      actions,
    );
    expect(interactionScene.intents.map((intent) => intent.kind))
      .toEqual(["longPress", "hoverIntent"]);
    expect(() => normalizeCandidateRecognizers<OracleInteractionApp, "Disclosure">(
      "Disclosure",
      {
        ...definitions,
        preview: {
          ...definitions.preview,
          alternative: { kind: "action", action: "keyboard" },
        },
      } as never,
      contract,
      parts,
      actions,
    )).toThrow("requires focus equivalence");
    expect(() => normalizeCandidateRecognizers<OracleInteractionApp, "Disclosure">(
      "Disclosure",
      {
        ...definitions,
        preview: {
          ...definitions.preview,
          handoff: { destination: "Missing", corridor: "safe-polygon" },
        },
      } as never,
      contract,
      parts,
      actions,
    )).toThrow("invalid handoff destination");
    expect(() => normalizeCandidateRecognizers<OracleInteractionApp, "Disclosure">(
      "Disclosure",
      {
        ...definitions,
        inspect: {
          ...definitions.inspect,
          activation: {
            ...definitions.inspect.activation,
            duration: { dimension: "time", value: 0 },
          },
        },
      },
      contract,
      parts,
      actions,
    )).toThrow("positive duration");
    expect(() => normalizeCandidateRecognizers<OracleInteractionApp, "Disclosure">(
      "Disclosure",
      definitions,
      {
        ...contract,
        preview: { kind: "hoverIntent", outcomes: ["engaged"] },
      } as never,
      parts,
      actions,
    )).toThrow("inconsistent generated outcome contract");

    const hover = new CandidateHoverIntentAdapter(interactionScene, "preview");
    hover.enter(0, 0, 0);
    expect(hover.advance(99)).toBeUndefined();
    expect(hover.advance(100)?.signal).toBe("engaged");
    expect(hover.leave(110, "safe-polygon")).toBeUndefined();
    expect(hover.advance(200)).toBeUndefined();
    expect(hover.snapshot.engaged).toBe(true);
    expect(hover.destination(210, true)).toBeUndefined();
    hover.destination(220, false);
    expect(hover.advance(299)).toBeUndefined();
    expect(hover.advance(300)?.signal).toBe("disengaged");
    expect(hover.focus(310, true)?.signal).toBe("engaged");

    const longPress = new CandidateLongPressAdapter(interactionScene, "inspect");
    const revision = longPress.down(4, 0, 0, 0);
    expect(longPress.advance(449)).toBeUndefined();
    expect(longPress.advance(450)?.signal).toBe("recognized");
    expect(longPress.up(revision, 4, 451)?.signal).toBe("released");
    const next = longPress.down(5, 500, 0, 0);
    expect(longPress.move(next, 5, 510, 9, 0)?.signal).toBe("cancelled");
    expect(longPress.cancel(next, 5, 520)).toBeUndefined();
  });

  test("candidate web gesture lowering preserves recognition and capture laws", () => {
    const dragScene = {
      intents: [{
        name: "drag",
        kind: "drag",
        region: "Surface",
        activation: { axis: "block", threshold: { dimension: "length", value: 4 } },
        outcomes: [{ outcome: "done", action: "done" }],
        alternative: { kind: "action", action: "keyboard" },
        available: "Canvas.recognizer.drag.available",
      }],
      relations: [],
    } as const;
    const unavailable = new CandidateWebGestureAdapter(dragScene, { drag: false });
    expect(unavailable.alternative("drag")).toEqual({ kind: "action", action: "keyboard" });
    unavailable.process({
      phase: "down", pointer: 1, region: "Surface", inline: 0, block: 0, time: 0,
    });
    expect(unavailable.process({
      phase: "move", pointer: 1, region: "Surface", inline: 0, block: 10, time: 10,
    }).events).toEqual([]);

    const adapter = new CandidateWebGestureAdapter(dragScene);
    adapter.process({
      phase: "down", pointer: 2, region: "Surface", inline: 0, block: 0, time: 0,
    });
    expect(adapter.process({
      phase: "move", pointer: 2, region: "Surface", inline: 0, block: 2, time: 2,
    }).events).toEqual([]);
    expect(adapter.process({
      phase: "move", pointer: 2, region: "Surface", inline: 0, block: 8, time: 8,
    }).effects).toEqual([{ kind: "capture", pointer: 2, region: "Surface" }]);
    adapter.process({
      phase: "up", pointer: 2, region: "Surface", inline: 0, block: 8, time: 9,
    });
    adapter.process({
      phase: "down", pointer: 2, region: "Surface", inline: 0, block: 0, time: 10,
    });
    expect(adapter.process({
      phase: "move", pointer: 2, region: "Surface", inline: 0, block: 8, time: 18,
    }).effects).toEqual([{ kind: "capture", pointer: 2, region: "Surface" }]);

    const exclusive = new CandidateWebGestureAdapter({
      intents: [
        { ...dragScene.intents[0], name: "first" },
        { ...dragScene.intents[0], name: "second" },
      ],
      relations: [{ kind: "exclusive", first: "second", second: "first" }],
    });
    exclusive.process({
      phase: "down", pointer: 3, region: "Surface", inline: 0, block: 0, time: 0,
    });
    expect(exclusive.process({
      phase: "move", pointer: 3, region: "Surface", inline: 0, block: 8, time: 8,
    }).events.map((event) => event.gesture)).toEqual(["second"]);

    const dependent = new CandidateWebGestureAdapter({
      intents: [
        {
          ...dragScene.intents[0],
          name: "horizontal",
          kind: "pan",
          activation: { axis: "inline", threshold: { dimension: "length", value: 4 } },
        },
        { ...dragScene.intents[0], name: "vertical", kind: "pan" },
      ],
      relations: [{ kind: "afterFailure", first: "vertical", second: "horizontal" }],
    });
    dependent.process({
      phase: "down", pointer: 4, region: "Surface", inline: 0, block: 0, time: 0,
    });
    expect(dependent.process({
      phase: "move", pointer: 4, region: "Surface", inline: 1, block: 8, time: 8,
    }).events.map((event) => event.gesture)).toEqual(["vertical"]);

    const waiting = new CandidateWebGestureAdapter({
      intents: [
        {
          ...dragScene.intents[0],
          name: "required",
          activation: { axis: "block", threshold: { dimension: "length", value: 20 } },
        },
        { ...dragScene.intents[0], name: "waiter" },
      ],
      relations: [{ kind: "afterFailure", first: "waiter", second: "required" }],
    });
    waiting.process({
      phase: "down", pointer: 8, region: "Surface", inline: 0, block: 0, time: 0,
    });
    expect(waiting.process({
      phase: "move", pointer: 8, region: "Surface", inline: 0, block: 8, time: 8,
    }).events).toEqual([]);

    const scrollScene = {
      intents: [{
        ...dragScene.intents[0],
        scroll: { owner: "Content", boundary: "start", outward: "positive" },
      }],
      relations: [],
    } as const;
    const scrolled = new CandidateWebGestureAdapter(
      scrollScene,
      {},
      () => ({ position: 40, minimum: 0, maximum: 500 }),
    );
    scrolled.process({
      phase: "down", pointer: 9, region: "Surface", inline: 0, block: 0, time: 0,
    });
    expect(scrolled.process({
      phase: "move", pointer: 9, region: "Surface", inline: 0, block: 8, time: 8,
    }).events).toEqual([]);

    const multi = new CandidateWebGestureAdapter({
      intents: [
        {
          name: "pinch",
          kind: "pinch",
          region: "Canvas",
          activation: { threshold: 0.05 },
          outcomes: [{ outcome: "done", action: "done" }],
          alternative: { kind: "action", action: "zoom" },
        },
      ],
      relations: [],
    });
    multi.process({ phase: "down", pointer: 5, region: "Canvas", inline: 0, block: 0, time: 0 });
    multi.process({
      phase: "down", pointer: 6, region: "Canvas", inline: 100, block: 0, time: 0,
    });
    const multiSample = multi.process({
      phase: "move", pointer: 6, region: "Canvas", inline: 120, block: 0, time: 20,
    }).events[0]!.sample;
    expect(multiSample.kind).toBe("scale");
    if (multiSample.kind !== "scale") throw new Error("Expected a scale sample.");
    expect(multiSample.value).toBe(1.2);
    expect(multiSample.velocity).toBeCloseTo(10, 10);

    const predicted = new CandidateWebGestureAdapter(dragScene);
    predicted.process({
      phase: "down", pointer: 7, region: "Surface", inline: 0, block: 0, time: 0,
    });
    expect(predicted.processPacket({
      current: {
        phase: "move", pointer: 7, region: "Surface", inline: 0, block: 6, time: 10,
      },
      predicted: [{
        phase: "move", pointer: 7, region: "Surface", inline: 0, block: 20, time: 20,
      }],
    }).events.map((event) => event.phase)).toEqual(["begin"]);

    const node = { listeners: new Map() };
    const captures = [];
    const releases = [];
    const touchActions = [];
    const mountedEvents = [];
    const mounted = mountCandidateGesturesToWeb(
      { ...dragScene, intents: [{ ...dragScene.intents[0], available: undefined }] },
      new Map([["Surface", node]]),
      {
        listen(owner, event, listener) {
          owner.listeners.set(event, listener);
          return () => owner.listeners.delete(event);
        },
        touchAction(_owner, value) {
          touchActions.push(value);
          return () => {};
        },
        capture(_owner, pointer) {
          captures.push(pointer);
        },
        release(_owner, pointer) {
          releases.push(pointer);
        },
      },
      (event) => mountedEvents.push([event.phase, event.reason]),
    );
    node.listeners.get("pointerdown")({
      pointerId: 20, clientX: 0, clientY: 0, timeStamp: 0,
    });
    node.listeners.get("pointermove")({
      pointerId: 20, clientX: 0, clientY: 8, timeStamp: 8,
    });
    expect(touchActions).toEqual(["pan-x"]);
    expect(captures).toEqual([20]);
    mounted.dispose();
    mounted.dispose();
    expect(releases).toEqual([20]);
    expect(mountedEvents).toEqual([
      ["begin", undefined],
      ["cancel", "capture-lost"],
    ]);
  });

  test("candidate presentation cannot overwrite layout geometry", () => {
    const geometry = createCandidateDerivedTargetHandle("surface", "geometry");
    expect(() => normalizeSemanticOperations([
      { kind: "set", target: geometry, value: 1 },
    ], [geometry])).toThrow("owned by another semantic domain");
  });

  test("candidate preset parameters obey structure bounds", () => {
    const distance = issueCandidateParameterHandle("distance");
    expect(() => normalizeCandidateParameters([
      { parameter: distance, default: 0.5, minimum: 0.1, maximum: 0.9 },
    ], [setCandidateParameter(distance, 0)])).toThrow("outside its bounds");
  });

  test("candidate policies reject nonphysical springs", () => {
    expect(() => createCandidateTransitionPolicy("invalid", {
      normal: { kind: "spring", mass: 0, stiffness: 420, damping: 34 },
      reduced: { kind: "instant" },
    })).toThrow("Spring parameters");
  });

  test("candidate presence awaits only local transitioned targets", () => {
    const content = createCandidatePresentationIdentity("content");
    const other = createCandidatePresentationIdentity("other");
    const contentOpacity = createCandidateTargetHandle("content", "opacity");
    const otherOpacity = createCandidateTargetHandle("other", "opacity");
    const scene = normalizeSemanticOperations([setCandidateTarget(contentOpacity, 0)]);
    expect(() => normalizeCandidatePresence(
      [content, other],
      [retainCandidate(content, [otherOpacity])],
      scene,
    )).toThrow("cannot await target");
    expect(() => normalizeCandidatePresence(
      [content],
      [retainCandidate(content, [contentOpacity])],
      scene,
    )).toThrow("has no transition policy");
    const retained = normalizeCandidatePresence(
      [content],
      [retainCandidate(content, [contentOpacity])],
      normalizeSemanticOperations([
        setCandidateTarget(contentOpacity, 0),
        transitionCandidateTarget(
          contentOpacity,
          createCandidateTransitionPolicy("fade", {
            normal: { kind: "timing", milliseconds: 100, curve: { kind: "linear" } },
            reduced: { kind: "instant" },
          }),
        ),
      ]),
    );
    expect(retained[0].release).toEqual({
      interaction: "exit-start",
      accessibility: "exit-start",
      unmount: "all-settled",
      stale: "ignore",
    });
  });

  test("candidate visual values enforce normalized domains and gradient order", () => {
    const layer = createCandidateLayer(createCandidatePresentationIdentity("root"), "layer");
    const color = { colorSpace: "oklch", lightness: 0.5, chroma: 0.1, hue: 0, alpha: 1 };
    const generatedScene = normalizeSemanticOperations([
      setCandidateTarget(layer.fill, { kind: "solid", color }),
      setCandidateTarget(layer.opacity, 0.8),
    ]);
    expect(generatedScene.generated).toEqual([
      { identity: "root:layer:5:layer", owner: "root" },
    ]);
    expect(lowerCandidatePresentationSceneToWebStyle(generatedScene)[0].generated).toEqual({
      identity: "root:layer:5:layer",
      owner: "root",
    });
    expect(
      lowerCandidateWebSceneToStyle({
        structure: {
          nodes: [{ identity: "root", platformKind: "div", role: "generic" }],
          scene: { order: ["root"], parent: {} },
        },
        presentation: generatedScene,
        layout: normalizeSemanticLayout(
          [createCandidatePresentationIdentity("root"), layer.identity],
          [],
        ),
      }).find((entry) => entry.identity === layer.identity.key)?.declarations,
    ).toContainEqual({ name: "pointer-events", value: "none" });
    expect(() =>
      normalizeSemanticOperations([
        setCandidateTarget(layer.fill, { kind: "solid", color }),
        setCandidateTarget(
          { ...layer.opacity, generated: { identity: layer.identity.key, owner: "other" } },
          0.8,
        ),
      ]),
    ).toThrow("conflicting owners");
    expect(() => normalizeSemanticOperations([setCandidateTarget(layer.fill, {
      kind: "linear-gradient",
      angle: { dimension: "angle", value: 0 },
      stops: [{ position: 0.8, color }, { position: 0.2, color }],
    })])).toThrow("Gradient stops must be ordered");
    expect(() => normalizeSemanticOperations([setCandidateTarget(layer.shape, {
      kind: "rectangle",
      corners: {
        startStart: { radius: { dimension: "length", value: 1 }, smoothing: 2 },
        startEnd: { radius: { dimension: "length", value: 1 }, smoothing: 0 },
        endStart: { radius: { dimension: "length", value: 1 }, smoothing: 0 },
        endEnd: { radius: { dimension: "length", value: 1 }, smoothing: 0 },
      },
    })])).toThrow("within zero and one");
    const transform = createCandidateTargetHandle("root", "transform", "transform");
    expect(() => normalizeSemanticOperations([setCandidateTarget(transform, {
      translation: {
        inline: { dimension: "length", value: 0 },
        block: { dimension: "length", value: 0 },
        depth: { dimension: "length", value: 0 },
      },
      scale: { inline: 1, block: 1, depth: 1 },
      rotation: {
        axis: { x: 0, y: 0, z: 0 },
        angle: { dimension: "angle", value: 30 },
      },
      origin: { inline: 0.5, block: 0.5, depth: { dimension: "length", value: 0 } },
      perspective: "none",
    })])).toThrow("axis cannot be zero");
  });

  test("candidate masks cannot own themselves", () => {
    const identity = createCandidatePresentationIdentity("identity");
    expect(() => normalizeSemanticRelationships(
      [identity],
      [maskCandidate(identity, identity, "alpha")],
    )).toThrow("cannot mask itself");
  });

  test("candidate layout relationships retain semantic constraints", () => {
    const viewport = createCandidatePresentationIdentity("viewport");
    const content = createCandidatePresentationIdentity("content");
    const child = createCandidatePresentationIdentity("child");
    const outside = createCandidatePresentationIdentity("outside");
    expect(() => normalizeSemanticLayout(
      [content, child],
      [
        arrangeCandidate(content, [child], flowCandidate({
          axis: "block",
          gap: { dimension: "length", value: 0 },
          align: "stretch",
          distribute: "start",
          wrap: false,
        })),
        placeCandidate(child, { column: { start: 1 }, row: { start: 1 } }),
      ],
    )).toThrow("needs one grid parent");
    expect(() => normalizeSemanticLayout(
      [content, child],
      [
        arrangeCandidate(content, [child], gridCandidate({
          columns: [{ size: "fraction", value: 1 }],
          rows: [],
          gap: { dimension: "length", value: 0 },
        })),
        placeCandidate(child, { column: { start: 2 }, row: { start: 1 } }),
      ],
    )).toThrow("exceeds declared tracks");
    expect(() => normalizeSemanticLayout(
      [viewport, content, outside],
      [
        scrollCandidate(viewport, content, {
          axis: "block",
          behavior: "free",
          indicators: "automatic",
        }),
        stickCandidate(outside, viewport, {
          edge: "blockStart",
          inset: { dimension: "length", value: 0 },
        }),
      ],
    )).toThrow("outside scroll content");
  });
});
`;

const sourcePath = new URL("./ui-language-reference.ts", import.meta.url);
const source = await readFile(sourcePath, "utf8");
const candidateSourcePath = new URL("./ui-language-candidates.ts", import.meta.url);
const candidateSource = await readFile(candidateSourcePath, "utf8");
const directory = await mkdtemp(join(tmpdir(), "poggers-ui-mutations-"));
const referencePath = join(directory, "ui-language-reference.ts");
const candidatePath = join(directory, "candidate.ts");
const oraclePath = join(directory, "oracle.spec.ts");
const bun = Bun.which("bun") ?? process.execPath;

try {
  await writeFile(oraclePath, oracle);
  await writeFile(referencePath, source);
  await writeFile(candidatePath, candidateSource);
  const baseline = runOracle(bun, directory, oraclePath);
  if (baseline.exitCode !== 0) {
    throw new Error(`Mutation oracle baseline failed:\n${baseline.output}`);
  }

  const survivors: string[] = [];
  for (const mutation of mutations) {
    const original = mutation.file === "candidate" ? candidateSource : source;
    if (!original.includes(mutation.search)) {
      throw new Error(`Mutation anchor is missing: ${mutation.name}`);
    }
    const mutated = original.replace(mutation.search, mutation.replacement);
    await writeFile(referencePath, mutation.file === "candidate" ? source : mutated);
    await writeFile(candidatePath, mutation.file === "candidate" ? mutated : candidateSource);
    const result = runOracle(bun, directory, oraclePath);
    if (result.exitCode === 0) survivors.push(mutation.name);
  }

  if (survivors.length) {
    throw new Error(`Mutation survivors:\n- ${survivors.join("\n- ")}`);
  }

  console.log(`Killed ${mutations.length}/${mutations.length} UI semantic mutations.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}

function runOracle(
  executable: string,
  directory: string,
  specPath: string,
): { readonly exitCode: number; readonly output: string } {
  const result = Bun.spawnSync([executable, "test", specPath], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  return {
    exitCode: result.exitCode,
    output: `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`,
  };
}
