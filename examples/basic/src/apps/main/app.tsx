import { createApp, type PlatformInterfaceContract } from "kit";
import { createWebInterface, type WebPlatform } from "kit/web";

import { shell, type ShellFeature } from "@/features/shell";
import { clean } from "@/presentations/clean";

type WebContract = {
  Features: { shell: ShellFeature };
};

export type Web = PlatformInterfaceContract<WebContract, WebPlatform>;

const web = createWebInterface<WebContract>({
  features: { shell },
  presentation: clean,
});

export const main = createApp({
  features: { web },
});
