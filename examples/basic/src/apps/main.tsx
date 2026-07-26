import { createApp } from "kit";
import { createWebInterface } from "kit/web";

import { shell, type ShellFeature } from "@/features/shell";
import { clean } from "@/presentations/web";

export type Main = {
  Features: { shell: ShellFeature };
};

const web = createWebInterface<Main>({
  presentation: clean,
});

export const main = createApp({
  features: { shell },
  interfaces: { web },
});
