import { createMemoryStore } from "tests/helpers/memory-storage";
import { runStoreContract } from "tests/helpers/storage-contracts";

runStoreContract("memory", () => createMemoryStore());
