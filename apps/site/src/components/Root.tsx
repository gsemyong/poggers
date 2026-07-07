import { SiteShell } from "./layout/SiteShell";
import { PageScreen } from "./screens/PageScreen";

export function Root() {
  return (
    <SiteShell>
      <PageScreen />
    </SiteShell>
  );
}
