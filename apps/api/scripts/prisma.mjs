import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

/**
 * Runs the Prisma CLI. Loads the monorepo root `.env` when present (local),
 * and uses process.env only on hosts like Render where secrets are injected.
 */
const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, "../../../.env");
const require = createRequire(import.meta.url);
const prismaCli = require.resolve("prisma/build/index.js");
const args = process.argv.slice(2);

const nodeArgs = existsSync(rootEnv)
  ? [`--env-file=${rootEnv}`, prismaCli, ...args]
  : [prismaCli, ...args];

const result = spawnSync(process.execPath, nodeArgs, {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
