#!/usr/bin/env node
import { cp, mkdir, lstat, rename, rm, readFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let agent = "both",
  project = null,
  user = false,
  dry = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--agent") agent = args[++i];
  else if (args[i] === "--project") project = args[++i];
  else if (args[i] === "--user") user = true;
  else if (args[i] === "--dry-run") dry = true;
  else if (args[i] === "--help") {
    console.log(
      "node scripts/install.mjs --agent claude|codex|both (--project PATH | --user) [--dry-run]\nExisting installations are never overwritten.",
    );
    process.exit(0);
  } else throw new Error(`Unknown argument: ${args[i]}`);
}
if (!["claude", "codex", "both"].includes(agent) || Boolean(project) === user)
  throw new Error(
    "Choose --agent claude|codex|both and exactly one of --project PATH or --user",
  );
const base = user ? homedir() : resolve(project),
  agents = agent === "both" ? ["claude", "codex"] : [agent];
const dirs = agents.map((a) =>
  join(base, a === "claude" ? ".claude" : ".agents", "skills", "studai-stem"),
);
const source = join(root, "skills/studai-stem");
await readFile(join(source, "scripts/runtime/cli.mjs"));
for (const path of dirs)
  if (await lstat(path).catch(() => null))
    throw new Error(
      `Already exists: ${path}. Choose a fresh project or review the existing installation before updating.`,
    );
if (dry) {
  console.log(
    JSON.stringify({ status: "dry-run", source, destinations: dirs }, null, 2),
  );
  process.exit(0);
}
// Stage complete copies before making any skill discoverable. No host settings are changed.
const staged = [];
try {
  for (const dest of dirs) {
    await mkdir(dirname(dest), { recursive: true });
    const stage = `${dest}.install-${process.pid}`;
    if (await lstat(stage).catch(() => null))
      throw new Error("Staging path already exists");
    await cp(source, stage, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: (path) => !path.includes("__pycache__") && !path.endsWith(".pyc"),
    });
    staged.push({ stage, dest });
  }
  for (const { stage, dest } of staged) {
    if (await lstat(dest).catch(() => null))
      throw new Error(`Destination appeared during installation: ${dest}`);
    await rename(stage, dest);
  }
} finally {
  for (const { stage } of staged)
    await rm(stage, { recursive: true, force: true });
}
console.log(
  JSON.stringify(
    {
      status: "installed",
      destinations: dirs,
      next: "Start or refresh the coding-agent session. Claude: /studai-stem. Codex: $studai-stem.",
    },
    null,
    2,
  ),
);
