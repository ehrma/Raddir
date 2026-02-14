#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const component = args[0];
const optionArgs = args.slice(1);

if (!component || !["client", "server"].includes(component)) {
  console.error("Usage: node scripts/dispatch-release.mjs <client|server> [--publish] [--draft] [--latest] [--version <x.y.z>] [--ref <branch>]");
  process.exit(1);
}

const options = {
  publish: false,
  draft: false,
  latest: false,
  ref: "main",
  version: "",
};

for (let i = 0; i < optionArgs.length; i++) {
  const arg = optionArgs[i];
  if (arg === "--publish") {
    options.publish = true;
  } else if (arg === "--draft") {
    options.draft = true;
  } else if (arg === "--latest") {
    options.latest = true;
  } else if (arg === "--ref") {
    options.ref = optionArgs[i + 1] ?? options.ref;
    i++;
  } else if (arg.startsWith("--ref=")) {
    options.ref = arg.slice("--ref=".length);
  } else if (arg === "--version") {
    options.version = optionArgs[i + 1] ?? options.version;
    i++;
  } else if (arg.startsWith("--version=")) {
    options.version = arg.slice("--version=".length);
  }
}

const workflow = component === "client" ? "electron-release.yml" : "docker-server.yml";
const packagePath = component === "client"
  ? resolve("packages/client/package.json")
  : resolve("packages/server/package.json");

const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const version = options.version || pkg.version;

const workflowArgs = [
  "workflow",
  "run",
  workflow,
  "--ref",
  options.ref,
  "-f",
  `publish=${options.publish}`,
  "-f",
  `version=${version}`,
];

if (component === "client") {
  workflowArgs.push("-f", `draft=${options.draft}`);
} else {
  workflowArgs.push("-f", `latest=${options.latest}`);
}

console.log(`[release] dispatching ${component} workflow ${workflow} (version=${version}, publish=${options.publish}, ref=${options.ref})`);

const dispatch = spawnSync("gh", workflowArgs, { stdio: "inherit", shell: process.platform === "win32" });
if (dispatch.status !== 0) {
  process.exit(dispatch.status ?? 1);
}

const list = spawnSync(
  "gh",
  ["run", "list", "--workflow", workflow, "--limit", "1"],
  { stdio: "inherit", shell: process.platform === "win32" }
);

process.exit(list.status ?? 0);
