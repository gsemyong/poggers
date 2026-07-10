import { createCommandMenu } from "@poggers/app";
import { For, Show } from "@poggers/kit/ui";

export function Root() {
  const Menu = createCommandMenu();

  return () => (
    <Menu.Root>
      <Menu.Stage>
        <Menu.Heading>
          <Menu.Kicker />
          <Menu.Title />
          <Menu.Summary />
        </Menu.Heading>

        <Menu.PresetNav>
          <Menu.PrecisionPreset />
          <Menu.TactilePreset />
          <Menu.EditorialPreset />
          <Menu.ThemeToggle />
        </Menu.PresetNav>

        <Menu.Trigger>
          <Menu.TriggerIcon />
          <Menu.TriggerLabel />
          <Menu.TriggerKey />
        </Menu.Trigger>

        <Menu.Panel>
          <Menu.Backdrop />
          <Menu.Surface>
            <Menu.Handle />
            <Menu.Search>
              <Menu.SearchIcon />
              <Menu.SearchInput />
            </Menu.Search>

            <Show when={() => Menu.state.mode === "ready" && Menu.commands.length > 0}>
              <Menu.Results>
                <For each={Menu.commands} by={(command) => command.id}>
                  {(command) => {
                    return (
                      <Menu.Result
                        id={`command-${command.id}`}
                        type="button"
                        value={command.id}
                        role="option"
                        tabIndex={-1}
                        aria-selected={() => Menu.state.selected === command.id}
                      >
                        <Show when={() => Menu.state.selected === command.id}>
                          <Menu.Selection aria-hidden />
                        </Show>
                        <Menu.ResultCopy>
                          <Menu.ResultLabel>{command.label}</Menu.ResultLabel>
                          <Menu.ResultDetail>{command.detail}</Menu.ResultDetail>
                        </Menu.ResultCopy>
                        <Menu.ResultKey>{command.shortcut}</Menu.ResultKey>
                      </Menu.Result>
                    );
                  }}
                </For>
              </Menu.Results>
            </Show>

            <Show when={() => Menu.state.mode !== "ready" || Menu.commands.length === 0}>
              <Menu.Status>
                <Menu.StatusTitle />
                <Menu.StatusDetail />
                <Menu.Retry />
              </Menu.Status>
            </Show>

            <Menu.Footer>
              <Menu.ResultCount />
              <Menu.Close />
            </Menu.Footer>
          </Menu.Surface>
        </Menu.Panel>
      </Menu.Stage>
    </Menu.Root>
  );
}
