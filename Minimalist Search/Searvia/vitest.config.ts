import { defineConfig } from "vitest/config";

export default defineConfig({
  root: process.cwd(),
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx,js,mjs}", "test/**/*.test.{ts,tsx,js,mjs}"],
    passWithNoTests: false,
  },
});
