import { createApplication } from "kit";
import type { WebPlatform } from "kit/web";

import { shell, type ShellFeature } from "@/features/shell";
import { clean } from "@/presentations/web";

export type Main = {
  Features: { shell: ShellFeature };
  Interfaces: WebPlatform;
};

export const main = createApplication<Main>({
  features: { shell },
  interfaces: {
    web: { presentation: clean },
  },
});
