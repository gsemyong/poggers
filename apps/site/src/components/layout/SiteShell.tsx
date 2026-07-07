import { createNavButton, createSiteShell, nav, usePage, useScreen } from "@poggers/app";
import { For } from "@poggers/kit/ui";
import type { Child } from "@poggers/kit/ui";

export function SiteShell({ children }: { children?: Child }) {
  const Shell = createSiteShell();
  const activeSlug = () => {
    const screen = useScreen();
    return screen.name === "page" ? screen.params.slug : "home";
  };
  const page = () => usePage({ slug: activeSlug() });

  function navigate(slug: string) {
    if (slug === "home") {
      nav.home();
      return;
    }
    nav.page({ slug });
  }

  return (
    <Shell.Root>
      <Shell.Sidebar>
        <Shell.Brand>Poggers Kit</Shell.Brand>
        <Shell.Nav>
          <For each={() => page().nav()}>
            {(item) => {
              const NavButton = createNavButton({
                input: { active: item.slug === activeSlug() },
              });
              return (
                <NavButton.Root type="button" onClick={() => navigate(item.slug)}>
                  <NavButton.Label>{item.title}</NavButton.Label>
                </NavButton.Root>
              );
            }}
          </For>
        </Shell.Nav>
      </Shell.Sidebar>

      <Shell.Content>{children}</Shell.Content>
    </Shell.Root>
  );
}
