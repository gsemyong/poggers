import { PageScreen } from "./page-screen";
import { SiteShell } from "./site-shell";

export function Root() {
  return (
    <SiteShell>
      <PageScreen />
    </SiteShell>
  );
}
