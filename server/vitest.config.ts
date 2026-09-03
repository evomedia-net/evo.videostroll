import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // A run launches Chromium, records, and encodes with ffmpeg. Generous on
    // purpose: a CI runner is slower than a laptop, and a timeout there reads
    // as a flaky test rather than a slow machine.
    testTimeout: 180_000,
    hookTimeout: 120_000,
    pool: "forks",
  },
});
