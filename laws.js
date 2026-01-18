// ==============================
// LAWS.JS – Public tra cứu văn bản
// - Sidebar phân loại (mục lớn + count)
// - Search + filter ngày ban hành + tình trạng + mục con
// - Hover xem trước
// - Phân trang + "Tải thêm" (kèm auto load khi cuộn gần cuối)
// ==============================

// API
const API_DOCS = "/api/docs";
const API_STATS = "/api/docs/stats/categories";

// State
let selectedMajor = ""; // mục lớn
let selectedMinor = ""; // mục con
let cachedCategoryStats = []; // cache sidebar để highlight active nhanh
let page = 1;
const limit = 20;
let total = 0;
let isLoading = false;
let noMore = false;

// DOM
const categoryListEl = document.getElementById("categoryList");
const docsListEl = document.getElementById("docsList");
const resultStatsEl = document.getElementById("resultStats");
const loadMoreWrapEl = document.getElementById("loadMoreWrap");
const loadMoreBtn = document.getElementById("loadMoreBtn");
const emptyStateEl = document.getElementById("emptyState");

const searchInput = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");
const minorFilter = document.getElementById("minorFilter");
const fromDate = document.getElementById("fromDate");
const toDate = document.getElementById("toDate");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const refreshBtn = document.getElementById("refreshBtn");

const tooltipEl = document.getElementById("hoverTooltip");
let tooltipActive = false;

function escapeHtml(str) {
  // ✅ Không dùng replaceAll để tránh lỗi trên một số trình duyệt cũ
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function shortText(text, max = 180) {
  if (!text) return "";
  const t = String(text).trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("vi-VN");
}

function buildQuery() {
  const qs = new URLSearchParams();
  const q = (searchInput.value || "").trim();
  if (q) qs.set("search", q);
  if (selectedMajor) qs.set("categoryMajor", selectedMajor);
  if (selectedMinor) qs.set("categoryMinor", selectedMinor);
  const st = (statusFilter.value || "").trim();
  if (st) qs.set("status", st);

  const f = fromDate.value;
  const t = toDate.value;
  if (f) qs.set("from", f);
  if (t) qs.set("to", t);

  qs.set("page", String(page));
  qs.set("limit", String(limit));
  return qs;
}

function setLoading(loading) {
  isLoading = loading;
  if (resultStatsEl) {
    resultStatsEl.classList.toggle("loading", loading);
  }
  if (loadMoreBtn) {
    loadMoreBtn.disabled = loading;
    loadMoreBtn.textContent = loading ? "Đang tải..." : "Tải thêm";
  }
}

function showEmptyState(show) {
  if (!emptyStateEl) return;
  emptyStateEl.style.display = show ? "block" : "none";
}

function showLoadMore(show) {
  if (!loadMoreWrapEl) return;
  loadMoreWrapEl.style.display = show ? "flex" : "none";
}

function clearDocsList() {
  if (docsListEl) docsListEl.innerHTML = "";
}

function renderStats() {
  if (!resultStatsEl) return;
  const shown = docsListEl ? docsListEl.querySelectorAll(".doc-item").length : 0;

  const majorLabel = selectedMajor ? selectedMajor : "Tất cả";
  const minorLabel = selectedMinor ? selectedMinor : "(mọi mục con)";

  const st = statusFilter.value ? ` · ${statusFilter.value}` : "";
  const fd = fromDate.value ? ` · Từ ${fromDate.value}` : "";
  const td = toDate.value ? ` · Đến ${toDate.value}` : "";

  const totalTxt = typeof total === "number" ? total : 0;
  resultStatsEl.innerHTML = `
    <div><b>${escapeHtml(majorLabel)}</b> <span style="color:#6b7280;">${escapeHtml(minorLabel)}${escapeHtml(st)}${escapeHtml(fd)}${escapeHtml(td)}</span></div>
    <div style="font-size:12px; color:#6b7280; margin-top:4px;">Đang hiển thị <b>${shown}</b> / <b>${totalTxt}</b> văn bản</div>
  `;
}

function badgeClassByStatus(status) {
  const s = String(status || "").trim();
  if (s === "Còn hiệu lực") return "status-ok";
  if (s === "Hết hiệu lực") return "status-expired";
  return "status-unknown";
}

function renderDocItem(doc) {
  const el = document.createElement("div");
  el.className = "doc-item";

  const title = escapeHtml(doc.title || "(Không tiêu đề)");
  const soHieu = escapeHtml(doc.soHieu || "");
  const loai = escapeHtml(doc.loaiVanBan || "");
  const cq = escapeHtml(doc.coQuanBanHanh || "");
  const major = escapeHtml(doc.categoryMajor || "Khác");
  const minor = escapeHtml(doc.categoryMinor || "");
  const tinhTrang = escapeHtml(doc.tinhTrang || "Không xác định");
  const ngayBH = fmtDate(doc.ngayBanHanh);

  const preview = shortText(doc.trichYeu || doc.textPreview || "", 320);
  const hoverPreview = shortText(doc.textPreview || doc.trichYeu || "", 600);

  const downloadUrl = doc._id ? `${API_DOCS}/${doc._id}/download` : "#";
  const viewUrl = doc.slug ? `doc.html?slug=${encodeURIComponent(doc.slug)}&v=${encodeURIComponent(window.CHATIIP_VERSION||'')}` : "#";
  const outlineUrl = doc.slug ? `doc.html?slug=${encodeURIComponent(doc.slug)}&tab=outline&v=${encodeURIComponent(window.CHATIIP_VERSION||'')}` : "#";

  el.setAttribute("data-preview", hoverPreview);

  el.innerHTML = `
    <div class="doc-main">
      <div class="doc-title">${title}</div>
      <div class="doc-meta">
        <span class="doc-badge ${badgeClassByStatus(doc.tinhTrang)}">${tinhTrang}</span>
        ${soHieu ? `<span class="doc-chip">Số hiệu: <b>${soHieu}</b></span>` : ""}
        ${loai ? `<span class="doc-chip">${loai}</span>` : ""}
        ${cq ? `<span class="doc-chip">${cq}</span>` : ""}
        <span class="doc-chip">${major}${minor ? ` / ${minor}` : ""}</span>
        ${ngayBH ? `<span class="doc-chip">Ban hành: ${escapeHtml(ngayBH)}</span>` : ""}
      </div>
      ${preview ? `<div class="doc-preview">${escapeHtml(preview)}</div>` : ""}
    </div>

    <div class="doc-actions">
      <a class="doc-action" href="${viewUrl}"><i class="fa-regular fa-eye"></i> Xem</a>
      <a class="doc-action" href="${outlineUrl}"><i class="fa-solid fa-diagram-project"></i> Lược đồ</a>
      <a class="doc-action" href="${downloadUrl}" target="_blank" rel="noopener"><i class="fa-solid fa-download"></i> Tải về</a>
    </div>
  `;

  // Click vào phần nội dung -> xem chi tiết
  el.querySelector(".doc-main")?.addEventListener("click", () => {
    if (viewUrl !== "#") window.location.href = viewUrl;
  });

  // Hover preview
  el.addEventListener("mouseenter", (e) => {
    const p = el.getAttribute("data-preview") || "";
    if (!p) return;
    showTooltip(p, e);
  });
  el.addEventListener("mousemove", (e) => {
    if (!tooltipActive) return;
    positionTooltip(e);
  });
  el.addEventListener("mouseleave", () => {
    hideTooltip();
  });

  return el;
}

function showTooltip(text, mouseEvent) {
  if (!tooltipEl) return;
  const t = String(text || "").trim();
  if (!t) return;
  tooltipEl.innerHTML = escapeHtml(t);
  tooltipEl.setAttribute("aria-hidden", "false");
  tooltipEl.style.opacity = "1";
  tooltipEl.style.transform = "translateY(0px)";
  tooltipActive = true;
  positionTooltip(mouseEvent);
}

function positionTooltip(mouseEvent) {
  if (!tooltipEl || !mouseEvent) return;
  const padding = 14;
  const x = mouseEvent.clientX + padding;
  const y = mouseEvent.clientY + padding;

  // Giới hạn trong viewport
  const rect = tooltipEl.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + rect.width > window.innerWidth - 10) {
    left = window.innerWidth - rect.width - 10;
  }
  if (top + rect.height > window.innerHeight - 10) {
    top = window.innerHeight - rect.height - 10;
  }
  tooltipEl.style.left = `${Math.max(10, left)}px`;
  tooltipEl.style.top = `${Math.max(10, top)}px`;
}

function hideTooltip() {
  if (!tooltipEl) return;
  tooltipEl.setAttribute("aria-hidden", "true");
  tooltipEl.style.opacity = "0";
  tooltipEl.style.transform = "translateY(6px)";
  tooltipActive = false;
}

async function fetchCategoriesStats() {
  try {
    const res = await fetch(API_STATS);
    if (!res.ok) throw new Error("Không tải được phân loại");
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data;
  } catch (e) {
    console.error("fetchCategoriesStats error:", e);
    return [];
  }
}

function renderCategories(list) {
  if (!categoryListEl) return;
  categoryListEl.innerHTML = "";

  const totalCount = (list || []).reduce((sum, x) => sum + Number(x.count || 0), 0);

  // Item "Tất cả"
  const allItem = document.createElement("div");
  allItem.className = `category-item ${selectedMajor === "" ? "active" : ""}`;
  allItem.innerHTML = `
    <div class="category-name">
      <div class="title">Tất cả</div>
      <div class="sub">Hiển thị toàn bộ văn bản</div>
    </div>
    <div class="category-count">${totalCount}</div>
  `;
  allItem.addEventListener("click", () => {
    selectMajor("");
  });
  categoryListEl.appendChild(allItem);

  (list || []).forEach((x) => {
    const major = (x && x.categoryMajor) ? String(x.categoryMajor) : "Khác";
    const count = Number(x.count || 0);

    const item = document.createElement("div");
    item.className = `category-item ${selectedMajor === major ? "active" : ""}`;
    item.innerHTML = `
      <div class="category-name">
        <div class="title">${escapeHtml(major)}</div>
        <div class="sub">Nhấn để lọc</div>
      </div>
      <div class="category-count">${count}</div>
    `;
    item.addEventListener("click", () => {
      selectMajor(major);
    });
    categoryListEl.appendChild(item);
  });
}

async function loadMinorOptionsForMajor(major) {
  // Reset
  if (!minorFilter) return;
  minorFilter.innerHTML = `<option value="">Mục con: Tất cả</option>`;

  if (!major) {
    selectedMinor = "";
    minorFilter.value = "";
    minorFilter.disabled = true;
    return;
  }

  minorFilter.disabled = false;

  // Lấy danh sách mục con bằng cách quét vài trang (limit backend tối đa 100)
  const uniq = new Set();
  let p = 1;
  let scanned = 0;
  const MAX_PAGES = 5; // giới hạn để tránh fetch quá nhiều

  while (p <= MAX_PAGES) {
    const qs = new URLSearchParams();
    qs.set("categoryMajor", major);
    qs.set("page", String(p));
    qs.set("limit", "100");

    try {
      const res = await fetch(`${API_DOCS}?${qs.toString()}`);
      if (!res.ok) break;
      const json = await res.json();
      const items = Array.isArray(json?.data) ? json.data : [];
      const t = Number(json?.total || 0);

      items.forEach((it) => {
        const m = (it && it.categoryMinor) ? String(it.categoryMinor).trim() : "";
        if (m) uniq.add(m);
      });

      scanned += items.length;
      if (scanned >= t || items.length === 0) break;
      p += 1;
    } catch {
      break;
    }
  }

  const minors = Array.from(uniq).sort((a, b) => a.localeCompare(b, "vi"));

  minors.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = `Mục con: ${m}`;
    minorFilter.appendChild(opt);
  });

  // nếu selectedMinor không còn phù hợp -> reset
  if (selectedMinor && !uniq.has(selectedMinor)) {
    selectedMinor = "";
    minorFilter.value = "";
  }
}

function selectMajor(major) {
  selectedMajor = major || "";
  selectedMinor = "";

  // UI
  renderStats();

  // Highlight active trong sidebar
  renderCategories(cachedCategoryStats);

  // Minor options
  loadMinorOptionsForMajor(selectedMajor);

  // Reload list
  resetAndLoad();
}

function resetAndLoad() {
  page = 1;
  total = 0;
  noMore = false;
  clearDocsList();
  showEmptyState(false);
  showLoadMore(false);
  loadDocsPage(true);
}

async function loadDocsPage(isFirstPage = false) {
  if (isLoading || noMore) return;

  setLoading(true);
  if (isFirstPage) {
    resultStatsEl.textContent = "Đang tải danh sách...";
  }

  try {
    const qs = buildQuery();
    const res = await fetch(`${API_DOCS}?${qs.toString()}`);
    if (!res.ok) throw new Error("Không tải được danh sách");

    const json = await res.json();
    const items = Array.isArray(json?.data) ? json.data : [];

    total = Number(json?.total || 0);

    if (isFirstPage && items.length === 0) {
      showEmptyState(true);
      renderStats();
      showLoadMore(false);
      noMore = true;
      return;
    }

    items.forEach((doc) => {
      docsListEl.appendChild(renderDocItem(doc));
    });

    renderStats();

    const shown = docsListEl.querySelectorAll(".doc-item").length;
    if (shown >= total || items.length === 0) {
      noMore = true;
      showLoadMore(false);
    } else {
      showLoadMore(true);
    }

    page += 1;

  } catch (e) {
    console.error("loadDocsPage error:", e);
    // Fail-safe: hiển thị empty state nếu trang 1 lỗi
    if (isFirstPage) {
      showEmptyState(true);
      if (emptyStateEl) {
        emptyStateEl.querySelector(".empty-title").textContent = "Không tải được dữ liệu.";
        emptyStateEl.querySelector(".empty-desc").textContent = "Vui lòng kiểm tra kết nối hoặc backend.";
      }
    }
  } finally {
    setLoading(false);
  }
}

// ------------------------------
// Events
// ------------------------------

let searchDebounce = null;
function onSearchOrFilterChanged() {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    resetAndLoad();
  }, 280);
}

searchInput?.addEventListener("input", onSearchOrFilterChanged);
statusFilter?.addEventListener("change", onSearchOrFilterChanged);
minorFilter?.addEventListener("change", () => {
  selectedMinor = minorFilter.value || "";
  resetAndLoad();
});
fromDate?.addEventListener("change", onSearchOrFilterChanged);
toDate?.addEventListener("change", onSearchOrFilterChanged);

clearFiltersBtn?.addEventListener("click", () => {
  searchInput.value = "";
  statusFilter.value = "";
  fromDate.value = "";
  toDate.value = "";

  selectedMajor = "";
  selectedMinor = "";
  if (minorFilter) {
    minorFilter.value = "";
    minorFilter.disabled = true;
    minorFilter.innerHTML = `<option value="">Mục con: Tất cả</option>`;
  }

  // Re-render sidebar active states by re-fetching stats
  init();
});

refreshBtn?.addEventListener("click", () => {
  init();
});

loadMoreBtn?.addEventListener("click", () => {
  loadDocsPage(false);
});

// Auto load more on scroll (gần cuối trang)
window.addEventListener("scroll", () => {
  if (isLoading || noMore) return;
  const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 260;
  if (nearBottom) {
    loadDocsPage(false);
  }
});

// ------------------------------
// Init
// ------------------------------

async function init() {
  // Reset state nhẹ
  hideTooltip();
  page = 1;
  total = 0;
  noMore = false;
  clearDocsList();
  showEmptyState(false);
  showLoadMore(false);

  // Disable minor until major selected
  if (minorFilter) {
    minorFilter.disabled = selectedMajor === "";
    if (selectedMajor === "") {
      minorFilter.value = "";
      minorFilter.innerHTML = `<option value="">Mục con: Tất cả</option>`;
    }
  }

  // Sidebar categories
  const stats = await fetchCategoriesStats();
  cachedCategoryStats = Array.isArray(stats) ? stats : [];
  renderCategories(cachedCategoryStats);

  // Populate minors if major is already selected
  await loadMinorOptionsForMajor(selectedMajor);

  // First page
  await loadDocsPage(true);

  // JSON-LD (ItemList) – nhẹ nhàng cho SEO
  try {
    const jsonLdEl = document.getElementById("lawsJsonLd");
    if (jsonLdEl) {
      jsonLdEl.textContent = JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          "name": "Văn bản pháp luật | ChatIIP",
          "url": "https://chatiip.com/laws.html"
        },
        null,
        2
      );
    }
  } catch {
    // ignore
  }

  renderStats();
}

init();
