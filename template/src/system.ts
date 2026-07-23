import { createApp, createSystem, type PlatformInterfaceContract } from "@poggers/kit";
import { createWebInterface, type WebPlatform } from "@poggers/kit/web";

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

const app = createApp<{ Features: { web: Web } }>({
  features: { web },
});

export default createSystem({
  metadata: { name: "{{name}}" },
  features: { app },
});
