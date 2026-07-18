import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export const sharedTypeScriptRules = {
  "no-console": "error",
  "@typescript-eslint/consistent-type-imports": [
    "error",
    { fixStyle: "inline-type-imports", prefer: "type-imports" },
  ],
  "@typescript-eslint/no-import-type-side-effects": "error",
};

export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "apps/web/next-env.d.ts",
      "graphify-out/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        sourceType: "module",
      },
    },
    rules: sharedTypeScriptRules,
  },
);
