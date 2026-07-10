import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { readFile, writeFile } from "node:fs/promises";

const presets = ["Precision", "Tactile", "Editorial"] as const;

async function selectPreset(page: Page, name: (typeof presets)[number]) {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Search commands", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Command menu" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Search commands" })).toBeFocused();
  return dialog;
}

async function closeMenu(page: Page) {
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Command menu" })).toBeHidden();
}

test("one semantic component supports three distinct preset fingerprints", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const fingerprints: string[] = [];
  const semanticSignatures: string[] = [];
  for (const preset of presets) {
    await selectPreset(page, preset);
    const selectionContrast = await page
      .getByRole("navigation", { name: "Visual preset" })
      .evaluate((navigation) => {
        const signature = (element: Element) => {
          const style = getComputedStyle(element);
          return JSON.stringify({
            background: style.backgroundImage || style.backgroundColor,
            border: style.borderBlockEndColor,
            color: style.color,
            shadow: style.boxShadow,
            transform: style.transform,
          });
        };
        const selected = navigation.querySelector('[aria-pressed="true"]');
        const inactive = navigation.querySelector('[aria-pressed="false"]');
        return selected && inactive ? [signature(selected), signature(inactive)] : [];
      });
    expect(selectionContrast).toHaveLength(2);
    expect(selectionContrast[0]).not.toBe(selectionContrast[1]);
    const dialog = await openMenu(page);
    await page.waitForTimeout(650);
    const placement = await dialog.evaluate((element) => {
      const style = getComputedStyle(element);
      const rectangle = element.getBoundingClientRect();
      return {
        bottomGap: innerHeight - rectangle.bottom,
        fallback: style.positionTryFallbacks,
        order: style.positionTryOrder,
        topGap: rectangle.top,
      };
    });
    expect(placement.fallback).toBe("flip-block");
    expect(placement.order).toBe("most-block-size");
    expect(placement.topGap).toBeGreaterThanOrEqual(8);
    expect(placement.bottomGap).toBeGreaterThanOrEqual(8);
    fingerprints.push(
      await dialog.evaluate((element) => {
        const style = getComputedStyle(element);
        const selected = getComputedStyle(element.querySelector('[aria-selected="true"]')!);
        return JSON.stringify({
          background: style.backgroundImage || style.backgroundColor,
          border: `${style.borderWidth} ${style.borderRadius}`,
          font: style.fontFamily,
          shadow: style.boxShadow,
          selected: selected.color,
          width: style.width,
        });
      }),
    );
    semanticSignatures.push(
      JSON.stringify({
        dialog: await page.getByRole("dialog", { name: "Command menu" }).count(),
        combobox: await page.getByRole("combobox", { name: "Search commands" }).count(),
        listbox: await page.getByRole("listbox", { name: "Commands" }).count(),
        options: await page.getByRole("option").count(),
        statuses: await page.getByRole("status").count(),
        done: await page.getByRole("button", { name: "Done", exact: true }).count(),
      }),
    );
    await closeMenu(page);
  }

  expect(new Set(fingerprints).size).toBe(3);
  expect(new Set(semanticSignatures).size).toBe(1);
});

test("typed theme selection stays reactive and preserves component state", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await selectPreset(page, "Precision");
  const dialog = await openMenu(page);
  const input = page.getByRole("combobox", { name: "Search commands" });
  await input.fill("review");
  expect(
    await dialog.evaluate((element) => innerHeight - element.getBoundingClientRect().bottom),
  ).toBeGreaterThanOrEqual(8);
  const lightCanvas = await page
    .locator("main")
    .evaluate((element) => getComputedStyle(element).color);

  await page.getByRole("button", { name: "Dark", exact: true }).click();
  const themeButton = page.getByRole("button", { name: "Light", exact: true });
  await expect(themeButton).toHaveAttribute("aria-pressed", "true");
  await expect(dialog).toBeVisible();
  await expect(input).toHaveValue("review");
  await expect
    .poll(() => page.locator("main").evaluate((element) => getComputedStyle(element).color))
    .not.toBe(lightCanvas);

  await selectPreset(page, "Tactile");
  await expect(themeButton).toHaveAttribute("aria-pressed", "true");
  await expect(input).toHaveValue("review");
  await selectPreset(page, "Precision");
  await expect(themeButton).toHaveAttribute("aria-pressed", "true");
  await themeButton.click();
  await expect(page.getByRole("button", { name: "Dark", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("keyboard search, shared selection, states, and focus return work", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  const dialog = await openMenu(page);
  const input = page.getByRole("combobox", { name: "Search commands" });

  await input.press("ArrowDown");
  await expect(page.getByRole("option", { name: /Search workspace/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog.locator('[aria-selected="true"] span[aria-hidden="true"]')).toHaveCount(1);

  await input.fill("zzzz");
  await expect(page.getByText("No matching commands", { exact: true })).toBeVisible();
  await input.fill("loading");
  await expect(page.getByText("Searching the workspace", { exact: true })).toBeVisible();
  await input.fill("error");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(5);

  await input.fill("review");
  await expect(page.getByRole("option", { name: /Review current changes/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await input.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Search commands", exact: true })).toBeFocused();
  await expect(page.locator("[data-motion-state], [data-motion-lifecycle], [inert]")).toHaveCount(
    0,
  );

  await selectPreset(page, "Tactile");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await openMenu(page);
  const unselected = page.locator('[role="option"][aria-selected="false"]');
  await expect(unselected).toHaveCount(4);
  expect(
    new Set(await unselected.evaluateAll((options) => options.map((option) => option.className)))
      .size,
  ).toBe(1);
});

test("compact sheet drags, springs back, and flick-dismisses", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const dialog = await openMenu(page);
  await page.waitForTimeout(650);
  const handle = dialog.locator(":scope > div").first();
  const box = await handle.boundingBox();
  if (!box) throw new Error("Missing drag handle geometry.");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 59, { steps: 8 });
  await page.waitForTimeout(120);
  await page.mouse.move(x, y + 60);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.evaluate((element) => element.getAttribute("style") ?? ""))
    .not.toContain("transform");

  const nextBox = await handle.boundingBox();
  if (!nextBox) throw new Error("Missing settled drag handle geometry.");
  await page.mouse.move(nextBox.x + nextBox.width / 2, nextBox.y + nextBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(nextBox.x + nextBox.width / 2, nextBox.y + 170, { steps: 4 });
  await page.mouse.up();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Search commands", exact: true })).toBeFocused();
});

test("preset hot refresh preserves state and does not replay entrance motion", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await openMenu(page);
  const input = page.getByRole("combobox", { name: "Search commands" });
  await input.fill("review");
  const presetPath = new URL("../src/presets.ts", import.meta.url);
  const source = await readFile(presetPath, "utf8");
  const changed = source.replace(
    "radius: { control: 8, panel: 17 }",
    "radius: { control: 8, panel: 18 }",
  );
  expect(changed).not.toBe(source);

  try {
    await writeFile(presetPath, changed);
    const dialog = page.getByRole("dialog", { name: "Command menu" });
    await expect
      .poll(() => dialog.evaluate((element) => getComputedStyle(element).borderRadius))
      .toBe("18px");
    await expect(dialog).toBeVisible();
    await expect(input).toHaveValue("review");
    await expect(dialog).toHaveCount(1);
    await page.waitForTimeout(200);
    await expect(dialog).not.toHaveCSS("opacity", "0");
    expect(await dialog.getAttribute("style")).not.toContain("will-change");
  } finally {
    await writeFile(presetPath, source);
  }

  await expect
    .poll(() =>
      page
        .getByRole("dialog", { name: "Command menu" })
        .evaluate((element) => getComputedStyle(element).borderRadius),
    )
    .toBe("17px");
  await expect(page.getByRole("combobox", { name: "Search commands" })).toHaveValue("review");
});

test("all presets have no automated WCAG A/AA violations", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.addScriptTag({ content: axe.source });

  for (const preset of presets) {
    await selectPreset(page, preset);
    await openMenu(page);
    await page.waitForTimeout(650);
    const results = await page.evaluate(async () =>
      // axe is injected above so the production application has no testing dependency.
      (globalThis as typeof globalThis & { axe: typeof axe }).axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      }),
    );
    expect(
      results.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.length })),
    ).toEqual([]);
    await closeMenu(page);
  }
});

test("reduced motion and forced colors preserve the complete interaction", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  let dialog = await openMenu(page);
  await page.waitForTimeout(50);
  expect(
    await dialog.evaluate((element) => ({
      animation: getComputedStyle(element).animationDuration,
      transition: getComputedStyle(element).transitionDuration,
      transform: element.style.transform,
      willChange: element.style.willChange,
    })),
  ).toEqual({ animation: "0.001s", transition: "0s", transform: "", willChange: "" });
  await page.getByRole("combobox", { name: "Search commands" }).press("Escape");
  await expect(dialog).toBeHidden();

  await page.emulateMedia({ forcedColors: "active", reducedMotion: "no-preference" });
  await page.reload();
  dialog = await openMenu(page);
  const input = page.getByRole("combobox", { name: "Search commands" });
  expect(
    await input.evaluate((element) => {
      const style = getComputedStyle(element);
      return style.outlineStyle !== "none" || style.boxShadow !== "none";
    }),
  ).toBe(true);
  await input.fill("review");
  await expect(page.getByRole("option")).toHaveCount(1);
  await input.press("Enter");
  await expect(dialog).toBeHidden();
});

test("logical layout works in RTL without changing semantics", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
  });
  await selectPreset(page, "Editorial");
  const dialog = await openMenu(page);
  await page.waitForTimeout(650);
  const bounds = await dialog.boundingBox();
  if (!bounds) throw new Error("Missing RTL dialog geometry.");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(900);
  const input = page.getByRole("combobox", { name: "Search commands" });
  await input.press("ArrowDown");
  await expect(page.getByRole("option", { name: /Search workspace/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("320px reflow, 200 percent text, and long content do not escape the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const dialog = await openMenu(page);
  await page.waitForTimeout(650);
  await dialog.evaluate((element) => {
    const label = element.querySelector('[role="option"] span:nth-child(2) span:first-child');
    const detail = element.querySelector('[role="option"] span:nth-child(2) span:last-child');
    if (label) label.textContent = "Compose an exceptionally detailed workspace update";
    if (detail) {
      detail.textContent =
        "A deliberately long description that verifies wrapping, containment, and readable reflow.";
    }
  });

  const geometry = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewport: innerWidth,
      bodyOverflow: document.documentElement.scrollWidth - innerWidth,
      dialogOverflow: element.scrollWidth - element.clientWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.bodyOverflow).toBeLessThanOrEqual(1);
  expect(geometry.dialogOverflow).toBeLessThanOrEqual(1);
});

test("rapid interruptions converge without residue, duplication, or browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");

  for (let index = 0; index < 6; index++) {
    await selectPreset(page, presets[index % presets.length]!);
    const trigger = page.getByRole("button", { name: "Search commands", exact: true });
    await trigger.click();
    await expect(page.getByRole("dialog", { name: "Command menu" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.setViewportSize(
      index % 2 === 0 ? { width: 390, height: 844 } : { width: 1180, height: 760 },
    );
  }

  await page.setViewportSize({ width: 1024, height: 768 });
  const dialog = await openMenu(page);
  const input = page.getByRole("combobox", { name: "Search commands" });
  await input.fill("review");
  await input.fill("");
  await input.press("ArrowDown");
  await page.waitForTimeout(700);

  await expect(dialog).toHaveCount(1);
  await expect(page.getByRole("option")).toHaveCount(5);
  await expect(page.locator("[data-motion-lifecycle], [inert]")).toHaveCount(0);
  expect(
    await dialog.evaluate((element) => ({
      transform: element.style.transform,
      willChange: element.style.willChange,
    })),
  ).toEqual({ transform: "", willChange: "" });
  expect(errors).toEqual([]);
});

test("close, preset replacement, and immediate reopen cancel the prior exit owner", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await selectPreset(page, "Tactile");
  let dialog = await openMenu(page);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await selectPreset(page, "Editorial");
  dialog = await openMenu(page);
  await page.waitForTimeout(700);

  expect(
    await dialog.evaluate((element) => ({
      computed: getComputedStyle(element).transform,
      inline: element.style.transform,
      opacity: element.style.opacity,
      willChange: element.style.willChange,
    })),
  ).toEqual({ computed: "none", inline: "", opacity: "", willChange: "" });
});
