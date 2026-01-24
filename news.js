// ==============================
//  NEWS.JS – V2 (INFINITE SCROLL)
// ==============================

let allNews = [];
let currentList = [];     // danh sách hiện đang hiển thị (sau khi search/filter)
let workingList = [];     // danh sách dùng để phân trang (bỏ bài featured)
let page = 1;
const perPage = 10;       // số bài mỗi lần load thêm
let loadingMore = false;
let noMore = false;

// API backend
const API = "/api/news";


// Local cache + state (để quay lại/tìm kiếm mượt hơn)
const NEWS_CACHE_KEY = "chatiip_news_cache_v1";
const NEWS_STATE_KEY = "chatiip_news_state_v1";
const NEWS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 phút

function safeParse(raw, fallback) {
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}

function readJsonLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return safeParse(raw, fallback);
  } catch (_) { return fallback; }
}

function writeJsonLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
}

function readJsonSS(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return fallback;
    return safeParse(raw, fallback);
  } catch (_) { return fallback; }
}

function writeJsonSS(key, val) {
  try { sessionStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
}

function hashNewsList(list) {
  try {
    // đủ để so sánh nhanh (không cần crypto)
    const s = (list || []).map(i => `${i.slug}|${i.modifiedAt||i.publishedAt||""}`).join("\n");
    let h = 0;
    for (let i=0;i<s.length;i++) { h = ((h<<5)-h) + s.charCodeAt(i); h |= 0; }
    return h;
  } catch (_) { return 0; }
}

function setUrlState(q, cat) {
  try {
    const u = new URL(window.location.href);
    if (q) u.searchParams.set("q", q);
    else u.searchParams.delete("q");
    if (cat) u.searchParams.set("cat", cat);
    else u.searchParams.delete("cat");
    history.replaceState({}, "", u.toString());
  } catch (_) {}
}

function getInitialFilterState() {
  // ưu tiên: URL -> sessionStorage
  try {
    const u = new URL(window.location.href);
    const q = (u.searchParams.get("q") || "").trim();
    const cat = (u.searchParams.get("cat") || "").trim();
    if (q || cat) return { q, cat, scrollY: 0 };
  } catch (_) {}

  return readJsonSS(NEWS_STATE_KEY, { q: "", cat: "", scrollY: 0 });
}

function saveNewsState() {
  const q = (searchInput?.value || "").trim();
  const cat = (categoryFilter?.value || "").trim();
  writeJsonSS(NEWS_STATE_KEY, { q, cat, scrollY: window.scrollY || 0, at: Date.now() });
  setUrlState(q, cat);
}

function restoreNewsStateAfterRender() {
  const st = getInitialFilterState();
  if (searchInput) searchInput.value = st.q || "";
  if (categoryFilter) categoryFilter.value = st.cat || "";
  // áp filter trước, rồi scroll sau
  applyFilters();
  if (typeof st.scrollY === "number" && st.scrollY > 0) {
    setTimeout(() => window.scrollTo({ top: st.scrollY, behavior: "auto" }), 50);
  }
}

// Back button (news page)
document.getElementById("backBtn")?.addEventListener("click", () => {
  try {
    if (history.length > 1) history.back();
    else window.location.href = "index.html";
  } catch (_) {
    window.location.href = "index.html";
  }
});

window.addEventListener("beforeunload", saveNewsState);

const featuredEl = document.getElementById("featuredNews");
const listEl = document.getElementById("newsList");
const jsonLdEl = document.getElementById("newsJsonLd");

// input filter
const searchInput = document.getElementById("searchInput");
const categoryFilter = document.getElementById("categoryFilter");

/* ==========================
   Skeleton loading
   ========================== */
function showSkeleton() {
  featuredEl.innerHTML = `
    <div class="skeleton-wrap">
      <div class="skeleton-box"></div>
      <div>
        <div class="skeleton-line" style="width:80%; height:24px;"></div>
        <div class="skeleton-line" style="width:60%;"></div>
        <div class="skeleton-line" style="width:90%;"></div>
        <div class="skeleton-line" style="width:50%;"></div>
      </div>
    </div>
  `;

  listEl.innerHTML = `
    <div class="news-item skeleton-box"></div>
    <div class="news-item skeleton-box"></div>
    <div class="news-item skeleton-box"></div>
  `;
}

/* ==========================
   Cắt ngắn text
   ========================== */
function shortText(text, max = 120) {
  if (!text) return "";
  const clean = String(text);
  return clean.length > max ? clean.slice(0, max) + "..." : clean;
}

/* ==========================
   Render bài nổi bật
   ========================== */
function renderFeaturedItem(n) {
  const img = n.img && n.img.trim() !== "" ? n.img : "https://chatiip.com/iip.jpg";
  const date = n.publishedAt
    ? new Date(n.publishedAt).toLocaleDateString("vi-VN")
    : "Không rõ ngày";

  featuredEl.innerHTML = `
    <div class="featured-image-wrap">
      <img src="${img}" alt="${n.title}" class="featured-image">
    </div>
    <div class="featured-meta">
      <h2 class="featured-title" id="featuredTitle">${n.title}</h2>
      <div class="featured-subtitle">
        ${shortText(n.subtitle || "", 180)}
      </div>
      <div class="featured-info">
        <i class="far fa-clock"></i>
        <span>${date}</span>
      </div>
    </div>
  `;

  const go = () => {
    try { saveNewsState(); } catch (_) {}
    window.location.href = `article.html?slug=${n.slug}&v=${encodeURIComponent(window.CHATIIP_VERSION||'')}`;
  };
  featuredEl.querySelector(".featured-image-wrap").onclick = go;
  featuredEl.querySelector("#featuredTitle").onclick = go;
}

/* ==========================
   Render 1 card tin
   ========================== */
function renderNewsItem(n) {
  const div = document.createElement("div");
  div.className = "news-item fade-in";

  const img = n.img && n.img.trim() !== ""
    ? n.img
    : "https://chatiip.com/iip.jpg";

  const date = n.publishedAt
    ? new Date(n.publishedAt).toLocaleDateString("vi-VN")
    : "Không rõ ngày";

  div.innerHTML = `
    <img src="${img}" class="news-thumb" loading="lazy">

    <div class="news-text">
      <div class="news-title">${n.title}</div>
      <div class="news-tag">${n.category || "Khác"}</div>

      <div class="news-subtitle">
        ${shortText(n.subtitle || "", 140)}
      </div>

      <div class="news-date">
        <i class="far fa-clock"></i> ${date}
      </div>
    </div>
  `;

  div.onclick = () => {
    try { saveNewsState(); } catch (_) {}
    window.location.href = `article.html?slug=${n.slug}&v=${encodeURIComponent(window.CHATIIP_VERSION||'')}`;
  };

  return div;
}

/* ==========================
   JSON-LD ItemList cho Google
   ========================== */
function updateJsonLd(list) {
  if (!jsonLdEl) return;

  const itemListElement = list.map((n, idx) => ({
    "@type": "ListItem",
    "position": idx + 1,
    "url": `https://chatiip.com/article.html?slug=${n.slug}`,
    "name": n.title
  }));

  const json = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "itemListElement": itemListElement
  };

  jsonLdEl.textContent = JSON.stringify(json, null, 2);
}

/* ==========================
   Phân trang từ workingList
   ========================== */

function resetPagination(list) {
  currentList = list;
  // bỏ bài đầu làm featured, phần còn lại để scroll
  workingList = list.slice(1);

  page = 1;
  noMore = false;
  loadingMore = false;

  listEl.innerHTML = "";
  featuredEl.innerHTML = "";

  if (list.length > 0) {
    renderFeaturedItem(list[0]);
  }

  appendMore(); // load trang đầu tiên
}

function appendMore() {
  if (noMore || workingList.length === 0) {
    loadingMore = false;
    return;
  }

  const start = (page - 1) * perPage;
  const end = page * perPage;
  const slice = workingList.slice(start, end);

  slice.forEach(n => listEl.appendChild(renderNewsItem(n)));

  if (end >= workingList.length) {
    noMore = true;
  }

  page++;
  loadingMore = false;
}

/* ==========================
   Load danh sách tin (lần đầu)
   ========================== */
async function loadNews() {
  // 1) Render ngay từ cache (nếu có) để quay lại cực nhanh
  let renderedFromCache = false;
  try {
    const cached = readJsonLS(NEWS_CACHE_KEY, null);
    if (cached && Array.isArray(cached.items) && cached.items.length) {
      allNews = cached.items;
      // sort newest
      allNews.sort((a, b) => {
        const tb = b && b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        const ta = a && a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        return tb - ta;
      });
      resetPagination(allNews);
      updateJsonLd(allNews);
      renderedFromCache = true;
      // restore filter + scroll
      restoreNewsStateAfterRender();
    }
  } catch (_) {}

  if (!renderedFromCache) {
    showSkeleton();
  }

  // 2) Fetch từ server để cập nhật mới nhất
  try {
    const res = await fetch(API, { cache: "no-store" });
    const data = await res.json();
    const fetched = data || [];

    if (!Array.isArray(fetched) || fetched.length === 0) {
      featuredEl.innerHTML = "";
      listEl.innerHTML = `<p>Chưa có bài viết nào.</p>`;
      writeJsonLS(NEWS_CACHE_KEY, { at: Date.now(), hash: 0, items: [] });
      return;
    }

    fetched.sort((a, b) => {
      const tb = b && b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      const ta = a && a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      return tb - ta;
    });

    const newHash = hashNewsList(fetched);
    const cached = readJsonLS(NEWS_CACHE_KEY, null);
    const oldHash = cached && typeof cached.hash === "number" ? cached.hash : 0;

    // Nếu có thay đổi hoặc chưa render cache -> render lại
    if (!renderedFromCache || newHash !== oldHash) {
      allNews = fetched;
      resetPagination(allNews);
      updateJsonLd(allNews);
      restoreNewsStateAfterRender();
    }

    writeJsonLS(NEWS_CACHE_KEY, { at: Date.now(), hash: newHash, items: fetched });

  } catch (err) {
    console.error("Lỗi tải tin:", err);
    if (!renderedFromCache) {
      featuredEl.innerHTML = "";
      listEl.innerHTML = `
        <p style="color:red; text-align:center;">⚠️ Lỗi tải tin. Vui lòng thử lại.</p>
      `;
    }
  }
}

loadNews();

/* ==========================
   FILTER + SEARCH (có infinite scroll)
   ========================== */

function applyFilters() {
  let filtered = [...allNews];

  const keyword = searchInput.value.toLowerCase().trim();
  const category = categoryFilter.value;

  // Lọc theo search
  if (keyword !== "") {
    filtered = filtered.filter(n =>
      n.title.toLowerCase().includes(keyword) ||
      (n.subtitle || "").toLowerCase().includes(keyword) ||
      (n.content || "").toLowerCase().includes(keyword)
    );
  }

  // Lọc theo chuyên mục
  // ✅ FIX: "Tất cả" (value="") phải hiển thị toàn bộ
  if (category !== "") {
    // ✅ FIX: nếu n.category bị thiếu -> coi như "Khác"
    filtered = filtered.filter(n => (n.category || "Khác") === category);
  }


  renderFilteredList(filtered);
}

function renderFilteredList(list) {
  if (!list || list.length === 0) {
    featuredEl.innerHTML = "";
    listEl.innerHTML = `<p style="padding:16px; color:#555;">Không tìm thấy bài viết nào.</p>`;
    updateJsonLd([]);
    return;
  }

  // dùng lại logic phân trang cho list đã lọc
  resetPagination(list);
  updateJsonLd(list);
}

// EVENT LISTENER cho filter
let __filterDebounce = null;
function scheduleApplyFilters() {
  try { setUrlState((searchInput?.value||"").trim(), (categoryFilter?.value||"").trim()); } catch (_) {}
  clearTimeout(__filterDebounce);
  __filterDebounce = setTimeout(() => {
    applyFilters();
    try { saveNewsState(); } catch (_) {}
  }, 220);
}

// EVENT LISTENER cho filter
if (searchInput) {
  searchInput.addEventListener("input", scheduleApplyFilters);
}

if (categoryFilter) {
  categoryFilter.addEventListener("change", scheduleApplyFilters);
}

/* ==========================
   INFINITE SCROLL
   ========================== */
window.addEventListener("scroll", () => {
  if (loadingMore || noMore) return;
  if (workingList.length === 0) return;

  // khi cuộn gần cuối trang 300px thì load tiếp
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 300) {
    loadingMore = true;
    appendMore();
  }
});
