#!/usr/bin/env node
const path = require("node:path");
const { spawn } = require("node:child_process");

const electronBinary = require("electron");
const cwd = path.resolve(__dirname, "..");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ["."], {
  cwd,
  env,
  stdio: "inherit"
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error("Failed to start electron:", error);
  process.exit(1);
});
