import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    files: ["plugin/src/**/*.ts", "tests/**/*.ts"],
    rules: {
      "no-eval": "error",
      "no-empty": ["error", { "allowEmptyCatch": false }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
    }
  },
  {
    ignores: ["plugin/dist/**", "build/**", "node_modules/**"]
  }
);
