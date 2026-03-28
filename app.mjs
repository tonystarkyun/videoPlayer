import {
  buildWebVtt,
  findActiveSegmentIndex,
  formatSeconds,
  parseSegmentsFromMarkdown,
} from "./parseSegments.mjs";

const projectTitle = document.querySelector("#projectTitle");
const videoPlayer = document.querySelector("#videoPlayer");
const statusMessage = document.querySelector("#statusMessage");
const videoSourceLabel = document.querySelector("#videoSourceLabel");
const markdownSourceLabel = document.querySelector("#markdownSourceLabel");
const segmentCountLabel = document.querySelector("#segmentCountLabel");
const currentTimeLabel = document.querySelector("#currentTimeLabel");
const subtitleTrackLabel = document.querySelector("#subtitleTrackLabel");
const searchInput = document.querySelector("#searchInput");
const searchSummary = document.querySelector("#searchSummary");
const segmentList = document.querySelector("#segmentList");
const segmentItemTemplate = document.querySelector("#segmentItemTemplate");
const videoFileInput = document.querySelector("#videoFileInput");
const markdownFileInput = document.querySelector("#markdownFileInput");
const reloadDefaultButton = document.querySelector("#reloadDefaultButton");
const followPlaybackInput = document.querySelector("#followPlaybackInput");
const previousSegmentButton = document.querySelector("#previousSegmentButton");
const nextSegmentButton = document.querySelector("#nextSegmentButton");
const downloadVttLink = document.querySelector("#downloadVttLink");

const state = {
  segments: [],
  activeIndex: -1,
  defaultTitle: "字幕时间轴播放器",
  videoObjectUrl: null,
  subtitleTrackUrl: null,
  subtitleTrackElement: null,
  scrollAnimationFrame: 0,
};

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("is-error", isError);
}

function setTitle(value) {
  projectTitle.textContent = value || state.defaultTitle;
  document.title = value ? `${value} | 字幕时间轴播放器` : "字幕时间轴播放器";
}

function basename(value) {
  return value.split(/[\\/]/).filter(Boolean).at(-1) || value;
}

function toAbsoluteUrl(relativePath) {
  return new URL(relativePath, window.location.href).toString();
}

function updateSegmentCountLabel(visibleCount = state.segments.length) {
  segmentCountLabel.textContent = `${visibleCount} / ${state.segments.length}`;
}

function setDownloadLinkEnabled(enabled) {
  downloadVttLink.classList.toggle("is-disabled", !enabled);
  downloadVttLink.setAttribute("aria-disabled", String(!enabled));

  if (!enabled) {
    downloadVttLink.removeAttribute("href");
    downloadVttLink.removeAttribute("download");
  }
}

function clearActiveSegment() {
  const activeItem = segmentList.querySelector(".segment-item.is-active");
  if (activeItem) {
    activeItem.classList.remove("is-active");
    activeItem.querySelector(".segment-button")?.removeAttribute("aria-current");
  }
}

function scrollSegmentIntoComfortZone(item, force = false) {
  if (!item || item.classList.contains("is-hidden")) {
    return;
  }

  const container = segmentList;
  const margin = Math.min(120, container.clientHeight * 0.22);
  const itemTop = item.offsetTop;
  const itemBottom = itemTop + item.offsetHeight;
  const visibleTop = container.scrollTop;
  const visibleBottom = visibleTop + container.clientHeight;
  const shouldScroll =
    force ||
    itemTop < visibleTop + margin ||
    itemBottom > visibleBottom - margin;

  if (!shouldScroll) {
    return;
  }

  const targetTop = Math.max(0, itemTop - container.clientHeight * 0.35);
  cancelAnimationFrame(state.scrollAnimationFrame);
  state.scrollAnimationFrame = requestAnimationFrame(() => {
    container.scrollTo({
      top: targetTop,
      behavior: "smooth",
    });
  });
}

function updateActiveSegment(index, { followPlayback = false, forceScroll = false } = {}) {
  if (index === state.activeIndex) {
    return;
  }

  clearActiveSegment();
  state.activeIndex = index;

  if (index < 0) {
    return;
  }

  const item = segmentList.querySelector(`[data-index="${index}"]`);
  if (!item) {
    return;
  }

  item.classList.add("is-active");
  item.querySelector(".segment-button")?.setAttribute("aria-current", "true");

  if (forceScroll || (followPlayback && followPlaybackInput.checked)) {
    scrollSegmentIntoComfortZone(item, forceScroll);
  }
}

function seekToSegment(index, { autoplay = true, forceScroll = true } = {}) {
  const segment = state.segments[index];
  if (!segment) {
    return;
  }

  videoPlayer.currentTime = segment.start;
  updateActiveSegment(index, { forceScroll });

  if (autoplay) {
    videoPlayer.play().catch(() => {});
  }
}

function getBaseSegmentIndex(offset) {
  if (state.activeIndex >= 0) {
    return state.activeIndex;
  }

  const currentIndex = findActiveSegmentIndex(state.segments, videoPlayer.currentTime);
  if (currentIndex >= 0) {
    return currentIndex;
  }

  return offset > 0 ? -1 : state.segments.length;
}

function seekAdjacentSegment(offset) {
  if (state.segments.length === 0) {
    return;
  }

  const baseIndex = getBaseSegmentIndex(offset);
  const nextIndex = Math.min(
    state.segments.length - 1,
    Math.max(0, baseIndex + offset),
  );

  seekToSegment(nextIndex);
}

function cleanupSubtitleTrack() {
  if (state.subtitleTrackElement) {
    state.subtitleTrackElement.remove();
    state.subtitleTrackElement = null;
  }

  if (state.subtitleTrackUrl) {
    URL.revokeObjectURL(state.subtitleTrackUrl);
    state.subtitleTrackUrl = null;
  }

  subtitleTrackLabel.textContent = "未生成";
  setDownloadLinkEnabled(false);
}

function showSubtitleTrack() {
  for (const textTrack of videoPlayer.textTracks) {
    textTrack.mode = "disabled";
  }

  if (state.subtitleTrackElement?.track) {
    state.subtitleTrackElement.track.mode = "showing";
  }
}

function buildVttFileName(displayName) {
  const stem = displayName.replace(/\.[^.]+$/, "");
  return `${stem || "segments"}.vtt`;
}

function attachGeneratedSubtitleTrack(displayName) {
  cleanupSubtitleTrack();

  const vttText = buildWebVtt(state.segments);
  const vttFileName = buildVttFileName(displayName);
  const blob = new Blob([vttText], {
    type: "text/vtt;charset=utf-8",
  });

  state.subtitleTrackUrl = URL.createObjectURL(blob);

  const track = document.createElement("track");
  track.kind = "subtitles";
  track.label = "自动生成字幕";
  track.srclang = "zh-CN";
  track.src = state.subtitleTrackUrl;
  track.default = true;
  track.addEventListener("load", showSubtitleTrack);

  videoPlayer.append(track);
  state.subtitleTrackElement = track;
  subtitleTrackLabel.textContent = vttFileName;
  downloadVttLink.href = state.subtitleTrackUrl;
  downloadVttLink.download = vttFileName;
  setDownloadLinkEnabled(true);
  showSubtitleTrack();
}

function renderSegments() {
  segmentList.innerHTML = "";
  state.activeIndex = -1;

  const fragment = document.createDocumentFragment();

  for (const segment of state.segments) {
    const item = segmentItemTemplate.content.firstElementChild.cloneNode(true);
    const button = item.querySelector(".segment-button");

    item.dataset.index = String(segment.id);
    button.dataset.index = String(segment.id);
    button.querySelector(".segment-time").textContent = segment.label;
    button.querySelector(".segment-text").textContent = segment.text || "（空白字幕）";
    button.title = "点击跳转到此字幕并开始播放";

    fragment.appendChild(item);
  }

  segmentList.appendChild(fragment);
  updateSegmentCountLabel();
  applySearchFilter();
}

function applySearchFilter() {
  const keyword = searchInput.value.trim().toLowerCase();
  let visibleCount = 0;

  for (const item of segmentList.children) {
    const index = Number(item.dataset.index);
    const segment = state.segments[index];
    const isVisible =
      !keyword ||
      segment.text.toLowerCase().includes(keyword) ||
      segment.label.includes(keyword);

    item.classList.toggle("is-hidden", !isVisible);
    if (isVisible) {
      visibleCount += 1;
    }
  }

  updateSegmentCountLabel(visibleCount);
  searchSummary.textContent =
    keyword === "" ? "显示全部片段" : `匹配到 ${visibleCount} 条字幕`;
}

function updateTimeDisplay() {
  currentTimeLabel.textContent = formatSeconds(videoPlayer.currentTime);
}

function syncActiveSegment() {
  const index = findActiveSegmentIndex(state.segments, videoPlayer.currentTime);
  updateActiveSegment(index, { followPlayback: true });
}

function parseAndRenderMarkdown(markdown, displayName) {
  state.segments = parseSegmentsFromMarkdown(markdown);
  markdownSourceLabel.textContent = displayName;
  renderSegments();
  attachGeneratedSubtitleTrack(displayName);
  syncActiveSegment();
  setStatus("字幕已加载，已自动生成 VTT 并叠加到视频上。");
}

async function loadMarkdownFromUrl(path) {
  const response = await fetch(toAbsoluteUrl(path), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`读取 Markdown 失败: ${response.status} ${response.statusText}`);
  }

  const markdown = await response.text();
  parseAndRenderMarkdown(markdown, basename(path));
}

async function loadDefaultProject() {
  try {
    setStatus("正在读取默认配置…");

    const response = await fetch(toAbsoluteUrl("./project.config.json"), {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`读取默认配置失败: ${response.status} ${response.statusText}`);
    }

    const config = await response.json();
    state.defaultTitle = config.title || state.defaultTitle;
    setTitle(config.title || state.defaultTitle);

    updateVideoSource(toAbsoluteUrl(config.videoPath), basename(config.videoPath));
    await loadMarkdownFromUrl(config.markdownPath);
  } catch (error) {
    console.error(error);
    setStatus(error.message, true);
  }
}

async function handleMarkdownFileSelection(file) {
  const markdown = await file.text();
  parseAndRenderMarkdown(markdown, file.name);
}

function updateVideoSource(url, displayName) {
  if (state.videoObjectUrl) {
    URL.revokeObjectURL(state.videoObjectUrl);
    state.videoObjectUrl = null;
  }

  videoPlayer.src = url;
  videoPlayer.load();
  videoSourceLabel.textContent = displayName;
  showSubtitleTrack();
}

function handleVideoFileSelection(file) {
  if (state.videoObjectUrl) {
    URL.revokeObjectURL(state.videoObjectUrl);
  }

  state.videoObjectUrl = URL.createObjectURL(file);
  updateVideoSource(state.videoObjectUrl, file.name);
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("input, textarea, [contenteditable='true']"));
}

function bindTimelineEvents() {
  segmentList.addEventListener("click", (event) => {
    const button = event.target.closest(".segment-button");
    if (!button) {
      return;
    }

    seekToSegment(Number(button.dataset.index));
  });

  previousSegmentButton.addEventListener("click", () => {
    seekAdjacentSegment(-1);
  });

  nextSegmentButton.addEventListener("click", () => {
    seekAdjacentSegment(1);
  });

  searchInput.addEventListener("input", applySearchFilter);

  window.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) {
      return;
    }

    if (event.key === "[") {
      event.preventDefault();
      seekAdjacentSegment(-1);
    }

    if (event.key === "]") {
      event.preventDefault();
      seekAdjacentSegment(1);
    }
  });

  videoPlayer.addEventListener("timeupdate", () => {
    updateTimeDisplay();
    syncActiveSegment();
  });

  videoPlayer.addEventListener("seeked", syncActiveSegment);
  videoPlayer.addEventListener("loadedmetadata", () => {
    updateTimeDisplay();
    syncActiveSegment();
    showSubtitleTrack();
  });
}

function bindPickerEvents() {
  videoFileInput.addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (!file) {
      return;
    }

    handleVideoFileSelection(file);
    setTitle(file.name.replace(/\.[^.]+$/, ""));
    setStatus("已切换到本地视频文件。");
  });

  markdownFileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) {
      return;
    }

    try {
      await handleMarkdownFileSelection(file);
      if (!videoFileInput.files.length) {
        setTitle(file.name.replace(/\.[^.]+$/, ""));
      }
    } catch (error) {
      console.error(error);
      setStatus(error.message, true);
    }
  });

  reloadDefaultButton.addEventListener("click", async () => {
    setTitle(state.defaultTitle);
    await loadDefaultProject();
  });
}

function initialize() {
  bindTimelineEvents();
  bindPickerEvents();
  currentTimeLabel.textContent = "00:00:00";
  updateSegmentCountLabel(0);
  setDownloadLinkEnabled(false);
  loadDefaultProject();
}

window.addEventListener("beforeunload", () => {
  cleanupSubtitleTrack();

  if (state.videoObjectUrl) {
    URL.revokeObjectURL(state.videoObjectUrl);
  }
});

initialize();
