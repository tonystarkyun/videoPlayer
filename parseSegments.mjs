const SEGMENT_LINE_PATTERN =
  /^\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)$/;

export function parseTimestamp(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(value.trim());

  if (!match) {
    throw new Error(`无法解析时间戳: ${value}`);
  }

  const [, hours, minutes, seconds, milliseconds] = match;
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(milliseconds) / 1000
  );
}

export function formatSeconds(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  return [hours, minutes, secs]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function extractSegmentsBlock(markdown) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const headerMatch = /^##\s+Segments\s*$/m.exec(normalized);

  if (!headerMatch || headerMatch.index === undefined) {
    throw new Error("Markdown 中没有找到 ## Segments 段落");
  }

  const headerEnd = normalized.indexOf("\n", headerMatch.index);
  const remainder = headerEnd === -1 ? "" : normalized.slice(headerEnd + 1);
  const nextHeaderMatch = /^##\s+/m.exec(remainder);

  return nextHeaderMatch ? remainder.slice(0, nextHeaderMatch.index) : remainder;
}

function cleanupSegmentText(value) {
  return value.replace(/^段落-\d+\s*/, "").trim();
}

function sanitizeCueText(value) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/-->/g, "→")
    .trim();
}

export function parseSegmentsFromMarkdown(markdown) {
  const block = extractSegmentsBlock(markdown);
  const segments = [];

  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const match = SEGMENT_LINE_PATTERN.exec(line);
    if (!match) {
      continue;
    }

    const [, startText, endText, contentText] = match;
    const start = parseTimestamp(startText);
    const end = parseTimestamp(endText);
    const text = cleanupSegmentText(contentText);

    segments.push({
      id: segments.length,
      start,
      end,
      startText,
      endText,
      text,
      label: `${formatSeconds(start)} - ${formatSeconds(end)}`,
    });
  }

  if (segments.length === 0) {
    throw new Error("Segments 段落存在，但没有解析到任何时间轴片段");
  }

  return segments;
}

export function buildWebVtt(segments) {
  const cues = segments.map((segment, index) => {
    const text = sanitizeCueText(segment.text) || " ";
    return `${index + 1}\n${segment.startText} --> ${segment.endText}\n${text}\n`;
  });

  return `WEBVTT\n\n${cues.join("\n")}`;
}

export function findActiveSegmentIndex(segments, currentTime) {
  let fallbackIndex = -1;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];

    if (currentTime >= segment.start) {
      fallbackIndex = index;
    }

    if (currentTime >= segment.start && currentTime < segment.end) {
      return index;
    }

    if (currentTime < segment.start) {
      break;
    }
  }

  return fallbackIndex;
}
