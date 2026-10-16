import { defineConfig } from "vitest/config";

// The API test files share one test database and reset it, so run them one at a time.
export default defineConfig({ test: { fileParallelism: false } });
