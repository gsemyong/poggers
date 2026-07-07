import { createPageHero, createSectionCard, usePage, useScreen } from "@poggers/app";
import { For } from "@poggers/kit/ui";

export function PageScreen() {
  const Hero = createPageHero();
  const slug = () => {
    const screen = useScreen();
    return screen.name === "page" ? screen.params.slug : "home";
  };
  const current = () => usePage({ slug: slug() });
  const activePage = () => current().page();

  return (
    <Hero.Root>
      <Hero.Mark aria-hidden="true">PK</Hero.Mark>
      <Hero.Eyebrow>Built with Poggers Kit</Hero.Eyebrow>
      <Hero.Title>{() => activePage().title}</Hero.Title>
      <Hero.Summary>{() => activePage().summary}</Hero.Summary>
      <Hero.Sections>
        <For each={() => activePage().sections}>
          {(section) => {
            const Card = createSectionCard();
            return (
              <Card.Root>
                <Card.Title>{section.heading}</Card.Title>
                <Card.Body>{section.body}</Card.Body>
              </Card.Root>
            );
          }}
        </For>
      </Hero.Sections>
    </Hero.Root>
  );
}
