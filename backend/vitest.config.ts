import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./src/test/setupEnv.ts"],
    // Integration tests share one physical test database and clean it with a
    // global resetDb() — running test files in parallel workers lets one file's
    // cleanup wipe rows another file's test is mid-assertion on. Serial execution
    // is the simple fix; the suite is fast enough (a couple seconds) that this
    // costs nothing that matters.
    fileParallelism: false,
  },
});
