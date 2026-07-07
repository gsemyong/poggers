import { createMemoryClientStore } from "tests/helpers/memory-storage";
import { runClientStoreContract } from "tests/helpers/storage-contracts";

runClientStoreContract("memory", () => createMemoryClientStore());
