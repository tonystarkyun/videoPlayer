import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildWebVtt, parseSegmentsFromMarkdown } from "./parseSegments.js";

const projectDir = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(projectDir, "./project.config.json");

function logSkip(message) {
  console.log(message);
}

if (!existsSync(configPath)) {
  logSkip("Skip default VTT export: project.config.json not found.");
  process.exit(0);
}

let config;

try {
  const configText = readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
  config = JSON.parse(configText);
} catch (error) {
  console.error(`Failed to parse ${configPath}: ${error.message}`);
  process.exit(1);
}

if (typeof config.markdownPath !== "string" || config.markdownPath.trim() === "") {
  logSkip("Skip default VTT export: markdownPath is not configured.");
  process.exit(0);
}

const markdownPath = resolve(projectDir, config.markdownPath);

if (!existsSync(markdownPath)) {
  logSkip(`Skip default VTT export: Markdown not found at ${markdownPath}.`);
  process.exit(0);
}

const vttPath = resolve(
  projectDir,
  config.vttPath || config.markdownPath.replace(/\.[^.]+$/, ".vtt"),
);
const markdown = readFileSync(markdownPath, "utf8");
const segments = parseSegmentsFromMarkdown(markdown);
const vtt = buildWebVtt(segments);

writeFileSync(vttPath, vtt, "utf8");

console.log(
  JSON.stringify(
    {
      markdownPath,
      vttPath,
      segmentCount: segments.length,
    },
    null,
    2,
  ),
);
