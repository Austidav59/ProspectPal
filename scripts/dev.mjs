import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Starts the Maps scraper (if Docker is available), then the usual api + web
 * `npm run dev` workflow.
 */
const root = resolve(import.meta.dirname, "..");
const composeFile = resolve(root, "docker-compose.yml");

async function ensureMapsScraper() {
  if (!existsSync(composeFile)) return;

  await new Promise((resolvePromise) => {
    let settled = false;
    const finish = (message) => {
      if (settled) return;
      settled = true;
      if (message) console.warn(message);
      resolvePromise();
    };

    const child = spawn("docker", ["compose", "up", "-d", "maps-scraper"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", () => {
      finish(
        "[dev] Docker not available — skipping maps-scraper. Use BUSINESS_DISCOVERY_PROVIDER=mock or install Docker.",
      );
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log("[dev] maps-scraper ready on http://localhost:8080");
        finish();
        return;
      }
      const hint = stderr.trim().split("\n").at(-1) ?? "docker compose failed";
      finish(
        `[dev] Could not start maps-scraper (${hint}). API/web will still start; use mock provider or run: npm run maps:up`,
      );
    });
  });
}

await ensureMapsScraper();

const child = spawn(
  "npx",
  [
    "concurrently",
    "-n",
    "api,web",
    "-c",
    "blue,green",
    "npm run dev -w @seo-prospector/api",
    "npm run dev -w @seo-prospector/web",
  ],
  {
    cwd: root,
    stdio: "inherit",
    // Do not use shell:true — it splits quoted command args and breaks concurrently.
    env: process.env,
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
