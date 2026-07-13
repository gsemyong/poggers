import { describe, expect, it } from "bun:test";
import fc from "fast-check";
import {
  ReferenceAutoScrollSession,
  ReferenceFocusRecoveryCoordinator,
  ReferenceGeometryRegistry,
  ReferenceGestureSession,
  ReferenceHoverIntent,
  ReferenceLongPress,
  ReferenceChartRuntime,
  ReferenceMotionChannel,
  ReferencePresenceCoordinator,
  ReferenceOverlayStack,
  ReferenceStatechart,
  ReferenceVirtualLayoutRegistry,
  deriveReferenceChannels,
  evaluateReferenceExpression,
  interpolateReferenceOklch,
  interpolateReferencePaint,
  interpolateReferenceRotation,
  interpolateReferenceShape,
  normalizeReferenceChart,
  projectReferenceGeometry,
  reconcileReferenceKeys,
  resolveReferenceComposition,
  resolveReferenceAdjustableCommand,
  resolveReferenceAdjustableValue,
  resolveReferenceAutoScroll,
  resolveReferenceChartEvent,
  resolveReferenceChartInitial,
  resolveReferenceFocusIndicator,
  resolveReferenceHotReload,
  resolveReferenceGestureArbitration,
  resolveReferenceGestureRelease,
  resolveReferenceRubberBand,
  resolveReferenceRovingFocus,
  resolveReferenceGestureRebase,
  resolveReferenceScrollCompetition,
  resolveReferenceSnapSet,
  resolveReferencePathMorph,
  resolveReferenceLayoutProjection,
  resolveReferenceLayoutTransition,
  resolveReferenceSharedIdentities,
  resolveReferenceStructureReconciliation,
  resolveReferenceTargets,
  resolveReferenceTokens,
  resolveReferenceTokenModes,
  resolveReferenceTransitionTransaction,
  resolveReferenceTransitionHandoff,
  resolveReferenceTransitionBatch,
  resolveReferenceTransitionUpdate,
  sampleReferenceSpring,
  settleReferencePresence,
  targetReferencePresence,
  validateReferenceSemanticTree,
} from "./ui-language-reference";

describe("UI language reference semantics", () => {
  it("resolves typed token aliases deterministically", () => {
    const left = resolveReferenceTokens({
      "color.text": { type: "color", value: { alias: "color.ink" } },
      "color.ink": { type: "color", value: { l: 0.2, c: 0, h: 0 } },
      "space.edge": { type: "length", value: 16 },
    });
    const right = resolveReferenceTokens({
      "space.edge": { type: "length", value: 16 },
      "color.ink": { type: "color", value: { l: 0.2, c: 0, h: 0 } },
      "color.text": { type: "color", value: { alias: "color.ink" } },
    });

    expect(left).toEqual(right);
    expect(left["color.text"]).toEqual(left["color.ink"]);
  });

  it("rejects token cycles and type-changing aliases with complete diagnostics", () => {
    expect(() =>
      resolveReferenceTokens({
        a: { type: "length", value: { alias: "b" } },
        b: { type: "length", value: { alias: "c" } },
        c: { type: "length", value: { alias: "a" } },
      }),
    ).toThrow("Token alias cycle: a -> b -> c -> a");

    expect(() =>
      resolveReferenceTokens({
        color: { type: "color", value: { l: 0.2 } },
        space: { type: "length", value: { alias: "color" } },
      }),
    ).toThrow('Token "space" has type "length" but aliases "color" of type "color".');
  });

  it("rejects two sources for one target property", () => {
    expect(() =>
      resolveReferenceTargets([
        { identity: "Drawer/Backdrop", property: "opacity", source: "paint", value: 1 },
        { identity: "Drawer/Backdrop", property: "opacity", source: "motion", value: 0 },
      ]),
    ).toThrow('Target "Drawer/Backdrop:opacity" is owned by both "paint" and "motion".');
  });

  it("resolves explicit composition with stable document-order fallback", () => {
    expect(
      resolveReferenceComposition(
        [
          { identity: "page", documentOrder: 0 },
          { identity: "chrome", documentOrder: 1 },
          { identity: "backdrop", documentOrder: 2 },
          { identity: "surface", documentOrder: 3 },
        ],
        [
          { below: "page", above: "chrome" },
          { below: "chrome", above: "backdrop" },
          { below: "backdrop", above: "surface" },
        ],
      ),
    ).toEqual(["page", "chrome", "backdrop", "surface"]);
  });

  it("rejects cyclic or unknown composition relationships", () => {
    expect(() =>
      resolveReferenceComposition(
        [
          { identity: "page", documentOrder: 0 },
          { identity: "page", documentOrder: 1 },
        ],
        [],
      ),
    ).toThrow('Duplicate composition identity "page".');
    expect(() =>
      resolveReferenceComposition(
        [
          { identity: "page", documentOrder: 0 },
          { identity: "dialog", documentOrder: 1 },
        ],
        [
          { below: "page", above: "dialog" },
          { below: "dialog", above: "page" },
        ],
      ),
    ).toThrow("Composition cycle: dialog -> page");
    expect(() =>
      resolveReferenceComposition(
        [{ identity: "page", documentOrder: 0 }],
        [{ below: "page", above: "missing" }],
      ),
    ).toThrow('Unknown composition identity "missing".');
  });

  it("reverses presence without creating a second identity", () => {
    expect(targetReferencePresence("absent", true)).toBe("entering");
    expect(settleReferencePresence("entering")).toBe("present");
    expect(targetReferencePresence("present", false)).toBe("exiting");
    expect(targetReferencePresence("exiting", true)).toBe("entering");
    expect(settleReferencePresence("entering")).toBe("present");
  });

  it("coordinates multi-target presence, immediate exit release, and stale reversal settlement", () => {
    const presence = new ReferencePresenceCoordinator("Drawer.Content");
    const targets = ["Drawer.Content:transform", "Drawer.Content:layer:8:backdrop:opacity"];
    const enter = presence.target(true, targets);
    expect(presence.snapshot).toMatchObject({
      phase: "entering",
      mounted: true,
      interactive: true,
      accessible: true,
      pending: [...targets].sort(),
    });
    expect(presence.settle(enter, targets[0]!)).toBe(false);
    expect(presence.settle(enter, targets[1]!)).toBe(true);
    expect(presence.snapshot.phase).toBe("present");

    const exit = presence.target(false, targets);
    expect(presence.snapshot).toMatchObject({
      phase: "exiting",
      mounted: true,
      interactive: false,
      accessible: false,
    });
    const reversal = presence.target(true, targets);
    expect(reversal).toBeGreaterThan(exit);
    expect(presence.settle(exit, targets[0]!)).toBe(false);
    expect(presence.settle(reversal, targets[0]!)).toBe(false);
    expect(presence.settle(reversal, targets[1]!)).toBe(true);
    expect(presence.snapshot).toMatchObject({ phase: "present", mounted: true });

    const finalExit = presence.target(false, targets);
    expect(presence.settle(finalExit, targets[1]!)).toBe(false);
    expect(presence.snapshot.mounted).toBe(true);
    expect(presence.settle(finalExit, targets[0]!)).toBe(true);
    expect(presence.snapshot).toMatchObject({ phase: "absent", mounted: false });
    expect(presence.dispose()).toBe(true);
    expect(presence.dispose()).toBe(false);
  });

  it("retargets from the presented value and velocity and rejects stale settlement", () => {
    const channel = new ReferenceMotionChannel("Drawer/Surface:block", "sheet", 0);
    channel.direct(180, 1.4);
    const closing = channel.target(700, "spring");
    expect(closing).toMatchObject({ from: 180, velocity: 1.4, to: 700 });
    expect(channel.sample(closing.revision, 260, 1.1)).toBe(true);

    const reopening = channel.target(0, "spring");
    expect(channel.outcome(closing.revision)).toBe("replaced");
    expect(reopening).toMatchObject({ from: 260, velocity: 1.1, to: 0 });
    expect(channel.settle(closing.revision)).toBe(false);
    expect(channel.settle(reopening.revision)).toBe(true);
    expect(channel.value).toBe(0);
    expect(channel.velocity).toBe(0);
    expect(channel.outcome(reopening.revision)).toBe("settled");
  });

  it("cancels and disposes active motion exactly once", () => {
    const channel = new ReferenceMotionChannel("Tabs/Indicator:inline", "selection", 0);
    const first = channel.target(100, "spring");
    channel.cancel();
    expect(channel.outcome(first.revision)).toBe("cancelled");
    channel.cancel();

    const second = channel.target(200, "spring");
    channel.dispose();
    channel.dispose();
    expect(channel.outcome(second.revision)).toBe("disposed");
    expect(() => channel.direct(0, 0)).toThrow(
      'Reference motion channel "Tabs/Indicator:inline" is disposed.',
    );
  });

  it("resolves arbitrary finite gesture releases to one legal destination", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true, min: -10, max: 10 }),
        fc.double({ noNaN: true, noDefaultInfinity: true, min: -100, max: 100 }),
        fc.constantFrom<"negative" | "positive" | "either">("negative", "positive", "either"),
        fc.boolean(),
        (progress, velocity, direction, cancelled) => {
          const result = resolveReferenceGestureRelease({
            progress,
            velocity,
            direction,
            cancelled,
            distanceThreshold: 0.5,
            velocityThreshold: 2,
          });
          expect(result.destination === 0 || result.destination === 1).toBe(true);
          expect(result.committed).toBe(result.destination === 1);
          if (cancelled) expect(result.committed).toBe(false);
        },
      ),
      { numRuns: 2_000 },
    );
  });

  it("does not commit in the opposing direction", () => {
    expect(
      resolveReferenceGestureRelease({
        progress: -1,
        velocity: -10,
        direction: "positive",
        distanceThreshold: 0.5,
        velocityThreshold: 2,
      }).committed,
    ).toBe(false);
    expect(
      resolveReferenceGestureRelease({
        progress: 1,
        velocity: 10,
        direction: "negative",
        distanceThreshold: 0.5,
        velocityThreshold: 2,
      }).committed,
    ).toBe(false);
  });

  it("owns pointer capture for exactly one revision-scoped gesture lifetime", () => {
    const gesture = new ReferenceGestureSession();
    const first = gesture.begin(4);
    expect(gesture.sample(first, 4, 120, 600)).toBe(true);
    expect(gesture.snapshot).toMatchObject({
      revision: first,
      captured: true,
      value: 120,
      velocity: 600,
    });
    expect(gesture.end(first, "capture-lost")).toBe(true);
    expect(gesture.sample(first, 4, 140, 500)).toBe(false);
    expect(gesture.end(first, "commit")).toBe(false);
    expect(gesture.snapshot).toMatchObject({ captured: false, outcome: "capture-lost" });

    const second = gesture.begin(8);
    expect(second).toBeGreaterThan(first);
    expect(gesture.sample(first, 4, 999, 999)).toBe(false);
    expect(gesture.sample(second, 8, 20, -40)).toBe(true);
    gesture.dispose();
    expect(gesture.snapshot).toMatchObject({ captured: false, outcome: "cancel" });
    expect(() => gesture.begin(9)).toThrow("Gesture session is disposed.");
  });

  it("keeps hover intent part-local while focus provides an immediate equivalent path", () => {
    const intent = new ReferenceHoverIntent({
      dwell: 100,
      maximumSpeed: 80,
      leaveDelay: 50,
    });
    intent.enter(0, 0, 0);
    intent.move(50, 20, 0);
    expect(intent.snapshot).toEqual({
      hovered: true,
      focused: false,
      intent: false,
      engaged: false,
    });
    intent.advance(100);
    expect(intent.snapshot).toMatchObject({ intent: true, engaged: true });
    intent.leave(110);
    expect(intent.snapshot).toMatchObject({ hovered: false, intent: true, engaged: true });
    intent.advance(130);
    expect(intent.snapshot.intent).toBe(true);
    intent.focus(135);
    intent.advance(160);
    expect(intent.snapshot).toEqual({
      hovered: false,
      focused: true,
      intent: false,
      engaged: true,
    });
    intent.blur(170);
    expect(intent.snapshot.engaged).toBe(false);
  });

  it("recognizes long press once from virtual time and cancels on excess movement", () => {
    const press = new ReferenceLongPress({ duration: 100, movementTolerance: 8 });
    const first = press.down(1, 0, 10, 20);
    press.advance(50);
    expect(press.snapshot).toEqual({ revision: first, phase: "possible", progress: 0.5 });
    expect(press.move(first, 1, 60, 14, 20)).toBe(true);
    expect(press.advance(100)).toBe("recognized");
    expect(press.advance(120)).toBeUndefined();
    expect(press.up(first, 1, 130)).toBe("commit");
    expect(press.snapshot).toEqual({ revision: first, phase: "committed", progress: 1 });
    expect(press.cancel(first, 1, 140)).toBe(false);

    const second = press.down(2, 150, 0, 0);
    expect(press.move(second, 2, 160, 9, 0)).toBe(true);
    expect(press.snapshot).toEqual({ revision: second, phase: "failed", progress: 0 });
    expect(press.advance(300)).toBeUndefined();
  });

  it("keeps rubber-band presentation separate from projected snap resolution", () => {
    expect(
      resolveReferenceRubberBand({
        value: 120,
        minimum: 0,
        maximum: 100,
        extent: 400,
        coefficient: 0.5,
      }),
    ).toBeCloseTo(109.7560975609756);
    expect(
      resolveReferenceRubberBand({
        value: -20,
        minimum: 0,
        maximum: 100,
        extent: 400,
        coefficient: 0.5,
      }),
    ).toBeCloseTo(-9.75609756097561);
    expect(
      resolveReferenceSnapSet({
        value: 40,
        velocity: 300,
        projectionSeconds: 0.2,
        points: [
          { outcome: "closed", value: 0 },
          { outcome: "half", value: 50 },
          { outcome: "open", value: 100 },
        ],
      }),
    ).toEqual({ outcome: "open", value: 100, velocity: 300 });
    expect(
      resolveReferenceSnapSet({
        value: 75,
        velocity: 0,
        projectionSeconds: 0.2,
        points: [
          { outcome: "open", value: 100 },
          { outcome: "half", value: 50 },
        ],
      }).outcome,
    ).toBe("half");
  });

  it("rebases an active gesture across geometry changes and yields to nested scrolling", () => {
    expect(
      resolveReferenceGestureRebase({
        value: 200,
        velocity: 400,
        previousExtent: 800,
        nextExtent: 600,
        available: true,
      }),
    ).toEqual({ strategy: "rebase", value: 150, velocity: 300 });
    expect(
      resolveReferenceGestureRebase({
        value: 200,
        velocity: 400,
        previousExtent: 800,
        nextExtent: 600,
        available: false,
      }),
    ).toEqual({ strategy: "cancel" });
    expect(
      resolveReferenceScrollCompetition({
        boundary: "start",
        position: 40,
        minimum: 0,
        maximum: 500,
        movement: "outward",
      }),
    ).toBe("scroll");
    expect(
      resolveReferenceScrollCompetition({
        boundary: "start",
        position: 0,
        minimum: 0,
        maximum: 500,
        movement: "outward",
      }),
    ).toBe("direct");
    expect(
      resolveReferenceScrollCompetition({
        boundary: "start",
        position: 0,
        minimum: 0,
        maximum: 500,
        movement: "inward",
      }),
    ).toBe("scroll");
  });

  it("derives bounded edge auto-scroll and rebases the active gesture by the applied delta", () => {
    const options = {
      viewportStart: 0,
      viewportEnd: 400,
      edgeExtent: 80,
      maximumSpeed: 1_000,
      seconds: 0.016,
      position: 500,
      minimum: 0,
      maximum: 1_000,
    } as const;
    expect(resolveReferenceAutoScroll({ ...options, pointer: 200 })).toEqual({
      requestedVelocity: 0,
      velocity: 0,
      delta: 0,
      position: 500,
      gestureRebase: 0,
    });
    expect(resolveReferenceAutoScroll({ ...options, pointer: 40 })).toMatchObject({
      requestedVelocity: -250,
      velocity: -250,
      delta: -4,
      gestureRebase: -4,
    });
    expect(resolveReferenceAutoScroll({ ...options, pointer: 360 })).toMatchObject({
      requestedVelocity: 250,
      velocity: 250,
      delta: 4,
      gestureRebase: 4,
    });
    expect(
      resolveReferenceAutoScroll({ ...options, pointer: 500, position: options.maximum }),
    ).toMatchObject({ requestedVelocity: 1_000, velocity: 0, delta: 0, position: 1_000 });

    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (a, b) => {
          const near = Math.min(a, b);
          const far = Math.max(a, b);
          const nearSpeed = resolveReferenceAutoScroll({
            ...options,
            pointer: options.viewportEnd - options.edgeExtent + near * options.edgeExtent,
          }).requestedVelocity;
          const farSpeed = resolveReferenceAutoScroll({
            ...options,
            pointer: options.viewportEnd - options.edgeExtent + far * options.edgeExtent,
          }).requestedVelocity;
          expect(nearSpeed).toBeLessThanOrEqual(farSpeed);
        },
      ),
    );

    const session = new ReferenceAutoScrollSession();
    const first = session.start();
    expect(session.step(first, { ...options, pointer: 360 })?.gestureRebase).toBe(4);
    const current = session.start();
    expect(session.step(first, { ...options, pointer: 360 })).toBeUndefined();
    expect(session.stop(current)).toBe(true);
    expect(session.step(current, { ...options, pointer: 360 })).toBeUndefined();
    session.dispose();
    expect(() => session.start()).toThrow("disposed");
  });

  it("commits only the latest complete geometry revision", () => {
    const geometry = new ReferenceGeometryRegistry();
    const stale = geometry.begin();
    const current = geometry.begin();

    expect(
      geometry.commit(stale, [
        {
          identity: "Tabs/One",
          rect: { inline: 0, block: 0, inlineSize: 80, blockSize: 40 },
        },
      ]),
    ).toBe(false);
    expect(geometry.read("Tabs/One")).toBeUndefined();
    expect(
      geometry.commit(current, [
        {
          identity: "Tabs/One",
          rect: { inline: 100, block: 0, inlineSize: 96, blockSize: 40 },
        },
      ]),
    ).toBe(true);
    expect(geometry.read("Tabs/One")).toEqual({
      inline: 100,
      block: 0,
      inlineSize: 96,
      blockSize: 40,
    });
  });

  it("revises virtual measurements by stable key without accepting stale geometry", () => {
    const layout = new ReferenceVirtualLayoutRegistry();
    const first = layout.begin(["a", "b", "c"], 40);
    expect(layout.commit(first, [{ key: "b", extent: 60 }])).toBe(true);
    expect(layout.items).toEqual([
      { key: "a", offset: 0, extent: 40, measured: false },
      { key: "b", offset: 40, extent: 60, measured: true },
      { key: "c", offset: 100, extent: 40, measured: false },
    ]);
    expect(layout.extent).toBe(140);

    const stale = layout.begin(["a", "b", "c"], 40);
    const current = layout.begin(["c", "b", "d"], 50);
    expect(layout.commit(stale, [{ key: "a", extent: 100 }])).toBe(false);
    expect(layout.commit(current, [{ key: "c", extent: 70 }])).toBe(true);
    expect(layout.items).toEqual([
      { key: "c", offset: 0, extent: 70, measured: true },
      { key: "b", offset: 70, extent: 60, measured: true },
      { key: "d", offset: 130, extent: 50, measured: false },
    ]);
    expect(layout.extent).toBe(180);
  });

  it("pairs shared identities once and rejects ambiguous sources", () => {
    expect(
      resolveReferenceSharedIdentities([
        { identity: "wallet", side: "destination", node: "Detail/Hero" },
        { identity: "wallet", side: "source", node: "List/Card" },
        { identity: "unmatched", side: "source", node: "List/Other" },
      ]),
    ).toEqual([{ identity: "wallet", source: "List/Card", destination: "Detail/Hero" }]);
    expect(() =>
      resolveReferenceSharedIdentities([
        { identity: "wallet", side: "source", node: "List/CardA" },
        { identity: "wallet", side: "source", node: "List/CardB" },
      ]),
    ).toThrow('Shared identity "wallet" has two source nodes: "List/CardA" and "List/CardB".');
  });

  it("associates at most one transition policy with a known target", () => {
    expect(
      resolveReferenceTransitionTransaction(
        ["Drawer.Surface:translate.block", "Drawer.Backdrop:opacity"],
        [
          { target: "Drawer.Surface:translate.block", policy: "sheet" },
          { target: "Drawer.Backdrop:opacity", policy: "backdrop" },
        ],
      ),
    ).toEqual({
      targets: ["Drawer.Backdrop:opacity", "Drawer.Surface:translate.block"],
      policies: [
        { target: "Drawer.Backdrop:opacity", policy: "backdrop" },
        { target: "Drawer.Surface:translate.block", policy: "sheet" },
      ],
    });
    expect(() =>
      resolveReferenceTransitionTransaction(
        ["Drawer.Surface:opacity"],
        [{ target: "Drawer.Backdrop:opacity", policy: "backdrop" }],
      ),
    ).toThrow('Transition policy references unknown target "Drawer.Backdrop:opacity".');
    expect(() =>
      resolveReferenceTransitionTransaction(
        ["Drawer.Surface:opacity"],
        [
          { target: "Drawer.Surface:opacity", policy: "first" },
          { target: "Drawer.Surface:opacity", policy: "second" },
        ],
      ),
    ).toThrow('Target "Drawer.Surface:opacity" has more than one transition policy.');
  });

  it("classifies transition handoff without losing compatible physical velocity", () => {
    const spring = { name: "responsive", kind: "spring", valueType: "length" } as const;
    const softerSpring = { name: "soft", kind: "spring", valueType: "length" } as const;
    const timing = { name: "timing", kind: "timing", valueType: "length" } as const;

    expect(
      resolveReferenceTransitionHandoff({
        current: 48,
        velocity: 320,
        target: 0,
        source: "transition",
        previous: spring,
        next: softerSpring,
        reducedMotion: false,
      }),
    ).toEqual({
      from: 48,
      velocity: 320,
      to: 0,
      strategy: "retarget",
      cancelPrevious: true,
    });
    expect(
      resolveReferenceTransitionHandoff({
        current: 120,
        velocity: 640,
        target: 844,
        source: "direct",
        next: spring,
        reducedMotion: false,
      }).velocity,
    ).toBe(640);
    expect(
      resolveReferenceTransitionHandoff({
        current: 48,
        velocity: 320,
        target: 0,
        source: "transition",
        previous: spring,
        next: timing,
        reducedMotion: false,
      }),
    ).toEqual({
      from: 48,
      velocity: 0,
      to: 0,
      strategy: "replace",
      cancelPrevious: true,
    });
    expect(() =>
      resolveReferenceTransitionHandoff({
        current: 1,
        velocity: 0,
        target: 0,
        source: "transition",
        previous: spring,
        next: { ...timing, valueType: "opacity" },
        reducedMotion: false,
      }),
    ).toThrow('Transition policy changes value type from "length" to "opacity".');
  });

  it("validates and timestamps a multi-target handoff as one transaction", () => {
    const spring = { name: "spring", kind: "spring", valueType: "number" } as const;
    const batch = resolveReferenceTransitionBatch(
      [
        {
          targetIdentity: "surface:scale",
          current: 0.9,
          velocity: 2,
          target: 1,
          source: "transition",
          previous: spring,
          next: spring,
          reducedMotion: false,
        },
        {
          targetIdentity: "backdrop:opacity",
          current: 0.2,
          velocity: 0,
          target: 0.4,
          source: "none",
          next: { name: "fade", kind: "timing", valueType: "number" },
          reducedMotion: false,
        },
      ],
      { revision: 7, epoch: 12.5 },
    );
    expect(batch.map(({ targetIdentity }) => targetIdentity)).toEqual([
      "backdrop:opacity",
      "surface:scale",
    ]);
    expect(batch.every(({ revision, epoch }) => revision === 7 && epoch === 12.5)).toBe(true);
    expect(batch[1]?.handoff).toMatchObject({ strategy: "retarget", velocity: 2 });
    expect(() =>
      resolveReferenceTransitionBatch(
        [
          {
            targetIdentity: "surface:scale",
            current: 0,
            velocity: 0,
            target: 1,
            source: "none",
            next: spring,
            reducedMotion: false,
          },
          {
            targetIdentity: "surface:scale",
            current: 1,
            velocity: 0,
            target: 0,
            source: "none",
            next: spring,
            reducedMotion: false,
          },
        ],
        { revision: 8, epoch: 13 },
      ),
    ).toThrow("same target more than once");
  });

  it("derives atomic preset and environment updates from one presented snapshot", () => {
    const spring = { name: "spring", kind: "spring", valueType: "scalar" } as const;
    const soft = { name: "soft", kind: "spring", valueType: "scalar" } as const;
    const timing = { name: "timing", kind: "timing", valueType: "scalar" } as const;
    const previous = {
      opacity: { target: 0.4, policy: spring, active: true, reducedMotion: false },
      scale: { target: 1, policy: spring, active: true, reducedMotion: false },
    } as const;
    const presented = {
      opacity: { value: 0.25, velocity: 0.3 },
      scale: { value: 0.92, velocity: 1.4 },
    };
    const preset = resolveReferenceTransitionUpdate({
      previous,
      next: {
        opacity: { target: 0.7, policy: timing, active: true, reducedMotion: false },
        scale: { target: 1.08, policy: soft, active: true, reducedMotion: false },
      },
      presented,
      transaction: { cause: "preset", revision: 8, epoch: 20 },
    });
    expect(preset).toEqual({
      cause: "preset",
      revision: 8,
      epoch: 20,
      changes: [
        {
          targetIdentity: "opacity",
          targetChanged: true,
          policyChanged: true,
          reducedMotionChanged: false,
          handoff: {
            from: 0.25,
            velocity: 0,
            to: 0.7,
            strategy: "replace",
            cancelPrevious: true,
          },
        },
        {
          targetIdentity: "scale",
          targetChanged: true,
          policyChanged: true,
          reducedMotionChanged: false,
          handoff: {
            from: 0.92,
            velocity: 1.4,
            to: 1.08,
            strategy: "retarget",
            cancelPrevious: true,
          },
        },
      ],
    });

    const reduced = resolveReferenceTransitionUpdate({
      previous,
      next: {
        opacity: { ...previous.opacity, reducedMotion: true },
        scale: { ...previous.scale, reducedMotion: true },
      },
      presented,
      transaction: { cause: "reducedMotion", revision: 9, epoch: 21 },
    });
    expect(reduced.changes.every((change) => change.handoff?.strategy === "settle")).toBe(true);
    expect(reduced.changes.map((change) => change.handoff?.to)).toEqual([0.4, 1]);

    const settled = {
      opacity: { ...previous.opacity, active: false, reducedMotion: true },
      scale: { ...previous.scale, active: false, reducedMotion: true },
    };
    const restored = resolveReferenceTransitionUpdate({
      previous: settled,
      next: {
        opacity: { ...settled.opacity, reducedMotion: false },
        scale: { ...settled.scale, reducedMotion: false },
      },
      presented: { opacity: { value: 0.4, velocity: 0 }, scale: { value: 1, velocity: 0 } },
      transaction: { cause: "environment", revision: 10, epoch: 22 },
    });
    expect(restored.changes.every((change) => change.handoff === undefined)).toBe(true);

    expect(() =>
      resolveReferenceTransitionUpdate({
        previous,
        next: {
          opacity: previous.opacity,
          scale: {
            ...previous.scale,
            policy: { ...spring, valueType: "length" },
          },
        },
        presented,
        transaction: { cause: "theme", revision: 11, epoch: 23 },
      }),
    ).toThrow('Transition target "scale" changes value type from "scalar" to "length".');
  });

  it("reduced motion reaches every target endpoint without a residual channel", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10_000, max: 10_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -10_000, max: 10_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -10_000, max: 10_000, noNaN: true, noDefaultInfinity: true }),
        (current, velocity, target) => {
          expect(
            resolveReferenceTransitionHandoff({
              current,
              velocity,
              target,
              source: "transition",
              previous: { name: "old", kind: "spring", valueType: "scalar" },
              next: { name: "next", kind: "spring", valueType: "scalar" },
              reducedMotion: true,
            }),
          ).toEqual({
            from: target,
            velocity: 0,
            to: target,
            strategy: "settle",
            cancelPrevious: true,
          });
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it("evaluates one typed expression algebra with exact active dependencies", () => {
    const expression = {
      kind: "choose",
      condition: { kind: "read", path: "interaction.hovered" },
      whenTrue: { kind: "read", path: "tokens.fill.hover" },
      whenFalse: { kind: "read", path: "tokens.fill.rest" },
    } as const;

    expect(
      evaluateReferenceExpression(expression, {
        "interaction.hovered": false,
        "tokens.fill.hover": "hover",
        "tokens.fill.rest": "rest",
      }),
    ).toEqual({
      value: "rest",
      dependencies: ["interaction.hovered", "tokens.fill.rest"],
    });
    expect(
      evaluateReferenceExpression(expression, {
        "interaction.hovered": true,
        "tokens.fill.hover": "hover",
        "tokens.fill.rest": "rest",
      }),
    ).toEqual({
      value: "hover",
      dependencies: ["interaction.hovered", "tokens.fill.hover"],
    });
  });

  it("rejects expression dimension errors and makes interpolation clamping explicit", () => {
    expect(() =>
      evaluateReferenceExpression(
        {
          kind: "add",
          left: { kind: "literal", value: { dimension: "length", value: 12 } },
          right: { kind: "literal", value: { dimension: "time", value: 120 } },
        },
        {},
      ),
    ).toThrow('addition requires equal types, received "length" and "time".');

    const interpolation = (clamp: boolean) =>
      evaluateReferenceExpression(
        {
          kind: "interpolate",
          input: { kind: "literal", value: { dimension: "scalar", value: 1.5 } },
          inputRange: [0, 1],
          outputRange: [
            { dimension: "length", value: 0 },
            { dimension: "length", value: 100 },
          ],
          clamp,
        },
        {},
      ).value;

    expect(interpolation(true)).toEqual({ dimension: "length", value: 100 });
    expect(interpolation(false)).toEqual({ dimension: "length", value: 150 });

    expect(
      evaluateReferenceExpression(
        {
          kind: "clamp",
          value: { kind: "literal", value: { dimension: "length", value: 140 } },
          minimum: { kind: "literal", value: { dimension: "length", value: 0 } },
          maximum: { kind: "literal", value: { dimension: "length", value: 100 } },
        },
        {},
      ).value,
    ).toEqual({ dimension: "length", value: 100 });
    expect(() =>
      evaluateReferenceExpression(
        {
          kind: "clamp",
          value: { kind: "literal", value: { dimension: "time", value: 1 } },
          minimum: { kind: "literal", value: { dimension: "time", value: 2 } },
          maximum: { kind: "literal", value: { dimension: "time", value: 0 } },
        },
        {},
      ),
    ).toThrow("Clamp bounds are reversed.");
  });

  it("resolves complete typed token modes without changing token identity", () => {
    const modes = resolveReferenceTokenModes(
      {
        canvas: { type: "color", value: "light" },
        ink: { type: "color", value: { alias: "canvas" } },
        spacing: { type: "length", value: 12 },
      },
      {
        dark: { canvas: "dark" },
        contrast: { canvas: "black", ink: "white" },
      },
    );
    expect(modes.default?.canvas).toEqual({ type: "color", value: "light" });
    expect(modes.dark?.ink).toEqual({ type: "color", value: "dark" });
    expect(modes.dark?.spacing).toEqual({ type: "length", value: 12 });
    expect(modes.contrast?.ink).toEqual({ type: "color", value: "white" });
    expect(() =>
      resolveReferenceTokenModes(
        { canvas: { type: "color", value: "light" } },
        { dark: { missing: "dark" } },
      ),
    ).toThrow('Token mode "dark" overrides unknown token "missing".');
  });

  it("preserves keyed identity through insertion, removal, and reorder", () => {
    expect(reconcileReferenceKeys(["a", "b", "c"], ["c", "a", "d"])).toEqual({
      retained: ["c", "a"],
      entered: ["d"],
      exited: ["b"],
      moved: [
        { key: "c", from: 2, to: 0 },
        { key: "a", from: 0, to: 1 },
      ],
    });
    expect(() => reconcileReferenceKeys(["a"], ["a", "a"])).toThrow(
      'Duplicate next collection key "a".',
    );
  });

  it("samples underdamped, critical, and overdamped springs from exact initial conditions", () => {
    for (const damping of [10, 20, 40]) {
      const spring = { from: 180, to: 0, velocity: -320, mass: 1, stiffness: 100, damping };
      expect(sampleReferenceSpring(spring, 0)).toEqual({ value: 180, velocity: -320 });
      const late = sampleReferenceSpring(spring, 10);
      expect(late.value).toBeCloseTo(0, damping === 10 ? 8 : 4);
      expect(late.velocity).toBeCloseTo(0, damping === 10 ? 8 : 3);
    }
  });

  it("derives coordinated channels from one authoritative source", () => {
    expect(
      deriveReferenceChannels("Drawer.Surface:block", 0.5, [
        { target: "Drawer.Backdrop:opacity", scale: 1, offset: 0 },
        { target: "Drawer.Page:scale", scale: -0.04, offset: 1 },
      ]),
    ).toEqual({
      "Drawer.Backdrop:opacity": 0.5,
      "Drawer.Page:scale": 0.98,
    });
    expect(() =>
      deriveReferenceChannels("Drawer.Surface:block", 0.5, [
        { target: "Drawer.Backdrop:opacity", scale: 1, offset: 0 },
        { target: "Drawer.Backdrop:opacity", scale: 0.5, offset: 0 },
      ]),
    ).toThrow(
      'Target "Drawer.Backdrop:opacity:value" is owned by both "Drawer.Surface:block" and "Drawer.Surface:block".',
    );
  });

  it("projects old geometry into new geometry without changing target layout", () => {
    expect(
      projectReferenceGeometry(
        { inline: 20, block: 40, inlineSize: 100, blockSize: 50 },
        { inline: 100, block: 120, inlineSize: 200, blockSize: 100 },
      ),
    ).toEqual({
      translateInline: -80,
      translateBlock: -80,
      scaleInline: 0.5,
      scaleBlock: 0.5,
    });
  });

  it("projects one stable identity across a parent swap", () => {
    expect(
      resolveReferenceLayoutProjection({
        identity: "Card/selected",
        previousParent: "Grid",
        nextParent: "Detail",
        previous: { inline: 20, block: 40, inlineSize: 100, blockSize: 80 },
        next: { inline: 120, block: 100, inlineSize: 240, blockSize: 192 },
      }),
    ).toEqual({
      identity: "Card/selected",
      parentChanged: true,
      target: { inline: 120, block: 100, inlineSize: 240, blockSize: 192 },
      projection: {
        translateInline: -100,
        translateBlock: -60,
        scaleInline: 100 / 240,
        scaleBlock: 80 / 192,
      },
    });
  });

  it("retargets layout from presented geometry and preserves only compatible velocity", () => {
    const presented = { inline: 70, block: 90, inlineSize: 150, blockSize: 100 };
    const target = { inline: 140, block: 120, inlineSize: 240, blockSize: 160 };
    const velocity = { inline: 320, block: -40, logInlineSize: 0.5, logBlockSize: -0.2 };
    expect(
      resolveReferenceLayoutTransition({
        identity: "Card/selected",
        previousParent: "Grid",
        nextParent: "Detail",
        presented,
        velocity,
        target,
        driver: "spring",
        reducedMotion: false,
      }),
    ).toEqual({
      identity: "Card/selected",
      parentChanged: true,
      target,
      from: presented,
      velocity,
      projection: {
        translateInline: -70,
        translateBlock: -30,
        scaleInline: 150 / 240,
        scaleBlock: 100 / 160,
      },
      strategy: "retarget",
    });
    expect(
      resolveReferenceLayoutTransition({
        identity: "Card/selected",
        previousParent: "Detail",
        nextParent: "Detail",
        presented,
        velocity,
        target,
        driver: "timing",
        reducedMotion: false,
      }).velocity,
    ).toEqual({ inline: 0, block: 0, logInlineSize: 0, logBlockSize: 0 });
    expect(
      resolveReferenceLayoutTransition({
        identity: "Card/selected",
        previousParent: "Grid",
        nextParent: "Detail",
        presented,
        velocity,
        target,
        driver: "spring",
        reducedMotion: true,
      }),
    ).toMatchObject({
      from: target,
      target,
      projection: { translateInline: 0, translateBlock: 0, scaleInline: 1, scaleBlock: 1 },
      strategy: "settle",
    });
  });

  it("allows vector morphing only across compatible command topology", () => {
    const source = [
      { kind: "move", inline: 0, block: 0 },
      { kind: "line", inline: 1, block: 0 },
      { kind: "line", inline: 1, block: 1 },
      { kind: "close" },
    ] as const;
    const destination = [
      { kind: "move", inline: 0.5, block: 0 },
      { kind: "line", inline: 1, block: 1 },
      { kind: "line", inline: 0, block: 1 },
      { kind: "close" },
    ] as const;

    expect(resolveReferencePathMorph(source, destination)).toEqual({
      compatible: true,
      commands: 4,
    });
    expect(() =>
      resolveReferencePathMorph(source, [
        { kind: "move", inline: 0, block: 0 },
        {
          kind: "curve",
          control1: { inline: 0, block: 0 },
          control2: { inline: 1, block: 1 },
          end: { inline: 1, block: 0 },
        },
        { kind: "line", inline: 0, block: 1 },
        { kind: "close" },
      ]),
    ).toThrow('Path morph command 1 changes from "line" to "curve".');

    const shapeFrom = {
      kind: "path" as const,
      viewBox: { inlineSize: 1, blockSize: 1 },
      commands: source,
      fillRule: "nonzero" as const,
    };
    const shapeTo = { ...shapeFrom, commands: destination };
    const midpoint = interpolateReferenceShape(shapeFrom, shapeTo, 0.5);
    expect(midpoint.kind).toBe("path");
    if (midpoint.kind !== "path") throw new Error("Expected a path midpoint.");
    expect(midpoint.commands[0]).toEqual({ kind: "move", inline: 0.25, block: 0 });
    expect(midpoint.commands[1]).toEqual({ kind: "line", inline: 1, block: 0.5 });
    expect(() =>
      interpolateReferenceShape(shapeFrom, { ...shapeTo, fillRule: "even-odd" }, 0.5),
    ).toThrow("matching coordinate and fill semantics");
  });

  it("requires explicit gesture arbitration and supports deliberate simultaneity", () => {
    expect(() =>
      resolveReferenceGestureArbitration(["sheet.dismiss", "viewport.scroll"], []),
    ).toThrow("Gesture conflict has no explicit relationship: sheet.dismiss, viewport.scroll.");
    expect(
      resolveReferenceGestureArbitration(
        ["sheet.dismiss", "viewport.scroll"],
        [{ kind: "before", first: "viewport.scroll", second: "sheet.dismiss" }],
      ),
    ).toEqual(["viewport.scroll"]);
    expect(
      resolveReferenceGestureArbitration(
        ["canvas.pan", "canvas.pinch"],
        [{ kind: "simultaneous", first: "canvas.pan", second: "canvas.pinch" }],
      ),
    ).toEqual(["canvas.pan", "canvas.pinch"]);
  });

  it("normalizes absolute hierarchical and orthogonal parallel statechart topology", () => {
    const topology = normalizeReferenceChart(
      {
        type: "parallel",
        on: { resetAll: { target: ["workspace.list", "sync.idle"] } },
        tasks: ["sync"],
        after: [{ wait: 10_000, target: "sync.idle" }],
        states: {
          workspace: {
            initial: "workspace.list",
            states: {
              list: { on: { open: "workspace.detail" } },
              detail: {
                on: {
                  reset: { target: ["workspace.list", "sync.idle"] },
                },
              },
            },
          },
          sync: {
            initial: "sync.idle",
            states: {
              idle: { on: { start: "sync.busy" } },
              busy: {
                tasks: ["sync"],
                after: [{ wait: 5000, target: "sync.idle" }],
              },
            },
          },
        },
      },
      new Set(["sync"]),
    );

    expect(topology.kind).toBe("parallel");
    expect(topology).toMatchObject({
      tasks: ["sync"],
      events: [
        {
          event: "resetAll",
          alternatives: [{ targets: ["workspace.list", "sync.idle"] }],
        },
      ],
      delays: [{ wait: 10_000, targets: ["sync.idle"] }],
    });
    expect(topology.nodes.map((node) => node.path)).toEqual([
      "sync",
      "sync.busy",
      "sync.idle",
      "workspace",
      "workspace.detail",
      "workspace.list",
    ]);
    expect(topology.nodes.find((node) => node.path === "sync")).toMatchObject({
      kind: "compound",
      initial: "sync.idle",
    });
    expect(topology.nodes.find((node) => node.path === "workspace.detail")?.events).toEqual([
      {
        event: "reset",
        alternatives: [{ targets: ["workspace.list", "sync.idle"] }],
      },
    ]);
  });

  it("rejects ambiguous or invalid hierarchical statechart topology", () => {
    expect(() => normalizeReferenceChart({ states: { idle: {} } })).toThrow(
      'Compound state "root" needs an initial direct child.',
    );
    expect(() =>
      normalizeReferenceChart({
        initial: "panel",
        states: {
          panel: { initial: "idle", states: { idle: {}, ready: {} } },
        },
      }),
    ).toThrow('Initial state "idle" is not a direct child of "panel".');
    expect(() =>
      normalizeReferenceChart({
        type: "parallel",
        initial: "left",
        states: { left: {}, right: {} },
      }),
    ).toThrow('parallel state "root" cannot declare an initial state.');
    expect(() =>
      normalizeReferenceChart({
        initial: "done",
        states: { done: { type: "final", on: { retry: "done" } } },
      }),
    ).toThrow('Final state "done" cannot own events, tasks, or delays.');
    expect(() =>
      normalizeReferenceChart({
        initial: "idle",
        states: { idle: { on: { open: "missing" } } },
      }),
    ).toThrow('targets unknown state "missing".');
    expect(() =>
      normalizeReferenceChart({
        initial: "left",
        states: {
          left: { on: { reset: { target: ["left", "right"] } } },
          right: {},
        },
      }),
    ).toThrow('has non-orthogonal targets "left" and "right".');
    expect(() =>
      normalizeReferenceChart({
        initial: "busy",
        states: { busy: { tasks: ["missing"] } },
      }),
    ).toThrow('invokes unknown task "missing".');
  });

  it("preserves orthogonal regions across deterministic hierarchical event traces", () => {
    const topology = normalizeReferenceChart({
      type: "parallel",
      states: {
        workspace: {
          initial: "workspace.list",
          states: {
            list: { on: { open: "workspace.detail" } },
            detail: { on: { reset: "workspace.list" } },
          },
        },
        sync: {
          initial: "sync.idle",
          states: {
            idle: { on: { start: "sync.busy" } },
            busy: { on: { reset: "sync.idle" } },
          },
        },
      },
    });
    const initial = resolveReferenceChartInitial(topology);
    expect(initial).toEqual(["sync.idle", "workspace.list"]);
    const detail = resolveReferenceChartEvent(topology, initial, "open");
    expect(detail).toEqual(["sync.idle", "workspace.detail"]);
    const busy = resolveReferenceChartEvent(topology, detail, "start");
    expect(busy).toEqual(["sync.busy", "workspace.detail"]);
    expect(resolveReferenceChartEvent(topology, busy, "reset")).toEqual([
      "sync.idle",
      "workspace.list",
    ]);

    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("open", "start", "reset", "unknown"), { maxLength: 100 }),
        (events) => {
          const run = () =>
            events.reduce(
              (active, event) => resolveReferenceChartEvent(topology, active, event),
              initial,
            );
          const first = run();
          expect(run()).toEqual(first);
          expect(new Set(first).size).toBe(first.length);
          expect(first).toHaveLength(2);
        },
      ),
    );
  });

  it("normalizes statechart declaration order deterministically", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom("alpha", "beta", "gamma"), {
          minLength: 3,
          maxLength: 3,
        }),
        (order) => {
          const topology = normalizeReferenceChart({
            type: "parallel",
            states: Object.fromEntries(order.map((name) => [name, {}])),
          });
          expect(topology.nodes.map((node) => node.path)).toEqual(["alpha", "beta", "gamma"]);
          expect(resolveReferenceChartInitial(topology)).toEqual(["alpha", "beta", "gamma"]);
        },
      ),
    );
  });

  it("selects the first enabled guarded alternative with an explicit fallback", () => {
    const topology = normalizeReferenceChart({
      initial: "idle",
      states: {
        idle: {
          on: {
            submit: [
              { guard: "isAdmin", target: "admin" },
              { guard: "isMember", target: "member" },
              "denied",
            ],
          },
        },
        admin: {},
        member: {},
        denied: {},
      },
    });
    const initial = resolveReferenceChartInitial(topology);

    expect(resolveReferenceChartEvent(topology, initial, "submit", { isAdmin: true })).toEqual([
      "admin",
    ]);
    expect(resolveReferenceChartEvent(topology, initial, "submit", { isMember: true })).toEqual([
      "member",
    ]);
    expect(resolveReferenceChartEvent(topology, initial, "submit")).toEqual(["denied"]);
    expect(topology.nodes.find((node) => node.path === "idle")?.events[0]?.alternatives).toEqual([
      { guard: "isAdmin", targets: ["admin"] },
      { guard: "isMember", targets: ["member"] },
      { targets: ["denied"] },
    ]);

    const withWork = normalizeReferenceChart(
      {
        initial: "idle",
        states: {
          idle: {
            on: {
              submit: {
                target: "done",
                update: "idle.submit.update",
                commands: [
                  { name: "persist", input: "idle.submit.command.0.input" },
                  { name: "announce" },
                ],
              },
            },
          },
          done: {},
        },
      },
      new Set(),
      new Set(["persist", "announce"]),
    );
    expect(withWork.nodes.find((node) => node.path === "idle")?.events[0]?.alternatives[0]).toEqual(
      {
        targets: ["done"],
        update: "idle.submit.update",
        commands: [{ name: "persist", input: "idle.submit.command.0.input" }, { name: "announce" }],
      },
    );
    expect(() =>
      normalizeReferenceChart({
        initial: "idle",
        states: {
          idle: { on: { submit: { target: "done", commands: [{ name: "missing" }] } } },
          done: {},
        },
      }),
    ).toThrow('requests unknown command "missing".');
  });

  it("stabilizes guarded always transitions through the same alternative algebra", () => {
    const topology = normalizeReferenceChart({
      initial: "routing",
      states: {
        routing: {
          always: [{ guard: "hasSession", target: "authenticated" }, "anonymous"],
        },
        authenticated: {},
        anonymous: {},
      },
    });

    expect(new ReferenceChartRuntime(topology).snapshot.active).toEqual(["anonymous"]);
    expect(new ReferenceChartRuntime(topology, { hasSession: true }).snapshot.active).toEqual([
      "authenticated",
    ]);
    expect(topology.nodes.find((node) => node.path === "routing")?.always).toEqual([
      { guard: "hasSession", targets: ["authenticated"] },
      { targets: ["anonymous"] },
    ]);

    expect(
      () =>
        new ReferenceChartRuntime(
          normalizeReferenceChart({
            initial: "loop",
            states: { loop: { always: "loop" } },
          }),
        ),
    ).toThrow('Statechart always transition from "loop" does not stabilize.');
  });

  it("stabilizes nested completion and emits final outputs exactly once", () => {
    const runtime = new ReferenceChartRuntime(
      normalizeReferenceChart({
        initial: "flow",
        states: {
          flow: {
            initial: "flow.editing",
            done: "success",
            states: {
              editing: { on: { finish: "flow.done" } },
              done: { type: "final", output: { draft: "saved" } },
            },
          },
          success: { type: "final", output: { result: "complete" } },
        },
      }),
    );

    expect(runtime.snapshot).toEqual({ now: 0, active: ["flow.editing"], complete: false });
    runtime.send("finish");
    expect(runtime.snapshot).toEqual({ now: 0, active: ["success"], complete: true });
    expect(runtime.drainOutputs()).toEqual([
      { state: "flow.done", value: { draft: "saved" } },
      { state: "success", value: { result: "complete" } },
    ]);
    expect(runtime.drainOutputs()).toEqual([]);
  });

  it("runs delayed transitions on a virtual clock and cancels timers on state exit", () => {
    const topology = normalizeReferenceChart({
      initial: "waiting",
      states: {
        waiting: {
          on: { cancel: "cancelled" },
          after: [{ wait: 100, target: "expired" }],
        },
        expired: {},
        cancelled: {},
      },
    });
    const cancelled = new ReferenceChartRuntime(topology);
    cancelled.advance(40);
    cancelled.send("cancel");
    cancelled.advance(1000);
    expect(cancelled.snapshot).toEqual({ now: 1040, active: ["cancelled"], complete: false });

    const expired = new ReferenceChartRuntime(topology);
    expired.advance(99);
    expect(expired.snapshot.active).toEqual(["waiting"]);
    expired.advance(1);
    expect(expired.snapshot).toEqual({ now: 100, active: ["expired"], complete: false });
  });

  it("owns typed task outcomes by state lifetime and rejects stale completion", () => {
    const runtime = new ReferenceChartRuntime(
      normalizeReferenceChart(
        {
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
        },
        new Set(["save"]),
      ),
    );

    runtime.send("start");
    const first = runtime.activeTasks[0]!;
    expect(first).toMatchObject({ owner: "saving", task: "save" });
    runtime.send("cancel");
    expect(runtime.activeTasks).toEqual([]);
    expect(runtime.completeTask("saving", "save", first.revision, "done")).toBe(false);

    runtime.send("start");
    const second = runtime.activeTasks[0]!;
    expect(second.revision).toBeGreaterThan(first.revision);
    expect(runtime.completeTask("saving", "save", second.revision, "done")).toBe(true);
    expect(runtime.snapshot.active).toEqual(["saved"]);
    expect(runtime.completeTask("saving", "save", second.revision, "done")).toBe(false);

    const failed = new ReferenceChartRuntime(
      normalizeReferenceChart(
        {
          initial: "saving",
          states: {
            saving: { tasks: [{ task: "save", fail: "failed" }] },
            failed: {},
          },
        },
        new Set(["save"]),
      ),
    );
    const task = failed.activeTasks[0]!;
    expect(failed.completeTask("saving", "save", task.revision, "fail")).toBe(true);
    expect(failed.snapshot.active).toEqual(["failed"]);
  });

  it("keeps generated virtual-clock traces deterministic", () => {
    const topology = normalizeReferenceChart({
      initial: "idle",
      states: {
        idle: { on: { start: "pending" } },
        pending: {
          on: { cancel: "idle" },
          after: [{ wait: 25, target: "done" }],
        },
        done: { on: { reset: "idle" } },
      },
    });
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({
              kind: fc.constant("send" as const),
              event: fc.constantFrom("start", "cancel", "reset"),
            }),
            fc.record({
              kind: fc.constant("advance" as const),
              milliseconds: fc.integer({ min: 0, max: 50 }),
            }),
          ),
          { maxLength: 100 },
        ),
        (operations) => {
          const run = () => {
            const runtime = new ReferenceChartRuntime(topology);
            for (const operation of operations) {
              if (operation.kind === "send") runtime.send(operation.event);
              else runtime.advance(operation.milliseconds);
            }
            return runtime.snapshot;
          };
          expect(run()).toEqual(run());
        },
      ),
    );
  });

  it("rejects output outside final states and targetless completion or delay", () => {
    expect(() =>
      normalizeReferenceChart({ initial: "idle", states: { idle: { output: "invalid" } } }),
    ).toThrow('Only a final state can declare output; received "idle".');
    expect(() =>
      normalizeReferenceChart({
        initial: "flow",
        states: {
          flow: { initial: "flow.done", done: {}, states: { done: { type: "final" } } },
        },
      }),
    ).toThrow('Transition from "flow" requires a target.');
    expect(() =>
      normalizeReferenceChart({
        initial: "idle",
        states: { idle: { after: [{ wait: 10 }] } },
      }),
    ).toThrow('Transition from "idle" requires a target.');
  });

  it("cancels state-scoped tasks and rejects stale completion", () => {
    const machine = new ReferenceStatechart({
      initial: "editing",
      states: {
        editing: { on: { submit: "submitting" } },
        submitting: {
          tasks: ["save"],
          on: { cancel: "editing", retry: "submitting", success: "done" },
        },
        done: {},
      },
    });

    expect(machine.send("submit")).toBe(true);
    const first = machine.activeTask("save")!;
    expect(machine.send("cancel")).toBe(true);
    expect(machine.outcome("save", first.revision)).toBe("cancelled");
    expect(machine.completeTask("save", first.revision)).toBe(false);

    expect(machine.send("submit")).toBe(true);
    const second = machine.activeTask("save")!;
    expect(second.revision).toBeGreaterThan(first.revision);
    expect(machine.completeTask("save", second.revision)).toBe(true);
    expect(machine.outcome("save", second.revision)).toBe("completed");
    expect(machine.send("success")).toBe(true);
    expect(machine.state).toBe("done");

    machine.dispose();
    expect(() => machine.send("submit")).toThrow("Reference statechart is disposed.");
  });

  it("queues named commands once after transition commit without task lifetime", () => {
    const machine = new ReferenceStatechart({
      initial: "list",
      states: {
        list: {
          on: {
            open: {
              target: "detail",
              commands: [
                { name: "navigate", value: { id: "wallet" } },
                { name: "track", value: "opened" },
              ],
            },
            invalid: { target: "detail", commands: [{ name: "" }] },
          },
        },
        detail: { on: { close: "list" } },
      },
    });

    expect(machine.send("open")).toBe(true);
    expect(machine.state).toBe("detail");
    expect(machine.send("close")).toBe(true);
    expect(machine.drainCommands()).toEqual([
      {
        revision: 1,
        index: 0,
        state: "detail",
        name: "navigate",
        value: { id: "wallet" },
      },
      { revision: 1, index: 1, state: "detail", name: "track", value: "opened" },
    ]);
    expect(machine.drainCommands()).toEqual([]);

    expect(() => machine.send("invalid")).toThrow("command name cannot be empty");
    expect(machine.state).toBe("list");
    expect(machine.drainCommands()).toEqual([]);
  });

  it("validates one accessible semantic hierarchy and modal focus owner", () => {
    const modalNodes = [
      { identity: "root", role: "generic", children: ["page", "trigger", "dialog"] },
      { identity: "page", role: "generic", inert: true },
      {
        identity: "trigger",
        role: "button",
        name: "Open wallet settings",
        focusable: true,
        controls: "dialog",
      },
      {
        identity: "dialog",
        role: "dialog",
        name: "Wallet settings",
        modal: true,
        children: ["close"],
      },
      { identity: "close", role: "button", name: "Close", focusable: true },
    ] as const;
    expect(
      validateReferenceSemanticTree(modalNodes, {
        root: "root",
        activeModal: {
          identity: "dialog",
          initialFocus: "close",
          returnFocus: "trigger",
        },
        focused: "close",
      }),
    ).toEqual({
      order: ["root", "page", "trigger", "dialog", "close"],
      parent: { close: "dialog", dialog: "root", page: "root", trigger: "root" },
      activeModal: { identity: "dialog", initialFocus: "close", returnFocus: "trigger" },
      focused: "close",
    });
    expect(() =>
      validateReferenceSemanticTree(modalNodes, {
        root: "root",
        activeModal: {
          identity: "dialog",
          initialFocus: "trigger",
          returnFocus: "trigger",
        },
      }),
    ).toThrow('invalid initial focus "trigger"');
    expect(() =>
      validateReferenceSemanticTree(
        modalNodes.map((node) =>
          node.identity === "trigger" ? { ...node, controls: undefined } : node,
        ),
        {
          root: "root",
          activeModal: {
            identity: "dialog",
            initialFocus: "close",
            returnFocus: "trigger",
          },
        },
      ),
    ).toThrow('invalid return focus "trigger"');
  });

  it("resolves one roving tab stop while skipping disabled items", () => {
    const items = [
      { identity: "first" },
      { identity: "disabled", disabled: true },
      { identity: "last" },
    ];
    expect(resolveReferenceRovingFocus(items, "first", "next")).toEqual({
      active: "last",
      tabStops: { first: -1, disabled: -1, last: 0 },
    });
    expect(resolveReferenceRovingFocus(items, "last", "next").active).toBe("first");
    expect(resolveReferenceRovingFocus(items, "first", "previous").active).toBe("last");
    expect(() =>
      resolveReferenceRovingFocus(
        [
          { identity: "a", disabled: true },
          { identity: "b", disabled: true },
        ],
        undefined,
        "first",
      ),
    ).toThrow("at least one enabled item");
  });

  it("validates active descendants and form error ownership within one semantic tree", () => {
    expect(
      validateReferenceSemanticTree(
        [
          { identity: "root", role: "generic", children: ["form", "list"] },
          { identity: "form", role: "form", children: ["field", "error"] },
          {
            identity: "field",
            role: "textbox",
            name: "Email",
            focusable: true,
            formOwner: "form",
            invalid: true,
            errorMessage: "error",
          },
          { identity: "error", role: "alert", name: "Enter a valid email" },
          {
            identity: "list",
            role: "listbox",
            name: "Commands",
            focusable: true,
            activeDescendant: "second",
            children: ["first", "second"],
          },
          { identity: "first", role: "option", name: "First" },
          { identity: "second", role: "option", name: "Second", selected: true },
        ],
        { root: "root", focused: "list" },
      ),
    ).toMatchObject({ focused: "list" });
    expect(() =>
      validateReferenceSemanticTree(
        [
          { identity: "root", role: "generic", children: ["list", "outside"] },
          {
            identity: "list",
            role: "listbox",
            name: "Commands",
            focusable: true,
            activeDescendant: "outside",
          },
          { identity: "outside", role: "option", name: "Outside" },
        ],
        { root: "root" },
      ),
    ).toThrow("is outside owner");
  });

  it("closes nested overlays top-down with revision-safe focus return", () => {
    const overlays = new ReferenceOverlayStack();
    overlays.open({ identity: "dialog", returnFocus: "open-dialog" });
    const childRevision = overlays.open({
      identity: "popover",
      parent: "dialog",
      returnFocus: "dialog-action",
    });
    expect(overlays.escape()).toEqual({ identity: "popover", revision: childRevision });
    expect(() => overlays.close(childRevision, "dialog")).toThrow("Only top overlay");
    expect(overlays.close(childRevision, "popover")).toEqual({
      closed: "popover",
      focus: "dialog-action",
    });
    expect(overlays.close(childRevision, "dialog")).toBeUndefined();
    const parentEscape = overlays.escape()!;
    expect(overlays.close(parentEscape.revision, "dialog")).toEqual({
      closed: "dialog",
      focus: "open-dialog",
    });
    expect(overlays.stack).toEqual([]);
  });

  it("recovers focus explicitly across responsive structure replacement", () => {
    const wide = [
      { identity: "Navigation.Link", focusable: true },
      { identity: "Navigation.Search", focusable: true },
    ];
    const compact = [
      { identity: "Navigation.Trigger", focusable: true },
      { identity: "Navigation.Menu", focusable: false, hidden: true },
    ];
    const focus = new ReferenceFocusRecoveryCoordinator("Navigation.Link");
    expect(focus.replace(wide, "Navigation.Link")).toMatchObject({
      focused: "Navigation.Link",
      strategy: "preserve",
    });
    const staleOverlayReturn = focus.capture();
    expect(focus.replace(compact, "Navigation.Trigger")).toMatchObject({
      focused: "Navigation.Trigger",
      strategy: "replace",
    });
    expect(focus.returnFocus(staleOverlayReturn, "Navigation.Link", wide)).toBe(false);
    expect(focus.focused).toBe("Navigation.Trigger");
    expect(focus.replace(wide, "Navigation.Link")).toMatchObject({
      focused: "Navigation.Link",
      strategy: "replace",
    });
    expect(() => focus.replace(compact)).toThrow("without a declared destination");
    expect(() => focus.replace(compact, "Navigation.Menu")).toThrow("is not available");
  });

  it("rejects inaccessible names, state roles, hierarchy, and modality", () => {
    expect(() =>
      validateReferenceSemanticTree([{ identity: "action", role: "button" }], {
        root: "action",
      }),
    ).toThrow('Semantic button "action" has no accessible name.');
    expect(() =>
      validateReferenceSemanticTree(
        [{ identity: "field", role: "textbox", name: "Query", labelledBy: "label" }],
        { root: "field" },
      ),
    ).toThrow('Semantic node "field" has two accessible-name owners.');
    expect(() =>
      validateReferenceSemanticTree([{ identity: "root", role: "generic", checked: true }], {
        root: "root",
      }),
    ).toThrow('Semantic generic "root" cannot have checked state.');
    expect(() =>
      validateReferenceSemanticTree(
        [
          { identity: "root", role: "generic", children: ["child"] },
          { identity: "other", role: "generic", children: ["child"] },
          { identity: "child", role: "generic" },
        ],
        { root: "root" },
      ),
    ).toThrow('Semantic node "child" belongs to both "root" and "other".');
    expect(() =>
      validateReferenceSemanticTree(
        [
          { identity: "root", role: "generic", children: ["dialog", "outside"] },
          {
            identity: "dialog",
            role: "dialog",
            name: "Dialog",
            modal: true,
            children: ["close"],
          },
          { identity: "close", role: "button", name: "Close", focusable: true },
          {
            identity: "outside",
            role: "button",
            name: "Outside",
            focusable: true,
            controls: "dialog",
          },
        ],
        {
          root: "root",
          activeModal: {
            identity: "dialog",
            initialFocus: "close",
            returnFocus: "outside",
          },
          focused: "outside",
        },
      ),
    ).toThrow('Focused identity "outside" is outside active modal "dialog".');
  });

  it("requires one explicit informative or decorative image alternative", () => {
    expect(
      validateReferenceSemanticTree(
        [{ identity: "portrait", role: "image", source: "/portrait.webp", name: "Portrait" }],
        { root: "portrait" },
      ),
    ).toMatchObject({ order: ["portrait"] });
    expect(
      validateReferenceSemanticTree(
        [{ identity: "texture", role: "image", source: "/texture.webp", decorative: true }],
        { root: "texture" },
      ),
    ).toMatchObject({ order: ["texture"] });
    expect(() =>
      validateReferenceSemanticTree(
        [{ identity: "missing", role: "image", source: "", name: "Portrait" }],
        { root: "missing" },
      ),
    ).toThrow("needs a source");
    expect(() =>
      validateReferenceSemanticTree(
        [{ identity: "missing", role: "image", source: "/portrait.webp" }],
        { root: "missing" },
      ),
    ).toThrow("needs alternative text");
    expect(() =>
      validateReferenceSemanticTree(
        [
          {
            identity: "conflicted",
            role: "image",
            source: "/texture.webp",
            decorative: true,
            name: "Texture",
          },
        ],
        { root: "conflicted" },
      ),
    ).toThrow("cannot have an accessible name");
  });

  it("plans retained semantic branch replacement without remounting survivors", () => {
    const previous = [
      {
        identity: "root",
        platformKind: "main",
        role: "generic" as const,
        children: ["common", "default"],
      },
      {
        identity: "common",
        platformKind: "p",
        role: "generic" as const,
        content: [{ kind: "text" as const, value: "Before" }],
      },
      {
        identity: "default",
        platformKind: "section",
        role: "group" as const,
        name: "Default",
        children: ["default-action"],
      },
      {
        identity: "default-action",
        platformKind: "button",
        role: "button" as const,
        name: "Open detail",
        focusable: true,
        actions: [{ event: "activate" as const, action: "open" }],
      },
    ];
    const next = [
      {
        identity: "root",
        platformKind: "main",
        role: "generic" as const,
        children: ["detail", "common"],
      },
      {
        identity: "detail",
        platformKind: "section",
        role: "group" as const,
        name: "Detail",
        children: ["detail-copy"],
      },
      {
        identity: "detail-copy",
        platformKind: "p",
        role: "generic" as const,
        content: [{ kind: "text" as const, value: "Detail" }],
      },
      {
        identity: "common",
        platformKind: "p",
        role: "generic" as const,
        content: [{ kind: "text" as const, value: "After" }],
      },
    ];

    expect(resolveReferenceStructureReconciliation(previous, next, ["default"])).toEqual({
      surviving: ["root", "common"],
      entering: ["detail", "detail-copy"],
      enterRoots: ["detail"],
      exiting: ["default", "default-action"],
      exitRoots: [{ identity: "default", presentation: "retain" }],
      moving: [],
      contentUpdates: [{ identity: "common", content: [{ kind: "text", value: "After" }] }],
      order: [
        { identity: "root", children: ["detail", "common"] },
        { identity: "detail", children: ["detail-copy"] },
        { identity: "detail-copy", children: [] },
        { identity: "common", children: [] },
      ],
    });
    expect(() =>
      resolveReferenceStructureReconciliation(previous, next, ["default-action"]),
    ).toThrow("not an exiting subtree root");
    expect(() =>
      resolveReferenceStructureReconciliation(previous, [
        { ...next[0]!, role: "group" as const },
        ...next.slice(1),
      ]),
    ).toThrow("changed its native contract");
  });

  it("preserves a usable focus indicator across custom and forced-color presentation", () => {
    expect(resolveReferenceFocusIndicator({ focusVisible: false, forcedColors: false })).toEqual({
      kind: "hidden",
    });
    expect(resolveReferenceFocusIndicator({ focusVisible: true, forcedColors: false })).toEqual({
      kind: "native",
    });
    expect(
      resolveReferenceFocusIndicator({
        focusVisible: true,
        forcedColors: false,
        custom: { visible: true, forcedColorsVisible: false },
      }),
    ).toEqual({ kind: "custom" });
    expect(
      resolveReferenceFocusIndicator({
        focusVisible: true,
        forcedColors: true,
        custom: { visible: true, forcedColorsVisible: false },
      }),
    ).toEqual({ kind: "native" });
    expect(
      resolveReferenceFocusIndicator({
        focusVisible: true,
        forcedColors: true,
        custom: { visible: true, forcedColorsVisible: true },
      }),
    ).toEqual({ kind: "custom" });
  });

  it("resolves every adjustable input path through one clamped quantized law", () => {
    const range = { minimum: -1, maximum: 1, step: 0.1, largeStep: 0.5 };
    expect(resolveReferenceAdjustableValue(0, 0.26, range, "pointer")).toEqual({
      value: 0.3,
      changed: true,
      source: "pointer",
    });
    expect(resolveReferenceAdjustableValue(0.3, 7, range, "programmatic")).toEqual({
      value: 1,
      changed: true,
      source: "programmatic",
    });
    expect(resolveReferenceAdjustableCommand(0.3, "largeDecrement", range)).toEqual({
      value: -0.2,
      changed: true,
      source: "keyboard",
    });
    expect(resolveReferenceAdjustableCommand(1, "increment", range)).toEqual({
      value: 1,
      changed: false,
      source: "keyboard",
    });
  });

  it("keeps adjustable resolution independent of input modality", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1_000, max: 1_000, noNaN: true, noDefaultInfinity: true }),
        (proposal) => {
          const range = { minimum: -10, maximum: 10, step: 0.25, largeStep: 2.5 };
          const values = (["pointer", "keyboard", "programmatic"] as const).map(
            (source) => resolveReferenceAdjustableValue(0, proposal, range, source).value,
          );
          expect(new Set(values).size).toBe(1);
          expect(values[0]).toBeGreaterThanOrEqual(range.minimum);
          expect(values[0]).toBeLessThanOrEqual(range.maximum);
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it("preserves live meaning across presentation reload and replaces incompatible contracts", () => {
    const previous = {
      contract: "Action:v1",
      structureIdentities: ["Action.Root", "Action.Trigger"],
      targetIdentities: ["Action.Trigger:opacity", "Action.Trigger:transform"],
    };
    const live = {
      presence: [
        { identity: "Action.Trigger", phase: "exiting" as const },
        { identity: "Action.Trigger", phase: "exiting" as const },
        { identity: "Removed", phase: "present" as const },
      ],
      motions: [
        {
          kind: "scalar" as const,
          identity: "Action.Trigger:opacity",
          value: 0.42,
          velocity: -0.8,
        },
        { kind: "scalar" as const, identity: "Removed:opacity", value: 0.1, velocity: 0 },
      ],
      tasks: ["Action.save", "Action.save"],
      gestures: ["Action.press"],
    };
    expect(
      resolveReferenceHotReload(
        previous,
        {
          ...previous,
          targetIdentities: ["Action.Trigger:opacity", "Action.Trigger:scale"],
        },
        live,
      ),
    ).toEqual({
      cause: "presentation",
      remount: false,
      retain: {
        context: true,
        state: true,
        presence: [{ identity: "Action.Trigger", phase: "exiting" }],
        motion: [
          { kind: "scalar", identity: "Action.Trigger:opacity", value: 0.42, velocity: -0.8 },
        ],
      },
      dispose: {
        motions: ["Removed:opacity"],
        tasks: ["Action.save"],
        gestures: ["Action.press"],
      },
    });
    expect(
      resolveReferenceHotReload(previous, { ...previous, contract: "Action:v2" }, live),
    ).toMatchObject({
      cause: "contract",
      remount: true,
      retain: { context: false, state: false, presence: [], motion: [] },
    });
  });

  it("interpolates OKLCH through the shorter hue arc with premultiplied alpha", () => {
    const hueMidpoint = interpolateReferenceOklch(
      { colorSpace: "oklch", lightness: 0.6, chroma: 0.2, hue: 350, alpha: 1 },
      { colorSpace: "oklch", lightness: 0.8, chroma: 0.1, hue: 10, alpha: 1 },
      0.5,
    );
    expect(hueMidpoint).toMatchObject({ colorSpace: "oklch", hue: 0, alpha: 1 });
    expect(hueMidpoint.lightness).toBeCloseTo(0.7);
    expect(hueMidpoint.chroma).toBeCloseTo(0.15);

    const alphaMidpoint = interpolateReferenceOklch(
      { colorSpace: "oklch", lightness: 0.8, chroma: 0.2, hue: 40, alpha: 0.8 },
      { colorSpace: "oklch", lightness: 0.2, chroma: 0.1, hue: 40, alpha: 0.2 },
      0.5,
    );
    expect(alphaMidpoint).toMatchObject({ colorSpace: "oklch", hue: 40, alpha: 0.5 });
    expect(alphaMidpoint.lightness).toBeCloseTo(0.68);
    expect(alphaMidpoint.chroma).toBeCloseTo(0.18);
  });

  it("interpolates compatible paints and rejects implicit discrete paint changes", () => {
    const black = { colorSpace: "oklch" as const, lightness: 0, chroma: 0, hue: 350, alpha: 1 };
    const white = { colorSpace: "oklch" as const, lightness: 1, chroma: 0, hue: 10, alpha: 1 };
    const from = {
      kind: "linear-gradient" as const,
      angle: { dimension: "angle" as const, value: 350 },
      stops: [
        { position: 0, color: black },
        { position: 1, color: white },
      ],
    };
    const to = {
      kind: "linear-gradient" as const,
      angle: { dimension: "angle" as const, value: 10 },
      stops: [
        { position: 0.2, color: white },
        { position: 0.8, color: black },
      ],
    };
    expect(interpolateReferencePaint(from, to, 0.5)).toMatchObject({
      kind: "linear-gradient",
      angle: { dimension: "angle", value: 0 },
      stops: [{ position: 0.1 }, { position: 0.9 }],
    });
    expect(() =>
      interpolateReferencePaint(
        from,
        {
          ...to,
          stops: [...to.stops, { position: 1, color: white }],
        },
        0.5,
      ),
    ).toThrow("matching stop topology");
    expect(() => interpolateReferencePaint({ kind: "solid", color: black }, to, 0.5)).toThrow(
      "matching kinds",
    );
  });

  it("interpolates axis-angle rotation through normalized quaternion Slerp", () => {
    const identityMidpoint = interpolateReferenceRotation(
      { axis: { x: 0, y: 0, z: 1 }, degrees: 350 },
      { axis: { x: 0, y: 0, z: 1 }, degrees: 10 },
      0.5,
    );
    expect(identityMidpoint.degrees).toBeCloseTo(0);
    expect(identityMidpoint.axis).toEqual({ x: 0, y: 0, z: 1 });

    const quarterTurn = interpolateReferenceRotation(
      { axis: { x: 0, y: 0, z: 1 }, degrees: 0 },
      { axis: { x: 0, y: 0, z: 1 }, degrees: 180 },
      0.5,
    );
    expect(quarterTurn.degrees).toBeCloseTo(90);
    expect(Math.hypot(quarterTurn.axis.x, quarterTurn.axis.y, quarterTurn.axis.z)).toBeCloseTo(1);
    expect(() =>
      interpolateReferenceRotation(
        { axis: { x: 0, y: 0, z: 0 }, degrees: 30 },
        { axis: { x: 0, y: 0, z: 1 }, degrees: 60 },
        0.5,
      ),
    ).toThrow("Rotation axis cannot be zero.");
  });

  it("never increases physical spring energy across arbitrary forward samples", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 5, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 500, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 2, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 2, noNaN: true, noDefaultInfinity: true }),
        (from, to, velocity, mass, stiffness, damping, firstTime, delta) => {
          const spring = { from, to, velocity, mass, stiffness, damping };
          const first = sampleReferenceSpring(spring, firstTime);
          const second = sampleReferenceSpring(spring, firstTime + delta);
          const energy = (sample: { value: number; velocity: number }) =>
            0.5 * mass * sample.velocity * sample.velocity +
            0.5 * stiffness * (sample.value - to) * (sample.value - to);
          const firstEnergy = energy(first);
          const secondEnergy = energy(second);
          const tolerance = Math.max(1, firstEnergy) * 1e-9;
          expect(secondEnergy).toBeLessThanOrEqual(firstEnergy + tolerance);
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it("reconciles arbitrary unique key sets without losing or duplicating identity", () => {
    const keys = fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 30 });
    fc.assert(
      fc.property(keys, keys, (previous, next) => {
        const result = reconcileReferenceKeys(previous, next);
        expect(result.retained).toEqual(next.filter((key) => previous.includes(key)));
        expect(result.entered).toEqual(next.filter((key) => !previous.includes(key)));
        expect(new Set([...result.retained, ...result.exited])).toEqual(new Set(previous));
        expect(new Set([...result.retained, ...result.entered]).size).toBe(next.length);
        expect(
          result.moved.every(
            ({ key, from, to }) => previous[from] === key && next[to] === key && from !== to,
          ),
        ).toBe(true);
      }),
      { numRuns: 1_000 },
    );
  });

  it("keeps state and task ownership lawful across arbitrary event traces", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("submit", "cancel", "success", "retry", "unknown"), {
          maxLength: 200,
        }),
        (events) => {
          const machine = new ReferenceStatechart({
            initial: "editing",
            states: {
              editing: { on: { submit: "submitting" } },
              submitting: {
                tasks: ["save"],
                on: { cancel: "editing", success: "done", retry: "submitting" },
              },
              done: {},
            },
          });
          for (const event of events) {
            machine.send(event);
            expect(["editing", "submitting", "done"]).toContain(machine.state);
            expect(machine.activeTask("save") !== undefined).toBe(machine.state === "submitting");
          }
        },
      ),
      { numRuns: 1_000 },
    );
  });
});
