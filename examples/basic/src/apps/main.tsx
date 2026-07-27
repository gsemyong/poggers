import { createApplication } from "kit";
import type { WebPlatform } from "kit/web";

import type { ShellFeature } from "@/features/shell";
import { clean } from "@/presentations/web";

export type Main = {
  Name: "Basic";
  Features: { shell: ShellFeature };
  Interfaces: WebPlatform;
};

export const main = createApplication<Main>({
  interfaces: {
    web: { presentation: clean },
  },
});
