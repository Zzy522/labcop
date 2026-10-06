import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "dist-community/**",
    ".selfhost/**",
    // Bundled third-party applications and generated Prisma output are not
    // maintained by this repository and should not be linted as application code.
    "public/ketcher/**",
    "public/rdkit/**",
    "src/generated/prisma/**",
  ]),
  {
    rules: {
      // Existing data-loading effects intentionally transition local loading state.
      // The React compiler rule is advisory and reports valid async fetch patterns.
      "react-hooks/set-state-in-effect": "off",
      // RDKit and Ketcher ship JavaScript-only browser APIs. Keep their boundary
      // types visible as warnings without blocking production verification.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["scripts/**/*.js", "scripts/**/*.cjs"],
    rules: {
      // Maintenance scripts execute directly in Node and intentionally use
      // CommonJS for compatibility with package lifecycle hooks.
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
