import type { AppDefinition } from "@poggers/app";
import { editorialPreset, precisionPreset, tactilePreset } from "src/presets";
import type { App, Command, CommandId } from "types";
import { Root } from "ui/root";

const panelId = "visual-lab-command-menu";
const commands: readonly Command[] = [
  {
    id: "compose",
    label: "Compose with context",
    detail: "Start a focused draft using the active project and selection.",
    shortcut: "C",
  },
  {
    id: "search",
    label: "Search workspace",
    detail: "Find files, symbols, decisions, and recent conversations.",
    shortcut: "S",
  },
  {
    id: "review",
    label: "Review current changes",
    detail: "Inspect behavior, accessibility, and verification evidence.",
    shortcut: "R",
  },
  {
    id: "share",
    label: "Prepare a handoff",
    detail: "Package the current context for another collaborator.",
    shortcut: "H",
  },
  {
    id: "settings",
    label: "Open preferences",
    detail: "Adjust appearance, motion, and project defaults.",
    shortcut: ",",
  },
];

export default {
  version: 1,
  app: { name: "Visual Lab" },
  pwa: {
    name: "Poggers Visual Lab",
    shortName: "Visual Lab",
    description: "Poggers visual system verification application.",
    themeColor: "oklch(96.5% 0.004 255)",
    backgroundColor: "oklch(96.5% 0.004 255)",
    display: "standalone",
  },
  resources: {},
  components: {
    CommandMenu: {
      state: {
        open: false,
        phase: "idle",
        query: "",
        selected: commands[0]!.id,
        mode: "ready",
        dragOffset: 0,
      },
      derived({ state }) {
        return {
          get commands() {
            const query = state.query.trim().toLowerCase();
            return query
              ? commands.filter((command) =>
                  `${command.label} ${command.detail}`.toLowerCase().includes(query),
                )
              : [...commands];
          },
          get resultText() {
            const count = this.commands.length;
            return count === 1 ? "1 command" : `${count} commands`;
          },
          get statusTitle() {
            if (state.mode === "loading") return "Searching the workspace";
            if (state.mode === "error") return "Search is temporarily unavailable";
            return "No matching commands";
          },
          get statusDetail() {
            if (state.mode === "loading") return "Resolving files, symbols, and recent context.";
            if (state.mode === "error") return "Try the search again without losing your place.";
            return "Try a broader phrase or clear the current search.";
          },
        };
      },
      actions({ state, derived, setPreset, theme, setTheme }) {
        return {
          toggleOpen() {
            state.open = !state.open;
            state.phase = state.open ? "opening" : "closing";
          },
          close() {
            state.open = false;
            state.phase = "closing";
          },
          selectPrecision() {
            setPreset("precision");
          },
          selectTactile() {
            setPreset("tactile");
          },
          selectEditorial() {
            setPreset("editorial");
          },
          toggleTheme() {
            setTheme(theme === "dark" ? "default" : "dark");
          },
          syncOpen(open) {
            state.open = open;
            state.phase = open ? "open" : "idle";
            if (!open) {
              state.query = "";
              state.mode = "ready";
              state.selected = commands[0]!.id;
            }
          },
          setQuery(query) {
            state.query = query;
            const normalized = query.trim().toLowerCase();
            state.mode =
              normalized === "loading" ? "loading" : normalized === "error" ? "error" : "ready";
            state.selected = derived.commands[0]?.id;
          },
          select(id) {
            state.selected = id;
          },
          move(delta) {
            const visible = derived.commands;
            if (!visible.length) return;
            const index = visible.findIndex((command) => command.id === state.selected);
            state.selected =
              visible[(Math.max(0, index) + delta + visible.length) % visible.length]!.id;
          },
          choose(id) {
            state.selected = id;
            state.open = false;
            state.phase = "closing";
          },
          retry() {
            state.query = "";
            state.mode = "ready";
            state.selected = commands[0]!.id;
          },
        };
      },
      bind({ preset, theme, state, derived, actions }) {
        return {
          values: {
            dragOffset: state.dragOffset,
            openness: state.open ? 1 : 0,
          },
          Kicker: { children: "One component · one semantic tree" },
          Title: { children: "Command menu" },
          Summary: {
            children:
              "A focused proof that behavior and accessibility remain fixed while presets own every visual and motion decision.",
          },
          PresetNav: { "aria-label": "Visual preset" },
          PrecisionPreset: {
            type: "button",
            "aria-pressed": preset === "precision",
            onClick: actions.selectPrecision,
            children: "Precision",
          },
          TactilePreset: {
            type: "button",
            "aria-pressed": preset === "tactile",
            onClick: actions.selectTactile,
            children: "Tactile",
          },
          EditorialPreset: {
            type: "button",
            "aria-pressed": preset === "editorial",
            onClick: actions.selectEditorial,
            children: "Editorial",
          },
          ThemeToggle: {
            type: "button",
            "aria-pressed": theme === "dark",
            onClick: actions.toggleTheme,
            children: theme === "dark" ? "Light" : "Dark",
          },
          Trigger: {
            type: "button",
            "aria-controls": panelId,
            "aria-haspopup": "dialog",
            "aria-expanded": state.open,
            onClick: actions.toggleOpen,
            children: undefined,
          },
          TriggerIcon: { children: "⌕", "aria-hidden": true },
          TriggerLabel: { children: state.open ? "Close commands" : "Search commands" },
          TriggerKey: { children: "⌘K", "aria-hidden": true },
          Panel: {
            id: panelId,
            dialogOpen: state.open,
            "aria-label": "Command menu",
            onCancel(event) {
              event.preventDefault();
              actions.close();
            },
            onClick(event) {
              if (event.target === event.currentTarget) actions.close();
            },
            onClose() {
              actions.syncOpen(false);
            },
            onVisualDismiss: actions.close,
          },
          Backdrop: {
            "aria-hidden": true,
            onClick: actions.close,
          },
          Handle: { "aria-hidden": true },
          SearchIcon: { children: "⌕", "aria-hidden": true },
          SearchInput: {
            type: "search",
            autofocus: true,
            value: state.query,
            placeholder: "Search commands",
            role: "combobox",
            "aria-label": "Search commands",
            "aria-controls": `${panelId}-results`,
            "aria-expanded": state.open,
            "aria-activedescendant": state.selected ? `command-${state.selected}` : undefined,
            onInput(event) {
              actions.setQuery(event.currentTarget.value);
            },
            onKeyDown(event) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                actions.move(event.key === "ArrowDown" ? 1 : -1);
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (state.selected) actions.choose(state.selected);
              }
            },
          },
          Results: {
            id: `${panelId}-results`,
            role: "listbox",
            "aria-label": "Commands",
            onPointerMove(event) {
              const id = commandIdFromTarget(event.target);
              if (id) actions.select(id);
            },
            onClick(event) {
              const id = commandIdFromTarget(event.target);
              if (id) actions.choose(id);
            },
          },
          Status: {
            role: state.mode === "error" ? "alert" : "status",
          },
          StatusTitle: { children: derived.statusTitle },
          StatusDetail: { children: derived.statusDetail },
          Retry: {
            type: "button",
            hidden: state.mode !== "error",
            onClick: actions.retry,
            children: "Try again",
          },
          ResultCount: { children: derived.resultText, role: "status" },
          Close: {
            type: "button",
            onClick: actions.close,
            children: "Done",
          },
        };
      },
    },
  },
  styles: {
    defaultPreset: "precision",
    presets: {
      precision: precisionPreset,
      tactile: tactilePreset,
      editorial: editorialPreset,
    },
  },
  root: Root,
} satisfies AppDefinition<App>;

export function commandById(id: CommandId): Command {
  return commands.find((command) => command.id === id) ?? commands[0]!;
}

function commandIdFromTarget(target: EventTarget | null): CommandId | undefined {
  if (!(target instanceof Element)) return;
  const value = target.closest<HTMLButtonElement>('button[role="option"]')?.value;
  return commands.some((command) => command.id === value) ? (value as CommandId) : undefined;
}
