import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildWebVtt, parseSegmentsFromMarkdown } from "./parseSegments.js";

const projectDir = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(projectDir, "./project.config.json");
const configText = readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
const config = JSON.parse(configText);
const markdownPath = resolve(projectDir, config.markdownPath);
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
