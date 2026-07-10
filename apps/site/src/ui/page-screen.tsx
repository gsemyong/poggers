import { createPageHero, createSectionCard, usePage, useScreen } from "@poggers/app";
import { For } from "@poggers/kit/ui";

export function PageScreen() {
  const Hero = createPageHero({
    input: {
      get page() {
        const screen = useScreen();
        return usePage({ slug: screen.name === "page" ? screen.params.slug : "home" }).page;
      },
    },
  });

  return () => (
    <Hero.Root>
      <Hero.Mark aria-hidden>PK</Hero.Mark>
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
