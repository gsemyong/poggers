import { createPageHero, createSectionCard, usePage, useScreen } from "@poggers/app";
import { For } from "@poggers/kit/ui";

export function PageScreen() {
  const Hero = createPageHero({
    derived() {
      return {
        get title() {
          const screen = useScreen();
          const slug = screen.name === "page" ? screen.params.slug : "home";
          return usePage({ slug }).page.title;
        },
        get summary() {
          const screen = useScreen();
          const slug = screen.name === "page" ? screen.params.slug : "home";
          return usePage({ slug }).page.summary;
        },
        get sections() {
          const screen = useScreen();
          const slug = screen.name === "page" ? screen.params.slug : "home";
          return usePage({ slug }).page.sections;
        },
      };
    },
  });

  return (
    <Hero.Root>
      <Hero.Mark aria-hidden="true">PK</Hero.Mark>
      <Hero.Eyebrow>Built with Poggers Kit</Hero.Eyebrow>
      <Hero.Title />
      <Hero.Summary />
      <Hero.Sections>
        <For each={Hero.sections}>
          {(section) => {
            const Card = createSectionCard({ input: section });
            return (
              <Card.Root>
                <Card.Title />
                <Card.Body />
              </Card.Root>
            );
          }}
        </For>
      </Hero.Sections>
    </Hero.Root>
  );
}
