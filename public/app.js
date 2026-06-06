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
let loggedInName = localStorage.getItem("photoReviewVoter") || "";
let toastTimer = null;
let ballots = [];
let adminBallots = [];
let completedModules = new Set();
let isSubmittingVote = false;
let resultDialogDismissed = false;
const selected = new Map();

const THEME_KEY = "photoReviewTheme";
const UPLOAD_BATCH_SIZE = 12;
let uploadQueue = Promise.resolve();
let uploadQueueLength = 0;
let processingRefreshTimer = null;
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
const voterInput = document.querySelector("#voterName");
const voterLogin = document.querySelector("#voterLogin");
const voterLogout = document.querySelector("#voterLogout");
const voterLoginStatus = document.querySelector("#voterLoginStatus");
const identityBox = document.querySelector(".identity");
const uploadStatus = document.querySelector("#uploadStatus");
const selectedCount = document.querySelector("#selectedCount");
const activeModuleTitle = document.querySelector("#activeModuleTitle");
const submitVote = document.querySelector("#submitVote");
const entryTemplate = document.querySelector("#entryTemplate");
const moduleGrid = document.querySelector("#moduleGrid");
const adminCode = document.querySelector("#adminCode");
const adminToggle = document.querySelector("#adminToggle");
const statusToggle = document.querySelector("#statusToggle");
const publishToggle = document.querySelector("#publishToggle");
const clearCurrentPeriod = document.querySelector("#clearCurrentPeriod");
const adminPanel = document.querySelector("#adminPanel");
const photographerName = document.querySelector("#photographerName");
const addPhotographer = document.querySelector("#addPhotographer");
const photographerAdmin = document.querySelector("#photographerAdmin");
const photographerList = document.querySelector("#photographerList");
const ballotAdmin = document.querySelector("#ballotAdmin");
const ballotList = document.querySelector("#ballotList");
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

function showToast(text) {
  if (!appToast) return;
  window.clearTimeout(toastTimer);
  appToast.textContent = text;
  appToast.hidden = false;
  appToast.classList.add("show");
  toastTimer = window.setTimeout(() => {
    appToast.classList.remove("show");
    appToast.hidden = true;
  }, 2200);
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
    if (text) text.textContent = finalTheme === "dark" ? "浅色" : "深色";
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

function nextPendingModule(fromModuleName) {
  const startIndex = Math.max(0, modules.findIndex(module => module.name === fromModuleName));
  const orderedModules = modules.slice(startIndex + 1).concat(modules.slice(0, startIndex + 1));
  return orderedModules.find(module => hasVotableEntries(module.name) && !completedModules.has(module.name));
}

function updateSelectedCount() {
  selectedCount.textContent = `已选作品 ${activeBucket().size} / ${activeLimit()}`;
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
    .sort((a, b) => b.votes - a.votes || a.sequence - b.sequence);
}

function moduleVoteTotal(moduleName) {
  return moduleResultList(moduleName).reduce((total, entry) => total + entry.votes, 0);
}

function votePercent(entry, totalVotes) {
  if (!totalVotes) return "0%";
  const value = Math.round((entry.votes / totalVotes) * 1000) / 10;
  return `${value}%`;
}

function entryMeta(entry) {
  if (adminMode && entry.title) return `${entry.title} · ${entry.photographer} · 整套作品 · ${mediaText(entry)}`;
  return `匿名作品 · 整套作品 · ${mediaText(entry)}`;
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
  } else {
    photographers = [];
  }
  const query = adminMode ? `?adminCode=${encodeURIComponent(adminCode.value.trim())}` : "";
  const entryData = await fetchJson(`/api/entries${query}`);
  modules = entryData.modules;
  entries = entryData.entries;
  for (const module of modules) {
    if (!selected.has(module.name)) selected.set(module.name, new Set());
  }
  activeModule ||= modules[0];
  const resultData = await fetchJson(`/api/results${query}`);
  results = resultData.results;
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

function renderPeriodAdmin() {
  if (!periodAdmin || !periodSelect || !periodStatus) return;
  periodAdmin.hidden = !adminMode;
  if (!adminMode) return;

  periodSelect.innerHTML = periods.map(period => `
    <option value="${escapeHtml(period.id)}"${period.id === currentPeriodId ? " selected" : ""}>
      ${escapeHtml(period.name || period.id)}
    </option>
  `).join("");
  periodStatus.textContent = `当前：${currentPeriodName || currentPeriodId}`;
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function render() {
  renderWelcome();
  activeModuleTitle.textContent = activeModule.name;
  updateSelectedCount();
  renderStatusControls();
  renderPeriodAdmin();
  renderPhotographerAdmin();
  renderBallotAdmin();
  renderModules();
  renderGallery();
  renderResults();
  openResultDialogIfNeeded();
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
}

function renderStatusControls() {
  adminPanel.classList.toggle("is-active", adminMode);
  document.body.classList.toggle("is-admin", adminMode);
  adminCode.hidden = adminMode;
  statusToggle.hidden = !adminMode;
  statusToggle.textContent = votingOpen ? "恢复上传" : "开始投票";
  publishToggle.hidden = !adminMode;
  publishToggle.disabled = !adminMode;
  publishToggle.textContent = resultsPublished ? "收回结果" : "公布结果";
  if (clearCurrentPeriod) clearCurrentPeriod.hidden = !adminMode;
  submitVote.disabled = !votingOpen || !voterName() || isSubmittingVote;
  submitVote.classList.toggle("is-loading", isSubmittingVote);
  submitVote.textContent = isSubmittingVote ? "提交中..." : "提交本模块投票";
}

function renderModules() {
  const resultCounts = new Map();
  for (const result of results) {
    resultCounts.set(result.moduleName, (resultCounts.get(result.moduleName) || 0) + result.votes);
  }
  const canViewResultCounts = adminMode || resultsPublished;

  moduleGrid.innerHTML = modules.map((module, index) => {
    const count = moduleEntries(module.name).length;
    const picked = selected.get(module.name)?.size || 0;
    const completed = completedModules.has(module.name);
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
        <span class="module-progress">${picked}/${module.voteLimit}</span>
        <span class="module-drop-text">拖入上传</span>
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

    button.addEventListener("drop", async event => {
      const targetModule = modules.find(module => module.name === button.dataset.module);
      try {
        activeModule = targetModule;
        render();
        setStatus(`正在读取 ${targetModule.name} 的作品文件夹...`);
        const files = await collectDroppedFiles(event.dataTransfer);
        enqueueUpload(files, targetModule.name);
      } catch (error) {
        setStatus(error.message || "读取拖拽文件夹失败");
      }
    });
  });
}

function renderGallery() {
  gallery.innerHTML = "";
  const list = moduleEntries(activeModule.name).sort((a, b) => a.sequence - b.sequence);
  const voter = voterName();

  if (!list.length) {
    const message = adminMode
      ? `${currentPeriodName || "当前月份"} 的 ${activeModule.name} 暂无作品。把作品文件夹拖到上方对应模块即可上传。`
      : `${currentPeriodName || "当前月份"} 的 ${activeModule.name} 暂无作品，请等待管理员上传或切换到已公布结果的月份查看。`;
    gallery.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
    return;
  }

  for (const entry of list) {
    const node = entryTemplate.content.firstElementChild.cloneNode(true);
    const isOwn = voter && entry.photographer === voter;
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
    deleteButton.hidden = votingOpen && !adminMode;
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
  previewTitle.textContent = entryTitle(entry);
  previewMeta.textContent = entryMeta(entry);
  mediaPreviewGrid.innerHTML = entry.media.map((item, index) => `
    <button class="media-preview-card${item.processing ? " processing" : ""}" type="button" data-index="${index}">
      ${item.kind === "video"
        ? `<video src="${item.src}" muted preload="metadata"></video>`
        : `<img src="${item.src}" alt="${entryTitle(entry)} 第 ${index + 1} 张">`}
      ${item.processing ? `<span class="media-processing">处理中</span>` : ""}
    </button>
  `).join("");
  mediaPreviewGrid.querySelectorAll(".media-preview-card").forEach(button => {
    button.addEventListener("click", () => openImageViewer(Number(button.dataset.index)));
  });
  previewDialog.showModal();
}

function closePreviewDialog() {
  previewDialog.close();
}

function openImageViewer(index) {
  if (!previewEntry) return;
  viewerIndex = index;
  resetViewerZoom();
  renderImageViewer();
  document.documentElement.classList.add("viewer-open");
  document.body.classList.add("viewer-open");
  imageViewer.showModal();
}

function renderImageViewer() {
  const item = previewEntry.media[viewerIndex];
  viewerTitle.textContent = entryTitle(previewEntry);
  viewerMeta.textContent = `${entryMeta(previewEntry)} · ${viewerIndex + 1}/${previewEntry.media.length}`;
  viewerStage.innerHTML = item.kind === "video"
    ? `<video class="viewer-media" src="${item.src}" controls autoplay></video>`
    : `<img class="viewer-media" src="${item.src}" alt="${entryTitle(previewEntry)} 第 ${viewerIndex + 1} 张">`;
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
      body: JSON.stringify({ entryId: entry.id, adminCode: adminMode ? adminCode.value.trim() : "" })
    });
    activeBucket().delete(entry.id);
    await loadData();
  } catch (error) {
    alert(error.message);
  }
}

function renderResults() {
  const hasResultEntries = results.some(entry => entry.mediaCount > 0 || entry.votes > 0 || entry.sku);
  const canViewResults = adminMode || (resultsPublished && hasResultEntries);
  if (resultsPanel) resultsPanel.hidden = !canViewResults;
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
              <span>${entry.votes} 票</span>
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
              <strong><span>${entry.votes} 票</span><small>${votePercent(entry, totalVotes)}</small></strong>
            </div>
          `).join("")}
        </details>
      `
      : "";
    return `
      <section class="result-module">
        <h3>${module.name}<span>获奖 ${awardLimit} 名 · ${resultsPublished ? "已公布" : "预览"}</span></h3>
        <div class="winner-grid">${awardRows}</div>
        ${otherRows}
      </section>
    `;
  }).join("");
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
          <strong><span>${entry.votes} 票</span><small>${votePercent(entry, totalVotes)}</small></strong>
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
  const mediaFiles = files.filter(file => mediaPattern.test(file.name));
  if (!mediaFiles.length) {
    setStatus("文件夹里没有可识别的图片或视频");
    return;
  }
  const batches = chunkArray(mediaFiles, UPLOAD_BATCH_SIZE);
  let uploadedFiles = 0;
  let totalMedia = 0;
  setStatus(`正在上传到 ${moduleName}：共 ${mediaFiles.length} 个媒体文件，分 ${batches.length} 批处理...`);
  try {
    for (const [batchIndex, batch] of batches.entries()) {
      const batchNo = batchIndex + 1;
      const formData = new FormData();
      formData.append("moduleName", moduleName);
      batch.forEach(file => {
        const relativePath = file.relativePath || file.webkitRelativePath || file.name;
        formData.append("files", file, relativePath);
      });
      setStatus(`正在上传到 ${moduleName}：第 ${batchNo}/${batches.length} 批正在上传并生成展示版...`);
      const result = await fetchJson("/api/upload", {
        method: "POST",
        body: formData
      });
      uploadedFiles += batch.length;
      totalMedia += result.media || 0;
      setStatus(`正在上传到 ${moduleName}：已完成 ${uploadedFiles}/${mediaFiles.length} 个文件，继续处理...`);
    }
    setStatus(`${moduleName} 上传完成：已处理 ${totalMedia} 个媒体文件，作品列表已刷新。`);
    await loadData();
  } catch (error) {
    setStatus(error.message);
  }
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
    showToast(`${submittedModuleName} 已投完，正在整理下一项...`);
    await loadData();
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
    showToast("全部投票完成，感谢参与评优");
    welcomePanel.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  window.setTimeout(() => {
    activeModule = nextModule;
    render();
    showToast(`进入 ${nextModule.name}，继续投票`);
    gallery.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 1000);
}

async function updatePeriod(action) {
  if (!adminMode) {
    alert("请先打开管理员后台");
    return;
  }
  const payload = { adminCode: adminCode.value.trim(), action };
  if (action === "switch") payload.periodId = periodSelect.value;
  if (action === "createNext" && !confirm("确定新建下月评优并切换过去吗？新月份会从空作品开始，历史月份仍可切回查看。")) return;

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

async function ensureSelectedPeriodActive() {
  if (!adminMode || !periodSelect || !periodSelect.value || periodSelect.value === currentPeriodId) return true;
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
addPhotographer.addEventListener("click", () => updatePhotographer("add"));
if (periodSelect) {
  periodSelect.addEventListener("change", () => {
    if (adminMode) updatePeriod("switch");
  });
}
if (createNextPeriod) createNextPeriod.addEventListener("click", () => updatePeriod("createNext"));
photographerName.addEventListener("keydown", event => {
  if (event.key === "Enter") updatePhotographer("add");
});
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
  const message = next ? "确定开始投票吗？开始后普通用户不能删除作品。" : "确定恢复上传阶段吗？恢复后普通用户可以删除误传作品。";
  if (!confirm(message)) return;
  try {
    await fetchJson("/api/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminCode: adminCode.value.trim(), votingOpen: next })
    });
    await loadData();
  } catch (error) {
    alert(error.message);
  }
});
publishToggle.addEventListener("click", async () => {
  if (!adminMode) return;
  if (!(await ensureSelectedPeriodActive())) return;
  const next = !resultsPublished;
  const message = next ? "确定公布最终结果吗？公布后摄影师可以看到各模块排名。" : "确定收回最终结果吗？收回后普通摄影师将看不到排名。";
  if (!confirm(message)) return;
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

loadData().catch(error => {
  gallery.innerHTML = `<div class="empty">${error.message}</div>`;
});
