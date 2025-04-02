module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
    jest: true,
  },
  extends: ["eslint:recommended"],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  rules: {
    "no-console": ["warn", { allow: ["warn", "error"] }],
    "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "prefer-const": "error",
    "no-var": "error",
    "eol-last": ["error", "always"],
    "no-multiple-empty-lines": ["error", { max: 1, maxEOF: 1 }],
    quotes: ["error", "single", { avoidEscape: true }],
    semi: ["error", "always"],
  },
};
