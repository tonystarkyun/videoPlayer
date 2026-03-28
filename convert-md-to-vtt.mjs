import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildWebVtt, parseSegmentsFromMarkdown } from "./parseSegments.js";

const [inputMarkdownArg, outputVttArg] = process.argv.slice(2);

if (!inputMarkdownArg) {
  console.error("Usage: node convert-md-to-vtt.mjs <inputMarkdownPath> [outputVttPath]");
  process.exit(1);
}

const markdownPath = resolve(process.cwd(), inputMarkdownArg);
const vttPath = resolve(
  process.cwd(),
  outputVttArg || inputMarkdownArg.replace(/\.[^.]+$/, ".vtt"),
);

const markdown = readFileSync(markdownPath, "utf8");
const segments = parseSegmentsFromMarkdown(markdown);
const vtt = buildWebVtt(segments);

writeFileSync(vttPath, vtt, "utf8");

console.log(
  JSON.stringify(
    {
      markdownPath,
      segmentCount: segments.length,
      vttPath,
    },
    null,
    2,
  ),
);
