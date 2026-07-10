import { PageScreen } from "ui/page-screen";
import { SiteShell } from "ui/site-shell";

export function Root() {
  return () => (
    <SiteShell>
      <PageScreen />
    </SiteShell>
  );
}
