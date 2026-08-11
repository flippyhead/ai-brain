/// <reference types="vite/client" />

export const modules = import.meta.glob([
  "./**/*.ts",
  "./_generated/*.js",
  "!./**/*.test.ts",
  "!./test.setup.ts",
]);
