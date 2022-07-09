#!/usr/bin/env node

//@ts-check

"use strict";

require("esbuild").build({
  entryPoints: ["./src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  platform: "node",
  target: "node16.0",
  sourcemap: true,
  external: ["vscode"],
  watch: process.argv.includes("--watch"),
  logLevel: "info",
  color: true,
  // loader: {
  //   ".wasm": "file",
  // },
});
