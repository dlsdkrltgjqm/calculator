// ===== 요소 참조 =====
const expressionEl = document.getElementById("expression");
const resultEl = document.getElementById("result");
const historyListEl = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistory");
const deleteSelectedBtn = document.getElementById("deleteSelected");
const assignProjectBtn = document.getElementById("assignProject");

const assignPanel = document.getElementById("assignPanel");
const assignSelect = document.getElementById("assignSelect");
const assignNewTitle = document.getElementById("assignNewTitle");
const assignConfirm = document.getElementById("assignConfirm");
const assignCancel = document.getElementById("assignCancel");

const projectListEl = document.getElementById("projectList");
const projectDetailEl = document.getElementById("projectDetail");
const newProjectBtn = document.getElementById("newProjectBtn");
const newProjectPanel = document.getElementById("newProjectPanel");
const newProjectTitle = document.getElementById("newProjectTitle");
const createProjectBtn = document.getElementById("createProject");
const cancelProjectBtn = document.getElementById("cancelProject");
const tabButtons = document.querySelectorAll(".tab");

// ===== 상태 =====
const HIST_KEY = "calc-history";
const PROJ_KEY = "calc-projects";

let current = "";                 // 계산기 입력 수식
let history = [];                 // 계산 내역 (init()에서 DB로부터 로드)
let projects = [];                // 프로젝트 목록 (init()에서 DB로부터 로드)
const selected = new Set();       // 선택된 계산 내역 id
let editingId = null;             // 메모 편집 중인 내역 id
let editingUrlId = null;          // 편집 중인 URL id (프로젝트/내역 공용)
let urlAddingId = null;           // URL 추가 폼이 열린 계산 내역 id
let selectedProjectId = null;     // 상세 보기 중인 프로젝트 id
let activeView = "calc";          // 'calc' | 'projects'

const DISPLAY = { "*": "×", "/": "÷", "-": "−", "+": "+" };

// ===== 공용 유틸 =====
function genId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 안전한 http(s) 링크만 반환, 그 외엔 null
function safeHref(url) {
  const u = String(url || "").trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(u)) return "https://" + u;
  return null;
}

function btn(text, cls, onClick) {
  const b = document.createElement("button");
  b.textContent = text;
  if (cls) b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

function makeInput(cls, placeholder, value) {
  const i = document.createElement("input");
  i.className = cls;
  i.placeholder = placeholder;
  if (value != null) i.value = value;
  return i;
}

// ===== 계산기 로직 =====
function toDisplay(expr) {
  return expr.replace(/[*/\-+]/g, (m) => DISPLAY[m] || m);
}

function tryEvaluate(expr) {
  if (!expr) return null;
  if (!/^[0-9+\-*/.%\s]+$/.test(expr)) return null;
  try {
    const safe = expr.replace(/%/g, "/100");
    const value = Function("return (" + safe + ")")();
    if (typeof value !== "number" || !isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
}

function formatNumber(n) {
  const rounded = Math.round((n + Number.EPSILON) * 1e10) / 1e10;
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 10 });
}

function updateDisplay() {
  expressionEl.textContent = toDisplay(current);
  const preview = tryEvaluate(current);
  resultEl.textContent = preview !== null ? formatNumber(preview) : (current || "0");
}

function inputValue(value) {
  const operators = ["+", "-", "*", "/"];
  const last = current.slice(-1);
  if (operators.includes(value)) {
    if (current === "") {
      if (value === "-") current = "-";
      return updateDisplay();
    }
    if (operators.includes(last)) current = current.slice(0, -1) + value;
    else current += value;
  } else {
    current += value;
  }
  updateDisplay();
}

function clearAll() { current = ""; updateDisplay(); }
function backspace() { current = current.slice(0, -1); updateDisplay(); }

function equals() {
  const value = tryEvaluate(current);
  if (value === null || current === "") return;
  addHistory({
    id: genId(),
    expr: toDisplay(current),
    result: formatNumber(value),
    note: "",
    urls: [],
    projectId: null,
    time: Date.now(),
  });
  current = String(value);
  updateDisplay();
}

// ===== 저장소 (IndexedDB, localStorage 폴백) =====
const DB_NAME = "calcAppDB";
const DB_VERSION = 1;
const STORE_HISTORY = "history";
const STORE_PROJECTS = "projects";
let db = null; // IndexedDB 핸들 (사용 불가 시 null → localStorage 폴백)

// --- 정규화(저장된 데이터 호환) ---
function normalizeHistory(list) {
  return (Array.isArray(list) ? list : [])
    .map((h) => ({
      id: h.id || genId(),
      expr: h.expr,
      result: h.result,
      note: h.note || "",
      urls: Array.isArray(h.urls)
        ? h.urls.map((u) => ({ id: u.id || genId(), label: u.label || "", url: u.url || "" }))
        : [],
      projectId: h.projectId || null,
      time: h.time || Date.now(),
    }))
    .sort((a, b) => b.time - a.time); // 최신순
}

function normalizeProjects(list) {
  return (Array.isArray(list) ? list : [])
    .map((p) => ({
      id: p.id || genId(),
      title: p.title || "제목 없음",
      time: p.time || Date.now(),
    }))
    .sort((a, b) => b.time - a.time); // 최신순
}

// --- IndexedDB 헬퍼 ---
function openDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB 미지원"));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_HISTORY)) d.createObjectStore(STORE_HISTORY, { keyPath: "id" });
      if (!d.objectStoreNames.contains(STORE_PROJECTS)) d.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll(store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// 스토어를 현재 메모리 배열로 통째로 교체 (전체 clear 후 put)
function dbReplaceAll(store, records) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    os.clear();
    records.forEach((r) => os.put(r));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- localStorage 폴백 ---
function readLocal(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}

function saveHistory() {
  if (db) {
    dbReplaceAll(STORE_HISTORY, history).catch((e) => console.warn("history 저장 실패", e));
  } else {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(history)); } catch {}
  }
}

function saveProjects() {
  if (db) {
    dbReplaceAll(STORE_PROJECTS, projects).catch((e) => console.warn("projects 저장 실패", e));
  } else {
    try { localStorage.setItem(PROJ_KEY, JSON.stringify(projects)); } catch {}
  }
}

// ===== 계산 내역 조작 =====
function findEntry(id) { return history.find((h) => h.id === id); }

function addHistory(entry) {
  history.unshift(entry);
  if (history.length > 200) history.pop();
  saveHistory();
  refreshAll();
}

function deleteSelected() {
  if (selected.size === 0) return;
  history = history.filter((h) => !selected.has(h.id));
  selected.clear();
  if (editingId && !findEntry(editingId)) editingId = null;
  saveHistory();
  refreshAll();
}

function clearHistory() {
  history = [];
  editingId = null;
  selected.clear();
  saveHistory();
  refreshAll();
}

// ===== 메모 =====
function saveNote(id, text) {
  const e = findEntry(id);
  if (!e) return;
  e.note = text.trim();
  editingId = null;
  saveHistory();
  refreshAll();
}

function deleteNote(id) {
  const e = findEntry(id);
  if (!e) return;
  e.note = "";
  saveHistory();
  refreshAll();
}

// 메모 표시/편집 UI를 container 에 덧붙임 (계산기 뷰·프로젝트 뷰 공용)
function appendMemoUI(container, h) {
  if (editingId === h.id) {
    const box = document.createElement("div");
    box.className = "note-edit";
    const input = document.createElement("textarea");
    input.className = "note-input";
    input.rows = 2;
    input.placeholder = "메모를 입력하세요";
    input.value = h.note || "";
    const actions = document.createElement("div");
    actions.className = "note-edit-actions";
    actions.append(
      btn("저장", "note-save", () => saveNote(h.id, input.value)),
      btn("취소", "note-cancel", () => { editingId = null; refreshAll(); })
    );
    box.append(input, actions);
    container.appendChild(box);
    setTimeout(() => input.focus(), 0);
  } else {
    if (h.note) {
      const note = document.createElement("div");
      note.className = "h-note";
      note.textContent = h.note;
      container.appendChild(note);
    }
    const actions = document.createElement("div");
    actions.className = "h-actions";
    actions.appendChild(
      btn(h.note ? "메모 수정" : "메모 추가", "note-btn", () => { editingId = h.id; refreshAll(); })
    );
    if (h.note) actions.appendChild(btn("메모 삭제", "note-del", () => deleteNote(h.id)));
    container.appendChild(actions);
  }
}

// ===== 계산 내역별 URL =====
function addEntryUrl(entryId, label, url) {
  const e = findEntry(entryId);
  if (!e) return;
  if (!Array.isArray(e.urls)) e.urls = [];
  e.urls.push({ id: genId(), label, url });
  urlAddingId = null;
  editingUrlId = null;
  saveHistory();
  refreshAll();
}

function updateEntryUrl(entryId, uid, label, url) {
  const e = findEntry(entryId);
  if (!e) return;
  const u = (e.urls || []).find((x) => x.id === uid);
  if (u) { u.label = label; u.url = url; }
  editingUrlId = null;
  saveHistory();
  refreshAll();
}

function deleteEntryUrl(entryId, uid) {
  const e = findEntry(entryId);
  if (!e) return;
  e.urls = (e.urls || []).filter((x) => x.id !== uid);
  if (editingUrlId === uid) editingUrlId = null;
  saveHistory();
  refreshAll();
}

// 계산 내역 항목의 URL 목록/추가/수정/삭제 UI (계산기 뷰·프로젝트 뷰 공용)
function appendUrlUI(container, h) {
  const wrap = document.createElement("div");
  wrap.className = "entry-urls";
  const urls = h.urls || [];

  urls.forEach((u) => {
    const row = document.createElement("div");
    row.className = "url-row";
    if (editingUrlId === u.id) {
      const labelI = makeInput("url-label-input", "이름 (선택)", u.label || "");
      const urlI = makeInput("url-input", "https://...", u.url || "");
      const acts = document.createElement("div");
      acts.className = "url-edit-actions";
      acts.append(
        btn("저장", "note-save", () => { if (urlI.value.trim()) updateEntryUrl(h.id, u.id, labelI.value.trim(), urlI.value.trim()); }),
        btn("취소", "note-cancel", () => { editingUrlId = null; refreshAll(); })
      );
      row.append(labelI, urlI, acts);
    } else {
      const href = safeHref(u.url);
      const link = document.createElement(href ? "a" : "span");
      if (href) { link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer"; }
      link.className = "url-link";
      link.textContent = u.label ? `${u.label} — ${u.url}` : u.url;
      const acts = document.createElement("div");
      acts.className = "url-actions";
      acts.append(
        btn("수정", "url-edit", () => { editingUrlId = u.id; urlAddingId = null; refreshAll(); }),
        btn("삭제", "url-del", () => deleteEntryUrl(h.id, u.id))
      );
      row.append(link, acts);
    }
    wrap.appendChild(row);
  });

  if (urlAddingId === h.id) {
    const row = document.createElement("div");
    row.className = "url-add entry-url-add";
    const labelI = makeInput("url-label-input", "이름 (선택)", "");
    const urlI = makeInput("url-input", "https://...", "");
    const submit = () => { const v = urlI.value.trim(); if (!v) return; addEntryUrl(h.id, labelI.value.trim(), v); };
    urlI.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    const acts = document.createElement("div");
    acts.className = "url-edit-actions";
    acts.append(
      btn("추가", "note-save", submit),
      btn("취소", "note-cancel", () => { urlAddingId = null; refreshAll(); })
    );
    row.append(labelI, urlI, acts);
    wrap.appendChild(row);
    setTimeout(() => urlI.focus(), 0);
  } else {
    wrap.appendChild(
      btn(urls.length ? "+ URL 추가" : "URL 추가", "url-add-btn", () => { urlAddingId = h.id; editingUrlId = null; refreshAll(); })
    );
  }

  container.appendChild(wrap);
}

// ===== 프로젝트 조작 =====
function findProject(id) { return projects.find((p) => p.id === id); }

function addProject(title) {
  const p = { id: genId(), title, urls: [], time: Date.now() };
  projects.unshift(p);
  saveProjects();
  return p;
}

function renameProject(id, title) {
  const p = findProject(id);
  if (!p) return;
  p.title = title;
  saveProjects();
  refreshAll();
}

function deleteProject(id) {
  projects = projects.filter((p) => p.id !== id);
  history.forEach((h) => { if (h.projectId === id) h.projectId = null; });
  if (selectedProjectId === id) selectedProjectId = null;
  saveProjects();
  saveHistory();
  refreshAll();
}

function assignEntries(projectId, ids) {
  ids.forEach((id) => { const e = findEntry(id); if (e) e.projectId = projectId; });
  saveHistory();
}

function unassignEntry(id) {
  const e = findEntry(id);
  if (!e) return;
  e.projectId = null;
  saveHistory();
  refreshAll();
}

// ===== 렌더링 =====
function refreshAll() {
  renderHistory();
  renderProjects();
  renderProjectDetail();
}

function updateSelectUI() {
  const count = selected.size;
  deleteSelectedBtn.disabled = count === 0;
  assignProjectBtn.disabled = count === 0;
  deleteSelectedBtn.textContent = count > 0 ? `선택 삭제 (${count})` : "선택 삭제";
  assignProjectBtn.textContent = count > 0 ? `프로젝트에 추가 (${count})` : "프로젝트에 추가";
}

function renderHistory() {
  const ids = new Set(history.map((h) => h.id));
  [...selected].forEach((id) => { if (!ids.has(id)) selected.delete(id); });

  historyListEl.innerHTML = "";
  if (history.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "아직 계산 내역이 없습니다.";
    historyListEl.appendChild(li);
    updateSelectUI();
    return;
  }

  history.forEach((h) => {
    const li = document.createElement("li");
    li.dataset.id = h.id;

    const row = document.createElement("div");
    row.className = "h-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "h-check";
    checkbox.checked = selected.has(h.id);
    checkbox.title = "선택";
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selected.add(h.id); else selected.delete(h.id);
      updateSelectUI();
    });
    row.appendChild(checkbox);

    const main = document.createElement("div");
    main.className = "h-main";
    main.innerHTML = `<div class="h-expr">${escapeHtml(h.expr)} =</div><div class="h-res">${escapeHtml(h.result)}</div>`;
    const proj = h.projectId ? findProject(h.projectId) : null;
    if (proj) {
      const badge = document.createElement("span");
      badge.className = "h-proj";
      badge.textContent = "📁 " + proj.title;
      main.appendChild(badge);
    }
    main.title = "클릭하면 결과를 다시 불러옵니다";
    main.addEventListener("click", () => { current = h.result.replace(/,/g, ""); updateDisplay(); });
    row.appendChild(main);
    li.appendChild(row);

    appendMemoUI(li, h);
    appendUrlUI(li, h);
    historyListEl.appendChild(li);
  });

  updateSelectUI();
}

function renderProjects() {
  if (!projectListEl) return;
  projectListEl.innerHTML = "";
  if (projects.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "저장된 프로젝트가 없습니다.";
    projectListEl.appendChild(li);
    return;
  }
  projects.forEach((p) => {
    const count = history.filter((h) => h.projectId === p.id).length;
    const li = document.createElement("li");
    li.className = "project-item" + (p.id === selectedProjectId ? " active" : "");
    li.innerHTML =
      `<span class="p-title">${escapeHtml(p.title)}</span>` +
      `<span class="p-count">계산 ${count}건</span>`;
    li.addEventListener("click", () => { selectedProjectId = p.id; refreshAll(); });
    projectListEl.appendChild(li);
  });
}

function renderProjectDetail() {
  if (!projectDetailEl) return;
  projectDetailEl.innerHTML = "";
  const p = findProject(selectedProjectId);
  if (!p) {
    const d = document.createElement("p");
    d.className = "empty";
    d.textContent = "프로젝트를 선택하세요.";
    projectDetailEl.appendChild(d);
    return;
  }

  // --- 헤더: 제목 편집 + 삭제 ---
  const header = document.createElement("div");
  header.className = "pd-header";
  const titleInput = document.createElement("input");
  titleInput.className = "pd-title";
  titleInput.value = p.title;
  titleInput.addEventListener("blur", () => {
    const v = titleInput.value.trim();
    if (v) renameProject(p.id, v); else titleInput.value = p.title;
  });
  titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter") titleInput.blur(); });
  const delProjBtn = btn("프로젝트 삭제", "pd-delete", () => {
    if (confirm("이 프로젝트를 삭제할까요? 담긴 계산 내역은 삭제되지 않고 '미지정'으로 돌아갑니다.")) deleteProject(p.id);
  });
  header.append(titleInput, delProjBtn);
  projectDetailEl.appendChild(header);

  // --- 계산 내역 섹션 (메모 수정 가능) ---
  const entries = history.filter((h) => h.projectId === p.id);
  const sec1 = document.createElement("div");
  sec1.className = "pd-section";
  const h3a = document.createElement("h3");
  h3a.textContent = `계산 내역 (${entries.length})`;
  sec1.appendChild(h3a);
  if (entries.length === 0) {
    const e = document.createElement("p");
    e.className = "pd-empty";
    e.textContent = "담긴 계산 내역이 없습니다. 계산기 탭에서 내역을 선택해 추가하세요.";
    sec1.appendChild(e);
  } else {
    entries.forEach((h) => {
      const card = document.createElement("div");
      card.className = "pd-entry";
      const top = document.createElement("div");
      top.className = "pd-entry-top";
      const info = document.createElement("div");
      info.innerHTML = `<div class="h-expr">${escapeHtml(h.expr)} =</div><div class="h-res">${escapeHtml(h.result)}</div>`;
      top.append(info, btn("제거", "pd-remove", () => unassignEntry(h.id)));
      card.appendChild(top);
      appendMemoUI(card, h);
      appendUrlUI(card, h);
      sec1.appendChild(card);
    });
  }
  projectDetailEl.appendChild(sec1);
}

// ===== 프로젝트 담기 패널 =====
function openAssignPanel() {
  if (selected.size === 0) return;
  assignSelect.innerHTML = "";
  const optNew = document.createElement("option");
  optNew.value = "__new__";
  optNew.textContent = "+ 새 프로젝트 만들기";
  assignSelect.appendChild(optNew);
  projects.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.title;
    assignSelect.appendChild(o);
  });
  assignSelect.value = projects.length ? projects[0].id : "__new__";
  assignNewTitle.value = "";
  toggleNewTitle();
  assignPanel.hidden = false;
}

function toggleNewTitle() {
  assignNewTitle.hidden = assignSelect.value !== "__new__";
}

// ===== 뷰 전환 =====
function switchView(view) {
  activeView = view;
  tabButtons.forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  document.getElementById("view-calc").classList.toggle("active", view === "calc");
  document.getElementById("view-projects").classList.toggle("active", view === "projects");
  refreshAll();
}

// ===== 이벤트 바인딩 =====
document.querySelectorAll(".key").forEach((b) => {
  b.addEventListener("click", () => {
    const action = b.dataset.action;
    const value = b.dataset.value;
    if (action === "clear") return clearAll();
    if (action === "back") return backspace();
    if (action === "equals") return equals();
    if (value !== undefined) inputValue(value);
  });
});

clearHistoryBtn.addEventListener("click", clearHistory);
deleteSelectedBtn.addEventListener("click", deleteSelected);
assignProjectBtn.addEventListener("click", () => {
  if (assignPanel.hidden) openAssignPanel(); else assignPanel.hidden = true;
});
assignSelect.addEventListener("change", toggleNewTitle);
assignCancel.addEventListener("click", () => { assignPanel.hidden = true; });
assignConfirm.addEventListener("click", () => {
  let pid;
  if (assignSelect.value === "__new__") {
    const t = assignNewTitle.value.trim();
    if (!t) { assignNewTitle.focus(); return; }
    pid = addProject(t).id;
  } else {
    pid = assignSelect.value;
  }
  assignEntries(pid, [...selected]);
  selected.clear();
  assignPanel.hidden = true;
  selectedProjectId = pid;
  switchView("projects");
});

newProjectBtn.addEventListener("click", () => {
  newProjectPanel.hidden = !newProjectPanel.hidden;
  if (!newProjectPanel.hidden) { newProjectTitle.value = ""; newProjectTitle.focus(); }
});
cancelProjectBtn.addEventListener("click", () => { newProjectPanel.hidden = true; });
createProjectBtn.addEventListener("click", () => {
  const t = newProjectTitle.value.trim();
  if (!t) { newProjectTitle.focus(); return; }
  const p = addProject(t);
  newProjectTitle.value = "";
  newProjectPanel.hidden = true;
  selectedProjectId = p.id;
  refreshAll();
});
newProjectTitle.addEventListener("keydown", (e) => { if (e.key === "Enter") createProjectBtn.click(); });

tabButtons.forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));

// 키보드 입력 (계산기 뷰에서, 입력칸에 포커스가 없을 때만)
document.addEventListener("keydown", (e) => {
  if (activeView !== "calc") return;
  if (e.target.closest("input, textarea, select")) return;
  const k = e.key;
  if (/[0-9.]/.test(k)) inputValue(k);
  else if (["+", "-", "*", "/", "%"].includes(k)) inputValue(k);
  else if (k === "Enter" || k === "=") { e.preventDefault(); equals(); }
  else if (k === "Backspace") backspace();
  else if (k === "Escape") clearAll();
});

// ===== 초기화 (DB 열기 → 마이그레이션 → 로드 → 렌더) =====
async function init() {
  try {
    db = await openDB();
    let h = await dbGetAll(STORE_HISTORY);
    let p = await dbGetAll(STORE_PROJECTS);

    // DB가 비어 있고 기존 localStorage 데이터가 있으면 1회 이전
    if (h.length === 0 && p.length === 0) {
      const lh = readLocal(HIST_KEY);
      const lp = readLocal(PROJ_KEY);
      if (lh.length || lp.length) {
        h = normalizeHistory(lh);
        p = normalizeProjects(lp);
        await dbReplaceAll(STORE_HISTORY, h);
        await dbReplaceAll(STORE_PROJECTS, p);
      }
    }

    history = normalizeHistory(h);
    projects = normalizeProjects(p);
  } catch (err) {
    // IndexedDB 사용 불가 → localStorage 폴백
    console.warn("IndexedDB 사용 불가, localStorage로 폴백합니다.", err);
    db = null;
    history = normalizeHistory(readLocal(HIST_KEY));
    projects = normalizeProjects(readLocal(PROJ_KEY));
  }

  updateDisplay();
  refreshAll();
}

init();

// ===== PWA 서비스 워커 등록 (홈화면 설치·오프라인) =====
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW 등록 실패", e));
  });
}
