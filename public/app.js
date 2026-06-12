const mediaPattern = /\.(jpe?g|jfif|png|webp|gif|bmp|tiff?|avif|heic|heif|mp4|mov|m4v|webm)$/i;
const RESULT_LIMIT_BY_MODULE = {
  "图片（AI）": 3,
  "图片（实拍）": 3,
  "图片助理": 2,
  "视频（卖点）": 2,
  "视频（质量）": 2,
  "简易视频": 3,
  "视频助理": 2,
  "AI视频": 1
};

let modules = [];
let activeModule = null;
let entries = [];
let results = [];
let tiebreakers = [];
let adminMode = false;
let systemInfo = null;
let votingOpen = false;
let resultsPublished = false;
let periods = [];
let currentPeriodId = "";
let currentPeriodName = "";
let previewEntry = null;
let viewerIndex = 0;
let viewerZoom = { scale: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0 };
let photographers = [];
let moduleVoters = {};
let votingStatus = null;
let loggedInName = localStorage.getItem("photoReviewVoter") || "";
let toastTimer = null;
let ballots = [];
let adminBallots = [];
const tiebreakerSelected = new Map();
let completedModules = new Set();
let isSubmittingVote = false;
let resultDialogDismissed = false;
const selected = new Map();

const THEME_KEY = "photoReviewTheme";
const UPLOAD_BATCH_SIZE = 12;
const OBJECT_UPLOAD_CONCURRENCY = 4;
const CLIENT_IMAGE_OPTIMIZE_MIN_BYTES = 1.5 * 1024 * 1024;
const CLIENT_IMAGE_MAX_DIMENSION = 2400;
const CLIENT_IMAGE_QUALITY = 0.86;
const CLIENT_OPTIMIZABLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
let uploadQueue = Promise.resolve();
let uploadQueueLength = 0;
let galleryDragDepth = 0;
let processingRefreshTimer = null;
let deferredRender = false;
let scrollBeforeViewer = 0;
const savedTheme = localStorage.getItem(THEME_KEY) || "light";
document.body.dataset.theme = savedTheme === "dark" ? "dark" : "light";

const themeToggles = document.querySelectorAll("[data-theme-toggle]");
const authScreen = document.querySelector("#authScreen");
const authName = document.querySelector("#authName");
const authLogin = document.querySelector("#authLogin");
const authStatus = document.querySelector("#authStatus");
const welcomePanel = document.querySelector("#welcomePanel");
const phaseBadge = document.querySelector("#phaseBadge");
const welcomeTitle = document.querySelector("#welcomeTitle");
const welcomeText = document.querySelector("#welcomeText");
const appToast = document.querySelector("#appToast");
const gallery = document.querySelector("#gallery");
const resultsBox = document.querySelector("#results");
const resultsPanel = document.querySelector(".results-panel");
const tiebreakerPanel = document.querySelector("#tiebreakerPanel");
const tiebreakerList = document.querySelector("#tiebreakerList");
const voterInput = document.querySelector("#voterName");
const voterLogin = document.querySelector("#voterLogin");
const voterLogout = document.querySelector("#voterLogout");
const voterLoginStatus = document.querySelector("#voterLoginStatus");
const identityBox = document.querySelector(".identity");
const uploadStatus = document.querySelector("#uploadStatus");
const selectedCount = document.querySelector("#selectedCount");
const activeModuleTitle = document.querySelector("#activeModuleTitle");
const submitVote = document.querySelector("#submitVote");
const voteToolbar = document.querySelector(".vote-toolbar");
const entryTemplate = document.querySelector("#entryTemplate");
const moduleGrid = document.querySelector("#moduleGrid");
const photographerResultCard = document.querySelector("#photographerResultCard");
const adminCode = document.querySelector("#adminCode");
const adminToggle = document.querySelector("#adminToggle");
const statusToggle = document.querySelector("#statusToggle");
const publishToggle = document.querySelector("#publishToggle");
const downloadArchive = document.querySelector("#downloadArchive");
const clearCurrentPeriod = document.querySelector("#clearCurrentPeriod");
const optimizeStatus = document.querySelector("#optimizeStatus");
const adminPanel = document.querySelector("#adminPanel");
const photographerName = document.querySelector("#photographerName");
const addPhotographer = document.querySelector("#addPhotographer");
const photographerAdmin = document.querySelector("#photographerAdmin");
const photographerList = document.querySelector("#photographerList");
const moduleVotersAdmin = document.querySelector("#moduleVotersAdmin");
const moduleVotersList = document.querySelector("#moduleVotersList");
const votingStatusAdmin = document.querySelector("#votingStatusAdmin");
const votingStatusSummary = document.querySelector("#votingStatusSummary");
const votingStatusList = document.querySelector("#votingStatusList");
const ballotAdmin = document.querySelector("#ballotAdmin");
const ballotList = document.querySelector("#ballotList");
const resultsPreviewAdmin = document.querySelector("#resultsPreviewAdmin");
const periodAdmin = document.querySelector("#periodAdmin");
const periodStatus = document.querySelector("#periodStatus");
const periodSelect = document.querySelector("#periodSelect");
const createNextPeriod = document.querySelector("#createNextPeriod");
const resultsTitle = document.querySelector("#resultsTitle");
const resultsNote = document.querySelector("#resultsNote");

const previewDialog = document.querySelector("#previewDialog");
const previewTitle = document.querySelector("#previewTitle");
const previewMeta = document.querySelector("#previewMeta");
const mediaPreviewGrid = document.querySelector("#mediaPreviewGrid");
const closePreview = document.querySelector("#closePreview");

const resultDialog = document.querySelector("#resultDialog");
const resultDialogGrid = document.querySelector("#resultDialogGrid");
const closeResultDialog = document.querySelector("#closeResultDialog");
const adminInfoDialog = document.querySelector("#adminInfoDialog");
const adminInfoTitle = document.querySelector("#adminInfoTitle");
const adminInfoBody = document.querySelector("#adminInfoBody");
const closeAdminInfoDialog = document.querySelector("#closeAdminInfoDialog");
const downloadDialogPoster = document.querySelector("#downloadDialogPoster");
const nextPeriodDialog = document.querySelector("#nextPeriodDialog");
const closeNextPeriodDialog = document.querySelector("#closeNextPeriodDialog");
const cancelNextPeriod = document.querySelector("#cancelNextPeriod");
const confirmNextPeriod = document.querySelector("#confirmNextPeriod");
const periodCalendar = document.querySelector("#periodCalendar");

const imageViewer = document.querySelector("#imageViewer");
const viewerTitle = document.querySelector("#viewerTitle");
const viewerMeta = document.querySelector("#viewerMeta");
const viewerStage = document.querySelector("#viewerStage");
const viewerPrev = document.querySelector("#viewerPrev");
const viewerNext = document.querySelector("#viewerNext");
const viewerClose = document.querySelector("#viewerClose");
const viewerZoomOut = document.querySelector("#viewerZoomOut");
const viewerZoomIn = document.querySelector("#viewerZoomIn");
const viewerFit = document.querySelector("#viewerFit");

function voterName() {
  return loggedInName.trim();
}

function setStatus(text) {
  uploadStatus.textContent = text;
}

function showToast(text, tone = "") {
  if (!appToast) return;
  window.clearTimeout(toastTimer);
  appToast.textContent = text;
  appToast.hidden = false;
  appToast.classList.toggle("success", tone === "success");
  appToast.classList.add("show");
  toastTimer = window.setTimeout(() => {
    appToast.classList.remove("show");
    appToast.classList.remove("success");
    appToast.hidden = true;
  }, tone === "success" ? 4200 : 2200);
}

function setAuthenticated(value) {
  document.body.classList.toggle("auth-locked", !value);
  document.body.classList.toggle("is-authenticated", value);
}

function setAuthStatus(text) {
  if (authStatus) authStatus.textContent = text;
}

function applyTheme(theme) {
  const finalTheme = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = finalTheme;
  localStorage.setItem(THEME_KEY, finalTheme);
  themeToggles.forEach(toggle => {
    toggle.setAttribute("aria-pressed", String(finalTheme === "dark"));
    toggle.setAttribute("aria-label", finalTheme === "dark" ? "切换浅色模式" : "切换深色模式");
    const text = toggle.querySelector(".theme-toggle-text");
    if (text) text.textContent = finalTheme === "dark" ? "浅色模式" : "深色模式";
  });
}

function syncAuthFields() {
  if (!authName) return;
  authName.value = loggedInName || "";
}

function moduleEntries(moduleName) {
  return entries.filter(entry => entry.moduleName === moduleName);
}

function activeLimit() {
  return activeModule?.voteLimit || 1;
}

function activeBucket() {
  if (!selected.has(activeModule.name)) selected.set(activeModule.name, new Set());
  return selected.get(activeModule.name);
}

function resetSelections() {
  selected.clear();
  for (const module of modules) selected.set(module.name, new Set());
}

function hasVotableEntries(moduleName) {
  return moduleEntries(moduleName).length > 0;
}

function myUploadedEntries(moduleName) {
  const voter = voterName();
  if (!voter) return [];
  return moduleEntries(moduleName).filter(entry => entry.isOwn || entry.photographer === voter);
}

function isModuleCompleted(moduleName) {
  return completedModules.has(moduleName);
}

function nextPendingModule(fromModuleName) {
  const startIndex = Math.max(0, modules.findIndex(module => module.name === fromModuleName));
  const orderedModules = modules.slice(startIndex + 1).concat(modules.slice(0, startIndex + 1));
  return orderedModules.find(module => hasVotableEntries(module.name) && !completedModules.has(module.name));
}

function updateSelectedCount() {
  const picked = activeBucket().size;
  selectedCount.textContent = isModuleCompleted(activeModule.name)
    ? `已提交 ${picked} / ${activeLimit()}，可重新选择后覆盖`
    : `已选作品 ${picked} / ${activeLimit()}`;
}

function entryTitle(entry) {
  const moduleIndex = entries
    .filter(item => item.moduleName === entry.moduleName)
    .sort((a, b) => a.sequence - b.sequence)
    .findIndex(item => item.id === entry.id);
  const displaySequence = String(moduleIndex + 1).padStart(2, "0");
  if (entry.sku) return `${displaySequence} · ${cleanSku(entry.sku)}`;
  return displaySequence;
}

function cleanSku(value) {
  const text = String(value || "").trim();
  const code = text.match(/[A-Za-z]+[A-Za-z0-9]*\d+[A-Za-z0-9]*/);
  if (code) return code[0];
  return text.split(/[（(\s]/)[0].trim();
}

function mediaText(entry) {
  if (entry.videoCount) return `${entry.videoCount} 个视频`;
  return `${entry.imageCount} 张图`;
}

function resultLimitForModule(moduleName) {
  return RESULT_LIMIT_BY_MODULE[moduleName] || 3;
}

function moduleResultList(moduleName) {
  return results
    .filter(entry => entry.moduleName === moduleName)
    .sort((a, b) => b.votes - a.votes || (b.tiebreakerVotes || 0) - (a.tiebreakerVotes || 0) || a.sequence - b.sequence);
}

function moduleVoteTotal(moduleName) {
  return moduleResultList(moduleName).reduce((total, entry) => total + entry.votes, 0);
}

function votePercent(entry, totalVotes) {
  if (!totalVotes) return "0%";
  const value = Math.round((entry.votes / totalVotes) * 1000) / 10;
  return `${value}%`;
}

function tiebreakerText(entry) {
  return entry.tiebreakerVotes ? ` · 加赛 ${entry.tiebreakerVotes} 票` : "";
}

function resultTieGroups(moduleName) {
  const groups = new Map();
  for (const entry of moduleResultList(moduleName)) {
    if (!entry.votes) continue;
    const key = String(entry.votes);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.values()].filter(group => group.length > 1);
}

function hasOpenTiebreakerFor(entryIds) {
  const wanted = [...entryIds].sort().join("|");
  return tiebreakers.some(item => item.status === "open" && [...(item.entryIds || [])].sort().join("|") === wanted);
}

function entryMeta(entry) {
  if (adminMode && entry.title) return `${entry.title} · ${entry.photographer} · ${mediaText(entry)}`;
  return mediaText(entry);
}

function resultDisplayTitle(entry) {
  const photographer = entry.photographer || "未识别摄影师";
  const sku = entry.sku ? cleanSku(entry.sku) : "未识别SKU";
  return `${photographer} · ${sku} ${circleNumber(entry)}`;
}

function circleNumber(entry) {
  const moduleIndex = entries
    .filter(item => item.moduleName === entry.moduleName)
    .sort((a, b) => a.sequence - b.sequence)
    .findIndex(item => item.id === entry.id);
  const number = moduleIndex + 1;
  if (number >= 1 && number <= 20) {
    return String.fromCodePoint(0x245F + number);
  }
  return `(${number})`;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "请求失败");
  return body;
}

async function loadBallots() {
  ballots = [];
  completedModules = new Set();
  resetSelections();
  const voter = voterName();
  if (!voter) return;
  const data = await fetchJson(`/api/ballots?voter=${encodeURIComponent(voter)}`);
  ballots = Array.isArray(data.ballots) ? data.ballots : [];
  for (const ballot of ballots) {
    if (!ballot.moduleName) continue;
    completedModules.add(ballot.moduleName);
    selected.set(ballot.moduleName, new Set(Array.isArray(ballot.entryIds) ? ballot.entryIds : []));
  }
}

async function loadAdminBallots() {
  adminBallots = [];
  if (!adminMode) return;
  const data = await fetchJson(`/api/ballots?adminCode=${encodeURIComponent(adminCode.value.trim())}`);
  adminBallots = Array.isArray(data.ballots) ? data.ballots : [];
}

async function loadData() {
  systemInfo = await fetchJson("/api/system");
  votingOpen = Boolean(systemInfo.votingOpen);
  resultsPublished = Boolean(systemInfo.resultsPublished);
  periods = Array.isArray(systemInfo.periods) ? systemInfo.periods : [];
  currentPeriodId = systemInfo.currentPeriodId || "";
  currentPeriodName = systemInfo.currentPeriodName || currentPeriodId;
  if (adminMode) {
    const photographerData = await fetchJson(`/api/photographers?adminCode=${encodeURIComponent(adminCode.value.trim())}`);
    photographers = photographerData.photographers;
    try {
      const statusData = await fetchJson(`/api/admin/voting-status?adminCode=${encodeURIComponent(adminCode.value.trim())}`);
      moduleVoters = statusData.moduleVoters || {};
      votingStatus = statusData.status || null;
    } catch (error) {
      moduleVoters = {};
      votingStatus = null;
    }
  } else {
    photographers = [];
    moduleVoters = {};
    votingStatus = null;
  }
  const query = adminMode
    ? `?adminCode=${encodeURIComponent(adminCode.value.trim())}`
    : (voterName() ? `?voterName=${encodeURIComponent(voterName())}` : "");
  const entryData = await fetchJson(`/api/entries${query}`);
  modules = entryData.modules;
  entries = entryData.entries;
  syncOpenPreviewEntry();
  for (const module of modules) {
    if (!selected.has(module.name)) selected.set(module.name, new Set());
  }
  activeModule ||= modules[0];
  const resultData = await fetchJson(`/api/results${query}`);
  results = resultData.results;
  const tiebreakerData = await fetchJson(`/api/tiebreakers${query}`);
  tiebreakers = Array.isArray(tiebreakerData.tiebreakers) ? tiebreakerData.tiebreakers : [];
  tiebreakerSelected.clear();
  for (const item of tiebreakers) {
    if (item.myEntryId) tiebreakerSelected.set(item.id, item.myEntryId);
  }
  await loadBallots();
  await loadAdminBallots();
  renderPhotographerLogin();
  syncAuthFields();
  setAuthenticated(Boolean(loggedInName || adminMode));
  render();
  scheduleProcessingRefresh();
}

function hasProcessingMedia() {
  return entries.some(entry => (entry.media || []).some(item => item.processing));
}

function syncOpenPreviewEntry() {
  if (!previewEntry) return;
  const latestEntry = entries.find(entry => entry.id === previewEntry.id);
  if (!latestEntry) {
    previewEntry = null;
    if (imageViewer.open) imageViewer.close();
    if (previewDialog.open) closePreviewDialog();
    return;
  }
  previewEntry = latestEntry;
  if (viewerIndex >= previewEntry.media.length) viewerIndex = Math.max(0, previewEntry.media.length - 1);
  if (previewDialog.open) renderPreviewContent();
  if (imageViewer.open) renderImageViewer();
}

function scheduleProcessingRefresh() {
  if (processingRefreshTimer || !hasProcessingMedia()) return;
  processingRefreshTimer = window.setTimeout(async () => {
    processingRefreshTimer = null;
    if (!hasProcessingMedia()) return;
    try {
      await loadData();
    } catch {}
  }, 5000);
}

function renderPhotographerLogin() {
  const remembered = localStorage.getItem("photoReviewVoter") || "";
  if (!loggedInName && remembered) loggedInName = remembered;
  if (identityBox) identityBox.hidden = adminMode;
  if (adminMode) return;
  identityBox?.classList.toggle("is-logged-in", Boolean(loggedInName));
  if (loggedInName) {
    voterInput.value = loggedInName;
    voterInput.readOnly = true;
    voterInput.hidden = true;
    voterLogin.hidden = true;
    voterLogout.hidden = false;
    voterLoginStatus.textContent = loggedInName;
  } else {
    voterInput.value = "";
    voterInput.readOnly = false;
    voterInput.hidden = false;
    voterLogin.hidden = false;
    voterLogout.hidden = true;
    voterLoginStatus.textContent = "";
  }
}

async function loginPhotographer() {
  const name = voterInput.value.trim();
  if (!name) {
    alert("请输入自己的姓名");
    voterInput.focus();
    return;
  }
  try {
    await fetchJson("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    loggedInName = name;
    localStorage.setItem("photoReviewVoter", name);
    await loadBallots();
    renderPhotographerLogin();
    render();
    showToast(`${name}，欢迎进入评优`);
  } catch (error) {
    localStorage.removeItem("photoReviewVoter");
    loggedInName = "";
    renderPhotographerLogin();
    alert(error.message);
    voterInput.focus();
  }
}

async function loginFromAuthScreen() {
  const credential = authName.value.trim();
  if (!credential) {
    setAuthStatus("请输入姓名或管理员口令");
    authName.focus();
    return;
  }

  try {
    try {
      await fetchJson(`/api/photographers?adminCode=${encodeURIComponent(credential)}`);
      adminMode = true;
      loggedInName = "";
      localStorage.removeItem("photoReviewVoter");
      adminCode.value = credential;
      adminToggle.textContent = "退出后台";
      adminPanel.hidden = false;
      setAuthenticated(true);
      await loadData();
      showToast("管理员已登录");
      return;
    } catch {}

    await fetchJson("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: credential })
    });
    loggedInName = credential;
    localStorage.setItem("photoReviewVoter", credential);
    adminMode = false;
    adminCode.value = "";
    adminPanel.hidden = true;
    setAuthenticated(true);
    await loadData();
    showToast(`${credential}，欢迎进入评优`);
  } catch (error) {
    setAuthStatus(error.message);
  }
}

function logoutPhotographer() {
  loggedInName = "";
  localStorage.removeItem("photoReviewVoter");
  ballots = [];
  completedModules = new Set();
  resetSelections();
  renderPhotographerLogin();
  render();
  syncAuthFields();
  setAuthenticated(false);
  showToast("已退出当前姓名");
}

function renderPhotographerAdmin() {
  if (!photographerList || !photographerAdmin) return;
  photographerAdmin.hidden = !adminMode;
  if (!adminMode) {
    photographerList.innerHTML = "";
    return;
  }
  photographerList.innerHTML = photographers.length
    ? photographers.map(name => `
      <span class="photographer-pill">
        ${escapeHtml(name)}
        <button type="button" data-name="${escapeHtml(name)}" aria-label="删除 ${escapeHtml(name)}">×</button>
      </span>
    `).join("")
    : `<span class="muted">还没有摄影师名单</span>`;

  photographerList.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => updatePhotographer("delete", button.dataset.name));
  });
}

function renderModuleVotersAdmin() {
  if (!moduleVotersList || !moduleVotersAdmin) return;
  moduleVotersAdmin.hidden = !adminMode;
  if (!adminMode) {
    moduleVotersList.innerHTML = "";
    return;
  }
  const statusModules = (votingStatus && votingStatus.modules) || [];
  if (!statusModules.length) {
    moduleVotersList.innerHTML = `<div class="empty compact">暂无模块</div>`;
    return;
  }
  if (!photographers.length) {
    moduleVotersList.innerHTML = `<div class="empty compact">请先在「摄影师名单」里添加人员</div>`;
    return;
  }
  moduleVotersList.innerHTML = statusModules.map(module => {
    const assigned = new Set(moduleVoters[module.name] || []);
    const pills = photographers.map(name => `
      <button type="button" class="voter-pill${assigned.has(name) ? " is-assigned" : ""}"
        data-module="${escapeHtml(module.name)}" data-name="${escapeHtml(name)}">
        ${escapeHtml(name)}
      </button>
    `).join("");
    return `
      <div class="module-voters-row">
        <div class="module-voters-head">
          <strong>${escapeHtml(module.name)}</strong>
          <span class="muted">已选 ${assigned.size} 人</span>
        </div>
        <div class="voter-pills">${pills}</div>
      </div>
    `;
  }).join("");

  moduleVotersList.querySelectorAll(".voter-pill").forEach(button => {
    button.addEventListener("click", () => toggleModuleVoter(button.dataset.module, button.dataset.name));
  });
}

function renderVotingStatus() {
  if (!votingStatusList || !votingStatusAdmin) return;
  votingStatusAdmin.hidden = !adminMode;
  if (!adminMode) {
    votingStatusList.innerHTML = "";
    if (votingStatusSummary) votingStatusSummary.innerHTML = "";
    return;
  }
  const status = votingStatus;
  if (!status || !status.modules) {
    votingStatusList.innerHTML = `<div class="empty compact">暂无进度</div>`;
    if (votingStatusSummary) votingStatusSummary.innerHTML = "";
    return;
  }
  const assignedModules = status.modules.filter(m => m.expected.length);
  if (votingStatusSummary) {
    if (!assignedModules.length) {
      votingStatusSummary.className = "voting-status-summary";
      votingStatusSummary.innerHTML = `还没有为任何模块设置应投名单，请先到「投票名单分组」里配置。`;
    } else if (status.allDone) {
      votingStatusSummary.className = "voting-status-summary done";
      votingStatusSummary.innerHTML = `✅ 所有应投人员已完成投票`;
    } else {
      const remainingPeople = assignedModules.reduce((sum, m) => sum + m.notVoted.length, 0);
      const remainingModules = assignedModules.filter(m => m.notVoted.length).length;
      votingStatusSummary.className = "voting-status-summary pending";
      votingStatusSummary.innerHTML = `还差 ${remainingModules} 个模块、共 ${remainingPeople} 人未投`;
    }
  }
  votingStatusList.innerHTML = status.modules.map(module => {
    if (!module.expected.length) {
      return `
        <div class="voting-status-row empty-assign">
          <div class="voting-status-head"><strong>${escapeHtml(module.name)}</strong><span class="muted">未设置应投名单</span></div>
        </div>
      `;
    }
    const done = module.notVoted.length === 0;
    const notVoted = module.notVoted.length
      ? `<div class="not-voted">未投：${module.notVoted.map(escapeHtml).join("、")}</div>`
      : `<div class="all-voted">全部已投 ✅</div>`;
    const extra = module.extra.length
      ? `<div class="extra-voted">名单外投票：${module.extra.map(escapeHtml).join("、")}</div>`
      : "";
    return `
      <div class="voting-status-row${done ? " done" : ""}">
        <div class="voting-status-head">
          <strong>${escapeHtml(module.name)}</strong>
          <span class="count">已投 ${module.voted.length} / 应投 ${module.expected.length}</span>
        </div>
        ${notVoted}
        ${extra}
      </div>
    `;
  }).join("");
}

async function toggleModuleVoter(moduleName, name) {
  if (!adminMode) return;
  const current = new Set(moduleVoters[moduleName] || []);
  if (current.has(name)) current.delete(name);
  else current.add(name);
  try {
    const result = await fetchJson("/api/admin/module-voters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminCode: adminCode.value.trim(), moduleName, voters: [...current] })
    });
    moduleVoters = result.moduleVoters || {};
    votingStatus = result.status || votingStatus;
    renderModuleVotersAdmin();
    renderVotingStatus();
  } catch (error) {
    alert(error.message);
  }
}

function renderPeriodAdmin() {
  if (!periodAdmin || !periodSelect || !periodStatus) return;
  periodAdmin.hidden = !adminMode;
  if (!adminMode) return;

  periodSelect.textContent = currentPeriodName || currentPeriodId || "选择月份";
  periodSelect.dataset.periodId = currentPeriodId || "";
  periodStatus.textContent = `当前：${currentPeriodName || currentPeriodId}`;
  renderPeriodCalendar();
}

function renderPeriodCalendar() {
  if (!periodCalendar) return;
  const monthFormatter = new Intl.DateTimeFormat("zh-CN", { month: "short" });
  periodCalendar.innerHTML = periods.map(period => {
    const [year, month] = String(period.id || "").split("-");
    const monthNumber = Number(month);
    const date = Number(year) && monthNumber ? new Date(Number(year), monthNumber - 1, 1) : null;
    const monthLabel = date ? monthFormatter.format(date) : (period.name || period.id);
    const yearLabel = date ? `${date.getFullYear()}` : "";
    const isActive = period.id === currentPeriodId;
    return `
      <div class="period-month-card${isActive ? " active" : ""}">
        <button type="button" class="period-month-switch" data-period-id="${escapeHtml(period.id)}">
          <span>${escapeHtml(yearLabel)}</span>
          <strong>${escapeHtml(monthLabel)}</strong>
          <small>${escapeHtml(period.name || period.id)}</small>
        </button>
        <button type="button" class="period-month-delete" data-period-id="${escapeHtml(period.id)}" ${periods.length <= 1 ? "disabled" : ""}>删除</button>
      </div>
    `;
  }).join("");
  periodCalendar.querySelectorAll(".period-month-switch").forEach(button => {
    button.addEventListener("click", async () => {
      nextPeriodDialog?.close();
      await updatePeriod("switch", { periodId: button.dataset.periodId });
    });
  });
  periodCalendar.querySelectorAll(".period-month-delete").forEach(button => {
    button.addEventListener("click", async event => {
      event.stopPropagation();
      await deletePeriod(button.dataset.periodId);
    });
  });
}

function renderBallotAdmin() {
  if (!ballotAdmin || !ballotList) return;
  ballotAdmin.hidden = !adminMode;
  if (!adminMode) {
    ballotList.innerHTML = "";
    return;
  }
  if (!adminBallots.length) {
    ballotList.innerHTML = `<div class="empty compact">还没有投票记录</div>`;
    return;
  }
  const sortedBallots = [...adminBallots].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  ballotList.innerHTML = sortedBallots.map(ballot => {
    const picked = (ballot.entryIds || []).map(id => {
      const entry = entryById(id);
      return entry ? entryTitle(entry) : "已删除作品";
    }).join("、");
    const timeText = ballot.createdAt ? new Date(ballot.createdAt).toLocaleString("zh-CN", { hour12: false }) : "未知时间";
    return `
      <div class="ballot-row">
        <strong>${escapeHtml(ballot.voter || "未知投票人")}</strong>
        <span>${escapeHtml(ballot.moduleName || "未知模块")}</span>
        <span>${escapeHtml(picked || "未选择作品")}</span>
        <small>${escapeHtml(timeText)}</small>
      </div>
    `;
  }).join("");
}

function bindDialogVoterPills() {
  if (!adminInfoBody) return;
  adminInfoBody.querySelectorAll(".voter-pill").forEach(button => {
    button.addEventListener("click", async () => {
      await toggleModuleVoter(button.dataset.module, button.dataset.name);
      openAdminInfoDialog("投票名单分组", moduleVotersList, { interactiveVoters: true });
    });
  });
}

function openAdminInfoDialog(title, contentNode, options = {}) {
  if (!adminInfoDialog || !adminInfoTitle || !adminInfoBody || !contentNode) return;
  adminInfoTitle.textContent = title;
  adminInfoDialog.classList.toggle("wide", Boolean(options.wide));
  if (downloadDialogPoster) {
    downloadDialogPoster.hidden = !options.resultsPreview;
    downloadDialogPoster.disabled = !options.resultsPreview;
    if (options.resultsPreview) downloadDialogPoster.textContent = "下载完整结果图";
  }
  adminInfoBody.innerHTML = "";
  adminInfoBody.appendChild(contentNode.cloneNode(true));
  if (!adminInfoDialog.open) adminInfoDialog.showModal();
  if (options.interactiveVoters) bindDialogVoterPills();
  if (options.resultsPreview) bindResultPreviewActions(adminInfoBody);
}

function bindResultPreviewActions(root = resultsBox) {
  root?.querySelectorAll(".create-tiebreaker").forEach(button => {
    button.addEventListener("click", () => {
      createTiebreaker(button.dataset.module, String(button.dataset.entryIds || "").split(",").filter(Boolean));
    });
  });
}

function openResultsPreviewDialog() {
  if (!resultsBox) return;
  const wrapper = document.createElement("div");
  wrapper.className = "admin-results-preview";
  if (resultsNote) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = resultsNote.textContent;
    wrapper.appendChild(note);
  }
  const resultsClone = resultsBox.cloneNode(true);
  resultsClone.removeAttribute("id");
  wrapper.appendChild(resultsClone);
  openAdminInfoDialog("后台票数预览", wrapper, { wide: true, resultsPreview: true });
}

function openNextPeriodDialog() {
  renderPeriodCalendar();
  nextPeriodDialog?.showModal();
}

function bindAdminInfoCards() {
  [
    { detail: moduleVotersAdmin, title: "投票名单分组", content: moduleVotersList, interactiveVoters: true },
    { detail: votingStatusAdmin, title: "投票进度", content: votingStatusList, extra: votingStatusSummary },
    { detail: ballotAdmin, title: "投票记录", content: ballotList },
    { detail: resultsPreviewAdmin, customOpen: openResultsPreviewDialog }
  ].forEach(item => {
    if (!item.detail || item.detail.dataset.dialogBound) return;
    item.detail.dataset.dialogBound = "1";
    item.detail.addEventListener("toggle", () => {
      if (item.detail.open) item.detail.open = false;
    });
    item.detail.addEventListener("click", event => {
      if (!adminMode) return;
      event.preventDefault();
      if (item.customOpen) {
        item.customOpen();
        return;
      }
      if (item.extra) {
        const wrapper = document.createElement("div");
        wrapper.appendChild(item.extra.cloneNode(true));
        wrapper.appendChild(item.content.cloneNode(true));
        openAdminInfoDialog(item.title, wrapper);
        return;
      }
      openAdminInfoDialog(item.title, item.content, { interactiveVoters: item.interactiveVoters });
    });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function anyContentDialogOpen() {
  return previewDialog.open || imageViewer.open;
}

function render() {
  // While the user is viewing a work (preview/fullscreen open), the 5s
  // processing-refresh would rebuild the gallery/module DOM underneath the
  // dialog. That destroys the card the dialog was opened from, so on close
  // the page scrolls back to the top (module area). Defer the rebuild until
  // the dialog closes; dialog contents stay fresh via syncOpenPreviewEntry().
  if (anyContentDialogOpen()) {
    deferredRender = true;
    return;
  }
  deferredRender = false;
  renderWelcome();
  activeModuleTitle.textContent = activeModule.name;
  updateSelectedCount();
  renderStatusControls();
  renderOptimizeStatus();
  renderPeriodAdmin();
  renderPhotographerAdmin();
  renderModuleVotersAdmin();
  renderVotingStatus();
  renderBallotAdmin();
  renderModules();
  renderGallery();
  renderTiebreakers();
  renderResults();
  openResultDialogIfNeeded();
}

function flushDeferredRender() {
  // Only rebuild once every content dialog is closed (closing the fullscreen
  // viewer can leave the preview grid still open).
  if (!deferredRender || anyContentDialogOpen()) return;
  // Preserve scroll position: the rebuild replaces the gallery card the dialog
  // was opened from, so without this the page can jump up to the module area.
  const y = window.scrollY;
  render();
  window.scrollTo({ top: y });
}

function entryById(id) {
  return entries.find(entry => entry.id === id);
}

function renderWelcome() {
  if (!welcomePanel) return;
  const totalWorks = entries.length;
  const votableModules = modules.filter(module => hasVotableEntries(module.name));
  const completedVotableCount = votableModules.filter(module => completedModules.has(module.name)).length;
  const allDone = loggedInName && votableModules.length > 0 && completedVotableCount === votableModules.length;
  phaseBadge.textContent = votingOpen ? "投票进行中" : "作品上传阶段";
  welcomePanel.classList.toggle("is-open", votingOpen);
  if (allDone) {
    phaseBadge.textContent = resultsPublished ? "结果已公布" : "已完成";
    welcomeTitle.textContent = resultsPublished ? "结果已公布" : "投票完成";
    welcomeText.innerHTML = resultsPublished
      ? `<span>查看排名</span><span>${votableModules.length} 个模块</span>`
      : `<span>已完成 ${completedVotableCount}/${votableModules.length}</span><span>等待公布</span>`;
  } else if (loggedInName) {
    welcomeTitle.textContent = votingOpen ? `${loggedInName}，开始评审` : `${loggedInName}，欢迎回来`;
    welcomeText.innerHTML = votingOpen
      ? `<span>${totalWorks} 个作品</span><span>已投 ${completedVotableCount}/${votableModules.length}</span>`
      : `<span>${totalWorks} 个作品</span><span>等待开票</span>`;
  } else {
    welcomeTitle.textContent = votingOpen ? "评审开始" : "作品准备中";
    welcomeText.innerHTML = votingOpen
      ? `<span>登录后投票</span><span>匿名展示</span>`
      : `<span>${totalWorks} 个作品</span><span>等待开票</span>`;
  }
  if (adminMode) {
    const periodLabel = currentPeriodName || currentPeriodId || "当前评优";
    welcomeText.innerHTML = `
      <span>${escapeHtml(periodLabel)}</span>
      <span>${totalWorks} 套作品</span>
      <span>${modules.length} 个模块</span>
    `;
  }
}

function renderStatusControls() {
  const activeCompleted = activeModule ? isModuleCompleted(activeModule.name) : false;
  adminPanel.classList.toggle("is-active", adminMode);
  document.body.classList.toggle("is-admin", adminMode);
  voteToolbar?.classList.toggle("is-completed", activeCompleted);
  adminCode.hidden = adminMode;
  statusToggle.hidden = !adminMode;
  statusToggle.textContent = votingOpen ? "恢复上传" : "开始投票";
  publishToggle.hidden = !adminMode;
  publishToggle.disabled = !adminMode;
  publishToggle.textContent = resultsPublished ? "收回结果" : "公布结果";
  if (adminToggle) {
    adminToggle.hidden = !adminMode;
    adminToggle.textContent = "退出后台";
  }
  if (downloadArchive) {
    downloadArchive.hidden = !adminMode;
    downloadArchive.disabled = !adminMode;
    downloadArchive.textContent = "\u4e0b\u8f7d\u5f52\u6863";
  }
  if (clearCurrentPeriod) clearCurrentPeriod.hidden = !adminMode;
  submitVote.disabled = !votingOpen || !voterName() || isSubmittingVote;
  submitVote.classList.toggle("is-loading", isSubmittingVote);
  submitVote.textContent = isSubmittingVote
    ? "提交中..."
    : activeCompleted ? "重新提交本模块" : "提交本模块投票";
}

function renderOptimizeStatus() {
  if (!optimizeStatus) return;
  optimizeStatus.hidden = !adminMode;
  if (!adminMode) return;

  const queue = systemInfo?.optimizeQueue || {};
  const pending = Number(queue.pending || 0);
  const active = Number(queue.active || 0);
  const total = pending + active;
  // 只在有视频正在转码时显示进度条；空闲（全部处理完成）时隐藏，避免常驻占位
  if (total === 0) {
    optimizeStatus.hidden = true;
    optimizeStatus.classList.remove("is-working");
    optimizeStatus.innerHTML = "";
    return;
  }
  optimizeStatus.classList.add("is-working");
  optimizeStatus.innerHTML = `
      <span class="optimize-dot" aria-hidden="true"></span>
      <strong>展示版处理中</strong>
      <span>正在处理 ${active} 个，还剩 ${pending} 个</span>
    `;
}

function renderModules() {
  const resultCounts = new Map();
  for (const result of results) {
    resultCounts.set(result.moduleName, (resultCounts.get(result.moduleName) || 0) + result.votes);
  }
  const canViewResultCounts = adminMode || resultsPublished;

  moduleGrid.innerHTML = modules.map((module, index) => {
    const count = moduleEntries(module.name).length;
    const myUploadCount = myUploadedEntries(module.name).length;
    const picked = selected.get(module.name)?.size || 0;
    const completed = isModuleCompleted(module.name);
    const empty = count === 0;
    const started = picked > 0 && !completed;
    const statusText = empty ? "无作品" : completed ? "已完成" : started ? `已选 ${picked}/${module.voteLimit}` : "待投票";
    const statusClass = empty ? " empty" : completed ? " done" : started ? " started" : " pending";
    const activeClass = module.name === activeModule.name ? " active" : "";
    const completedClass = completed ? " completed" : "";
    const number = String(index + 1).padStart(2, "0");
    return `
      <button class="module-card${activeClass}${completedClass}${statusClass}" type="button" data-module="${module.name}">
        <span class="module-index">${number}</span>
        <span class="module-main">
          <span class="module-heading">
            <span class="module-name">${module.name}</span>
            <span class="module-status">${statusText}</span>
          </span>
        </span>
        <span class="module-stats">${count} 作品</span>
        ${myUploadCount ? `<span class="module-uploaded">已上传 ${myUploadCount} 套</span>` : ""}
        <span class="module-progress">${picked}/${module.voteLimit}</span>
        <span class="module-drop-text">拖入上传</span>
        ${completed ? `<span class="module-complete-mark" aria-label="本模块已投票">已投</span>` : ""}
      </button>
    `;
  }).join("");

  moduleGrid.querySelectorAll(".module-card").forEach(button => {
    button.addEventListener("click", () => {
      activeModule = modules.find(module => module.name === button.dataset.module);
      render();
    });

    ["dragenter", "dragover"].forEach(eventName => {
      button.addEventListener(eventName, event => {
        event.preventDefault();
        button.classList.add("dragging");
      });
    });

    ["dragleave", "drop"].forEach(eventName => {
      button.addEventListener(eventName, event => {
        event.preventDefault();
        button.classList.remove("dragging");
      });
    });

    button.addEventListener("drop", event => {
      const targetModule = modules.find(module => module.name === button.dataset.module);
      handleUploadDrop(event, targetModule);
    });
  });
}

async function handleUploadDrop(event, targetModule = activeModule) {
  event.preventDefault();
  event.stopPropagation();
  galleryDragDepth = 0;
  gallery.classList.remove("dragging");

  try {
    if (!targetModule) return;
    if (!adminMode && !voterName()) {
      setStatus("请先登录自己的姓名后再上传");
      authName?.focus();
      return;
    }
    activeModule = targetModule;
    render();
    setStatus(`正在读取 ${targetModule.name} 的作品文件夹...`);
    const files = await collectDroppedFiles(event.dataTransfer);
    enqueueUpload(files, targetModule.name);
  } catch (error) {
    setStatus(error.message || "读取拖拽文件夹失败");
  }
}

function renderGallery() {
  gallery.innerHTML = "";
  const list = moduleEntries(activeModule.name).sort((a, b) => a.sequence - b.sequence);
  const voter = voterName();

  if (!list.length) {
    const canUpload = adminMode || Boolean(voter);
    const uploadHint = canUpload
      ? `把文件夹、图片或视频拖到这里，上传到 ${activeModule.name}`
      : "请先登录自己的姓名后再上传作品";
    const message = `${currentPeriodName || "当前月份"} 的 ${activeModule.name} 暂无作品`;
    gallery.innerHTML = `
      <div class="empty gallery-drop-zone">
        <strong>${escapeHtml(uploadHint)}</strong>
        <span>${escapeHtml(message)}</span>
      </div>
    `;
    return;
  }

  for (const entry of list) {
    const node = entryTemplate.content.firstElementChild.cloneNode(true);
    const isOwn = Boolean(entry.isOwn || (voter && entry.photographer === voter));
    const isSelected = activeBucket().has(entry.id);
    node.classList.toggle("selected", isSelected);
    node.classList.toggle("disabled", Boolean(isOwn));
    node.querySelector(".entry-title").textContent = entryTitle(entry);
    node.querySelector(".entry-meta").textContent = entryMeta(entry);
    node.querySelector(".vote-check").disabled = !voter || Boolean(isOwn);
    node.querySelector(".vote-check").title = !voter ? "请先登录自己的姓名" : (isOwn ? "不能投自己的作品" : "选择整套作品");
    node.querySelector(".vote-check").addEventListener("click", event => {
      event.stopPropagation();
      toggleEntry(entry);
    });
    const deleteButton = node.querySelector(".delete-entry");
    const canDelete = adminMode || (!votingOpen && Boolean(isOwn));
    deleteButton.hidden = !canDelete;
    deleteButton.addEventListener("click", event => {
      event.stopPropagation();
      deleteEntry(entry);
    });
    node.addEventListener("click", () => openPreview(entry));
    gallery.appendChild(node);
  }
}

function openPreview(entry) {
  previewEntry = entry;
  renderPreviewContent();
  previewDialog.showModal();
}

function renderPreviewContent() {
  if (!previewEntry) return;
  previewTitle.textContent = entryTitle(previewEntry);
  previewMeta.textContent = entryMeta(previewEntry);
  mediaPreviewGrid.innerHTML = previewEntry.media.map((item, index) => `
    <button class="media-preview-card${item.processing ? " processing" : ""}" type="button" data-index="${index}">
      ${item.kind === "video"
        ? `<span class="video-preview-placeholder" aria-hidden="true"><span class="video-play-icon">▶</span></span><span class="media-kind-badge">视频</span><span class="media-play-badge">点击播放</span>`
        : `<img src="${item.src}" loading="lazy" alt="${entryTitle(previewEntry)} 第 ${index + 1} 张">`}
      ${item.processing ? `<span class="media-processing">处理中</span>` : ""}
      <span class="media-error" hidden>加载失败，点击打开原文件</span>
    </button>
  `).join("");
  mediaPreviewGrid.querySelectorAll("img").forEach(media => {
    media.addEventListener("error", () => {
      const retryCount = Number(media.dataset.retryCount || "0");
      if (retryCount < 2) {
        media.dataset.retryCount = String(retryCount + 1);
        const src = new URL(media.currentSrc || media.src, window.location.href);
        src.searchParams.set("retry", `${Date.now()}-${retryCount + 1}`);
        media.src = src.toString();
        return;
      }
      const card = media.closest(".media-preview-card");
      card?.classList.add("is-error");
      const error = card?.querySelector(".media-error");
      if (error) error.hidden = false;
    });
  });
  mediaPreviewGrid.querySelectorAll(".media-preview-card").forEach(button => {
    button.addEventListener("click", () => {
      if (button.classList.contains("is-error")) {
        const item = previewEntry?.media?.[Number(button.dataset.index)];
        if (item?.src) window.open(item.src, "_blank", "noopener");
        return;
      }
      openImageViewer(Number(button.dataset.index));
    });
  });
}

function closePreviewDialog() {
  previewDialog.close();
}

function openImageViewer(index) {
  if (!previewEntry) return;
  viewerIndex = index;
  resetViewerZoom();
  renderImageViewer();
  // The .viewer-open class locks the page (overflow:hidden), which collapses
  // the scroll position to 0. Remember where we were so we can restore it on
  // close — otherwise closing the viewer dumps the user back at the top.
  scrollBeforeViewer = window.scrollY;
  document.documentElement.classList.add("viewer-open");
  document.body.classList.add("viewer-open");
  imageViewer.showModal();
}

function renderImageViewer() {
  const item = previewEntry.media[viewerIndex];
  viewerTitle.textContent = entryTitle(previewEntry);
  viewerMeta.textContent = `${entryMeta(previewEntry)} · ${viewerIndex + 1}/${previewEntry.media.length}`;
  viewerStage.innerHTML = item.kind === "video"
    ? `<video class="viewer-media" src="${item.src}" controls autoplay playsinline preload="metadata"></video>`
    : `<img class="viewer-media" src="${item.src}" alt="${entryTitle(previewEntry)} 第 ${viewerIndex + 1} 张">`;
  const media = viewerMedia();
  media?.addEventListener("error", () => {
    viewerStage.classList.add("is-error");
    if (!viewerStage.querySelector(".viewer-load-error")) {
      viewerStage.insertAdjacentHTML("beforeend", `<div class="viewer-load-error">文件加载失败，可以<a href="${item.src}" target="_blank" rel="noopener">点击这里打开原文件</a>。</div>`);
    }
  });
  media?.addEventListener("loadeddata", () => viewerStage.classList.remove("is-error"));
  applyViewerZoom();
}

function shiftViewer(step) {
  if (!previewEntry) return;
  viewerIndex = (viewerIndex + step + previewEntry.media.length) % previewEntry.media.length;
  resetViewerZoom();
  renderImageViewer();
}

function viewerMedia() {
  return viewerStage.querySelector(".viewer-media");
}

function applyViewerZoom() {
  const media = viewerMedia();
  if (!media) return;
  if (viewerZoom.scale <= 1) {
    viewerZoom.scale = 1;
    viewerZoom.x = 0;
    viewerZoom.y = 0;
  }
  media.style.transform = `translate(${viewerZoom.x}px, ${viewerZoom.y}px) scale(${viewerZoom.scale})`;
  media.style.cursor = viewerZoom.scale > 1 && media.tagName !== "VIDEO" ? "grab" : "default";
  viewerFit.textContent = viewerZoom.scale === 1 ? "适应" : `${Math.round(viewerZoom.scale * 100)}%`;
}

function resetViewerZoom() {
  viewerZoom = { scale: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0 };
  applyViewerZoom();
}

function changeViewerZoom(delta) {
  viewerZoom.scale = Math.min(4, Math.max(1, Number((viewerZoom.scale + delta).toFixed(2))));
  if (viewerZoom.scale <= 1) {
    viewerZoom.x = 0;
    viewerZoom.y = 0;
  }
  applyViewerZoom();
}

async function deleteEntry(entry) {
  const label = entryTitle(entry);
  if (!confirm(`确定删除 ${label} 吗？删除后该作品和相关票数都会移除。`)) return;
  try {
    await fetchJson("/api/delete-entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entryId: entry.id,
        adminCode: adminMode ? adminCode.value.trim() : "",
        voterName: adminMode ? "" : voterName()
      })
    });
    activeBucket().delete(entry.id);
    await loadData();
  } catch (error) {
    alert(error.message);
  }
}

function renderTiebreakers() {
  if (!tiebreakerPanel || !tiebreakerList) return;
  const visible = tiebreakers.filter(item => item.status === "open" && (adminMode || voterName()));
  tiebreakerPanel.hidden = visible.length === 0;
  if (!visible.length) {
    tiebreakerList.innerHTML = "";
    return;
  }

  tiebreakerList.innerHTML = visible.map(item => {
    const picked = tiebreakerSelected.get(item.id) || item.myEntryId || "";
    const blockedByOwnEntry = !adminMode && item.entries.some(entry => entry.isOwn);
    return `
      <article class="tiebreaker-card${blockedByOwnEntry ? " blocked" : ""}" data-tiebreaker="${item.id}">
        <div class="tiebreaker-head">
          <div>
            <strong>${escapeHtml(item.moduleName)} 并列加赛</strong>
            <span>${blockedByOwnEntry ? "你有作品在本组加赛中，不能参与本组投票" : `${item.entries.length} 个同票作品 · 每人选 1 个`}</span>
          </div>
          ${adminMode ? `<button class="close-tiebreaker" type="button">结束加赛</button>` : ""}
        </div>
        <div class="tiebreaker-options">
          ${item.entries.map(entry => {
            const checked = picked === entry.id;
            const disabled = blockedByOwnEntry || Boolean(entry.isOwn);
            return `
              <button class="tiebreaker-option${checked ? " selected" : ""}${disabled ? " disabled" : ""}" type="button" data-entry="${entry.id}" ${disabled ? "disabled" : ""}>
                <span>${entryTitle(entry)}</span>
                <small>${adminMode ? `${escapeHtml(entry.photographer || "")} · ` : ""}原票 ${entry.votes || 0} · 加赛 ${entry.tiebreakerVotes || 0}</small>
              </button>
            `;
          }).join("")}
        </div>
        ${!adminMode ? `<button class="submit-tiebreaker" type="button" ${picked && !blockedByOwnEntry ? "" : "disabled"}>${blockedByOwnEntry ? "本组不可投票" : "提交加赛投票"}</button>` : ""}
      </article>
    `;
  }).join("");

  tiebreakerList.querySelectorAll(".tiebreaker-card").forEach(card => {
    const tiebreakerId = card.dataset.tiebreaker;
    card.querySelectorAll(".tiebreaker-option").forEach(button => {
      button.addEventListener("click", () => {
        if (adminMode || button.disabled) return;
        tiebreakerSelected.set(tiebreakerId, button.dataset.entry);
        renderTiebreakers();
      });
    });
    card.querySelector(".submit-tiebreaker")?.addEventListener("click", () => submitTiebreakerVote(tiebreakerId));
    card.querySelector(".close-tiebreaker")?.addEventListener("click", () => closeTiebreaker(tiebreakerId));
  });
}

async function createTiebreaker(moduleName, entryIds) {
  if (!adminMode) return;
  try {
    await fetchJson("/api/tiebreakers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminCode: adminCode.value.trim(), action: "create", moduleName, entryIds })
    });
    await loadData();
    showToast("已发起并列加赛", "success");
  } catch (error) {
    alert(error.message);
  }
}

async function closeTiebreaker(tiebreakerId) {
  if (!adminMode) return;
  try {
    await fetchJson("/api/tiebreakers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminCode: adminCode.value.trim(), action: "close", tiebreakerId })
    });
    await loadData();
    showToast("已结束加赛", "success");
  } catch (error) {
    alert(error.message);
  }
}

async function submitTiebreakerVote(tiebreakerId) {
  const entryId = tiebreakerSelected.get(tiebreakerId);
  if (!entryId) return;
  try {
    await fetchJson("/api/tiebreaker-vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voter: voterName(), tiebreakerId, entryId })
    });
    await loadData();
    showToast("加赛投票已提交，排名会自动更新", "success");
  } catch (error) {
    alert(error.message);
  }
}

function renderResults() {
  const hasResultEntries = results.some(entry => entry.mediaCount > 0 || entry.votes > 0 || entry.sku);
  const canViewResults = adminMode || (resultsPublished && hasResultEntries);
  const showPhotographerResultCard = !adminMode && resultsPublished && hasResultEntries;
  if (resultsPanel) resultsPanel.hidden = adminMode || showPhotographerResultCard || !canViewResults;
  if (resultsPreviewAdmin) resultsPreviewAdmin.hidden = !adminMode;
  if (photographerResultCard) {
    photographerResultCard.hidden = !showPhotographerResultCard;
    if (showPhotographerResultCard) {
      const label = currentPeriodName || currentPeriodId || "本期评优";
      photographerResultCard.innerHTML = `
        <span>评优结果</span>
        <strong>${escapeHtml(label)}</strong>
      `;
    }
  }
  if (!canViewResults) return;

  resultsTitle.textContent = resultsPublished ? "最终评优结果" : (adminMode ? "后台票数预览" : "最终结果");
  resultsNote.textContent = canViewResults
    ? (adminMode && !resultsPublished ? "当前仅管理员可见，公布后摄影师才能看到。" : "每个模块优先展示获奖结果，完整排名在卡片下方查看。")
    : "投票期间不显示实时票数，管理员公布后这里会显示最终排名。";

  resultsBox.innerHTML = modules.map(module => {
    const totalVotes = moduleVoteTotal(module.name);
    const awardLimit = resultLimitForModule(module.name);
    const list = moduleResultList(module.name);
    const awardEntries = list.slice(0, awardLimit);
    const otherEntries = list.slice(awardLimit);
    const awardRows = awardEntries.length
      ? awardEntries.map((entry, index) => {
        const percent = votePercent(entry, totalVotes);
        return `
          <article class="winner-card rank-${index + 1}">
            <span class="winner-rank">第 ${index + 1} 名</span>
            <strong>${resultDisplayTitle(entry)}</strong>
            <div class="winner-score">
              <span>${entry.votes} 票${tiebreakerText(entry)}</span>
              <small>${percent}</small>
            </div>
            <div class="winner-bar" aria-hidden="true"><i style="width:${percent}"></i></div>
          </article>
        `;
      }).join("")
      : `<div class="result-empty-state"><span>暂无作品</span></div>`;
    const otherRows = otherEntries.length
      ? `
        <details class="result-more">
          <summary>查看其余 ${otherEntries.length} 个排名</summary>
          ${otherEntries.map((entry, index) => `
            <div class="result-row">
              <span><b>第 ${index + awardLimit + 1} 名</b> ${resultDisplayTitle(entry)}</span>
              <strong><span>${entry.votes} 票${tiebreakerText(entry)}</span><small>${votePercent(entry, totalVotes)}</small></strong>
            </div>
          `).join("")}
        </details>
      `
      : "";
    const tieGroups = adminMode
      ? resultTieGroups(module.name).map(group => {
        const ids = group.map(entry => entry.id);
        const open = hasOpenTiebreakerFor(ids);
        return `
          <div class="tie-admin-row">
            <span>${group[0].votes} 票并列：${group.map(resultDisplayTitle).join("、")}</span>
            <button class="create-tiebreaker" type="button" data-module="${escapeHtml(module.name)}" data-entry-ids="${escapeHtml(ids.join(","))}" ${open ? "disabled" : ""}>
              ${open ? "加赛进行中" : "发起加赛"}
            </button>
          </div>
        `;
      }).join("")
      : "";
    return `
      <section class="result-module">
        <h3>${module.name}<span>获奖 ${awardLimit} 名 · ${resultsPublished ? "已公布" : "预览"}</span></h3>
        <div class="winner-grid">${awardRows}</div>
        ${tieGroups ? `<div class="tie-admin-list">${tieGroups}</div>` : ""}
        ${otherRows}
      </section>
    `;
  }).join("");
  bindResultPreviewActions(resultsBox);
}

function renderResultDialog() {
  if (!resultDialogGrid) return;
  resultDialogGrid.innerHTML = modules.map(module => {
    const totalVotes = moduleVoteTotal(module.name);
    const topEntries = moduleResultList(module.name).slice(0, resultLimitForModule(module.name));
    const rows = topEntries.length
      ? topEntries.map((entry, index) => `
        <div class="result-dialog-row rank-${index + 1} award-row">
          <span class="rank-mark">第 ${index + 1} 名 · 获奖</span>
          <span class="rank-title">${resultDisplayTitle(entry)}</span>
          <strong><span>${entry.votes} 票${tiebreakerText(entry)}</span><small>${votePercent(entry, totalVotes)}</small></strong>
        </div>
      `).join("")
      : `<div class="empty compact">暂无作品</div>`;
    return `
      <section class="result-dialog-module">
        <h3>${module.name}<span>前 ${resultLimitForModule(module.name)} 名</span></h3>
        ${rows}
      </section>
    `;
  }).join("");
}

function openResultDialogIfNeeded(force = false) {
  if (!resultDialog) return;
  const hasResultEntries = results.some(entry => entry.mediaCount > 0 || entry.votes > 0 || entry.sku);
  if (!resultsPublished || !hasResultEntries) {
    resultDialogDismissed = false;
    if (resultDialog.open) resultDialog.close();
    return;
  }
  renderResultDialog();
  if (resultDialog.open) return;
  if (!force && resultDialogDismissed) return;
  resultDialog.showModal();
}

function toggleEntry(entry) {
  const voter = voterName();
  if (!voter) {
    alert("请先登录自己的姓名");
    voterInput.focus();
    return;
  }
  if (entry.photographer && entry.photographer === voter) {
    alert("不能投自己的作品");
    return;
  }
  const bucket = activeBucket();
  if (bucket.has(entry.id)) {
    bucket.delete(entry.id);
  } else {
    if (bucket.size >= activeLimit()) {
      alert(`${activeModule.name} 最多投 ${activeLimit()} 个作品文件夹`);
      return;
    }
    bucket.add(entry.id);
  }
  render();
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function fileEntryToFile(entry, pathPrefix) {
  return new Promise((resolve, reject) => {
    entry.file(file => {
      file.relativePath = `${pathPrefix}${file.name}`;
      resolve(file);
    }, reject);
  });
}

function readDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const readBatch = () => {
      reader.readEntries(batch => {
        if (!batch.length) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

async function collectEntryFiles(entry, pathPrefix = "") {
  if (entry.isFile) return [await fileEntryToFile(entry, pathPrefix)];
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const children = await readDirectoryEntries(reader);
  const nested = await Promise.all(children.map(child => collectEntryFiles(child, `${pathPrefix}${entry.name}/`)));
  return nested.flat();
}

async function collectDroppedFiles(dataTransfer) {
  const items = Array.from(dataTransfer.items || []);
  const entryItems = items
    .map(item => item.webkitGetAsEntry ? item.webkitGetAsEntry() : null)
    .filter(Boolean);
  if (entryItems.length) {
    const nested = await Promise.all(entryItems.map(entry => collectEntryFiles(entry)));
    return nested.flat();
  }
  return Array.from(dataTransfer.files || []);
}

function enqueueUpload(files, moduleName) {
  const position = uploadQueueLength;
  uploadQueueLength += 1;
  if (position > 0) {
    setStatus(`${moduleName} 已加入上传队列，前面还有 ${position} 个任务...`);
  }

  const task = uploadQueue
    .then(async () => {
      const targetModule = modules.find(module => module.name === moduleName);
      if (targetModule) {
        activeModule = targetModule;
        render();
      }
      await uploadFiles(files, moduleName);
    })
    .catch(error => {
      setStatus(error.message || "上传失败，请重试");
    })
    .finally(() => {
      uploadQueueLength = Math.max(0, uploadQueueLength - 1);
    });

  uploadQueue = task.catch(() => {});
  return task;
}

async function uploadFiles(files, moduleName) {
  if (!adminMode && !voterName()) {
    setStatus("请先登录自己的姓名后再上传");
    return;
  }
  if (!adminMode && myUploadedEntries(moduleName).length) {
    setStatus(`${moduleName} 已经上传过作品，如需重新上传，请先删除之前上传的作品`);
    showToast(`${moduleName} 已上传过，请先删除原作品再上传`, "error");
    return;
  }
  const mediaFiles = files.filter(file => mediaPattern.test(file.name));
  if (!mediaFiles.length) {
    setStatus("文件夹里没有可识别的图片或视频");
    return;
  }
  const batches = chunkArray(mediaFiles, UPLOAD_BATCH_SIZE);
  let uploadedFiles = 0;
  let totalMedia = 0;
  const uploadSessionId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const useDirectUpload = Boolean(systemInfo?.storage?.directUpload);
  setStatus(`正在上传到 ${moduleName}：共 ${mediaFiles.length} 个媒体文件，分 ${batches.length} 批处理...`);
  try {
    for (const [batchIndex, batch] of batches.entries()) {
      const batchNo = batchIndex + 1;
      const result = useDirectUpload
        ? await uploadBatchToObjectStorage(batch, moduleName, batchNo, batches.length, uploadSessionId)
        : await uploadBatchToServer(batch, moduleName, batchNo, batches.length, uploadSessionId);
      uploadedFiles += batch.length;
      totalMedia += result.media || 0;
      setStatus(`正在上传到 ${moduleName}：已完成 ${uploadedFiles}/${mediaFiles.length} 个文件，继续处理...`);
    }
    const uploadOwner = adminMode ? "管理员" : voterName();
    setStatus(`${moduleName} 上传完成：已处理 ${totalMedia} 个媒体文件，作品列表已刷新。`);
    showToast(`${moduleName} 上传成功，已记录为 ${uploadOwner} 的作品`, "success");
    await loadData();
  } catch (error) {
    setStatus(error.message);
  }
}

async function uploadBatchToServer(batch, moduleName, batchNo, batchCount, uploadSessionId) {
  const formData = new FormData();
  formData.append("moduleName", moduleName);
  formData.append("uploadSessionId", uploadSessionId);
  if (!adminMode) formData.append("uploaderName", voterName());
  batch.forEach(file => {
    const relativePath = file.relativePath || file.webkitRelativePath || file.name;
    formData.append("files", file, relativePath);
  });
  setStatus(`正在上传到 ${moduleName}：第 ${batchNo}/${batchCount} 批正在上传并生成展示版...`);
  return fetchJson("/api/upload", {
    method: "POST",
    body: formData
  });
}

async function uploadBatchToObjectStorage(batch, moduleName, batchNo, batchCount, uploadSessionId) {
  setStatus(`正在上传到 ${moduleName}：第 ${batchNo}/${batchCount} 批压缩图片...`);
  const uploadBatch = await Promise.all(batch.map(prepareDirectUploadFile));
  const compressedCount = uploadBatch.filter(file => file.optimizedForUpload).length;
  const savedBytes = uploadBatch.reduce((sum, file) => sum + (file.uploadSavedBytes || 0), 0);
  if (compressedCount) {
    setStatus(`正在上传到 ${moduleName}：第 ${batchNo}/${batchCount} 批已压缩 ${compressedCount} 张，减少 ${formatFileSize(savedBytes)}...`);
  }

  const files = uploadBatch.map(file => ({
    name: file.name,
    relativePath: file.relativePath || file.webkitRelativePath || file.name,
    type: file.type || "",
    size: file.size || 0
  }));
  setStatus(`正在上传到 ${moduleName}：第 ${batchNo}/${batchCount} 批准备直传对象存储...`);
  const signed = await fetchJson("/api/storage/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ moduleName, files, uploadSessionId, uploaderName: adminMode ? "" : voterName() })
  });
  const signedFiles = Array.isArray(signed.files) ? signed.files : [];
  const uploaded = [];
  let completed = 0;

  await runLimited(signedFiles, OBJECT_UPLOAD_CONCURRENCY, async (signedFile, index) => {
    const source = findSignedSourceFile(uploadBatch, signedFile) || uploadBatch[index];
    if (!source) return;
    const response = await fetch(signedFile.uploadUrl, {
      method: signedFile.method || "PUT",
      headers: signedFile.contentType ? { "Content-Type": signedFile.contentType } : {},
      body: source
    });
    if (!response.ok) throw new Error(`对象存储上传失败：${response.status}`);
    uploaded.push(signedFile);
    completed += 1;
    setStatus(`正在上传到 ${moduleName}：第 ${batchNo}/${batchCount} 批直传 ${completed}/${signedFiles.length}...`);
  });

  setStatus(`正在上传到 ${moduleName}：第 ${batchNo}/${batchCount} 批写入作品列表...`);
  return fetchJson("/api/storage/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: uploaded })
  });
}

function findSignedSourceFile(batch, signedFile) {
  return batch.find(file => {
    const relativePath = file.relativePath || file.webkitRelativePath || file.name;
    return relativePath === signedFile.relativePath;
  });
}

async function prepareDirectUploadFile(file) {
  const relativePath = file.relativePath || file.webkitRelativePath || file.name;
  file.relativePath = relativePath;
  if (!shouldOptimizeUploadImage(file)) return file;

  try {
    const compressed = await compressImageForUpload(file);
    if (!compressed || compressed.size >= file.size) return file;
    const optimizedName = file.name.replace(/\.[^.]+$/, ".webp");
    const optimizedRelativePath = relativePath.replace(/\.[^.]+$/, ".webp");
    const optimizedFile = new File([compressed], optimizedName, {
      type: "image/webp",
      lastModified: file.lastModified
    });
    optimizedFile.relativePath = optimizedRelativePath;
    optimizedFile.uploadSavedBytes = file.size - optimizedFile.size;
    optimizedFile.optimizedForUpload = true;
    return optimizedFile;
  } catch {
    return file;
  }
}

function shouldOptimizeUploadImage(file) {
  return file.size >= CLIENT_IMAGE_OPTIMIZE_MIN_BYTES && CLIENT_OPTIMIZABLE_IMAGE_TYPES.has(file.type);
}

async function compressImageForUpload(file) {
  const image = await loadImageElement(file);
  const scale = Math.min(1, CLIENT_IMAGE_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(image, 0, 0, width, height);
  return new Promise(resolve => {
    canvas.toBlob(resolve, "image/webp", CLIENT_IMAGE_QUALITY);
  });
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片压缩失败"));
    };
    image.src = url;
  });
}

function formatFileSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${Math.max(0, Math.round(bytes))}B`;
}

async function runLimited(items, limit, worker) {
  const queue = [...items.entries()];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const [index, item] = queue.shift();
      await worker(item, index);
    }
  });
  await Promise.all(workers);
}

async function submitCurrentVote() {
  const voter = voterName();
  const entryIds = Array.from(activeBucket());
  const submittedModuleName = activeModule.name;
  if (!votingOpen) {
    alert("管理员还没有开始投票");
    return;
  }
  if (!voter) {
    alert("请先登录自己的姓名");
    voterInput.focus();
    return;
  }
  if (!entryIds.length) {
    alert("请至少选择 1 个作品文件夹");
    return;
  }
  if (isSubmittingVote) return;
  isSubmittingVote = true;
  renderStatusControls();
  try {
    await fetchJson("/api/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voter, moduleName: submittedModuleName, entryIds })
    });
    completedModules.add(submittedModuleName);
    render();
    await loadData();
    const completedVotableCount = modules
      .filter(module => hasVotableEntries(module.name))
      .filter(module => isModuleCompleted(module.name)).length;
    const votableCount = modules.filter(module => hasVotableEntries(module.name)).length;
    showToast(`${submittedModuleName} 已提交成功 · 已完成 ${completedVotableCount}/${votableCount}`, "success");
    goToNextPendingModule(submittedModuleName);
  } catch (error) {
    alert(error.message);
  } finally {
    isSubmittingVote = false;
    renderStatusControls();
  }
}

function goToNextPendingModule(submittedModuleName) {
  const nextModule = nextPendingModule(submittedModuleName);
  if (!nextModule) {
    showToast("全部模块已投完，等待管理员公布结果", "success");
    welcomePanel.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  window.setTimeout(() => {
    activeModule = nextModule;
    render();
    showToast(`已进入下一项：${nextModule.name}`);
    gallery.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 1000);
}

async function updatePeriod(action, options = {}) {
  if (!adminMode) {
    alert("请先打开管理员后台");
    return;
  }
  const payload = { adminCode: adminCode.value.trim(), action };
  if (action === "switch") payload.periodId = options.periodId || periodSelect.dataset.periodId;
  if (action === "createNext" && !options.skipConfirm && !confirm("确定新建下月评优并切换过去吗？新月份会从空作品开始，历史月份仍可切回查看。")) return;

  try {
    await fetchJson("/api/periods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    activeModule = null;
    resultDialogDismissed = false;
    resetSelections();
    await loadData();
    activeModule = modules[0];
    render();
    showToast(action === "createNext" ? "已进入下月评优" : "已切换评优月份");
  } catch (error) {
    alert(error.message);
  }
}

async function deletePeriod(periodId) {
  if (!adminMode || !periodId) return;
  const target = periods.find(period => period.id === periodId);
  const label = target?.name || periodId;
  if (periods.length <= 1) {
    alert("至少需要保留一个评优月份");
    return;
  }
  if (!confirm(`确定删除 ${label} 吗？该月份的作品、投票和加赛记录都会删除。`)) return;

  try {
    await fetchJson("/api/periods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminCode: adminCode.value.trim(), action: "delete", periodId })
    });
    activeModule = null;
    resultDialogDismissed = false;
    resetSelections();
    await loadData();
    activeModule = modules[0];
    render();
    renderPeriodCalendar();
    showToast(`已删除 ${label}`);
  } catch (error) {
    alert(error.message);
  }
}

async function ensureSelectedPeriodActive() {
  if (!adminMode || !periodSelect || !periodSelect.dataset.periodId || periodSelect.dataset.periodId === currentPeriodId) return true;
  try {
    await updatePeriod("switch");
    return true;
  } catch {
    return false;
  }
}

async function updatePhotographer(action, name) {
  if (!adminMode) {
    alert("请先打开管理员后台");
    return;
  }
  const finalName = String(name || photographerName.value).trim();
  if (!finalName) {
    alert("请输入摄影师姓名");
    photographerName.focus();
    return;
  }
  if (action === "delete" && !confirm(`确定删除摄影师 ${finalName} 吗？`)) return;

  try {
    const result = await fetchJson("/api/photographers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminCode: adminCode.value.trim(), action, name: finalName })
    });
    photographers = result.photographers;
    photographerName.value = "";
    renderPhotographerLogin();
    renderPhotographerAdmin();
  } catch (error) {
    alert(error.message);
  }
}

if (authLogin) authLogin.addEventListener("click", loginFromAuthScreen);
if (authName) {
  authName.addEventListener("keydown", event => {
    if (event.key === "Enter") loginFromAuthScreen();
  });
}
if (themeToggles.length) {
  applyTheme(document.body.dataset.theme);
  themeToggles.forEach(toggle => {
    toggle.addEventListener("click", () => {
      applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
    });
  });
}
voterLogin.addEventListener("click", loginPhotographer);
voterInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !loggedInName) loginPhotographer();
});
voterLogout.addEventListener("click", logoutPhotographer);
submitVote.addEventListener("click", submitCurrentVote);
if (gallery) {
  ["dragenter", "dragover"].forEach(eventName => {
    gallery.addEventListener(eventName, event => {
      event.preventDefault();
      galleryDragDepth += eventName === "dragenter" ? 1 : 0;
      gallery.classList.add("dragging");
    });
  });

  gallery.addEventListener("dragleave", event => {
    event.preventDefault();
    galleryDragDepth = Math.max(0, galleryDragDepth - 1);
    if (galleryDragDepth === 0) gallery.classList.remove("dragging");
  });

  gallery.addEventListener("drop", event => {
    handleUploadDrop(event, activeModule);
  });
}
if (addPhotographer) addPhotographer.addEventListener("click", () => updatePhotographer("add"));
if (periodSelect) {
  periodSelect.addEventListener("click", () => {
    if (adminMode) openNextPeriodDialog();
  });
}
if (createNextPeriod) createNextPeriod.addEventListener("click", () => {
  if (!adminMode) return;
  openNextPeriodDialog();
});
if (photographerResultCard) {
  photographerResultCard.addEventListener("click", () => {
    resultDialogDismissed = false;
    openResultDialogIfNeeded(true);
  });
}
if (closeAdminInfoDialog) closeAdminInfoDialog.addEventListener("click", () => adminInfoDialog?.close());
if (downloadDialogPoster) {
  downloadDialogPoster.addEventListener("click", () => {
    if (!adminMode) return;
    try {
      drawResultPoster();
    } catch (error) {
      console.error(error);
      showToast("生成图片失败：" + (error?.message || "未知错误"), "error");
    }
  });
}
if (closeNextPeriodDialog) closeNextPeriodDialog.addEventListener("click", () => nextPeriodDialog?.close());
if (adminInfoDialog) {
  adminInfoDialog.addEventListener("click", event => {
    if (event.target === adminInfoDialog) adminInfoDialog.close();
  });
  adminInfoDialog.addEventListener("close", () => {
    if (downloadDialogPoster) downloadDialogPoster.hidden = true;
  });
}
if (nextPeriodDialog) {
  nextPeriodDialog.addEventListener("click", event => {
    if (event.target === nextPeriodDialog) nextPeriodDialog.close();
  });
}
if (cancelNextPeriod) cancelNextPeriod.addEventListener("click", () => nextPeriodDialog?.close());
if (confirmNextPeriod) confirmNextPeriod.addEventListener("click", async () => {
  nextPeriodDialog?.close();
  await updatePeriod("createNext", { skipConfirm: true });
});
if (photographerName) {
  photographerName.addEventListener("keydown", event => {
    if (event.key === "Enter") updatePhotographer("add");
  });
}
adminToggle.addEventListener("click", async () => {
  if (adminMode) {
    adminMode = false;
    adminCode.value = "";
    adminToggle.textContent = "打开后台";
    adminPanel.hidden = true;
    syncAuthFields();
    setAuthenticated(false);
  } else {
    if (!adminCode.value.trim()) {
      alert("请输入管理员口令");
      adminCode.focus();
      return;
    }
    adminMode = true;
    adminToggle.textContent = "退出后台";
  }
  await loadData();
});
statusToggle.addEventListener("click", async () => {
  if (!adminMode) return;
  if (!(await ensureSelectedPeriodActive())) return;
  const next = !votingOpen;
  try {
    await fetchJson("/api/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminCode: adminCode.value.trim(), votingOpen: next })
    });
    await loadData();
    showToast(next ? "已开始投票" : "已恢复上传阶段");
  } catch (error) {
    alert(error.message);
  }
});
publishToggle.addEventListener("click", async () => {
  if (!adminMode) return;
  if (!(await ensureSelectedPeriodActive())) return;
  const next = !resultsPublished;
  try {
    await fetchJson("/api/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminCode: adminCode.value.trim(), resultsPublished: next })
    });
    resultDialogDismissed = false;
    await loadData();
    if (next) openResultDialogIfNeeded(true);
    showToast(next ? "最终结果已公布" : "最终结果已收回");
  } catch (error) {
    alert(error.message);
  }
});
if (downloadArchive) {
  downloadArchive.addEventListener("click", () => {
    if (!adminMode) return;
    const code = adminCode.value.trim();
    if (!code) {
      alert("请先登录管理员后台");
      return;
    }
    const url = `/api/admin/archive?adminCode=${encodeURIComponent(code)}`;
    const link = document.createElement("a");
    link.href = url;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast("正在生成本月归档，请等待浏览器下载完成");
  });
}
function posterModuleBlocks() {
  // All ranked works per module (not just winners), in MODULES order.
  // awardLimit marks how many of the top rows count as "获奖" for highlighting.
  return modules
    .map(module => {
      const awardLimit = resultLimitForModule(module.name);
      const list = moduleResultList(module.name).filter(entry => entry.sku || entry.votes > 0);
      return { name: module.name, rows: list, awardLimit };
    })
    .filter(block => block.rows.length > 0);
}

function drawResultPoster() {
  const blocks = posterModuleBlocks();
  if (!blocks.length) {
    showToast("当前没有可导出的结果", "error");
    return;
  }

  const RANK_LABEL = ["1", "2", "3"];
  const RANK_COLOR = ["#b98514", "#77808e", "#a86026"];
  const FONT = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif';

  const INK = "#1a1c1f";
  const PAGE_BG = "#f6f6f3";
  const REST_BG = "#ffffff";
  const REST_TEXT = "#1a1c1f";
  const REST_SUB = "#8a8f96";
  const AWARD_BG = ["#fff8df", "#f7f8fa", "#fff4eb"];
  const AWARD_BORDER = ["#d4a134", "#b7bec8", "#c9864a"];
  const AWARD_SUB = ["#8a6116", "#667085", "#9a5b22"];

  // Layout metrics (logical px).
  const W = 900;
  const padX = 56;
  const titleBlockH = 168;
  const moduleHeaderH = 64;
  const rowH = 70;
  const rowGap = 8;
  const moduleGap = 34;
  const footerH = 76;

  let H = titleBlockH + footerH;
  for (const block of blocks) H += moduleHeaderH + block.rows.length * (rowH + rowGap) + moduleGap;

  const scale = 2; // crisp on high-DPI and when re-shared
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.textBaseline = "middle";

  // Background.
  ctx.fillStyle = PAGE_BG;
  ctx.fillRect(0, 0, W, H);
  // Top accent bar.
  ctx.fillStyle = "#111111";
  ctx.fillRect(padX, 36, 44, 6);

  const periodLabel = currentPeriodName || currentPeriodId || "本期";

  // Title.
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.font = `800 40px ${FONT}`;
  ctx.fillText(`${periodLabel} 作品评优结果`, padX, 78);
  ctx.fillStyle = "#6b6f76";
  ctx.font = `400 20px ${FONT}`;
  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日 导出 · 完整排名`;
  ctx.fillText(dateStr, padX, 118);
  // Divider under title.
  ctx.strokeStyle = "#d8d3c7";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, 150);
  ctx.lineTo(W - padX, 150);
  ctx.stroke();

  let y = titleBlockH;
  for (const block of blocks) {
    // Module header.
    ctx.fillStyle = INK;
    ctx.fillRect(padX, y + 18, 6, 28);
    ctx.font = `800 27px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(block.name, padX + 20, y + 33);
    // Award-count hint on the right.
    ctx.fillStyle = "#9a9da3";
    ctx.font = `400 16px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(`获奖 ${block.awardLimit} 名 · 共 ${block.rows.length} 名`, W - padX, y + 33);
    y += moduleHeaderH;

    block.rows.forEach((entry, index) => {
      const rowTop = y;
      const midY = rowTop + rowH / 2;
      const isMedal = index < 3;
      const isAward = index < block.awardLimit;
      const awardTone = Math.min(index, 2);
      const cardBg = isAward ? AWARD_BG[awardTone] : REST_BG;
      const border = isAward ? AWARD_BORDER[awardTone] : "#e3e0d8";
      const mainText = REST_TEXT;
      const subText = isAward ? AWARD_SUB[awardTone] : REST_SUB;

      // Row card.
      ctx.fillStyle = cardBg;
      roundRect(ctx, padX, rowTop, W - padX * 2, rowH, 12);
      ctx.fill();
      ctx.strokeStyle = border;
      ctx.lineWidth = isAward ? 1.5 : 1;
      roundRect(ctx, padX, rowTop, W - padX * 2, rowH, 12);
      ctx.stroke();

      if (isAward) {
        ctx.fillStyle = AWARD_BORDER[awardTone];
        roundRect(ctx, padX, rowTop + 12, 5, rowH - 24, 3);
        ctx.fill();
      }

      // Rank badge.
      ctx.textAlign = "center";
      if (isMedal) {
        ctx.fillStyle = AWARD_BG[index];
        ctx.strokeStyle = AWARD_BORDER[index];
        ctx.lineWidth = 1.5;
        roundRect(ctx, padX + 18, midY - 24, 38, 32, 16);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = RANK_COLOR[index];
        ctx.font = `900 20px ${FONT}`;
        ctx.fillText(RANK_LABEL[index], padX + 37, midY - 8);
      } else {
        ctx.fillStyle = mainText;
        ctx.font = `800 24px ${FONT}`;
        ctx.fillText(`${index + 1}`, padX + 36, midY - 4);
      }
      // Rank caption.
      ctx.fillStyle = isMedal ? RANK_COLOR[index] : subText;
      ctx.font = `700 14px ${FONT}`;
      ctx.fillText(`第${index + 1}名`, padX + 36, midY + 20);

      // Name + SKU.
      const photographer = entry.photographer || "未识别摄影师";
      const sku = entry.sku ? cleanSku(entry.sku) : "未识别SKU";
      ctx.textAlign = "left";
      ctx.fillStyle = mainText;
      ctx.font = `700 25px ${FONT}`;
      ctx.fillText(photographer, padX + 82, midY - 11);
      ctx.fillStyle = subText;
      ctx.font = `400 18px ${FONT}`;
      ctx.fillText(sku, padX + 82, midY + 15);

      // Votes (right aligned).
      ctx.textAlign = "right";
      ctx.fillStyle = mainText;
      ctx.font = `800 27px ${FONT}`;
      ctx.fillText(`${entry.votes} 票`, W - padX - 20, midY - 8);
      if (entry.tiebreakerVotes) {
        ctx.fillStyle = subText;
        ctx.font = `400 15px ${FONT}`;
        ctx.fillText(`加赛 ${entry.tiebreakerVotes} 票`, W - padX - 20, midY + 16);
      }

      y += rowH + rowGap;
    });
    y += moduleGap;
  }

  // Footer.
  ctx.textAlign = "center";
  ctx.fillStyle = "#9a9da3";
  ctx.font = `400 16px ${FONT}`;
  ctx.fillText("作品评优系统 · 浅色高亮为获奖名次", W / 2, H - footerH / 2);

  canvas.toBlob(blob => {
    if (!blob) {
      showToast("生成海报失败", "error");
      return;
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${periodLabel} 评优结果.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    showToast("完整结果图已下载，可直接转发到企业微信群");
  }, "image/png");
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
if (clearCurrentPeriod) {
  clearCurrentPeriod.addEventListener("click", async () => {
    if (!adminMode) return;
    if (!(await ensureSelectedPeriodActive())) return;
    const label = currentPeriodName || currentPeriodId || "当前月份";
    if (!confirm(`确定清空 ${label} 吗？该月份作品、投票和上传文件都会删除。`)) return;
    try {
      const result = await fetchJson("/api/clear-period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminCode: adminCode.value.trim() })
      });
      resultDialogDismissed = false;
      await loadData();
      showToast(`已清空 ${label}：${result.entries || 0} 个作品`);
    } catch (error) {
      alert(error.message);
    }
  });
}
closePreview.addEventListener("click", closePreviewDialog);
previewDialog.addEventListener("close", flushDeferredRender);
previewDialog.addEventListener("click", event => {
  if (event.target === previewDialog) closePreviewDialog();
});
closeResultDialog.addEventListener("click", () => {
  resultDialogDismissed = true;
  resultDialog.close();
});
resultDialog.addEventListener("click", event => {
  if (event.target === resultDialog) {
    resultDialogDismissed = true;
    resultDialog.close();
  }
});
viewerClose.addEventListener("click", () => imageViewer.close());
viewerPrev.addEventListener("click", () => shiftViewer(-1));
viewerNext.addEventListener("click", () => shiftViewer(1));
viewerZoomOut.addEventListener("click", () => changeViewerZoom(-0.25));
viewerZoomIn.addEventListener("click", () => changeViewerZoom(0.25));
viewerFit.addEventListener("click", resetViewerZoom);
imageViewer.addEventListener("close", () => {
  document.documentElement.classList.remove("viewer-open");
  document.body.classList.remove("viewer-open");
  // Clearing the stage removes the <video> element so playback (and its audio
  // / network download) stops immediately — closing the dialog alone doesn't.
  viewerStage.innerHTML = "";
  // Restore the pre-viewer scroll position that overflow:hidden collapsed.
  window.scrollTo({ top: scrollBeforeViewer });
  flushDeferredRender();
});
viewerStage.addEventListener("wheel", event => {
  event.preventDefault();
  changeViewerZoom(event.deltaY > 0 ? -0.15 : 0.15);
});
viewerStage.addEventListener("pointerdown", event => {
  const media = viewerMedia();
  if (!media || media.tagName === "VIDEO" || viewerZoom.scale <= 1) return;
  viewerZoom.dragging = true;
  viewerZoom.startX = event.clientX - viewerZoom.x;
  viewerZoom.startY = event.clientY - viewerZoom.y;
  media.setPointerCapture(event.pointerId);
  media.style.cursor = "grabbing";
});
viewerStage.addEventListener("pointermove", event => {
  if (!viewerZoom.dragging) return;
  viewerZoom.x = event.clientX - viewerZoom.startX;
  viewerZoom.y = event.clientY - viewerZoom.startY;
  applyViewerZoom();
});
viewerStage.addEventListener("pointerup", event => {
  if (!viewerZoom.dragging) return;
  viewerZoom.dragging = false;
  const media = viewerMedia();
  if (media) {
    media.releasePointerCapture(event.pointerId);
    media.style.cursor = viewerZoom.scale > 1 ? "grab" : "default";
  }
});
document.addEventListener("keydown", event => {
  if (imageViewer.open) {
    if (event.key === "ArrowLeft") shiftViewer(-1);
    if (event.key === "ArrowRight") shiftViewer(1);
    if (event.key === "+" || event.key === "=") changeViewerZoom(0.25);
    if (event.key === "-") changeViewerZoom(-0.25);
    if (event.key === "0") resetViewerZoom();
  }
});

bindAdminInfoCards();

loadData().catch(error => {
  gallery.innerHTML = `<div class="empty">${error.message}</div>`;
});
