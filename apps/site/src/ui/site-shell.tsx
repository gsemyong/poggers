import { createNavButton, createSiteShell, nav, usePage, useScreen } from "@poggers/app";
import { For } from "@poggers/kit/ui";
import type { Child } from "@poggers/kit/ui";

export function SiteShell({ children }: { children?: Child }) {
  const Shell = createSiteShell({
    derived() {
      return {
        get activeSlug() {
          const screen = useScreen();
          return screen.name === "page" ? screen.params.slug : "home";
        },
        get navItems() {
          const screen = useScreen();
          const slug = screen.name === "page" ? screen.params.slug : "home";
          return usePage({ slug }).nav;
        },
      };
    },
  });

  return (
    <Shell.Root>
      <Shell.Sidebar>
        <Shell.Brand>Poggers Kit</Shell.Brand>
        <Shell.Nav>
          <For each={Shell.navItems}>
            {(item) => {
              const NavButton = createNavButton({
                input: { active: item.slug === Shell.activeSlug, label: item.title },
                actions() {
                  return {
                    navigate() {
                      if (item.slug === "home") {
                        nav.home();
                        return;
                      }
                      nav.page({ slug: item.slug });
                    },
                  };
                },
              });
              return (
                <NavButton.Root>
                  <NavButton.Label />
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
