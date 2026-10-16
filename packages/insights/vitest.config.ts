import { defineConfig } from "vitest/config";

// The 400-store accuracy suite recomputes every figure by brute force.
export default defineConfig({ test: { testTimeout: 120_000, hookTimeout: 120_000 } });
