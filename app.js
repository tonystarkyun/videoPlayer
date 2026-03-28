import {
  buildWebVtt,
  findActiveSegmentIndex,
  formatSeconds,
  parseSegmentsFromMarkdown,
} from "./parseSegments.js";

const VIDEO_EXTENSIONS = new Set([
  ".avi",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp4",
  ".ogv",
  ".webm",
]);
const DEFAULT_TITLE = "字幕时间轴播放器";

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
const mediaList = document.querySelector("#mediaList");
const mediaItemTemplate = document.querySelector("#mediaItemTemplate");
const mediaEmptyState = document.querySelector("#mediaEmptyState");
const librarySummary = document.querySelector("#librarySummary");
const modalLibrarySummary = document.querySelector("#modalLibrarySummary");
const folderInput = document.querySelector("#folderInput");
const reloadDefaultButton = document.querySelector("#reloadDefaultButton");
const followPlaybackInput = document.querySelector("#followPlaybackInput");
const subtitleVisibleInput = document.querySelector("#subtitleVisibleInput");
const previousSegmentButton = document.querySelector("#previousSegmentButton");
const nextSegmentButton = document.querySelector("#nextSegmentButton");
const downloadVttLink = document.querySelector("#downloadVttLink");
const openLibraryButton = document.querySelector("#openLibraryButton");
const closeLibraryButton = document.querySelector("#closeLibraryButton");
const libraryModal = document.querySelector("#libraryModal");

const state = {
  activeIndex: -1,
  currentMediaKey: null,
  defaultTitle: DEFAULT_TITLE,
  isLibraryModalOpen: false,
  mediaElements: new Map(),
  mediaLibrary: [],
  pendingSeek: null,
  scrollAnimationFrame: 0,
  segmentElements: new Map(),
  segments: [],
  subtitleTrackElement: null,
  subtitleTrackUrl: null,
  videoObjectUrl: null,
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

function buildVttFileName(displayName) {
  const stem = displayName.replace(/\.[^.]+$/, "");
  return `${stem || "segments"}.vtt`;
}

function toAbsoluteUrl(relativePath) {
  return new URL(relativePath, window.location.href).toString();
}

function hasConfiguredPath(value) {
  return typeof value === "string" && value.trim() !== "";
}

async function checkUrlExists(url) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      method: "HEAD",
    });

    return response.ok;
  } catch {
    return false;
  }
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

function cleanupVideoObjectUrl() {
  if (!state.videoObjectUrl) {
    return;
  }

  URL.revokeObjectURL(state.videoObjectUrl);
  state.videoObjectUrl = null;
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

function resetLoadedProject() {
  cancelAnimationFrame(state.scrollAnimationFrame);
  cleanupVideoObjectUrl();
  cleanupSubtitleTrack();
  clearPendingSeek();

  videoPlayer.pause();
  videoPlayer.removeAttribute("src");
  videoPlayer.load();

  state.activeIndex = -1;
  state.currentMediaKey = null;
  state.mediaLibrary = [];
  state.segments = [];
  state.segmentElements.clear();
  state.mediaElements.clear();

  mediaList.innerHTML = "";
  segmentList.innerHTML = "";
  segmentList.scrollTop = 0;
  searchInput.value = "";
  searchSummary.textContent = "显示全部片段";
  videoSourceLabel.textContent = "未加载";
  markdownSourceLabel.textContent = "未加载";
  currentTimeLabel.textContent = "00:00:00";
  updateSegmentCountLabel(0);
  renderMediaLibrary();
}

function enterIdleState(message) {
  state.defaultTitle = DEFAULT_TITLE;
  resetLoadedProject();
  setLibrarySummary("当前未加载默认项目");
  setTitle(state.defaultTitle);
  setStatus(message);
}

function syncSubtitleVisibility() {
  for (const textTrack of videoPlayer.textTracks) {
    textTrack.mode = "disabled";
  }

  if (!subtitleVisibleInput.checked) {
    return;
  }

  if (state.subtitleTrackElement?.track) {
    state.subtitleTrackElement.track.mode = "showing";
  }
}

function clearActiveSegment() {
  const activeItem = state.segmentElements.get(state.activeIndex);
  if (!activeItem) {
    return;
  }

  activeItem.classList.remove("is-active");
  activeItem.querySelector(".segment-button")?.removeAttribute("aria-current");
}

function scrollSegmentIntoComfortZone(item, force = false) {
  if (!item || item.classList.contains("is-hidden")) {
    return;
  }

  const margin = Math.min(120, segmentList.clientHeight * 0.22);
  const itemTop = item.offsetTop;
  const itemBottom = itemTop + item.offsetHeight;
  const visibleTop = segmentList.scrollTop;
  const visibleBottom = visibleTop + segmentList.clientHeight;
  const shouldScroll =
    force ||
    itemTop < visibleTop + margin ||
    itemBottom > visibleBottom - margin;

  if (!shouldScroll) {
    return;
  }

  const targetTop = Math.max(0, itemTop - segmentList.clientHeight * 0.35);
  cancelAnimationFrame(state.scrollAnimationFrame);
  state.scrollAnimationFrame = requestAnimationFrame(() => {
    segmentList.scrollTo({
      behavior: "smooth",
      top: targetTop,
    });
  });
}

function updateActiveSegment(index, { followPlayback = false, forceScroll = false } = {}) {
  if (index === state.activeIndex) {
    if (forceScroll) {
      scrollSegmentIntoComfortZone(state.segmentElements.get(index), true);
    }
    return;
  }

  clearActiveSegment();
  state.activeIndex = index;

  if (index < 0) {
    return;
  }

  const item = state.segmentElements.get(index);
  if (!item) {
    return;
  }

  item.classList.add("is-active");
  item.querySelector(".segment-button")?.setAttribute("aria-current", "true");

  if (forceScroll || (followPlayback && followPlaybackInput.checked)) {
    scrollSegmentIntoComfortZone(item, forceScroll);
  }
}

function beginPendingSeek(index, targetTime) {
  state.pendingSeek = {
    expiresAt: performance.now() + 2500,
    index,
    targetTime,
  };
}

function clearPendingSeek() {
  state.pendingSeek = null;
}

function seekToSegment(index, { autoplay = true, forceScroll = true } = {}) {
  const segment = state.segments[index];
  if (!segment) {
    return;
  }

  beginPendingSeek(index, segment.start);
  updateActiveSegment(index, { forceScroll });

  if (typeof videoPlayer.fastSeek === "function") {
    videoPlayer.fastSeek(segment.start);
  } else {
    videoPlayer.currentTime = segment.start;
  }

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

function updateMediaSelection(key) {
  const previous = state.mediaElements.get(state.currentMediaKey);
  if (previous) {
    previous.classList.remove("is-active");
    previous.querySelector(".media-button")?.removeAttribute("aria-current");
  }

  state.currentMediaKey = key;

  const current = state.mediaElements.get(key);
  if (!current) {
    return;
  }

  current.classList.add("is-active");
  current.querySelector(".media-button")?.setAttribute("aria-current", "true");
}

function setLibrarySummary(text) {
  librarySummary.textContent = text;
  if (modalLibrarySummary) {
    modalLibrarySummary.textContent = text;
  }
}

function focusLibraryModalTarget() {
  const target =
    mediaList.querySelector("[aria-current='true']") ||
    mediaList.querySelector(".media-button") ||
    closeLibraryButton;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  target.focus({ preventScroll: true });
  if (target !== closeLibraryButton) {
    target.scrollIntoView({
      block: "nearest",
    });
  }
}

function openLibraryModal() {
  if (state.isLibraryModalOpen || !libraryModal) {
    return;
  }

  state.isLibraryModalOpen = true;
  libraryModal.hidden = false;
  document.body.classList.add("has-modal");
  openLibraryButton?.setAttribute("aria-expanded", "true");
  requestAnimationFrame(focusLibraryModalTarget);
}

function closeLibraryModal({ restoreFocus = true } = {}) {
  if (!state.isLibraryModalOpen || !libraryModal) {
    return;
  }

  state.isLibraryModalOpen = false;
  libraryModal.hidden = true;
  document.body.classList.remove("has-modal");
  openLibraryButton?.setAttribute("aria-expanded", "false");

  if (restoreFocus) {
    openLibraryButton?.focus();
  }
}

function renderMediaLibrary() {
  mediaList.innerHTML = "";
  state.mediaElements.clear();

  if (state.mediaLibrary.length === 0) {
    mediaEmptyState.hidden = false;
    if (state.isLibraryModalOpen) {
      requestAnimationFrame(focusLibraryModalTarget);
    }
    return;
  }

  mediaEmptyState.hidden = true;
  const fragment = document.createDocumentFragment();

  for (const entry of state.mediaLibrary) {
    const item = mediaItemTemplate.content.firstElementChild.cloneNode(true);
    const button = item.querySelector(".media-button");

    item.dataset.key = entry.key;
    button.dataset.key = entry.key;
    button.querySelector(".media-title").textContent = entry.title;
    button.querySelector(".media-meta").textContent = entry.meta;

    if (entry.key === state.currentMediaKey) {
      item.classList.add("is-active");
      button.setAttribute("aria-current", "true");
    }

    state.mediaElements.set(entry.key, item);
    fragment.appendChild(item);
  }

  mediaList.appendChild(fragment);

  if (state.isLibraryModalOpen) {
    requestAnimationFrame(focusLibraryModalTarget);
  }
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
  track.default = false;
  track.addEventListener("load", syncSubtitleVisibility);

  videoPlayer.append(track);
  state.subtitleTrackElement = track;
  subtitleTrackLabel.textContent = vttFileName;
  downloadVttLink.href = state.subtitleTrackUrl;
  downloadVttLink.download = vttFileName;
  setDownloadLinkEnabled(true);
  syncSubtitleVisibility();
}

function renderSegments() {
  segmentList.innerHTML = "";
  state.activeIndex = -1;
  state.segmentElements.clear();

  const fragment = document.createDocumentFragment();

  for (const segment of state.segments) {
    const item = segmentItemTemplate.content.firstElementChild.cloneNode(true);
    const button = item.querySelector(".segment-button");

    item.dataset.index = String(segment.id);
    button.dataset.index = String(segment.id);
    button.querySelector(".segment-time").textContent = segment.label;
    button.querySelector(".segment-text").textContent = segment.text || "（空白字幕）";
    button.title = "点击跳转到此字幕并播放";

    state.segmentElements.set(segment.id, item);
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
      segment.label.toLowerCase().includes(keyword);

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
  if (state.pendingSeek) {
    const { expiresAt, index, targetTime } = state.pendingSeek;
    const reachedTarget = Math.abs(videoPlayer.currentTime - targetTime) <= 0.35;

    if (!reachedTarget && performance.now() < expiresAt) {
      updateActiveSegment(index, { forceScroll: true });
      return;
    }

    clearPendingSeek();
    updateActiveSegment(index, { forceScroll: true });
    return;
  }

  const index = findActiveSegmentIndex(state.segments, videoPlayer.currentTime);
  updateActiveSegment(index, { followPlayback: true });
}

function parseAndRenderMarkdown(markdown, sourceLabel, subtitleDisplayName) {
  searchInput.value = "";
  state.segments = parseSegmentsFromMarkdown(markdown);
  markdownSourceLabel.textContent = sourceLabel;
  renderSegments();
  attachGeneratedSubtitleTrack(subtitleDisplayName);
  syncActiveSegment();
}

async function loadMarkdownTextFromUrl(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`读取 Markdown 失败: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function setVideoSource(url, displayName, { isObjectUrl = false } = {}) {
  cleanupVideoObjectUrl();
  clearPendingSeek();

  if (isObjectUrl) {
    state.videoObjectUrl = url;
  }

  videoPlayer.pause();
  videoPlayer.src = url;
  videoPlayer.load();
  videoSourceLabel.textContent = displayName;
  currentTimeLabel.textContent = "00:00:00";
  syncSubtitleVisibility();
}

function isVideoFile(file, extension) {
  return file.type.startsWith("video/") || VIDEO_EXTENSIONS.has(extension);
}

function getFileDescriptor(file) {
  const normalized = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const fileName = parts.at(-1) || file.name;
  const extensionMatch = /\.[^.]+$/.exec(fileName);
  const extension = extensionMatch ? extensionMatch[0].toLowerCase() : "";
  const stem = extensionMatch ? fileName.slice(0, -extension.length) : fileName;
  const rootFolder = parts.length > 1 ? parts[0] : "";
  const relativeDir = parts.length > 2 ? parts.slice(1, -1).join("/") : "";

  return {
    extension,
    fileName,
    relativeDir,
    rootFolder,
    stem,
  };
}

function buildMediaLibraryFromFolder(files) {
  const entries = new Map();
  let folderName = "";
  let unmatchedMarkdownCount = 0;
  let unmatchedVideoCount = 0;

  for (const file of files) {
    const descriptor = getFileDescriptor(file);
    if (!folderName && descriptor.rootFolder) {
      folderName = descriptor.rootFolder;
    }

    const key = `${descriptor.relativeDir}::${descriptor.stem.toLowerCase()}`;
    const entry = entries.get(key) || {
      key,
      markdownFile: null,
      relativeDir: descriptor.relativeDir,
      title: descriptor.stem,
      videoFile: null,
    };

    if (descriptor.extension === ".md") {
      entry.markdownFile = file;
    } else if (isVideoFile(file, descriptor.extension)) {
      entry.videoFile = file;
    }

    entries.set(key, entry);
  }

  const items = [];

  for (const entry of entries.values()) {
    if (entry.videoFile && entry.markdownFile) {
      items.push({
        ...entry,
        meta: entry.relativeDir
          ? `${entry.relativeDir} · ${entry.videoFile.name}`
          : `${entry.videoFile.name}`,
        sourceType: "local",
      });
      continue;
    }

    if (entry.videoFile) {
      unmatchedVideoCount += 1;
    } else if (entry.markdownFile) {
      unmatchedMarkdownCount += 1;
    }
  }

  items.sort((left, right) => {
    const dirCompare = left.relativeDir.localeCompare(right.relativeDir, "zh-CN");
    if (dirCompare !== 0) {
      return dirCompare;
    }

    return left.title.localeCompare(right.title, "zh-CN");
  });

  return {
    folderName: folderName || "所选文件夹",
    items,
    unmatchedMarkdownCount,
    unmatchedVideoCount,
  };
}

async function loadMediaEntry(entry) {
  updateMediaSelection(entry.key);
  setTitle(entry.title);

  if (entry.sourceType === "local") {
    const objectUrl = URL.createObjectURL(entry.videoFile);
    setVideoSource(objectUrl, entry.videoFile.name, { isObjectUrl: true });

    if (!entry.markdownText) {
      entry.markdownText = await entry.markdownFile.text();
    }

    parseAndRenderMarkdown(entry.markdownText, entry.markdownFile.name, entry.title);
    return;
  }

  setVideoSource(entry.videoUrl, basename(entry.videoUrl));
  const markdown = await loadMarkdownTextFromUrl(entry.markdownUrl);
  parseAndRenderMarkdown(markdown, basename(entry.markdownUrl), entry.title);
}

async function loadDefaultProject() {
  try {
    setStatus("正在读取默认配置…");

    const response = await fetch(toAbsoluteUrl("./project.config.json"), {
      cache: "no-store",
    });

    if (!response.ok) {
      enterIdleState("没有可用的默认项目，请选择一个包含同名视频和 .md 的文件夹。");
      return;
    }

    const config = await response.json();
    if (!hasConfiguredPath(config.videoPath) || !hasConfiguredPath(config.markdownPath)) {
      enterIdleState("默认项目未配置完整，请选择一个包含同名视频和 .md 的文件夹。");
      return;
    }

    const entry = {
      key: "__default__",
      markdownUrl: toAbsoluteUrl(config.markdownPath),
      meta: "默认项目",
      sourceType: "remote",
      title: config.title || basename(config.videoPath),
      videoUrl: toAbsoluteUrl(config.videoPath),
    };

    const [videoExists, markdownExists] = await Promise.all([
      checkUrlExists(entry.videoUrl),
      checkUrlExists(entry.markdownUrl),
    ]);

    if (!videoExists || !markdownExists) {
      enterIdleState("默认项目文件不存在，请选择一个包含同名视频和 .md 的文件夹。");
      return;
    }

    state.defaultTitle = entry.title;
    state.mediaLibrary = [entry];
    setLibrarySummary("默认项目 · 1 个可播放项");
    renderMediaLibrary();
    await loadMediaEntry(entry);
    setStatus("已加载默认项目。你可以改为选择一个本地文件夹继续使用。");
  } catch (error) {
    console.error(error);
    setStatus(error.message, true);
  }
}

async function loadFolderLibrary(fileList) {
  const scanResult = buildMediaLibraryFromFolder(Array.from(fileList));
  state.mediaLibrary = scanResult.items;
  state.currentMediaKey = null;

  if (scanResult.items.length === 0) {
    setLibrarySummary(`${scanResult.folderName} · 未找到可播放项目`);
    renderMediaLibrary();
    setStatus(
      `在 ${scanResult.folderName} 中没有找到同名的 .mp4 和 .md 配对。`,
      true,
    );
    return;
  }

  setLibrarySummary(`${scanResult.folderName} · ${scanResult.items.length} 个项目`);
  renderMediaLibrary();
  await loadMediaEntry(scanResult.items[0]);

  const notes = [];
  if (scanResult.unmatchedVideoCount > 0) {
    notes.push(`忽略 ${scanResult.unmatchedVideoCount} 个没有字幕 Markdown 的视频`);
  }
  if (scanResult.unmatchedMarkdownCount > 0) {
    notes.push(`忽略 ${scanResult.unmatchedMarkdownCount} 个没有对应视频的 Markdown`);
  }

  const suffix = notes.length > 0 ? `，${notes.join("，")}` : "";
  setStatus(`已从 ${scanResult.folderName} 加载 ${scanResult.items.length} 个项目${suffix}。`);
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("input, textarea, [contenteditable='true']"));
}

function bindTimelineEvents() {
  segmentList.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest(".segment-button");
    const item = target?.closest(".segment-item");
    const rawIndex = button?.dataset.index ?? item?.dataset.index;

    if (rawIndex === undefined) {
      return;
    }

    const index = Number(rawIndex);
    if (Number.isNaN(index)) {
      return;
    }

    seekToSegment(index);
  });

  mediaList.addEventListener("click", async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest(".media-button");
    const rawKey = button?.dataset.key;

    if (!rawKey) {
      return;
    }

    const entry = state.mediaLibrary.find((item) => item.key === rawKey);
    if (!entry) {
      return;
    }

    try {
      await loadMediaEntry(entry);
      setStatus(`已加载 ${entry.title}。`);
    } catch (error) {
      console.error(error);
      setStatus(error.message, true);
    }
  });

  previousSegmentButton.addEventListener("click", () => {
    seekAdjacentSegment(-1);
  });

  nextSegmentButton.addEventListener("click", () => {
    seekAdjacentSegment(1);
  });

  subtitleVisibleInput.addEventListener("change", syncSubtitleVisibility);
  searchInput.addEventListener("input", applySearchFilter);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.isLibraryModalOpen) {
      event.preventDefault();
      closeLibraryModal();
      return;
    }

    if (event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) {
      return;
    }

    if (state.isLibraryModalOpen) {
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
    syncSubtitleVisibility();
  });
}

function bindLibraryModalEvents() {
  openLibraryButton?.addEventListener("click", () => {
    openLibraryModal();
  });

  closeLibraryButton?.addEventListener("click", () => {
    closeLibraryModal();
  });

  libraryModal?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("[data-close-modal]")) {
      return;
    }

    closeLibraryModal();
  });
}

function bindPickerEvents() {
  folderInput.addEventListener("change", async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }

    try {
      await loadFolderLibrary(files);
    } catch (error) {
      console.error(error);
      setStatus(error.message, true);
    }
  });

  reloadDefaultButton.addEventListener("click", async () => {
    folderInput.value = "";
    await loadDefaultProject();
  });
}

function initialize() {
  subtitleVisibleInput.checked = false;
  bindTimelineEvents();
  bindLibraryModalEvents();
  bindPickerEvents();
  currentTimeLabel.textContent = "00:00:00";
  updateSegmentCountLabel(0);
  setDownloadLinkEnabled(false);
  loadDefaultProject();
}

window.addEventListener("beforeunload", () => {
  cleanupSubtitleTrack();
  cleanupVideoObjectUrl();
});

initialize();
