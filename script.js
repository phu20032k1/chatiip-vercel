
// ====================  SESSION & USER ID & GOOGLE LOG  ====================
function getSessionId() {
    let sid = localStorage.getItem("chatiip_session_id");
    if (!sid) {
        sid = (window.crypto && crypto.randomUUID)
            ? crypto.randomUUID()
            : Date.now() + "_" + Math.random();
        localStorage.setItem("chatiip_session_id", sid);
    }
    return sid;
}

function getUserId() {
    return localStorage.getItem("chatiip_user_id") || "anonymous";
}

const GOOGLE_LOG_URL =
    "https://script.google.com/macros/s/AKfycbz1RqVbn7j_7dUxmuAFuzUmBgJnqsJVIAYJzFjnovJraQyVEb193XI5lbp5l-33DB5cuA/exec";

const GOOGLE_SECRET = "minhphu2003";

async function logToGoogle(payload) {
    try {
        await fetch(GOOGLE_LOG_URL, {
            method: "POST",
            body: JSON.stringify({
                token: GOOGLE_SECRET,
                ...payload,
                source: "chatiip_frontend",
                user_agent: navigator.userAgent
            })
        });
    } catch (e) {
        console.error("Google log error", e);
    }
}






// ====================  BACKEND CHAT SESSION (HISTORY)  ====================
const CHAT_HISTORY_BASE_URL = "https://botchat.iipmap.com/history";

// Auth guard: when NOT logged in, do not persist chat/history to localStorage.
function __isLoggedInLS() {
    try {
        const raw = localStorage.getItem("chatiip_current_user");
        if (!raw) return false;
        const u = JSON.parse(raw);
        return !!(u && u.id);
    } catch (_) {
        return false;
    }
}

let __volatileBackendSessionId = "";

function getBackendSessionId() {
    try {
        if (__isLoggedInLS()) {
            return localStorage.getItem("chatiip_backend_session_id") || "";
        }
    } catch (_) {
        // ignore
    }
    return __volatileBackendSessionId || "";
}

function setBackendSessionId(sid) {
    try {
        __volatileBackendSessionId = sid || "";
        if (__isLoggedInLS() && sid) localStorage.setItem("chatiip_backend_session_id", sid);
    } catch (_) {}
}

function clearBackendSessionId() {
    try {
        __volatileBackendSessionId = "";
        localStorage.removeItem("chatiip_backend_session_id");
    } catch (_) {}
}


// ====================  LOCAL FAST CACHE (CHAT HISTORY)  ====================
// Mục tiêu:
// 1) Reload trang là thấy lịch sử ngay (từ localStorage) rồi mới đồng bộ server.
// 2) Giữ được các nội dung có cấu trúc (flowchart/map/chart) để render lại đúng.
const CHAT_CACHE_PREFIX = "chatiip_chat_cache_v4:"; // bump version nếu đổi format
const CHAT_CACHE_PENDING_KEY = "chatiip_chat_cache_pending_v4";
const CHAT_CACHE_MAX_MESSAGES = 200;

function getChatCacheKey(sessionId) {
    return CHAT_CACHE_PREFIX + String(sessionId || "");
}

function safeJsonParse(raw, fallback) {
    try { return JSON.parse(raw); } catch (_) { return fallback; }
}

function readChatCacheByKey(key) {
    try {
        if (!__isLoggedInLS()) return null;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const obj = safeJsonParse(raw, null);
        if (!obj || typeof obj !== 'object') return null;
        if (!Array.isArray(obj.messages)) obj.messages = [];
        return obj;
    } catch (_) {
        return null;
    }
}

function writeChatCacheByKey(key, obj) {
    try {
        if (!__isLoggedInLS()) return;
        localStorage.setItem(key, JSON.stringify(obj));
    } catch (_) {}
}

function appendChatCache(sessionIdOrPending, msg) {
    const key = sessionIdOrPending ? getChatCacheKey(sessionIdOrPending) : CHAT_CACHE_PENDING_KEY;
    const cache = readChatCacheByKey(key) || { updatedAt: Date.now(), messages: [] };

    cache.updatedAt = Date.now();
    cache.messages = Array.isArray(cache.messages) ? cache.messages : [];
    cache.messages.push(msg);

    if (cache.messages.length > CHAT_CACHE_MAX_MESSAGES) {
        cache.messages = cache.messages.slice(-CHAT_CACHE_MAX_MESSAGES);
    }

    writeChatCacheByKey(key, cache);
}

function migratePendingCacheToSession(newSessionId) {
    try {
        if (!newSessionId) return;
        const pending = readChatCacheByKey(CHAT_CACHE_PENDING_KEY);
        if (!pending || !Array.isArray(pending.messages) || !pending.messages.length) return;

        const key = getChatCacheKey(newSessionId);
        const existing = readChatCacheByKey(key) || { updatedAt: Date.now(), messages: [] };
        const merged = {
            updatedAt: Date.now(),
            messages: [...(existing.messages || []), ...pending.messages]
        };
        if (merged.messages.length > CHAT_CACHE_MAX_MESSAGES) {
            merged.messages = merged.messages.slice(-CHAT_CACHE_MAX_MESSAGES);
        }
        writeChatCacheByKey(key, merged);
        localStorage.removeItem(CHAT_CACHE_PENDING_KEY);
    } catch (_) {}
}

function hashString(str) {
    // fast non-crypto hash
    let h = 0;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
    }
    return h;
}

function summarizeMessagesForCompare(msgs) {
    try {
        const last = msgs && msgs.length ? msgs[msgs.length - 1] : null;
        return {
            n: Array.isArray(msgs) ? msgs.length : 0,
            lastRole: last ? String(last.role || last.type || '') : '',
            lastTextHash: last ? hashString(String(last.content || last.text || '')) : 0
        };
    } catch (_) {
        return { n: 0, lastRole: '', lastTextHash: 0 };
    }
}

// ====================  ESCAPE HTML (GLOBAL)  ====================
function escapeHtmlGlobal(unsafe) {
    return String(unsafe ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// ====================  IIP MAP (INDUSTRIAL ZONES)  ====================
// Dùng MapLibre (KHÔNG cần token) + dữ liệu GeoJSON (industrial_zones.geojson)
const IIP_GEOJSON_PATH = "industrial_zones.geojson";
const IIP_GEOJSON_URL = `${IIP_GEOJSON_PATH}?v=${encodeURIComponent(window.CHATIIP_VERSION || "")}`;

const VN_PROVINCES_PATH = "vn_provinces.geojson";
const VN_PROVINCES_URL = `${VN_PROVINCES_PATH}?v=${encodeURIComponent(window.CHATIIP_VERSION || "")}`;

let __vnProvPromise = null;
let __vnProvIndex = null;

let __iipGeoPromise = null;
let __iipIndex = null;

// Chuẩn hoá tiếng Việt: bỏ dấu + lowercase để match ổn định
function normalizeViText(input) {
    return String(input ?? "")
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function isIndustrialQuery(question) {
    const t = normalizeViText(question);
    return /(khu cong nghiep|kcn|cum cong nghiep|ccn|khu che xuat|kcx|khu kinh te|kkt|industrial\s*(zone|park)|industrial\s*park|vsip)/.test(t);
}

function buildIipIndex(geojson) {
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    const provincesSet = new Set();

    for (const f of features) {
        const p = String(f?.properties?.province ?? "").trim();
        if (p) provincesSet.add(p);
    }
    const provinces = Array.from(provincesSet).sort((a, b) => a.localeCompare(b, "vi"));

    const normProvinceToReal = new Map();
    provinces.forEach(p => normProvinceToReal.set(normalizeViText(p), p));

    return { features, provinces, normProvinceToReal };
}

async function getIndustrialGeojson() {
    // Offline-friendly: nếu đã có data global (từ industrial_zones_data.js) thì dùng luôn
    if (window.IIP_GEOJSON_DATA && window.IIP_GEOJSON_DATA.features) {
        __iipIndex = buildIipIndex(window.IIP_GEOJSON_DATA);
        return window.IIP_GEOJSON_DATA;
    }

    if (__iipGeoPromise) return __iipGeoPromise;

    __iipGeoPromise = fetch(IIP_GEOJSON_URL, { cache: "no-store" })
        .then(r => {
            if (!r.ok) throw new Error(`Không tải được ${IIP_GEOJSON_PATH} (HTTP ${r.status})`);
            return r.json();
        })
        .then(j => {
            __iipIndex = buildIipIndex(j);
            return j;
        })
        .catch(err => {
            console.warn("IIP GeoJSON load error:", err);
            __iipGeoPromise = null; // cho phép retry
            throw err;
        });

    return __iipGeoPromise;
}

async function getProvinceGeojson() {
    // Offline-friendly: nếu đã có data global (từ vn_provinces_data.js) thì dùng luôn
    if (window.VN_PROVINCES_GEOJSON && window.VN_PROVINCES_GEOJSON.features) {
        if (!__vnProvIndex) {
            __vnProvIndex = buildProvinceIndex(window.VN_PROVINCES_GEOJSON);
        }
        return window.VN_PROVINCES_GEOJSON;
    }

    if (__vnProvPromise) return __vnProvPromise;

    __vnProvPromise = fetch(VN_PROVINCES_URL, { cache: "no-store" })
        .then(r => {
            if (!r.ok) throw new Error(`Không tải được ${VN_PROVINCES_PATH} (HTTP ${r.status})`);
            return r.json();
        })
        .then(j => {
            __vnProvIndex = buildProvinceIndex(j);
            return j;
        })
        .catch(err => {
            console.warn("VN provinces GeoJSON load error:", err);
            __vnProvPromise = null;
            throw err;
        });

    return __vnProvPromise;
}

function buildProvinceIndex(geojson) {
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    const normToName = new Map();

    const addAlias = (alias, canonical) => {
        const a = String(alias || "").trim();
        const c = String(canonical || "").trim();
        if (!a || !c) return;
        const n = normalizeViText(a);
        if (!n) return;
        if (!normToName.has(n)) normToName.set(n, c);
    };

    for (const f of features) {
        const name = String(f?.properties?.NAME_1 || f?.properties?.name || "").trim();
        if (!name) continue;

        addAlias(name, name);

        // thêm alias từ VARNAME_1 (để hỗ trợ tỉnh cũ trước sáp nhập / cách viết khác)
        const varname = String(f?.properties?.VARNAME_1 || "").trim();
        if (varname) {
            varname.split(",").forEach(a => addAlias(a, name));
        }
    }

    return { features, normToName };
}


// ====================  PROVINCE BBOX + TABLE EXTRACTION HELPERS  ====================
function __coordsWalk(coords, cb) {
    if (!coords) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
        cb(coords[0], coords[1]);
        return;
    }
    if (Array.isArray(coords)) {
        for (const c of coords) __coordsWalk(c, cb);
    }
}

function getFeatureBbox(feature) {
    try {
        const geom = feature?.geometry;
        if (!geom) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        __coordsWalk(geom.coordinates, (x, y) => {
            const xx = Number(x), yy = Number(y);
            if (!isFinite(xx) || !isFinite(yy)) return;
            if (xx < minX) minX = xx;
            if (yy < minY) minY = yy;
            if (xx > maxX) maxX = xx;
            if (yy > maxY) maxY = yy;
        });
        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
        return [[minX, minY], [maxX, maxY]];
    } catch (_) {
        return null;
    }
}

function fitToProvinceByNames(map, provGeo, provinces) {
    try {
        if (!map || !provGeo) return false;
        const list = Array.isArray(provinces) ? provinces : (provinces ? [provinces] : []);
        const mapped = list.map(p => mapProvinceNameToGeo(p)).filter(Boolean);
        if (!mapped.length) return false;

        const feats = (provGeo.features || []).filter(f => mapped.includes(String(f?.properties?.NAME_1 || '').trim()));
        if (!feats.length) return false;

        let bounds = null;
        for (const f of feats) {
            const bb = getFeatureBbox(f);
            if (!bb) continue;
            if (!bounds) bounds = bb;
            else {
                bounds = [
                    [Math.min(bounds[0][0], bb[0][0]), Math.min(bounds[0][1], bb[0][1])],
                    [Math.max(bounds[1][0], bb[1][0]), Math.max(bounds[1][1], bb[1][1])]
                ];
            }
        }
        if (!bounds) return false;
        map.fitBounds(bounds, { padding: 48, maxZoom: 9.5, duration: 650 });
        return true;
    } catch (_) {
        return false;
    }
}

function extractIipNamesFromRenderedTable(botEl) {
    try {
        if (!botEl) return [];
        const tables = botEl.querySelectorAll('.data-table');
        if (!tables || !tables.length) return [];

        for (const tbl of tables) {
            const thead = tbl.querySelector('thead');
            const tbody = tbl.querySelector('tbody');
            if (!thead || !tbody) continue;

            const headers = Array.from(thead.querySelectorAll('th')).map(th => normalizeViText(th.textContent || ''));
            if (!headers.length) continue;

            // Heuristic: table must look like KCN/CCN list
            let nameCol = headers.findIndex(h => h.includes('ten') && (h.includes('khu') || h.includes('kcn') || h.includes('cum') || h.includes('ccn')));
            if (nameCol < 0) {
                // fallback: second column if table also has address/price-like columns
                const hasAddr = headers.some(h => h.includes('dia') || h.includes('address'));
                if (hasAddr && headers.length >= 2) nameCol = 1;
            }
            if (nameCol < 0) continue;

            const rows = Array.from(tbody.querySelectorAll('tr'));
            const names = [];
            for (const tr of rows) {
                const tds = tr.querySelectorAll('td');
                if (!tds || tds.length <= nameCol) continue;
                const nm = String(tds[nameCol].textContent || '').trim();
                if (nm) names.push(nm);
            }
            if (names.length) return names;
        }
        return [];
    } catch (_) {
        return [];
    }
}


// Fallback mapping (hỗ trợ tên tỉnh cũ sau sáp nhập, dùng ngay cả khi chưa load province geojson)
const PROVINCE_MERGE_FALLBACK = (() => {
    const m = new Map();
    const pairs = [
        ["Hà Giang","Tuyên Quang"],
        ["Yên Bái","Lào Cai"],
        ["Bắc Kạn","Thái Nguyên"],
        ["Vĩnh Phúc","Phú Thọ"],
        ["Hòa Bình","Phú Thọ"],
        ["Bắc Giang","Bắc Ninh"],
        ["Thái Bình","Hưng Yên"],
        ["Hải Dương","Hải Phòng"],
        ["Hà Nam","Ninh Bình"],
        ["Nam Định","Ninh Bình"],
        ["Quảng Bình","Quảng Trị"],
        ["Quảng Nam","Đà Nẵng"],
        ["Kon Tum","Quảng Ngãi"],
        ["Bình Định","Gia Lai"],
        ["Ninh Thuận","Khánh Hòa"],
        ["Đắk Nông","Lâm Đồng"],
        ["Bình Thuận","Lâm Đồng"],
        ["Phú Yên","Đắk Lắk"],
        ["Bà Rịa - Vũng Tàu","Hồ Chí Minh"],
        ["Bình Dương","Hồ Chí Minh"],
        ["Bình Phước","Đồng Nai"],
        ["Long An","Tây Ninh"],
        ["Sóc Trăng","Cần Thơ"],
        ["Hậu Giang","Cần Thơ"],
        ["Bến Tre","Vĩnh Long"],
        ["Trà Vinh","Vĩnh Long"],
        ["Tiền Giang","Đồng Tháp"],
        ["Bạc Liêu","Cà Mau"],
        ["Kiên Giang","An Giang"],
        ["Thừa Thiên Huế","Huế"]
    ];
    for (const [from, to] of pairs) {
        m.set(normalizeViText(from), to);
        m.set(normalizeViText(to), to);
    }
    // alias phổ biến
    ["TP.HCM","TP HCM","TP Hồ Chí Minh","Sài Gòn","Sai Gon","Saigon"].forEach(a => m.set(normalizeViText(a), "Hồ Chí Minh"));
    ["TP Đà Nẵng"].forEach(a => m.set(normalizeViText(a), "Đà Nẵng"));
    ["TP Cần Thơ"].forEach(a => m.set(normalizeViText(a), "Cần Thơ"));
    ["TP Hải Phòng"].forEach(a => m.set(normalizeViText(a), "Hải Phòng"));
    return m;
})();


function mapProvinceNameToGeo(provinceText) {
    const norm = normalizeViText(provinceText);
    if (!norm) return provinceText || "";

    // Ưu tiên map theo geojson (34 tỉnh/thành mới)
    if (__vnProvIndex?.normToName) {
        return __vnProvIndex.normToName.get(norm)
            || PROVINCE_MERGE_FALLBACK.get(norm)
            || provinceText
            || "";
    }

    // Nếu chưa load geojson: dùng fallback
    return PROVINCE_MERGE_FALLBACK.get(norm) || provinceText || "";
}


function extractProvinceFromText(question) {
    const t = normalizeViText(question);
    if (!__iipIndex?.normProvinceToReal) return "";
    for (const [norm, real] of __iipIndex.normProvinceToReal.entries()) {
        if (norm && t.includes(norm)) return real;
    }
    return "";
}

// ====================  COMPARE (MULTI-PROVINCE) HELPERS  ====================
function isCompareQuery(question) {
    const t = normalizeViText(question);
    return /(so\s*sanh|compare|\bvs\b|\bvoi\b|\bv[ơo]i\b)/.test(t);
}

function extractProvincesFromText(question, maxCount = 2) {
    const t = normalizeViText(question);
    const out = [];

    // 1) ưu tiên các tỉnh có trong index KCN
    try {
        if (__iipIndex?.normProvinceToReal) {
            const entries = Array.from(__iipIndex.normProvinceToReal.entries())
                .sort((a, b) => (b?.[0]?.length || 0) - (a?.[0]?.length || 0)); // tên dài trước
            for (const [norm, real] of entries) {
                if (!norm || !real) continue;
                if (t.includes(norm)) {
                    if (!out.includes(real)) out.push(real);
                    if (out.length >= maxCount) return out;
                }
            }
        }
    } catch (_) {}

    // 2) fallback: scan alias trong PROVINCE_MERGE_FALLBACK (hỗ trợ tỉnh cũ / cách viết khác)
    try {
        const entries2 = Array.from(PROVINCE_MERGE_FALLBACK.entries())
            .sort((a, b) => (b?.[0]?.length || 0) - (a?.[0]?.length || 0));
        for (const [norm, canon] of entries2) {
            if (!norm || !canon) continue;
            if (t.includes(norm)) {
                if (!out.includes(canon)) out.push(canon);
                if (out.length >= maxCount) return out;
            }
        }
    } catch (_) {}

    return out.slice(0, maxCount);
}

function setProvinceHighlightFilter(map, provinces) {
    try {
        if (!map || !map.getLayer) return;
        if (!map.getLayer('province-highlight') && !map.getLayer('province-highlight-line')) return;
        const list = Array.isArray(provinces) ? provinces : (provinces ? [provinces] : []);
        const mapped = list.map(p => mapProvinceNameToGeo(p)).filter(Boolean);

        if (!mapped.length) {
            if (map.getLayer('province-highlight')) map.setFilter('province-highlight', ['==', ['get', 'NAME_1'], '']);
            if (map.getLayer('province-highlight-line')) map.setFilter('province-highlight-line', ['==', ['get', 'NAME_1'], '']);
            return;
        }
        const f = (mapped.length === 1)
            ? ['==', ['get', 'NAME_1'], mapped[0]]
            : ['in', ['get', 'NAME_1'], ['literal', mapped]];
        if (map.getLayer('province-highlight')) map.setFilter('province-highlight', f);
        if (map.getLayer('province-highlight-line')) map.setFilter('province-highlight-line', f);
    } catch (_) {}
}

function buildIipListBlockFromFeatures(features, titleText, maxRows = 25) {
    const list = Array.isArray(features) ? features : [];
    const total = list.length;
    const show = (maxRows === null || maxRows === undefined || maxRows <= 0 || maxRows === Infinity)
        ? list
        : list.slice(0, maxRows);

    const rows = show.map((f, idx) => {
        const p = f?.properties || {};
        const nameRaw = String(p.name || "");
        const addrRaw = String(p.address || "");
        const priceRaw = String(p.price || "");
        const name = escapeHtmlGlobal(nameRaw);
        const addr = escapeHtmlGlobal(addrRaw);
        const price = escapeHtmlGlobal(priceRaw);

        // Dùng ellipsis để tránh xuống dòng xấu (đặc biệt khi layout hẹp/so sánh).
        return `
          <tr>
            <td class="col-stt">${idx + 1}</td>
            <td><span class="cell-ellipsis" title="${name}">${name || "—"}</span></td>
            <td><span class="cell-ellipsis" title="${addr}">${addr || "—"}</span></td>
            <td class="col-area"><span class="cell-ellipsis" title="${price}">${price || "—"}</span></td>
          </tr>
        `;
    }).join("");

    const note = total > show.length
        ? `<div class="data-block-sub">Hiển thị ${show.length}/${total}. (Gợi ý: hỏi thêm tiêu chí để lọc nhỏ lại)</div>`
        : `<div class="data-block-sub">Tổng: ${total} điểm</div>`;

    return `
      <div class="data-block compare-iip-block">
        <div class="data-block-header">
          <div class="data-block-title">${escapeHtmlGlobal(titleText)}</div>
          ${note}
        </div>
        <div class="data-table-wrap">
          <table class="data-table data-table-compact">
            <thead>
              <tr>
                <th class="col-stt">#</th>
                <th>Tên khu</th>
                <th>Địa chỉ</th>
                <th class="col-area">Giá</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
}

function ensureCompareListsInBubble(botEl, geoFeatures, provinces) {
    try {
        if (!botEl) return false;
        const bubble = botEl.querySelector(".message-bubble");
        if (!bubble) return false;

        // tránh chèn trùng
        if (bubble.querySelector(".compare-iip-lists")) return false;

        const provs = (Array.isArray(provinces) ? provinces : []).filter(Boolean);
        if (provs.length < 2) return false;

        const canonList = provs.map(mapProvinceNameToGeo).filter(Boolean);
        const byProv = new Map();
        canonList.forEach(c => byProv.set(c, []));

        for (const f of geoFeatures || []) {
            const pv = mapProvinceNameToGeo(String(f?.properties?.province || "").trim());
            if (byProv.has(pv)) byProv.get(pv).push(f);
        }

        // build html blocks
        const wrap = document.createElement("div");
        wrap.className = "compare-iip-lists";

        canonList.forEach((canon, i) => {
            const real = provs[i] || canon;
            const arr = byProv.get(canon) || [];
            const html = buildIipListBlockFromFeatures(arr, `Danh sách KCN: ${real} (${arr.length})`, 0);
            const tmp = document.createElement("div");
            tmp.innerHTML = html;
            wrap.appendChild(tmp.firstElementChild);
        });

        bubble.appendChild(wrap);

        // đảm bảo bubble rộng để table nhìn ổn
        try { bubble.classList.add("wide"); } catch (_) {}
        return true;
    } catch (_) {
        return false;
    }
}



function __safeUrl(url) {
    try {
        const u = String(url || '').trim();
        if (!u) return '';
        if (/^https?:\/\//i.test(u)) return u;
        return '';
    } catch (_) {
        return '';
    }
}

function __pickFirstImage(imagesField) {
    const s = String(imagesField || '').trim();
    if (!s) return '';
    // API đôi khi trả nhiều URL phân tách bằng dấu phẩy / xuống dòng
    const parts = s.split(/[\n\r\t, ]+/).map(p => p.trim()).filter(Boolean);
    for (const p of parts) {
        const u = __safeUrl(p);
        if (u) return u;
    }
    return '';
}

function __formatMaybeNumber(v) {
    const s = String(v ?? '').trim();
    if (!s) return '';
    // nếu là số: format theo locale vi-VN
    const n = Number(s.replace(/,/g, ''));
    if (!Number.isNaN(n) && String(n) !== '0') {
        try { return new Intl.NumberFormat('vi-VN').format(n); } catch (_) { return String(n); }
    }
    return s;
}

function __extractIndustries(props) {
    const p = props || {};
    const cand = [
        p.industries,
        p.industry,
        p.careers,
        p.career,
        p.nganh_nghe,
        p.nganhNghe,
        p.nganh,
        p.sectors,
        p.sector
    ];

    for (const v of cand) {
        if (!v) continue;
        if (Array.isArray(v)) {
            const arr = v.map(x => String(x || '').trim()).filter(Boolean);
            if (arr.length) return arr.join(', ');
        } else {
            const s = String(v).trim();
            if (s) return s;
        }
    }

    // dataset hiện tại có career_id nhưng không có mapping; hiển thị trạng thái
    if (p.career_id) return 'Có (đang cập nhật danh mục ngành)';
    return 'Đang cập nhật';
}

function buildIipDetailCardHtml(feature) {
    const p = feature?.properties || {};

    const name = escapeHtmlGlobal(p.name || 'Khu công nghiệp');
    const kind = escapeHtmlGlobal(p.kind || p.type || '');
    const province = escapeHtmlGlobal(p.province || '');
    const address = escapeHtmlGlobal(p.address || '');

    const priceRaw = (p.price !== undefined && p.price !== null) ? __formatMaybeNumber(p.price) : '';
    const priceUnit = escapeHtmlGlobal(p.price_unit || p.unit || '');
    const price = escapeHtmlGlobal(priceRaw ? (priceUnit ? `${priceRaw} ${priceUnit}` : String(priceRaw)) : '');

    const acreageRaw = (p.acreage !== undefined && p.acreage !== null) ? __formatMaybeNumber(p.acreage) : '';
    const acreage = escapeHtmlGlobal(acreageRaw ? String(acreageRaw) : '');

    const occRaw = (p.occupancy !== undefined && p.occupancy !== null) ? __formatMaybeNumber(p.occupancy) : '';
    const occ = escapeHtmlGlobal(occRaw ? String(occRaw) : '');

    const industries = escapeHtmlGlobal(__extractIndustries(p));

    const source = escapeHtmlGlobal(p.source || '');
    const updated = escapeHtmlGlobal(p.updated_at || p.updatedAt || '');

    const img = __pickFirstImage(p.images);
    const imgHtml = img ? `<div class="iip-detail-media"><img class="iip-detail-img" src="${img}" alt="${name}" loading="lazy" /></div>` : '';

    const coords = feature?.geometry?.coordinates || [];
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    const googleQuery = encodeURIComponent(`${p.name || ''} ${p.address || ''}`.trim() || `${lat},${lng}`);
    const gmaps = `https://www.google.com/maps/search/?api=1&query=${googleQuery}`;

    const codeRaw = String(p.code || '').trim();
    const codeClean = codeRaw.replace(/^https?:\/\/iipmap\.com\/?/i, '').replace(/^\/+/, '');
    const path = codeClean ? (codeClean.startsWith('zones/') ? codeClean : `zones/${codeClean}`) : '';
    const sourceUrl = path ? `https://iipmap.com/${path.split('/').map(encodeURIComponent).join('/')}` : '';

    const badge1 = kind ? `<span class="iip-badge">${escapeHtmlGlobal(kind)}</span>` : '';
    const badge2 = province ? `<span class="iip-badge secondary">${province}</span>` : '';

    const row = (label, value, suffix='') => {
        const v = String(value || '').trim();
        if (!v) return '';
        return `<div class="iip-detail-row"><div class="iip-detail-label">${label}</div><div class="iip-detail-value">${escapeHtmlGlobal(v)}${suffix}</div></div>`;
    };

    const rows = [
        row('Địa điểm', address || province),
        row('Giá', price),
        row('Diện tích', acreage, acreage ? ' ha' : ''),
        row('Lấp đầy', occ, occ ? '%' : ''),
        row('Ngành nghề', industries),
        row('Nguồn', source),
        row('Cập nhật', updated)
    ].filter(Boolean).join('');

    const actions = `
      <div class="iip-detail-actions">
        <a class="iip-detail-btn secondary" href="${gmaps}" target="_blank" rel="noopener noreferrer">
          <i class="fa-solid fa-location-dot"></i> Google Maps
        </a>
        ${sourceUrl ? `
        <a class="iip-detail-btn" href="${sourceUrl}" target="_blank" rel="noopener noreferrer">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> IIPMAP
        </a>` : ''}
      </div>
    `;

    return `
      <div class="iip-detail-card">
        ${imgHtml}
        <div class="iip-detail-body">
          <div class="iip-detail-head">
            <div class="iip-detail-name">${name}</div>
            <div class="iip-detail-badges">${badge1}${badge2}</div>
          </div>
          <div class="iip-detail-grid">${rows}</div>
          ${actions}
        </div>
      </div>
    `;
}
function buildFeaturePopupHtml(feature) {
    const p = feature?.properties || {};
    const name = escapeHtmlGlobal(p.name || "Khu công nghiệp");
    const province = escapeHtmlGlobal(p.province || "");
    const address = escapeHtmlGlobal(p.address || "");
    const price = escapeHtmlGlobal(p.price || "");
    const acreage = (p.acreage !== undefined && p.acreage !== null) ? escapeHtmlGlobal(String(p.acreage)) : "";
    const occ = (p.occupancy !== undefined && p.occupancy !== null) ? escapeHtmlGlobal(String(p.occupancy)) : "";

    const coords = feature?.geometry?.coordinates || [];
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);

    // Link nguồn (iipmap) theo slug "code" nếu có
    const codeRaw = String(p.code || "").trim();
    // iipmap chỉ hoạt động đúng với đường dẫn /zones/<slug>
    // Hỗ trợ cả trường hợp p.code đã là URL đầy đủ hoặc đã có prefix zones/
    const codeClean = codeRaw
      .replace(/^https?:\/\/iipmap\.com\/?/i, "")
      .replace(/^\/+/, "");
    const path = codeClean
      ? (codeClean.startsWith("zones/") ? codeClean : `zones/${codeClean}`)
      : "";
    const sourceUrl = path ? `https://iipmap.com/${path.split("/").map(encodeURIComponent).join("/")}` : "";
const googleQuery = encodeURIComponent(`${p.name || ""} ${p.address || ""}`.trim() || `${lat},${lng}`);
    const gmaps = `https://www.google.com/maps/search/?api=1&query=${googleQuery}`;

    const rows = [
        province ? `<div><b>Tỉnh:</b> ${province}</div>` : "",
        address ? `<div><b>Địa chỉ:</b> ${address}</div>` : "",
        price ? `<div><b>Giá:</b> ${price}</div>` : "",
        acreage ? `<div><b>Diện tích:</b> ${acreage} ha</div>` : "",
        (occ !== "" && occ !== "null") ? `<div><b>Lấp đầy:</b> ${occ}%</div>` : "",
        // Action link theo yêu cầu: chỉ hiển thị trong popup của bản đồ
        sourceUrl ? `
          <div class="iip-popup-actions">
            <a class="iip-popup-btn" href="${sourceUrl}" target="_blank" rel="noopener noreferrer">Xem chi tiết trên IIPMAP</a>
            <a class="iip-popup-btn secondary" href="${gmaps}" target="_blank" rel="noopener noreferrer">Xem trực tiếp trên Google Maps </a>
          </div>` : "",
        `<div style="margin-top:8px;"><a class="chat-link" href="${gmaps}" target="_blank" rel="noopener noreferrer"></a></div>`
    ].filter(Boolean).join("");

    return `<div style="min-width:220px"><div style="font-weight:800;margin-bottom:6px">${name}</div>${rows}</div>`;
}

function uniqByCodeOrName(features) {
    const seen = new Set();
    const out = [];
    for (const f of features || []) {
        const p = f?.properties || {};
        const key = String(p.code || normalizeViText(p.name || "")).trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(f);
    }
    return out;
}

function matchFeaturesByItemNames(items, allFeatures) {
    const names = (items || [])
        .map(it => it?.name ?? it?.ten ?? it?.Tên ?? it?.Name ?? "")
        .map(s => String(s || "").trim())
        .filter(Boolean);

    if (!names.length) return [];

    const out = [];
    const features = allFeatures || [];

    for (const nm of names) {
        const n = normalizeViText(nm);
        if (!n) continue;

        let best = null;
        for (const f of features) {
            const fname = normalizeViText(f?.properties?.name || "");
            if (!fname) continue;

            if (fname === n || fname.includes(n) || n.includes(fname)) {
                best = f;
                break;
            }
        }
        if (best) out.push(best);
    }

    return uniqByCodeOrName(out);
}


function findBestFeatureByName(name, candidates) {
    const n = normalizeViText(name);
    if (!n) return null;
    let best = null;
    for (const f of candidates || []) {
        const fname = normalizeViText(f?.properties?.name || "");
        if (!fname) continue;
        if (fname === n || fname.includes(n) || n.includes(fname)) { best = f; break; }
    }
    return best;
}

function focusFeatureOnMap(map, feature) {
    try {
        if (!map || !feature) return;
        const c = feature?.geometry?.coordinates;
        if (!Array.isArray(c) || c.length < 2) return;
        const center = [Number(c[0]), Number(c[1])];
        map.easeTo({ center, zoom: 12, duration: 650 });

        // IMPORTANT: Mapbox Popup mặc định sẽ focus sau khi mở (focusAfterOpen=true)
        // -> với chat container có overflow, thao tác click lặp lại có thể gây "nhảy cuộn" khó chịu.
        // Tắt focusAfterOpen để tránh browser auto-scroll.
        new mapboxgl.Popup({ closeButton: true, closeOnClick: true, focusAfterOpen: false })
            .setLngLat(center)
            .setHTML(buildFeaturePopupHtml(feature))
            .addTo(map);
    } catch (_) {}
}


// ====================  EXACT ZONE FOCUS (KCN/CCN)  ====================
// Mục tiêu: khi user hỏi cụ thể 1 KCN/CCN ("KCN X ở đâu?"), bản đồ auto zoom đúng điểm đó + mở popup.
function __buildZoneSearchTokens(question) {
    const t = normalizeViText(question);

    // stopwords cho truy vấn định vị / hỏi đường
    const stop = new Set([
        "khu","cong","nghiep","cum","kcn","ccn","industrial","zone",
        "o","ở","tai","tại","thuoc","thuộc","tinh","tỉnh","tp","thanh","thành","pho","phố",
        "dia","địa","chi","chỉ","duong","đường","ban","bản","do","đồ","map","maps","google",
        "la","là","gi","gì","nao","nào","nhat","nhất","gan","gần","near",
        "cho","tôi","toi","minh","mình","den","đến","toi","tới","huong","hướng","dan","dẫn"
    ]);

    // loại bỏ từ thuộc tên tỉnh (để không "kéo" match sai vào nhiều điểm cùng tỉnh)
    const provWordSet = new Set();
    try {
        const provs = extractProvincesFromText(String(question || ""), 2) || [];
        const prov1 = provs.length ? provs : (extractProvinceFromText(String(question || "")) ? [extractProvinceFromText(String(question || ""))] : []);
        prov1.map(p => normalizeViText(p)).filter(Boolean).forEach(pn => {
            pn.split(" ").forEach(w => { if (w && w.length >= 3) provWordSet.add(w); });
        });
        ["tinh","tp","thanh","pho","ba","br","riau"].forEach(w => provWordSet.add(w));
    } catch (_) {}

    // token: cho phép ngắn hơn (>=2) để bắt "vsip", "yen", ...
    const tokens = t.split(" ")
        .map(w => w.trim())
        .filter(w => w && !stop.has(w) && !provWordSet.has(w))
        .filter(w => w.length >= 2)
        .slice(0, 10);

    // ưu tiên token đặc trưng (dài hơn) lên trước
    tokens.sort((a, b) => (b.length - a.length));
    return tokens;
}

function __scoreFeatureForTokens(feature, tokens) {
    try {
        const name = normalizeViText(feature?.properties?.name || "");
        const addr = normalizeViText(feature?.properties?.address || "");
        if (!name) return { score: 0, inName: 0 };

        let score = 0;
        let inName = 0;

        for (const tok of tokens || []) {
            if (!tok) continue;
            const hitName = name.includes(tok);
            const hitAddr = addr.includes(tok);

            if (hitName) { score += 3; inName += 1; }
            else if (hitAddr) { score += 1; }
        }

        // bonus: match theo cụm từ
        if (tokens && tokens.length >= 2) {
            const phrase = tokens.slice(0, 4).join(" ");
            if (phrase && name.includes(phrase)) score += 4;
        }

        return { score, inName };
    } catch (_) {
        return { score: 0, inName: 0 };
    }
}

function detectFocusFeatureFromQuestion(question, candidateFeatures, allFeatures) {
    try {
        if (!isIndustrialQuery(question)) return null;
        if (isCompareQuery(question)) return null;

        const tokens = __buildZoneSearchTokens(question);
        if (!tokens || tokens.length < 2) return null;

        const candidates = (candidateFeatures && candidateFeatures.length) ? candidateFeatures : (allFeatures || []);
        if (!candidates || !candidates.length) return null;

        let best = null, bestScore = -1, bestInName = 0;
        let secondScore = -1;

        for (const f of candidates) {
            const r = __scoreFeatureForTokens(f, tokens);
            const s = r.score;
            if (s > bestScore) {
                secondScore = bestScore;
                bestScore = s;
                bestInName = r.inName;
                best = f;
            } else if (s > secondScore) {
                secondScore = s;
            }
        }

        // tiêu chí tự tin:
        // - token trúng trong tên >= 2 (tránh match mơ hồ theo tỉnh/địa chỉ)
        // - score đủ lớn và cách biệt so với top2
        const minScore = Math.max(6, Math.min(12, tokens.length * 3));
        if (!best || bestInName < 2) return null;
        if (bestScore < minScore) return null;
        if (secondScore >= 0 && (bestScore - secondScore) < 2) return null;

        return best;
    } catch (_) {
        return null;
    }
}



function filterFeaturesForQuestion(question, geojson) {
    const idx = __iipIndex || buildIipIndex(geojson);
    const features = idx.features || [];

    const compare = isCompareQuery(question);
    const provinces = compare ? extractProvincesFromText(question, 2) : [];
    const province = provinces?.[0] || extractProvinceFromText(question);

    const canonList = (provinces && provinces.length)
        ? provinces.map(mapProvinceNameToGeo).filter(Boolean)
        : (province ? [mapProvinceNameToGeo(province)] : []);

    let filtered = canonList.length
        ? features.filter(f => canonList.includes(mapProvinceNameToGeo(String(f?.properties?.province || "").trim())))
        : features.slice();

    // lấy token tìm kiếm (trừ stopwords + từ thuộc tên tỉnh) để match tên/địa chỉ
    const t = normalizeViText(question);

    // stopwords cơ bản + từ khóa so sánh
    const stop = new Set(["khu","cong","nghiep","cum","kcn","ccn","khucongnghiep","cumcongnghiep",
        "tai","o","thuoc","tinh","tp","thanh","pho","thi","xa","huyen","quan",
        "gia","giá","usd","vnd","m2","m²","nam","năm","thang","tháng",
        "bao","nhieu","so","sanh","so sánh","gan","nhat","voi","vs","va","và","so","sánh","theo"]);

    // loại bỏ từ thuộc tên tỉnh đã nhận diện (tránh filter giao nhau khi so sánh 2 tỉnh)
    const provWordSet = new Set();
    try {
        const provNames = (provinces && provinces.length ? provinces : (province ? [province] : []))
            .map(p => normalizeViText(String(p || "")))
            .filter(Boolean);
        for (const pn of provNames) {
            pn.split(" ").forEach(w => { if (w && w.length >= 3) provWordSet.add(w); });
        }
        // cũng loại bỏ các từ phổ biến hay đi kèm tên tỉnh
        ["tinh","tp","thanh","pho","ba","br","riau"].forEach(w => provWordSet.add(w));
    } catch (_) {}

    const tokens = t.split(" ")
        .filter(w => w.length >= 4 && !stop.has(w) && !provWordSet.has(w))
        .slice(0, 6);

    // nếu chỉ còn token rất chung chung (hoặc rỗng), bỏ qua filter token


    if (tokens.length) {
        filtered = filtered.filter(f => {
            const name = normalizeViText(f?.properties?.name || "");
            const addr = normalizeViText(f?.properties?.address || "");
            return tokens.every(tok => name.includes(tok) || addr.includes(tok));
        });
    }

    if (filtered.length > 500) filtered = filtered.slice(0, 500);

    return { filtered, province, provinces: provinces && provinces.length ? provinces : (province ? [province] : []) };
}

function buildGeojsonFromFeatures(features) {
    return {
        type: "FeatureCollection",
        features: (features || []).filter(Boolean)
    };
}

function createIipMapCard({ title, subtitle }) {
    const card = document.createElement("div");
    card.className = "iip-map-card";

    const head = document.createElement("div");
    head.className = "iip-map-head";

    const left = document.createElement("div");
    left.style.minWidth = "0";

    const t = document.createElement("div");
    t.className = "iip-map-title";
    t.textContent = title || "Bản đồ khu công nghiệp";

    const sub = document.createElement("div");
    sub.className = "iip-map-subtitle";
    sub.textContent = subtitle || "Bấm vào điểm để xem chi tiết.";

    left.appendChild(t);
    left.appendChild(sub);

    const actions = document.createElement("div");
    actions.className = "iip-map-actions";

    const btnFit = document.createElement("button");
    btnFit.className = "iip-map-btn";
    btnFit.type = "button";
    btnFit.innerHTML = '<i class="fa-solid fa-maximize"></i> Hightlight tỉnh';

    // Basemap toggle removed per request (no Satellite mode).
    const btnTerrain = null;

    const btnProvinces = document.createElement("button");
    btnProvinces.className = "iip-map-btn";
    btnProvinces.type = "button";
    btnProvinces.innerHTML = '<i class="fa-solid fa-layer-group"></i> Ranh giới tỉnh';
    btnProvinces.dataset.on = "1";

    const btnToggle = document.createElement("button");
    btnToggle.className = "iip-map-btn";
    btnToggle.type = "button";
    btnToggle.innerHTML = '<i class="fa-solid fa-down-left-and-up-right-to-center"></i> ';

    actions.appendChild(btnFit);
    // no basemap button
    actions.appendChild(btnProvinces);
    actions.appendChild(btnToggle);

    head.appendChild(left);
    head.appendChild(actions);

    const mapWrap = document.createElement("div");
    mapWrap.className = "iip-map-wrap";

    // Prevent parent chat container from scrolling while user interacts with the map.
    // IMPORTANT: do NOT use capture=true here, otherwise MapLibre will NOT receive events
    // (causes "can't click/drag/zoom" bugs).
    try {
        const stopBubble = (ev) => { try { ev.stopPropagation(); } catch (_) {} };
        const stopAndPrevent = (ev) => {
            // ✅ Do NOT block pinch-zoom (2+ fingers). Only block 1-finger scroll chaining.
            const isPinch = !!(ev && ev.touches && ev.touches.length > 1);
            if (!isPinch) {
                try { ev.preventDefault?.(); } catch (_) {}
            }
            try { ev.stopPropagation?.(); } catch (_) {}
        };

        // stop page/chat scroll but keep events reaching MapLibre
        mapWrap.addEventListener("wheel", stopAndPrevent, { passive: false });
        mapWrap.addEventListener("touchmove", stopAndPrevent, { passive: false });
        ["touchstart", "pointerdown", "pointermove"].forEach((t) => {
            mapWrap.addEventListener(t, stopBubble, { passive: true });
        });
    } catch (_) {}


    const hint = document.createElement("div");
    hint.className = "iip-map-hint";
    hint.innerHTML = `• Click vào cụm để zoom. • Click vào điểm để xem popup.`;

    card.appendChild(head);
    card.appendChild(mapWrap);
    card.appendChild(hint);

    return { card, mapWrap, btnFit, btnToggle, btnTerrain, btnProvinces, hint, subEl: sub };
}


function createOsmStyle() {
    // Dùng trực tiếp custom style Mapbox của bạn (map trắng tự thiết kế trong Studio)
    // Không dùng thêm raster OSM / Satellite nữa.
    try {
        return "mapbox://styles/phu20032k1/cmkf0692r002f01sehtqv3nfo";
    } catch (e) {
        // fallback: vẫn dùng style custom đó
        return "mapbox://styles/phu20032k1/cmkf0692r002f01sehtqv3nfo";
    }
}


function updateBasemapButton(btn, mode) {
    if (!btn) return;
    const label = mode === "sat"
        ? '<i class="fa-solid fa-satellite"></i> Vệ tinh'
        : '<i class="fa-solid fa-map"></i> Nền thường';
    btn.innerHTML = label;
}


function setBasemapMode(map, mode = "osm") {
    try {
        const showSat = mode === "sat";
        const showOsm = mode === "osm";

        if (map.getLayer("sat")) map.setLayoutProperty("sat", "visibility", showSat ? "visible" : "none");
        if (map.getLayer("osm")) map.setLayoutProperty("osm", "visibility", showOsm ? "visible" : "none");
    } catch (_) {}
}



function setProvinceLayerVisible(map, visible) {
    try {
        const v = visible ? "visible" : "none";
        ["province-fill", "province-line", "province-highlight", "province-highlight-line", "province-label"].forEach(id => {
            if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
        });
    } catch (_) {}
}

function addIslandsLabels(map) {
    // Nhãn tiếng Việt cho 2 quần đảo.
    // Đồng thời phủ (mask) một vùng nhỏ quanh 2 quần đảo để tránh việc tile nền hiển thị nhãn/đường ranh gây nhiễu.
    try {
        const srcId = "vn-islands";
        const maskId = "vn-islands-mask";

        // 1) Mask: che bớt nhãn/đường ranh từ tile nền trong vùng biển quanh 2 quần đảo.
        if (!map.getSource(maskId)) {
            const mask = {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        properties: { kind: "mask" },
                        // Hoàng Sa (xấp xỉ vùng biển bao quanh)
                        geometry: {
                            type: "Polygon",
                            coordinates: [[
                                [110.6, 14.9],
                                [113.9, 14.9],
                                [113.9, 18.1],
                                [110.6, 18.1],
                                [110.6, 14.9]
                            ]]
                        }
                    },
                    {
                        type: "Feature",
                        properties: { kind: "mask" },
                        // Trường Sa (xấp xỉ vùng biển bao quanh)
                        geometry: {
                            type: "Polygon",
                            coordinates: [[
                                [112.3, 8.6],
                                [116.4, 8.6],
                                [116.4, 12.5],
                                [112.3, 12.5],
                                [112.3, 8.6]
                            ]]
                        }
                    }
                ]
            };
            map.addSource(maskId, { type: "geojson", data: mask });
        }

        if (!map.getLayer("vn-islands-mask-fill")) {
            map.addLayer({
                id: "vn-islands-mask-fill",
                type: "fill",
                source: maskId,
                paint: {
                    // màu xanh biển nhẹ để hòa với nền bản đồ; mục tiêu là che nhãn/đường ranh, không gây chú ý.
                    "fill-color": "rgba(135, 189, 206, 0)",
                    "fill-outline-color": "rgba(170, 220, 235, 0.0)"
                }
            });
        }

        // 2) Labels: nhãn do chúng ta tự đặt (ưu tiên tiếng Việt + theo yêu cầu “Việt Nam”).
        if (!map.getSource(srcId)) {
            const data = {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        properties: {
                            name: "Quần đảo Hoàng Sa (Việt Nam)",
                            title: "Quần đảo Hoàng Sa — của Việt Nam"
                        },
                        geometry: { type: "Point", coordinates: [112.30, 16.50] }
                    },
                    {
                        type: "Feature",
                        properties: {
                            name: "Quần đảo Trường Sa (Việt Nam)",
                            title: "Quần đảo Trường Sa — của Việt Nam"
                        },
                        geometry: { type: "Point", coordinates: [114.30, 10.50] }
                    }
                ]
            };
            map.addSource(srcId, { type: "geojson", data });
        }

        if (!map.getLayer("vn-islands-label")) {
            map.addLayer({
                id: "vn-islands-label",
                type: "symbol",
                source: srcId,
                layout: {
                    "text-field": ["get", "name"],
                    "text-size": 13,
                    "text-anchor": "center",
                    "text-allow-overlap": true
                },
                paint: {
                    "text-color": "#0f172a",
                    "text-halo-color": "#ffffff",
                    "text-halo-width": 1.4
                }
            });
        }
    } catch (_) {}
}

function ensureMapIcons(map) {
    // icon trắng đơn giản (SVG) để hiển thị trên nền tròn
    const kcnSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="white" d="M3 21V10l7-4v3l7-4v16H3zm2-2h2v-2H5v2zm0-4h2v-2H5v2zm4 4h2v-2H9v2zm0-4h2v-2H9v2zm4 4h2v-2h-2v2zm0-4h2v-2h-2v2z"/></svg>`;
    const ccnSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="white" d="M4 21V8l8-5 8 5v13H4zm2-2h3v-4H6v4zm5 0h3V9h-3v10zm5 0h3v-6h-3v6z"/></svg>`;

    const defs = [
        { name: 'kcn-icon', svg: kcnSvg },
        { name: 'ccn-icon', svg: ccnSvg }
    ];

    const tasks = defs.map(({ name, svg }) => {
        if (map.hasImage(name)) return Promise.resolve();
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                try { map.addImage(name, img, { pixelRatio: 2 }); } catch (_) {}
                resolve();
            };
            img.onerror = () => resolve();
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        });
    });

    return Promise.all(tasks);
}

async function addProvinceLayers(map, selectedProvinces = "") {
    try {
        const provGeo = await getProvinceGeojson().catch(() => null);
        if (!provGeo) return;
        try { map.__provGeo = provGeo; } catch (_) {}

        const sourceId = 'provinces';
        if (!map.getSource(sourceId)) {
            map.addSource(sourceId, { type: 'geojson', data: provGeo });
        }

        // lớp fill mờ để bắt hover
        if (!map.getLayer('province-fill')) {
            map.addLayer({
                id: 'province-fill',
                type: 'fill',
                source: sourceId,
                paint: { 'fill-color': '#94a3b8', 'fill-opacity': 0.06 },
                layout: { visibility: 'none' }
            });
        }

        if (!map.getLayer('province-line')) {
            map.addLayer({
                id: 'province-line',
                type: 'line',
                source: sourceId,
                paint: { 'line-color': '#64748b', 'line-width': 1 },
                layout: { visibility: 'none' }
            });
        }

        if (!map.getLayer('province-highlight')) {
            map.addLayer({
                id: 'province-highlight',
                type: 'fill',
                source: sourceId,
                filter: ['==', ['get', 'NAME_1'], ''],
                // Stronger highlight for better visibility.
                paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.38, 'fill-outline-color': '#1d4ed8' },
                layout: { visibility: 'none' }
            });
        }

        // add a bold outline above highlight fill
        if (!map.getLayer('province-highlight-line')) {
            map.addLayer({
                id: 'province-highlight-line',
                type: 'line',
                source: sourceId,
                filter: ['==', ['get', 'NAME_1'], ''],
                paint: { 'line-color': '#1d4ed8', 'line-width': 3 },
                layout: { visibility: 'none' }
            });
        }

        // label (tắt mặc định vì có thể rối)
        if (!map.getLayer('province-label')) {
            map.addLayer({
                id: 'province-label',
                type: 'symbol',
                source: sourceId,
                layout: {
                    'text-field': ['get', 'NAME_1'],
                    'text-size': 11,
                    'text-allow-overlap': false,
                    'text-anchor': 'center',
                    visibility: 'none'
                },
                paint: { 'text-color': '#475569', 'text-halo-color': '#ffffff', 'text-halo-width': 1 }
            });
        }

        // highlight nếu có tỉnh trong câu hỏi (1 hoặc nhiều tỉnh)
        try {
            const list = Array.isArray(selectedProvinces) ? selectedProvinces : (selectedProvinces ? [selectedProvinces] : []);
            const mapped = list.map(p => mapProvinceNameToGeo(p)).filter(Boolean);
            if (mapped.length && map.getLayer('province-highlight')) {
                const f = (mapped.length === 1)
            ? ['==', ['get', 'NAME_1'], mapped[0]]
            : ['in', ['get', 'NAME_1'], ['literal', mapped]];
                map.setFilter('province-highlight', f);
                if (map.getLayer('province-highlight-line')) map.setFilter('province-highlight-line', f);
            }
        } catch (_) {}

    } catch (e) {
        console.warn('addProvinceLayers error', e);
    }
}

function fitBoundsToFeatures(map, features) {
    try {
        if (!features || !features.length) return;
        const bounds = new mapboxgl.LngLatBounds();
        for (const f of features) {
            const c = f?.geometry?.coordinates;
            if (Array.isArray(c) && c.length >= 2) bounds.extend([Number(c[0]), Number(c[1])]);
        }
        if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { padding: 40, maxZoom: 12, duration: 600 });
        }
    } catch (e) { }
}

function renderIipMap(mapWrap, geojson, features, meta = {}) {
    if (typeof mapboxgl === "undefined") {
        mapWrap.innerHTML = `<div class="iip-map-error">⚠️ Không tải được thư viện bản đồ (mapbox-gl.js).</div>`;
        return null;
    }

    // Nếu mapWrap đã có map trước đó → xoá
    try {
        if (mapWrap.__iipMap && typeof mapWrap.__iipMap.remove === "function") {
            mapWrap.__iipMap.remove();
        }
    } catch (_) { }

    const map = new mapboxgl.Map({
        container: mapWrap,
        style: createOsmStyle(),
        center: [105.8342, 21.0278],
        zoom: 5.1
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), "top-right");

    const useCluster = (features?.length || 0) > 40;
    const data = buildGeojsonFromFeatures(features?.length ? features : (geojson?.features || []));

    map.on("load", async () => {
        await ensureMapIcons(map);
        // Province layer (tắt mặc định)
        await addProvinceLayers(map, meta?.province || "");
        // highlight (1 hoặc nhiều tỉnh)
        const __pvsForHl = meta?.provinces || meta?.province || "";
        setProvinceHighlightFilter(map, __pvsForHl);
        // Re-apply once after first idle (Mapbox đôi khi render chậm khi DOM/layout thay đổi).
        try {
            map.once("idle", () => {
                try { setProvinceLayerVisible(map, true); } catch (_) {}
                try { setProvinceHighlightFilter(map, __pvsForHl); } catch (_) {}
            });
        } catch (_) {}
        // Bật sẵn lớp "nền tỉnh"
        setProvinceLayerVisible(map, true);
        addIslandsLabels(map);

        // Click nhãn quần đảo → popup "title"
        try {
            map.on("click", "vn-islands-label", (e) => {
                const f = e?.features?.[0];
                if (!f) return;
                const coordinates = (f.geometry?.coordinates || []).slice();
                const title = f?.properties?.title || f?.properties?.name || "";
                // tránh nhảy cuộn do popup focus
                new mapboxgl.Popup({ closeButton: true, closeOnClick: true, focusAfterOpen: false })
                    .setLngLat(coordinates)
                    .setHTML(`<div style="font-weight:700;">${escapeHtmlGlobal(String(title))}</div>`)
                    .addTo(map);
            });
            map.on("mouseenter", "vn-islands-label", () => map.getCanvas().style.cursor = "pointer");
            map.on("mouseleave", "vn-islands-label", () => map.getCanvas().style.cursor = "");
        } catch (_) {}

        map.addSource("iip", {
            type: "geojson",
            data,
            cluster: useCluster,
            clusterMaxZoom: 12,
            clusterRadius: 42
        });

        if (useCluster) {
            map.addLayer({
                id: "clusters",
                type: "circle",
                source: "iip",
                filter: ["has", "point_count"],
                paint: {
                    "circle-radius": ["step", ["get", "point_count"], 18, 50, 22, 200, 28],
                    "circle-color": "#3b82f6",
                    "circle-opacity": 0.85
                }
            });

            map.addLayer({
                id: "cluster-count",
                type: "symbol",
                source: "iip",
                filter: ["has", "point_count"],
                layout: {
                    "text-field": ["get", "point_count_abbreviated"],
                    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
                    "text-size": 12
                },
                paint: { "text-color": "#ffffff" }
            });
        }

        // nền tròn theo loại (KCN/CCN)
        map.addLayer({
            id: "point-halo",
            type: "circle",
            source: "iip",
            filter: ["!", ["has", "point_count"]],
            paint: {
                "circle-radius": 11,
                "circle-color": [
                    "case",
                    ["==", ["get", "kind"], "KCN"], "#2563eb",
                    ["==", ["get", "kind"], "CCN"], "#f97316",
                    "#ef4444"
                ],
                "circle-opacity": 0.88,
                "circle-stroke-width": 2,
                "circle-stroke-color": "#ffffff"
            }
        });

        map.addLayer({
            id: "points",
            type: "symbol",
            source: "iip",
            filter: ["!", ["has", "point_count"]],
            layout: {
                "icon-image": [
                    "case",
                    ["==", ["get", "kind"], "CCN"], "ccn-icon",
                    "kcn-icon"
                ],
                "icon-size": 0.95,
                "icon-allow-overlap": true,
                "icon-anchor": "center"
            }
        });

        // click cluster → zoom
        if (useCluster) {
            map.on("click", "clusters", (e) => {
                const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
                const clusterId = features?.[0]?.properties?.cluster_id;
                const source = map.getSource("iip");
                if (!source || clusterId === undefined) return;

                source.getClusterExpansionZoom(clusterId, (err, zoom) => {
                    if (err) return;
                    map.easeTo({ center: features[0].geometry.coordinates, zoom });
                });
            });
            map.on("mouseenter", "clusters", () => map.getCanvas().style.cursor = "pointer");
            map.on("mouseleave", "clusters", () => map.getCanvas().style.cursor = "");
        }

        // click point → popup
        map.on("click", "points", (e) => {
            const f = e.features && e.features[0];
            if (!f) return;

            const coordinates = f.geometry.coordinates.slice();
            // tránh nhảy cuộn do popup focus
            new mapboxgl.Popup({ closeButton: true, closeOnClick: true, focusAfterOpen: false })
                .setLngLat(coordinates)
                .setHTML(buildFeaturePopupHtml(f))
                .addTo(map);
        });
        map.on("mouseenter", "points", () => map.getCanvas().style.cursor = "pointer");
        map.on("mouseleave", "points", () => map.getCanvas().style.cursor = "");
        // fit bounds: ưu tiên zoom theo ranh giới tỉnh nếu user hỏi theo tỉnh
        // ✅ Nếu truy vấn là 1 KCN/CCN cụ thể: auto zoom đúng điểm + mở popup
        try {
            if (meta?.focusFeature) {
                try {
                    const pv = String(meta.focusFeature?.properties?.province || "").trim();
                    if (pv) setProvinceHighlightFilter(map, [pv]);
                } catch (_) {}
                focusFeatureOnMap(map, meta.focusFeature);
            } else {
                const provQuery = (meta?.provinces && meta.provinces.length) ? meta.provinces : (meta?.province || "");
                const hasProv = Array.isArray(provQuery) ? provQuery.length : Boolean(provQuery);
                const ok = hasProv ? fitToProvinceByNames(map, map.__provGeo, provQuery) : false;
                if (!ok) fitBoundsToFeatures(map, data.features);
            }
        } catch (_) {
            fitBoundsToFeatures(map, data.features);
        }
    });

    mapWrap.__iipMap = map;
    return map;
}


// ✅ Đưa "danh sách + bản đồ" nằm ngang hàng (2 cột) khi có bảng dữ liệu trong bubble
function tryMakeIipSideBySide(botEl, mapCard, question) {
    try {
        if (!botEl || !mapCard) return false;
        const stack = botEl.querySelector(".bot-stack");
        if (!stack) return false;

        // tránh chạy nhiều lần
        if (stack.querySelector(".iip-side-by-side")) return false;

        const actions = stack.querySelector(".message-actions");
        const bubble = stack.querySelector(".message-bubble");
        if (!actions || !bubble) return false;

        // chỉ áp dụng khi trong bubble có bảng/thẻ dữ liệu (data-block)
        if (!bubble.querySelector(".data-block")) return false;

                // Chỉ bật layout side-by-side khi có:
        // - So sánh (>=2 tỉnh) HOẶC
        // - 1 tỉnh HOẶC
        // - 1 KCN/CCN cụ thể (bubble đã có thẻ .iip-detail-card)
        let _provs2 = [];
        let _prov1 = "";
        const _isFocusKcn = !!bubble.querySelector(".iip-detail-card");
        try {
            _provs2 = (extractProvincesFromText(String(question || ""), 2) || []).filter(Boolean);
        } catch (_) {
            _provs2 = [];
        }
        if (_provs2.length < 2) {
            try { _prov1 = String(extractProvinceFromText(String(question || "")) || "").trim(); } catch (_) { _prov1 = ""; }
            if (!_prov1 && !_isFocusKcn) return false;
        }

        const wrap = document.createElement("div");
        wrap.className = "iip-side-by-side";
        // ✅ Compare (>=2 tỉnh): xếp dọc để map full-width ngang bảng
        if (_provs2.length >= 2) {
            // ✅ Compare (>=2 tỉnh): layout 2 cột (bảng bên trái, map bên phải)
            wrap.classList.add('iip-compare');
        } else {
            // ✅ 1 tỉnh: side-by-side (table + map cạnh nhau)
            wrap.classList.add('iip-single');
        }

        // nếu có quá nhiều bảng/thẻ dữ liệu (>=3), cho phép cột trái cuộn để gọn
        try{
            const blockCount = bubble.querySelectorAll(".data-block").length;
            if (blockCount >= 3) wrap.classList.add("iip-many-blocks");
        }catch(_){ }


        const left = document.createElement("div");
        left.className = "iip-side-left";

        const right = document.createElement("div");
        right.className = "iip-side-right";

        // ✅ Desktop focus-KCN: chỉ đưa thẻ chi tiết lên trên cùng (full-width)
        // khi còn có ít nhất 1 khối dữ liệu khác (ví dụ: bảng kết quả).
        // Nếu chỉ có 2 khối (thẻ chi tiết + bản đồ) thì giữ side-by-side 55/45.
        try {
            const isDesktop = window.matchMedia && window.matchMedia("(min-width: 900px)").matches;
            const detail = bubble.querySelector(".iip-detail-card");
            const hasOtherBlocks = !!bubble.querySelector(".data-block:not(.iip-detail-card)");
            let movedDetail = false;

            if (isDesktop && detail && hasOtherBlocks) {
                const top = document.createElement("div");
                top.className = "iip-detail-top";
                // move detail out of bubble
                top.appendChild(detail);
                // insert above the side-by-side wrap (right before actions)
                stack.insertBefore(top, actions);
                movedDetail = true;
            }

            // ✅ Nếu đã đưa thẻ chi tiết lên trên nhưng phần còn lại không có bảng/thẻ nào,
            // thì cho bản đồ full-width (tránh map bị hẹp 45% và để trống bên trái).
            if (movedDetail) {
                const remaining = bubble.querySelectorAll(".data-block").length;
                if (remaining === 0) {
                    wrap.classList.add("iip-map-only");
                }
            }
        } catch (_) {}

        // move nodes
        left.appendChild(bubble);
        right.appendChild(mapCard);

        wrap.appendChild(left);
        wrap.appendChild(right);

        // chèn trước action buttons (bên dưới thẻ chi tiết nếu có)
        stack.insertBefore(wrap, actions);
        return true;
    } catch (_) {
        return false;
    }
}

async function appendIndustrialMapToBot(botEl, question, data) {
    if (!botEl) return false;
    if (botEl.querySelector(".iip-map-card")) return false;

    const visPre = (typeof extractExcelVisualize === "function") ? extractExcelVisualize(data) : null;
    if (!isIndustrialQuery(question) && !(visPre?.items?.length)) return false;

    let geo;
    try {
        geo = await getIndustrialGeojson();
    } catch (e) {
        // show error card
        const stack = botEl.querySelector(".bot-stack");
        const actions = botEl.querySelector(".message-actions");
        const card = document.createElement("div");
        card.className = "iip-map-card";
        card.innerHTML = `<div class="iip-map-error">⚠️ Không tải được dữ liệu bản đồ. Hãy chắc chắn file <b>${escapeHtmlGlobal(IIP_GEOJSON_PATH)}</b> nằm cùng thư mục với <b>index.html</b> và bạn chạy bằng server (Live Server / http.server).</div>`;
        if (stack && actions) stack.insertBefore(card, actions);
        else if (stack) stack.appendChild(card);
        else botEl.appendChild(card);
        return true;
    }

    // ưu tiên: nếu server trả excel_visualize → match theo items
    const vis = visPre;
    let r = null;

    // Luôn detect tỉnh từ câu hỏi (kể cả khi backend trả về bảng/items)
    const rAuto = filterFeaturesForQuestion(question, geo);

    let features = [];
    let subtitle = "";

    const tableNames = extractIipNamesFromRenderedTable(botEl);

    // Ưu tiên nhất: nếu trong bubble đã có bảng danh sách KCN/CCN → map theo đúng bảng để đồng bộ số lượng
    if (tableNames && tableNames.length) {
        features = matchFeaturesByItemNames(tableNames, geo.features);
        subtitle = features.length
            ? `Hiển thị ${features.length}/${tableNames.length} khu công nghiệp từ bảng kết quả.`
            : "Không match được theo bảng — hiển thị theo truy vấn.";
    } else     if (vis?.items?.length) {
        features = matchFeaturesByItemNames(vis.items, geo.features);
        subtitle = features.length
            ? `Hiển thị ${features.length} khu công nghiệp từ kết quả trả lời.`
            : "Không match được theo tên — hiển thị theo truy vấn.";
    }

    if (!features.length) {
        r = rAuto;
        features = r.filtered;
        {
            const provs = Array.isArray(r?.provinces) ? r.provinces.filter(Boolean) : [];
            if (provs.length >= 2) {
                // subtitle cho so sánh 2 tỉnh
                const canon = provs.map(p => mapProvinceNameToGeo(p));
                const counts = canon.map(c => features.filter(f => mapProvinceNameToGeo(String(f?.properties?.province || '').trim()) === c).length);
                subtitle = `So sánh theo tỉnh: ${provs[0]} vs ${provs[1]}. (${counts[0]} + ${counts[1]} điểm)`;
            } else if (r.province) {
                subtitle = `Lọc theo tỉnh: ${r.province}. (${features.length} điểm)`;
            } else {
                subtitle = `Hiển thị theo truy vấn. (${features.length} điểm)`;
            }
        }
        // nếu vẫn trống thì show full dataset
        if (!features.length) {
            features = geo.features.slice();
            subtitle = `Hiển thị toàn bộ dữ liệu. (${features.length} điểm)`;
        }
    }

// ✅ Nếu user hỏi CỤ THỂ 1 KCN/CCN: tự động định vị chính xác điểm đó trên bản đồ
// (tránh trường hợp đang fit theo tỉnh nên user phải tự tìm trong danh sách)
let __focusFeature = null;
let __wantExact = false;
try {
    if (!isCompareQuery(question)) {
        // Nếu lọc ra đúng 1 điểm thì focus luôn
        if (features && features.length === 1) {
            __focusFeature = features[0];
        } else {
            // Nếu đang có nhiều điểm, thử tìm điểm khớp nhất theo tên trong câu hỏi
            __focusFeature = detectFocusFeatureFromQuestion(question, features, geo.features);

            // Chỉ thu hẹp về 1 điểm khi câu hỏi mang tính định vị ("ở đâu", "địa chỉ", "chỉ đường", ...)
            const qt = normalizeViText(question);
            __wantExact = /(o dau|dia chi|chi duong|ban do|map|maps|google maps|den|toi|to|hien thi tren ban do)/.test(qt);
            if (__wantExact && __focusFeature) {
                features = [__focusFeature];
                const nm = String(__focusFeature?.properties?.name || '').trim();
                const pv = String(__focusFeature?.properties?.province || '').trim();
                subtitle = nm ? `Đã định vị: ${nm}${pv ? ' — ' + pv : ''}.` : subtitle;
            }
        }
    }
} catch (_) {
    __focusFeature = null;
    __wantExact = false;
}



    const stack = botEl.querySelector(".bot-stack");
    const actions = botEl.querySelector(".message-actions");

    // ✅ Nếu đã định vị 1 KCN/CCN cụ thể: hiển thị thẻ thông tin chi tiết (giá/địa điểm/diện tích/ngành nghề...)
    try {
        if (__focusFeature && !isCompareQuery(question)) {
            const bubble = botEl.querySelector(".message-bubble");
            if (bubble && !bubble.querySelector('.iip-detail-card')) {
                const t = String(bubble.textContent || '');
                const looksLikeError = /Bạn vui lòng nêu rõ|"error"|\berror\b/i.test(t) || !!bubble.querySelector('pre.json-block');
                const detailHtml = buildIipDetailCardHtml(__focusFeature);
                if (looksLikeError) {
                    bubble.innerHTML = detailHtml;
                } else {
                    bubble.insertAdjacentHTML('afterbegin', detailHtml);
                }
            }
        }
    } catch (_) {}


    // ✅ So sánh 2 tỉnh: luôn chèn danh sách (bảng) nếu backend không trả JSON list
    const __detectedProvinces = (() => {
        const out = [];
        const push = (p) => {
            const v = String(p || '').trim();
            if (!v) return;
            if (!out.includes(v)) out.push(v);
        };
        try { (rAuto?.provinces || []).forEach(push); } catch (_) {}
        try { (r?.provinces || []).forEach(push); } catch (_) {}
        try { if (vis?.province) push(vis.province); } catch (_) {}
        // Fallback: trích xuất tỉnh trực tiếp từ câu hỏi để đảm bảo highlight đủ khi so sánh
        try { (extractProvincesFromText(String(question || ""), 2) || []).forEach(push); } catch (_) {}
        return out;
    })();

    try {
        if (__detectedProvinces.length >= 2) {
            // chèn bảng danh sách theo từng tỉnh (từ features đã lọc)
            ensureCompareListsInBubble(botEl, features, __detectedProvinces);
        }
    } catch (_) {}

    const { card, mapWrap, btnFit, btnToggle, btnTerrain, btnProvinces, hint, subEl } = createIipMapCard({
        title: "Bản đồ khu công nghiệp",
        subtitle
    });

    if (hint) hint.textContent = `• Click vào cụm để zoom. • Click vào điểm để xem chi tiết. • Tổng: ${features.length} điểm.`;

    if (stack && actions) stack.insertBefore(card, actions);
    else if (stack) stack.appendChild(card);
    else botEl.appendChild(card);

    // Force wide bubble
    try {
        const bubble = botEl.querySelector(".message-bubble");
        if (bubble) bubble.classList.add("wide");
    } catch (_) {}

    // ✅ Đưa danh sách và bản đồ nằm ngang hàng (desktop)
    try { tryMakeIipSideBySide(botEl, card, question); } catch (_) {}

    const map = renderIipMap(mapWrap, geo, features, { question, province: (rAuto?.province || r?.province || vis?.province || ""), provinces: __detectedProvinces, focusFeature: __focusFeature });

    btnFit?.addEventListener("click", () => {
        try {
            if (!map) return;
            fitBoundsToFeatures(map, buildGeojsonFromFeatures(features).features);
        } catch (_) {}
    });

    btnToggle?.addEventListener("click", () => {
        const isHidden = mapWrap.style.display === "none";
        mapWrap.style.display = isHidden ? "" : "none";
        if (hint) hint.style.display = isHidden ? "" : "none";
        btnToggle.innerHTML = isHidden
            ? '<i class="fa-solid fa-down-left-and-up-right-to-center"></i> Thu gọn'
            : '<i class="fa-solid fa-up-right-and-down-left-from-center"></i> Mở rộng';
        if (isHidden) {
            // khi mở lại: map cần resize
            try { map?.resize?.(); } catch (_) {}
        }
    });

    // Basemap (Satellite) toggle removed.



    btnProvinces?.addEventListener("click", () => {
        if (!map) return;
        const on = (btnProvinces.dataset.on || "0") === "1";
        const next = !on;
        btnProvinces.dataset.on = next ? "1" : "0";
        btnProvinces.innerHTML = next
            ? '<i class="fa-solid fa-layer-group"></i> Tắt tỉnh'
            : '<i class="fa-solid fa-layer-group"></i> Tỉnh';
        setProvinceLayerVisible(map, next);
        // nếu có tỉnh trong query thì highlight khi bật
        if (next) {
            const pvs = (__detectedProvinces && __detectedProvinces.length)
                ? __detectedProvinces
                : ((r?.province || vis?.province) ? [r?.province || vis?.province] : []);
            setProvinceHighlightFilter(map, pvs);
        }
    });


    // ✅ Click vào dòng trong bảng/thẻ để focus điểm trên bản đồ
    try {
        if (map) {
            // ✅ Helper: cuộn (smooth) để đưa map của *đoạn chat hiện tại* vào khung nhìn
            // - Hoạt động cả desktop & mobile
            // - Tự mở map nếu đang thu gọn
            const __scrollMapIntoView = () => {
                try {
                    // Map card của đúng message hiện tại
                    const targetCard = card || botEl.querySelector(".iip-map-card") || mapWrap;
                    if (!targetCard) return;

                    // Nếu map đang thu gọn thì mở lại (để user thấy map khi cuộn đến)
                    try {
                        const isHidden = mapWrap && mapWrap.style && mapWrap.style.display === "none";
                        if (isHidden) {
                            mapWrap.style.display = "";
                            if (hint) hint.style.display = "";
                            if (btnToggle) {
                                btnToggle.innerHTML = '<i class="fa-solid fa-down-left-and-up-right-to-center"></i> Thu gọn';
                            }
                            try { map?.resize?.(); } catch (_) {}
                        }
                    } catch (_) {}

                    // Ưu tiên scroll trong khung chatContainer (single scroll container)
                    const container = document.getElementById("chatContainer") || document.scrollingElement || document.documentElement;
                    if (!container) return;

                    // Scroll có offset nhẹ để tránh dính sát mép trên
                    const containerRect = container.getBoundingClientRect ? container.getBoundingClientRect() : null;
                    const targetRect = targetCard.getBoundingClientRect ? targetCard.getBoundingClientRect() : null;
                    if (!containerRect || !targetRect) {
                        try { targetCard.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) {}
                        return;
                    }

                    // targetTop trong coordinate của container
                    const currentTop = (typeof container.scrollTop === "number") ? container.scrollTop : 0;
                    const delta = (targetRect.top - containerRect.top);
                    const top = Math.max(0, currentTop + delta - 16);

                    try {
                        container.scrollTo({ top, behavior: "smooth" });
                    } catch (_) {
                        container.scrollTop = top;
                    }

                    // Hiệu ứng highlight nhẹ để user nhận ra map vừa được cuộn tới
                    try {
                        targetCard.classList.add("scroll-highlight");
                        setTimeout(() => { try { targetCard.classList.remove("scroll-highlight"); } catch (_) {} }, 1200);
                    } catch (_) {}
                } catch (_) {}
            };

            const rows = botEl.querySelectorAll(".data-table tbody tr");
            rows.forEach(tr => {
                tr.style.cursor = "pointer";
                tr.addEventListener("click", (ev) => {
                    try { __markRichInteraction && __markRichInteraction(); } catch (_) {}
                    try { ev && ev.preventDefault && ev.preventDefault(); } catch (_) {}
                    try { ev && ev.stopPropagation && ev.stopPropagation(); } catch (_) {}
                    const tds = tr.querySelectorAll("td");
                    const nameCell = tds && tds.length >= 2 ? tds[1] : null;
                    const nm = nameCell ? nameCell.textContent.trim() : "";
                    const f = findBestFeatureByName(nm, geo.features);
                    // ✅ Cuộn map của message hiện tại ra trước, rồi focus điểm
                    __scrollMapIntoView();
                    if (f) focusFeatureOnMap(map, f);
                });
            });

            // ✅ List (cards view): click vào card hoặc title đều scroll + focus
            const cards = botEl.querySelectorAll(".data-card");
            cards.forEach(cardEl => {
                try { cardEl.style.cursor = "pointer"; } catch (_) {}
                cardEl.addEventListener("click", (ev) => {
                    try { __markRichInteraction && __markRichInteraction(); } catch (_) {}
                    try { ev && ev.preventDefault && ev.preventDefault(); } catch (_) {}
                    try { ev && ev.stopPropagation && ev.stopPropagation(); } catch (_) {}

                    const titleNode = cardEl.querySelector(".data-card-title");
                    const txt = (titleNode ? titleNode.textContent : (cardEl.textContent || "")) || "";
                    // format: "1. Tên KCN" hoặc "Tên KCN"
                    const nm = String(txt || "").replace(/^\s*\d+\.\s*/, "").trim();
                    const f = findBestFeatureByName(nm, geo.features);

                    __scrollMapIntoView();
                    if (f) focusFeatureOnMap(map, f);
                });
            });
        }
    } catch (_) {}

    setTimeout(scrollToBottom, 80);
    return true;
}


// ⭐ jsonToIndustrialTableV2 giữ nguyên để render bảng từ JSON
function jsonToIndustrialTableV2(data) {
    if (!Array.isArray(data) || data.length === 0) {
        return "<p>Không có dữ liệu.</p>";
    }

    // ⭐ TỰ ĐỘNG ÁNH XẠ KEY TIẾNG VIỆT → KEY CHUẨN
    function normalize(item) {
        return {
            name: item["Tên"] || item["ten"] || item["Name"] || item.name || "",
            address: item["Địa chỉ"] || item["diachi"] || item["Address"] || item.address || "",
            area: item["Tổng diện tích"] || item["dien_tich"] || item["area"] || item["Area"] || "",
            industry: item["Ngành nghề"] || item["nganh_nghe"] || item["Industry"] || item.industry || ""
        };
    }

    // ⭐ CHUẨN HÓA MỌI PHẦN TỬ
    data = data.map(normalize);

    const total = data.length;

    let rows = "";
    let cards = "";

    data.forEach((item, idx) => {
        const industries = (item.industry || "")
            .split(/[\n•;]/)
            .map(i => i.trim())
            .filter(Boolean);

        const chips = industries.length
            ? industries.map(i => `<span class="chip">${escapeHtmlGlobal(i)}</span>`).join("")
            : `<span class="chip">—</span>`;

        rows += `
          <tr>
            <td class="col-stt">${idx + 1}</td>
            <td>${escapeHtmlGlobal(String(item.name || ""))}</td>
            <td>${escapeHtmlGlobal(String(item.address || ""))}</td>
            <td class="col-area">${escapeHtmlGlobal(String(item.area || ""))}</td>
            <td><div class="chip-row">${chips}</div></td>
          </tr>
        `;

        cards += `
          <article class="data-card">
            <div class="data-card-head">
              <div class="data-card-title">${idx + 1}. ${escapeHtmlGlobal(String(item.name || ""))}</div>
              <div class="data-card-badge">${escapeHtmlGlobal(String(item.area || "")) || "—"}</div>
            </div>

            <div class="data-card-line">
              <div class="data-card-label">Địa chỉ</div>
              <div class="data-card-value">${escapeHtmlGlobal(String(item.address || "")) || "—"}</div>
            </div>

            <div class="data-card-line">
              <div class="data-card-label">Ngành nghề</div>
              <div class="data-card-value"><div class="chip-row">${chips}</div></div>
            </div>
          </article>
        `;
    });

    const html = `
      <div class="data-block" data-view="table">
        <div class="data-block-toolbar">
          <div class="data-block-title">Kết quả: <strong>${total}</strong></div>
          <div class="data-view-tabs" role="tablist" aria-label="Chế độ xem">
            <button class="data-view-tab active" type="button" data-view-target="table" role="tab" aria-selected="true">
              <i class="fa-solid fa-table"></i> Bảng
            </button>
            <button class="data-view-tab" type="button" data-view-target="cards" role="tab" aria-selected="false">
              <i class="fa-regular fa-rectangle-list"></i> Thẻ
            </button>
          </div>
        </div>

        <div class="data-panel active" data-view-panel="table">
          <div class="data-table-wrap" role="region" aria-label="Bảng dữ liệu" tabindex="0">
            <table class="data-table">
              <thead>
                <tr>
                  <th class="col-stt">STT</th>
                  <th>Tên</th>
                  <th>Địa chỉ</th>
                  <th class="col-area">Diện tích</th>
                  <th>Ngành nghề</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>
        </div>

        <div class="data-panel" data-view-panel="cards">
          <div class="data-cards-wrap" role="region" aria-label="Thẻ dữ liệu" tabindex="0">
            <div class="data-cards">
              ${cards}
            </div>
          </div>
        </div>
      </div>
    `;

    return html;
}



let speechLang = "vi-VN"; // mặc định
// ⭐ HÀM LOAD UI THEO NGÔN NGỮ
async function loadLanguageUI(langCode) {
    try {
        const res = await fetch(`/lang/${langCode}.json`);
        const dict = await res.json();

        // Welcome text
        const w = document.getElementById("welcomeMessageText");
        if (w) w.innerText = dict.welcome;

        // Placeholder input
        const input = document.getElementById("messageInput");
        if (input) input.placeholder = dict.placeholder;

        // New chat button
        const newChat = document.getElementById("newChatBtn");
        if (newChat) newChat.innerHTML = `<i class="fas fa-plus"></i> ${dict.new_chat}`;

    } catch (err) {
        console.warn("Không thể tải file ngôn ngữ:", langCode, err);
    }
}









// ============================================================
//  CHAT + VOICE + FILE + HAMBURGER + NEWS (FULL, KHÔNG LƯỢC)
// ============================================================

document.addEventListener('DOMContentLoaded', function () {




    // =========================
    // DOM elements CHAT
    // =========================
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const chatContainer = document.getElementById('chatContainer');
    const welcomeMessage = document.getElementById('welcomeMessage');
    const messageInputContainer = document.getElementById('messageInputContainer');
    const fileButton = document.getElementById('fileButton');
    const voiceButton = document.getElementById('voiceButton');
    const fileInput = document.getElementById('fileInput');

    const loginPromptModal = document.getElementById('loginPromptModal');
    const loginPromptContinueGuestBtn = document.getElementById('loginPromptContinueGuestBtn');
    const loginPromptLoginBtn = document.getElementById('loginPromptLoginBtn');
    const loginPromptSignupBtn = document.getElementById('loginPromptSignupBtn');

    // =========================
    // Auto-hide composer (message input bar) on scroll down
    // - Shows again on scroll up, near-bottom, or when the input is focused
    // =========================
    (function setupComposerAutoHide(){
        if (!chatContainer || !messageInputContainer) return;

        let lastTop = chatContainer.scrollTop || 0;
        let lastTs = 0;

        const showComposer = () => document.body.classList.remove('composer-hidden');
        const hideComposer = () => document.body.classList.add('composer-hidden');

        const isNearBottom = () => {
            const dist = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
            return dist < 90;
        };

        // Keep composer visible while typing
        messageInput.addEventListener('focus', showComposer);
        messageInput.addEventListener('click', showComposer);
        messageInput.addEventListener('input', showComposer);

        // Also show when user taps the composer area
        messageInputContainer.addEventListener('pointerdown', showComposer, { passive: true });

        // If the UI returns to the "centered" state (e.g., new chat), ensure the composer is visible.
        try {
            const mo = new MutationObserver(() => {
                if (messageInputContainer.classList.contains('centered')) showComposer();
            });
            mo.observe(messageInputContainer, { attributes: true, attributeFilter: ['class'] });
        } catch (_) {
            // ignore
        }

        chatContainer.addEventListener('scroll', () => {
            // Only apply when we are in "has messages" state (composer is bottom-fixed)
            if (messageInputContainer.classList.contains('centered')) return;

            const now = Date.now();
            // Throttle for performance
            if (now - lastTs < 40) return;
            lastTs = now;

            const top = chatContainer.scrollTop;
            const delta = top - lastTop;
            lastTop = top;

            // Ignore tiny scroll jitter
            if (Math.abs(delta) < 4) return;

            // Never hide when near bottom (so user can continue to type quickly)
            if (isNearBottom()) {
                showComposer();
                return;
            }

            // Never hide while focused
            if (document.activeElement === messageInput) {
                showComposer();
                return;
            }

            if (delta > 0) hideComposer();
            else showComposer();
        }, { passive: true });
    })();


    

    // =========================
    // Giới hạn 5 câu hỏi cho khách + modal nhắc đăng nhập
    // =========================
    const GUEST_QUESTION_COUNT_KEY = "chatiip_guest_question_count";
    const GUEST_LOGIN_PROMPT_ALWAYS_KEY = "chatiip_guest_login_prompt_always";

    function getGuestQuestionCount() {
        try {
            const raw = localStorage.getItem(GUEST_QUESTION_COUNT_KEY);
            const n = parseInt(raw || "0", 10);
            if (!Number.isFinite(n) || n < 0) return 0;
            return n;
        } catch (_) {
            return 0;
        }
    }

    function incrementGuestQuestionCount() {
        try {
            let n = getGuestQuestionCount();
            n += 1;
            localStorage.setItem(GUEST_QUESTION_COUNT_KEY, String(n));
            if (n >= 7) {
                localStorage.setItem(GUEST_LOGIN_PROMPT_ALWAYS_KEY, "1");
            }
            return n;
        } catch (_) {
            return 0;
        }
    }

    function shouldAlwaysShowLoginPrompt() {
        try {
            return localStorage.getItem(GUEST_LOGIN_PROMPT_ALWAYS_KEY) === "1";
        } catch (_) {
            return false;
        }
    }

    function openLoginPromptModal() {
        if (!loginPromptModal) return;
        loginPromptModal.classList.add("is-open");
        loginPromptModal.setAttribute("aria-hidden", "false");
    }

    function closeLoginPromptModal() {
        if (!loginPromptModal) return;
        loginPromptModal.classList.remove("is-open");
        loginPromptModal.setAttribute("aria-hidden", "true");
    }

    // Gán sự kiện cho nút trong modal
    if (loginPromptContinueGuestBtn) {
        loginPromptContinueGuestBtn.addEventListener("click", function () {
            closeLoginPromptModal();
        });
    }

    if (loginPromptModal) {
        loginPromptModal.addEventListener("click", function (ev) {
            try {
                if (ev.target === loginPromptModal || ev.target.classList.contains("login-prompt-backdrop")) {
                    closeLoginPromptModal();
                }
            } catch (_) {}
        });


    if (loginPromptLoginBtn) {
        loginPromptLoginBtn.addEventListener("click", function (ev) {
            try { ev.preventDefault(); } catch (_) {}
            try { closeLoginPromptModal(); } catch (_) {}
            try {
                const btn = document.getElementById("loginOpenBtn");
                if (btn) btn.click();
            } catch (_) {}
        });
    }

    if (loginPromptSignupBtn) {
        loginPromptSignupBtn.addEventListener("click", function (ev) {
            try { ev.preventDefault(); } catch (_) {}
            try { closeLoginPromptModal(); } catch (_) {}
            try {
                const btn = document.getElementById("registerOpenBtn");
                if (btn) btn.click();
            } catch (_) {}
        });
    }

    }


// =========================
    // Autosave: lưu metadata đoạn chat sau 10 phút không tương tác + khi rời tab
    // Mục tiêu: thoát ra ~10 phút quay lại vẫn thấy đoạn chat trong sidebar, kể cả guest.
    // =========================
    var __chatAutosaveTimer = null;
    const CHAT_AUTOSAVE_IDLE_MS = 10 * 60 * 1000;

    function getMetaFromCache(sessionId) {
        try {
            if (!sessionId) return { title: "Đoạn chat", preview: "" };
            const cached = readChatCacheByKey(getChatCacheKey(sessionId));
            const msgs = cached && Array.isArray(cached.messages) ? cached.messages : [];

            let title = "Đoạn chat";
            for (const m of msgs) {
                if (String(m?.role || "") === "user") {
                    const t = String(m?.text ?? "").trim();
                    if (t) { title = t; break; }
                }
            }

            let preview = "";
            for (let i = msgs.length - 1; i >= 0; i--) {
                const m = msgs[i];
                if (!m) continue;
                const raw = m.text ?? m.content ?? "";
                if (raw == null) continue;
                const s = (typeof raw === "string") ? raw : JSON.stringify(raw);
                if (String(s || "").trim()) { preview = s; break; }
            }

            return { title, preview };
        } catch (_) {
            return { title: "Đoạn chat", preview: "" };
        }
    }

    function saveActiveChatMetaNow(reason) {
        try {
            const sid = getBackendSessionId();
            if (!sid) return;
            if (typeof upsertSession !== "function") return;

            const ownerId = (typeof getHistoryOwnerId === "function") ? getHistoryOwnerId() : (getLoggedInUser()?.id || "guest");
            const loggedIn = (typeof isLoggedIn === "function") ? isLoggedIn() : !!getLoggedInUser()?.id;

            const meta = getMetaFromCache(sid);

            // Nếu đã có title custom thì giữ nguyên
            try {
                const list = (typeof readSessions === "function") ? readSessions(ownerId) : [];
                const cur = list.find(s => String(s?.sessionId || "") === String(sid));
                if (cur && cur.title && String(cur.title).trim() && cur.title !== "Đoạn chat") {
                    meta.title = String(cur.title);
                }
            } catch (_) {}

            upsertSession(ownerId, sid, { title: meta.title, preview: meta.preview });
            if (loggedIn) {
                try { upsertSessionToServer(sid, { title: meta.title, preview: meta.preview, reason }); } catch (_) {}
            }

            try { updateHistoryUI(historySearchInput ? historySearchInput.value : ""); } catch (_) {}
        } catch (_) {}
    }

    function scheduleChatAutosave() {
        try {
            if (__chatAutosaveTimer) clearTimeout(__chatAutosaveTimer);
            __chatAutosaveTimer = setTimeout(() => {
                saveActiveChatMetaNow("idle-10m");
            }, CHAT_AUTOSAVE_IDLE_MS);
        } catch (_) {}
    }

    // Save when user hides tab / closes page
    try {
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) saveActiveChatMetaNow("hidden");
        });
        window.addEventListener("beforeunload", () => {
            saveActiveChatMetaNow("unload");
        });
    } catch (_) {}



// =========================
// Mobile viewport + iOS keyboard fix
// - Uses CSS vars: --app-height, --keyboard-offset
// =========================
const __rootStyle = document.documentElement.style;

function __setAppHeight() {
    try { __rootStyle.setProperty("--app-height", `${window.innerHeight}px`); } catch (_) {}
}

function __setKeyboardOffset() {
    try {
        if (!window.visualViewport) {
            __rootStyle.setProperty("--keyboard-offset", "0px");
            return;
        }
        const vv = window.visualViewport;
        const bottomInset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
        __rootStyle.setProperty("--keyboard-offset", `${bottomInset}px`);
    } catch (_) {
        try { __rootStyle.setProperty("--keyboard-offset", "0px"); } catch (_) {}
    }
}

__setAppHeight();
__setKeyboardOffset();

window.addEventListener("resize", () => {
    __setAppHeight();
    __setKeyboardOffset();
});

if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", __setKeyboardOffset);
    window.visualViewport.addEventListener("scroll", __setKeyboardOffset);
}

// Keep latest message visible when keyboard opens/closes
// (Auto-scroll on focus/blur removed: only scroll on new user message or bot reply)

// =========================
// ⭐ FIX QUAN TRỌNG: Auto scroll (single-scroll container)
// =========================
let __suspendAutoScrollUntil = 0;
const AUTO_SCROLL_NEAR_BOTTOM_PX = 160;

function __markRichInteraction() {
    try { __suspendAutoScrollUntil = Date.now() + 1200; } catch (_) {}
}

function __isNearBottom() {
    try {
        if (!chatContainer) return true;
        const dist = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
        return dist <= AUTO_SCROLL_NEAR_BOTTOM_PX;
    } catch (_) {
        return true;
    }
}

// =========================
// ⭐ FIX QUAN TRỌNG: Auto scroll (single-scroll container)
// =========================
function scrollToBottom(behavior = "smooth", force = false) {
    if (!chatContainer) return;
    // 🔒 Theo yêu cầu: chỉ cuộn khi người dùng bấm Gửi hoặc bấm nút cuộn xuống.
    if (!force) return;

    // Khi đang sửa tin nhắn thì KHÔNG tự kéo xuống (đứng yên tại vị trí đang sửa)
    try {
        if (!force && !!chatContainer.querySelector('.user-message.editing')) return;
    } catch (_) {}

    // Khi người dùng đang tương tác với bảng / bản đồ thì KHÔNG auto-scroll (tránh nhảy cuộn khó chịu)
    try {
        if (!force && Date.now() < __suspendAutoScrollUntil) return;
    } catch (_) {}

    // Chỉ auto-scroll nếu đang ở gần đáy (giống ChatGPT). Nếu user đang đọc phía trên thì giữ nguyên.
    try {
        if (!force && !__isNearBottom()) return;
    } catch (_) {}

    requestAnimationFrame(() => {
        try {
            chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior });
        } catch (e) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    });
}

// =========================
// ⭐ Scroll-to-bottom button (manual jump)
// =========================
const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");

function __updateScrollToBottomBtn() {
    try {
        if (!scrollToBottomBtn || !chatContainer) return;

        // Không hiện nút khi chưa có nội dung để cuộn
        const canScroll = (chatContainer.scrollHeight || 0) > (chatContainer.clientHeight || 0) + 10;
        if (!canScroll) {
            scrollToBottomBtn.classList.remove("show");
            return;
        }

        const dist = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;

        // Chỉ hiện khi user ở xa đáy một khoảng đủ lớn
        if (dist > 220) {
            scrollToBottomBtn.classList.add("show");
        } else {
            scrollToBottomBtn.classList.remove("show");
        }
    } catch (_) {}
}

try {
    if (scrollToBottomBtn && chatContainer) {
        scrollToBottomBtn.addEventListener("click", () => {
            scrollToBottom("smooth", true);
            // update sớm để tránh bị giữ trạng thái "show" trong lúc đang animation
            setTimeout(__updateScrollToBottomBtn, 50);
        });

        chatContainer.addEventListener("scroll", __updateScrollToBottomBtn, { passive: true });
        window.addEventListener("resize", __updateScrollToBottomBtn);
        setTimeout(__updateScrollToBottomBtn, 300);
    }
} catch (_) {}


// =========================
// ⭐ RICH_SCROLL_GUARDS: chặn cuộn lan (scroll chaining) + tạm dừng auto-scroll khi tương tác bảng/bản đồ
// =========================
(function RICH_SCROLL_GUARDS() {
    try {
        const richSelector = '.data-table-wrap, .data-cards-wrap, .compare-iip-lists, .iip-map-wrap, .mapboxgl-map, .mapboxgl-canvas-container';

        const closestRich = (el) => {
            try { return el && el.closest ? el.closest(richSelector) : null; } catch (_) { return null; }
        };

        // Mark interaction to suppress auto-scroll for a short time
        ['pointerdown', 'touchstart', 'mousedown'].forEach((evt) => {
            document.addEventListener(evt, (e) => {
                if (closestRich(e.target)) __markRichInteraction();
            }, { capture: true, passive: true });
        });

        // Wheel scroll: block scroll chaining ONLY when the inner scroller is at an edge.
        // Important: If we preventDefault while the inner region can still scroll,
        // we would disable the browser's native scrolling (common on iOS/Android
        // and desktop mobile emulators).
        document.addEventListener('wheel', (e) => {
            const wrap = closestRich(e.target);
            if (!wrap) return;
            __markRichInteraction();

            // Only guard for scrollable regions (tables/cards). Map has its own guards.
            if (!(wrap.classList && (wrap.classList.contains('data-table-wrap') || wrap.classList.contains('data-cards-wrap')))) return;

            const canY = wrap.scrollHeight > wrap.clientHeight + 1;
            const canX = wrap.scrollWidth > wrap.clientWidth + 1;
            if (!canY && !canX) return;

            const dy = e.deltaY || 0;
            const dx = e.deltaX || 0;
            const useY = Math.abs(dy) >= Math.abs(dx);

            // Block ONLY when user is trying to scroll past an edge, which would
            // otherwise "chain" to the parent scroller.
            let shouldBlock = false;
            if (useY && canY) {
                const atTop = wrap.scrollTop <= 0;
                const atBottom = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 1;
                if ((dy < 0 && atTop) || (dy > 0 && atBottom)) shouldBlock = true;
            } else if (!useY && canX) {
                const atLeft = wrap.scrollLeft <= 0;
                const atRight = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 1;
                if ((dx < 0 && atLeft) || (dx > 0 && atRight)) shouldBlock = true;
            }

            if (shouldBlock) {
                try { e.preventDefault(); } catch (_) {}
                try { e.stopPropagation(); } catch (_) {}
            }
        }, { capture: true, passive: false });

        // Touch move: same idea as wheel. Only block when user is trying to scroll
        // past an edge (to prevent parent scroll), otherwise allow native scrolling.
        let lastTouchX = 0;
        let lastTouchY = 0;
        document.addEventListener('touchstart', (e) => {
            const t = e.touches && e.touches[0];
            if (!t) return;
            lastTouchX = t.clientX;
            lastTouchY = t.clientY;
        }, { capture: true, passive: true });

        document.addEventListener('touchmove', (e) => {
            const wrap = closestRich(e.target);
            if (!wrap) return;
            __markRichInteraction();

            // ✅ Allow pinch-zoom (2+ fingers) on rich content
            if (e.touches && e.touches.length > 1) return;

            if (!(wrap.classList && (wrap.classList.contains('data-table-wrap') || wrap.classList.contains('data-cards-wrap')))) return;

            const t = e.touches && e.touches[0];
            if (!t) return;
            const dx = lastTouchX - t.clientX;
            const dy = lastTouchY - t.clientY;
            lastTouchX = t.clientX;
            lastTouchY = t.clientY;

            const canY = wrap.scrollHeight > wrap.clientHeight + 1;
            const canX = wrap.scrollWidth > wrap.clientWidth + 1;
            if (!canY && !canX) return;

            const useY = Math.abs(dy) >= Math.abs(dx);

            let shouldBlock = false;
            if (useY && canY) {
                const atTop = wrap.scrollTop <= 0;
                const atBottom = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 1;
                if ((dy < 0 && atTop) || (dy > 0 && atBottom)) shouldBlock = true;
            } else if (!useY && canX) {
                const atLeft = wrap.scrollLeft <= 0;
                const atRight = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 1;
                if ((dx < 0 && atLeft) || (dx > 0 && atRight)) shouldBlock = true;
            }

            if (shouldBlock) {
                try { e.preventDefault(); } catch (_) {}
                try { e.stopPropagation(); } catch (_) {}
            }
        }, { capture: true, passive: false });

    } catch (e) {
        console.warn('RICH_SCROLL_GUARDS init failed', e);
    }
})();



    // =========================
    // Responsive helpers
    // =========================
    function isMobileViewport() {
        try {
            return window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
        } catch (e) {
            return window.innerWidth <= 768;
        }
    }

    // =========================
    // Chart image preview overlay (zoom-friendly on mobile)
    // =========================
    function ensureImagePreviewOverlay() {
        let overlay = document.getElementById("imgPreviewOverlay");
        if (overlay) return overlay;

        overlay = document.createElement("div");
        overlay.id = "imgPreviewOverlay";
        overlay.className = "img-preview-overlay";
        overlay.innerHTML = `
          <div class="img-preview-inner" role="dialog" aria-modal="true" aria-label="Xem biểu đồ">
            <button class="img-preview-close" type="button" aria-label="Đóng">
              <i class="fas fa-times"></i>
            </button>
            <img id="imgPreviewTarget" alt="Biểu đồ" />
          </div>
        `;

        document.body.appendChild(overlay);

        const close = () => {
            overlay.classList.remove("open");
            document.body.classList.remove("modal-open");
        };

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) close();
        });
        overlay.querySelector(".img-preview-close")?.addEventListener("click", close);
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && overlay.classList.contains("open")) close();
        });

        return overlay;
    }

    function openImagePreview(src, alt) {
        const overlay = ensureImagePreviewOverlay();
        const img = document.getElementById("imgPreviewTarget");
        if (img) {
            img.src = src;
            img.alt = alt || "Biểu đồ";
        }
        overlay.classList.add("open");
        document.body.classList.add("modal-open");
    }

    function setDataBlockView(block, target) {
        if (!block) return;
        const tab = block.querySelector(`.data-view-tab[data-view-target="${target}"]`);
        if (tab && !tab.classList.contains("active")) tab.click();
    }

    function autoPreferCardsOnMobile(root) {
        if (!root || !isMobileViewport()) return;
        root.querySelectorAll?.(".data-block")?.forEach?.((block) => {
            if (block.querySelector('.data-view-tab[data-view-target="cards"]')) {
                setDataBlockView(block, "cards");
            }
        });
    }


    // ⭐ Auto expand textarea (tự mở rộng ô nhập tin nhắn)
    messageInput.addEventListener("input", function () {
        this.style.height = "auto";                // reset chiều cao -> giúp tính đúng
        this.style.height = this.scrollHeight + "px";  // cao bằng đúng nội dung

        // Nếu cao hơn 120px -> bật scroll để không vượt quá màn hình
        if (this.scrollHeight > 120) {
            this.style.overflowY = "scroll";
        } else {
            this.style.overflowY = "hidden";
        }
    });




    // trạng thái (duy trì tên biến cũ để tránh lỗi)
    let isRecording = false;
    let recordingTimer = null;
    let recordingTime = 0;

    // Google STT (MediaRecorder)
    let mediaRecorder = null;
    let mediaStream = null;
    let mediaChunks = [];


    // ====================  GỬI TIN NHẮN VĂN BẢN  ====================
    
    // ====================  JSON helpers (deep parse) ====================
    function tryParseJsonDeep(input, maxDepth = 3) {
        let cur = input;
        for (let i = 0; i < maxDepth; i++) {
            if (typeof cur !== "string") break;
            const s = cur.trim();
            if (!s) break;
            try {
                cur = JSON.parse(s);
            } catch (e) {
                break;
            }
        }
        return cur;
    }

    function looksLikeStructuredViz(obj) {
        if (!obj || typeof obj !== "object") return false;
        const t = String(obj.type || obj.kind || "").toLowerCase();
        const fmt = String(obj?.payload?.format || obj?.format || "").toLowerCase();
        return (
            t.includes("flowchart") ||
            t.includes("chart") ||
            t.includes("excel_visualize") ||
            fmt.includes("mermaid") ||
            fmt.includes("chartjs")
        );
    }

	// Khi server trả về JSON cho flowchart/chart nhưng không có trường text,
	// tránh hiển thị nguyên JSON thô trong bubble.
	function getVizDefaultCaption(vizObj) {
		try {
			const t = String(vizObj?.type || vizObj?.kind || "").toLowerCase();
			const fmt = String(vizObj?.payload?.format || vizObj?.format || "").toLowerCase();
			if (t.includes("flowchart") || fmt.includes("mermaid")) return "Đây là flowchart:";
			if (t.includes("excel_visualize")) return "Đây là bảng dữ liệu:";
			if (t.includes("chart") || fmt.includes("chartjs")) return "Đây là biểu đồ:";
			return "";
		} catch (_) {
			return "";
		}
	}

    async function copyTextWithFallback(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) {}

        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            ta.style.left = "-9999px";
            document.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange(0, ta.value.length);
            const ok = document.execCommand("copy");
            document.body.removeChild(ta);
            return !!ok;
        } catch (_) {
            return false;
        }
    }

    // ====================  FLOWCHART (Mermaid) ====================

    // Small loader to make Mermaid more reliable across different hosting/CDN blocks.
    function loadExternalScriptOnce(url, globalName, timeoutMs = 12000) {
        return new Promise((resolve, reject) => {
            try {
                if (globalName && window[globalName]) return resolve(true);
                const existing = document.querySelector(`script[data-chatiip-src="${url}"]`);
                if (existing) {
                    // If a previous attempt is still loading, wait a bit.
                    const t0 = Date.now();
                    const tick = () => {
                        if (globalName && window[globalName]) return resolve(true);
                        if (Date.now() - t0 > timeoutMs) return reject(new Error("Script load timeout"));
                        setTimeout(tick, 150);
                    };
                    return tick();
                }

                const s = document.createElement("script");
                s.src = url;
                s.async = true;
                s.defer = true;
                s.setAttribute("data-chatiip-src", url);

                const timer = setTimeout(() => {
                    try { s.remove(); } catch (_) {}
                    reject(new Error("Script load timeout"));
                }, timeoutMs);

                s.onload = () => {
                    clearTimeout(timer);
                    if (globalName && !window[globalName]) {
                        return reject(new Error("Global not found after load"));
                    }
                    resolve(true);
                };
                s.onerror = () => {
                    clearTimeout(timer);
                    try { s.remove(); } catch (_) {}
                    reject(new Error("Script load error"));
                };
                document.head.appendChild(s);
            } catch (e) {
                reject(e);
            }
        });
    }

    async function ensureMermaidLoaded() {
        if (window.mermaid) return true;
        const candidates = [
            // Primary
            "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js",
            // Fallbacks
            "https://unpkg.com/mermaid@10/dist/mermaid.min.js",
            "https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js"
        ];
        for (const url of candidates) {
            try {
                await loadExternalScriptOnce(url, "mermaid");
                if (window.mermaid) return true;
            } catch (_) {}
        }
        return !!window.mermaid;
    }
    function extractMermaidFlowchart(data) {
        if (!data || typeof data !== "object") return null;
        const payload = (data.payload && typeof data.payload === "object") ? data.payload : null;

        const type = String(data.type || payload?.type || "").toLowerCase();
        const format = String(payload?.format || data.format || "").toLowerCase();

        const code = String(payload?.code || data.code || "").trim();
        const isFlow = type.includes("flowchart") || format === "mermaid";

        if (!isFlow || !code) return null;

        return {
            title: String(data.answer || data.title || "Flowchart"),
            code,
            explanation: String(payload?.explanation || data.explanation || "").trim()
        };
    }

    function ensureMermaidReady() {
        try {
            if (window.mermaid && !window.__CHATIIP_MERMAID_READY) {
                // Use 'loose' to avoid over-strict sanitization breaking unicode labels in some environments.
                window.mermaid.initialize({
                    startOnLoad: false,
                    securityLevel: "loose",
                    theme: "base",
                    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, Arial, \"Noto Sans\", \"Liberation Sans\", sans-serif",
                    flowchart: {
                        useMaxWidth: true,
                        htmlLabels: true,
                        nodeSpacing: 18,
                        rankSpacing: 26,
                        curve: "linear"
                    },
                    themeVariables: {
                        fontFamily: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, Arial, \"Noto Sans\", \"Liberation Sans\", sans-serif",
                        fontSize: "14px"
                    }
                });
                window.__CHATIIP_MERMAID_READY = true;
            }
        } catch (_) {}
        return !!window.mermaid;
    }

    function normalizeMermaidCode(code) {
        let c = String(code || "").trim();
        // Remove ```mermaid fences if the backend accidentally includes them.
        if (c.startsWith("```")) {
            c = c.replace(/^```\s*mermaid\s*/i, "").replace(/^```\s*/i, "");
            c = c.replace(/```\s*$/i, "").trim();
        }
        return c;
    }

    // Make Mermaid more tolerant by quoting node labels (helps with Vietnamese/parentheses/special chars).
    
    function forceMermaidDirection(code, dir = "LR") {
        let s = String(code || "").replace(/\r\n?/g, "\n").trim();
        const lines = s.split("\n");
        if (!lines.length) return s;
        const first = lines[0].trim();
        const m = first.match(/^(flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i);
        if (m) {
            lines[0] = `${m[1]} ${String(dir || "LR").toUpperCase()}`;
            return lines.join("\n");
        }
        // if header missing, add one
        return `flowchart ${String(dir || "LR").toUpperCase()}\n` + s;
    }

function quoteMermaidLabels(code) {
        let s = String(code || "").replace(/\r\n?/g, "\n").trim();

        // Ensure header exists
        if (!/^\s*(flowchart|graph)\b/i.test(s)) {
            s = "flowchart LR\n" + s;
        }

        const wrap = (re, openTok, closeTok) => {
            s = s.replace(re, (m, id, label) => {
                const t = String(label || "").trim();
                // already quoted?
                if (/^\".*\"$/.test(t) || /^'.*'$/.test(t)) return m;
                const escaped = t.replace(/\\/g, "\\\\").replace(/\"/g, '\\"');
                return `${id}${openTok}\"${escaped}\"${closeTok}`;
            });
        };

        // Common node label forms:
        wrap(/(\b[A-Za-z][\w-]*)\s*\{([^}\n\r]*?)\}/g, "{", "}");            // decision: A{label}
        wrap(/(\b[A-Za-z][\w-]*)\s*\[([^\]\n\r]*?)\]/g, "[", "]");          // rect:     A[label]
        wrap(/(\b[A-Za-z][\w-]*)\s*\(\(([^\)\n\r]*?)\)\)/g, "((", "))");    // circle:   A((label))
        wrap(/(\b[A-Za-z][\w-]*)\s*\(([^)\n\r]*?)\)/g, "(", ")");           // round:    A(label)
        wrap(/(\b[A-Za-z][\w-]*)\s*\[\[([^\]\n\r]*?)\]\]/g, "[[", "]]" );    // subroutine A[[label]]

        return s;
    }
    function toggleMermaidDirection(code) {
        let s = String(code || "").replace(/\r\n?/g, "\n").trim();
        // normalize header to flowchart
        const lines = s.split("\n");
        if (!lines.length) return s;
        const first = lines[0].trim();
        const m = first.match(/^(flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i);
        if (m) {
            const dir = m[2].toUpperCase();
            const next = (dir === "LR") ? "TD" : "LR";
            lines[0] = `${m[1]} ${next}`;
            return lines.join("\n");
        }
        // no header: default to LR
        return "flowchart LR\n" + s;
    }

    function buildFlowchartModal() {
        let modal = document.querySelector(".flowchart-modal");
        if (modal) return modal;

        modal = document.createElement("div");
        modal.className = "flowchart-modal";
        modal.innerHTML = `
          <div class="flowchart-modal-backdrop" data-action="close"></div>
          <div class="flowchart-modal-panel" role="dialog" aria-modal="true">
            <div class="flowchart-modal-header">
              <div class="flowchart-modal-title">Flowchart</div>
              <button class="action-btn mini" type="button" data-action="close" aria-label="Close">Đóng</button>
            </div>
            <div class="flowchart-modal-body">
              <div class="mermaid-wrap"><div class="mermaid-loading">Đang vẽ sơ đồ…</div></div>
            </div>
          </div>
        `;
        document.body.appendChild(modal);

        const close = () => modal.classList.remove("open");
        modal.addEventListener("click", (e) => {
            const a = e.target?.getAttribute?.("data-action");
            if (a === "close") close();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") close();
        });
        return modal;
    }


    async function renderMermaidInto(el, code) {
        const ok = await ensureMermaidLoaded();
        if (!ok) throw new Error("Mermaid not loaded");
        if (!ensureMermaidReady()) throw new Error("Mermaid init failed");

        const text = quoteMermaidLabels(normalizeMermaidCode(code));
        const id = "mmd_" + Math.random().toString(36).slice(2);

        // Clear placeholder
        el.innerHTML = "";

        // Mermaid API differs across versions / builds.
        // Try a few known signatures before falling back.
        let res;
        try {
            // Mermaid v10+: render(id, text) -> Promise<{svg, bindFunctions}>
            res = await window.mermaid.render(id, text);
        } catch (e1) {
            try {
                // Some builds accept a container argument
                res = await window.mermaid.render(id, text, el);
            } catch (e2) {
                // Older API via mermaidAPI
                if (window.mermaid?.mermaidAPI?.render) {
                    res = await new Promise((resolve, reject) => {
                        try {
                            window.mermaid.mermaidAPI.render(id, text, (svgCode, bindFunctions) => {
                                resolve({ svg: svgCode, bindFunctions });
                            }, el);
                        } catch (e3) {
                            reject(e3);
                        }
                    });
                } else {
                    throw e2;
                }
            }
        }
        el.innerHTML = res.svg;
        // Make the rendered SVG responsive + improve typography
        try {
            const svg = el.querySelector("svg");
            if (svg) {
                svg.removeAttribute("height");
                svg.setAttribute("width", "100%");
                svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
                svg.style.maxWidth = "100%";
                svg.style.height = "auto";
                svg.classList.add("mmd-svg");
                // Ensure viewBox exists so CSS scaling works well
                if (!svg.getAttribute("viewBox")) {
                    try {
                        const bb = svg.getBBox();
                        if (bb && bb.width && bb.height) svg.setAttribute("viewBox", `${bb.x} ${bb.y} ${bb.width} ${bb.height}`);
                    } catch (_) {}
                }
            }
            el.classList.add("mermaid-rendered");
        } catch (_) {}
        try { res.bindFunctions?.(el); } catch (_) {}
    }

    function handleFlowchartResponse(data, botEl) {
        const flow = extractMermaidFlowchart(data);
        if (!flow || !botEl) return false;

        botEl.querySelectorAll(".flowchart-viz").forEach(n => n.remove());

        const stack = botEl.querySelector(".bot-stack");
        const actions = botEl.querySelector(".message-actions");

        const wrap = document.createElement("div");
        wrap.className = "flowchart-viz";
        wrap.style.marginTop = "10px";

                let currentCode = forceMermaidDirection(flow.code, "LR");
        
                wrap.innerHTML = `
                  <div class="data-block flowchart-card">
                    <div class="data-block-header">
                      <div class="data-block-title">Flowchart</div>
                      <div class="data-block-actions">
                        <button class="action-btn mini" type="button" data-action="flow-fit" aria-label="Fit">
                          <span class="action-tooltip">Vừa khung</span>Fit
                        </button>
                        <button class="action-btn mini" type="button" data-action="flow-dir" aria-label="Toggle direction">
                          <span class="action-tooltip">Đổi hướng</span>Ngang/Dọc
                        </button>
                        <button class="action-btn mini" type="button" data-action="flow-full" aria-label="Fullscreen">
                          <span class="action-tooltip">Phóng to</span>Full
                        </button>
                        <button class="action-btn mini" type="button" data-action="copy-mermaid" aria-label="Copy Mermaid">
                          <i class="fa-regular fa-copy"></i>
                          <span class="action-tooltip">Copy Mermaid</span>
                        </button>
                      </div>
                    </div>
        
                    <div class="flowchart-stage">
                      <div class="mermaid-wrap"><div class="mermaid-loading">Đang vẽ sơ đồ…</div></div>
                    </div>
        
                    ${flow.explanation ? `<details class="flowchart-explain"><summary>Giải thích</summary><div class="flowchart-explain-body">${formatMessage(flow.explanation)}</div></details>` : ""}
                  </div>
                `;
        
                const host = wrap.querySelector(".mermaid-wrap");
                const stage = wrap.querySelector(".flowchart-stage");
        
                const renderNow = async () => {
                    if (!host) return;
                    host.innerHTML = `<div class="mermaid-loading">Đang vẽ sơ đồ…</div>`;
                    try {
                        await renderMermaidInto(host, currentCode);
                    } catch (e) {
                        host.innerHTML = `<div class="mermaid-error">Không thể vẽ sơ đồ.<br><pre class="json-block">${escapeHtmlGlobal(currentCode)}</pre></div>`;
                    }
                };
        
                wrap.querySelector('[data-action="copy-mermaid"]')?.addEventListener("click", async () => {
                    const ok = await copyTextWithFallback(currentCode);
                    if (ok) showTempTooltip(wrap.querySelector('[data-action="copy-mermaid"]'), "Đã sao chép");
                    else alert("Không thể copy. Bạn hãy copy thủ công trong khối code.");
                });
        
                wrap.querySelector('[data-action="flow-fit"]')?.addEventListener("click", () => {
                    if (stage) { stage.scrollTop = 0; stage.scrollLeft = 0; }
                });
        
                wrap.querySelector('[data-action="flow-dir"]')?.addEventListener("click", async () => {
                    currentCode = toggleMermaidDirection(currentCode);
                    await renderNow();
                    if (stage) { stage.scrollTop = 0; stage.scrollLeft = 0; }
                });
        
                wrap.querySelector('[data-action="flow-full"]')?.addEventListener("click", async () => {
                    const modal = buildFlowchartModal();
                    modal.classList.add("open");
                    const titleEl = modal.querySelector(".flowchart-modal-title");
                    if (titleEl) titleEl.textContent = flow.title || "Flowchart";
        
                    const modalHost = modal.querySelector(".mermaid-wrap");
                    if (!modalHost) return;
        
                    modalHost.innerHTML = `<div class="mermaid-loading">Đang vẽ sơ đồ…</div>`;
                    try {
                        await renderMermaidInto(modalHost, currentCode);
                    } catch (e) {
                        modalHost.innerHTML = `<div class="mermaid-error">Không thể vẽ sơ đồ.<br><pre class="json-block">${escapeHtmlGlobal(currentCode)}</pre></div>`;
                    }
                });
        
                (async () => { await renderNow(); })();
        
        // Force wide bubble + prefer cards on mobile
        try {
            const bubble = botEl.querySelector('.message-bubble');
            if (bubble) bubble.classList.add('wide');
            autoPreferCardsOnMobile(botEl);
        } catch (_) {}

        if (stack && actions) stack.insertBefore(wrap, actions);
        else if (stack) stack.appendChild(wrap);
        else botEl.appendChild(wrap);

        setTimeout(scrollToBottom, 80);
        return true;
    }

    // ====================  CHART (Chart.js) ====================
    function extractChartJs(data) {
        if (!data || typeof data !== "object") return null;
        const payload = (data.payload && typeof data.payload === "object") ? data.payload : null;

        const type = String(data.type || payload?.type || "").toLowerCase();
        const format = String(payload?.format || data.format || "").toLowerCase();

        const isChart = type.includes("chart") || format === "chartjs";
        if (!isChart) return null;

        // 1) payload.config (Chart.js config)
        if (payload?.config && typeof payload.config === "object") {
            return { title: String(data.answer || data.title || "Biểu đồ"), config: payload.config };
        }

        // 2) payload.data/options/type (Chart.js pieces)
        if (payload?.data && (payload?.type || payload?.options)) {
            const cfg = { type: payload.type || "bar", data: payload.data, options: payload.options || {} };
            return { title: String(data.answer || data.title || "Biểu đồ"), config: cfg };
        }

        // 3) labels + values shorthand
        const labels = payload?.labels || data.labels;
        const values = payload?.values || data.values;
        if (Array.isArray(labels) && Array.isArray(values) && labels.length && values.length) {
            const cfg = {
                type: payload?.chartType || payload?.type || "bar",
                data: {
                    labels,
                    datasets: [{ label: payload?.seriesName || "Giá trị", data: values }]
                },
                options: payload?.options || {}
            };
            return { title: String(data.answer || data.title || "Biểu đồ"), config: cfg };
        }

        return null;
    }

    function handleChartJsResponse(data, botEl) {
        const chart = extractChartJs(data);
        if (!chart || !botEl) return false;
        if (!window.Chart) return false; // chart.js chưa load

        botEl.querySelectorAll(".chartjs-viz").forEach(n => n.remove());

        const stack = botEl.querySelector(".bot-stack");
        const actions = botEl.querySelector(".message-actions");

        const wrap = document.createElement("div");
        wrap.className = "chartjs-viz";
        wrap.style.marginTop = "10px";

        wrap.innerHTML = `
          <div class="data-block">
            <div class="data-block-header">
              <div class="data-block-title">${escapeHtmlGlobal(chart.title || "Biểu đồ")}</div>
            </div>
            <div class="chartjs-wrap">
              <canvas></canvas>
            </div>
          </div>
        `;

        const canvas = wrap.querySelector("canvas");
        try {
            const ctx = canvas.getContext("2d");
            // destroy old if any stored
            if (canvas._chart) { try { canvas._chart.destroy(); } catch (_) {} }
            canvas._chart = new window.Chart(ctx, chart.config);
        } catch (e) {
            wrap.querySelector(".chartjs-wrap").innerHTML = `<pre class="json-block">${escapeHtmlGlobal(JSON.stringify(chart.config, null, 2))}</pre>`;
        }

        // Force wide bubble + prefer cards on mobile
        try {
            const bubble = botEl.querySelector('.message-bubble');
            if (bubble) bubble.classList.add('wide');
            autoPreferCardsOnMobile(botEl);
        } catch (_) {}

        if (stack && actions) stack.insertBefore(wrap, actions);
        else if (stack) stack.appendChild(wrap);
        else botEl.appendChild(wrap);

        setTimeout(scrollToBottom, 80);
        return true;
    }


function sendMessage() {

        const message = messageInput.value.trim();
        if (!message) return;

        // Nếu đang đọc to câu trả lời trước đó thì dừng lại khi user gửi tin nhắn mới.
        try { stopTTS(); } catch (_) {}

        // Đếm số câu hỏi của khách và hiển thị modal khi đến câu thứ 5
        try {
            const isGuestUser = (typeof isLoggedIn === "function") ? !isLoggedIn() : !(getLoggedInUser && getLoggedInUser()?.id);
            if (isGuestUser) {
                const count = incrementGuestQuestionCount();
                if (count === 5) {
                    openLoginPromptModal();
                }
            }
        } catch (_) {}

        const messageId = (window.crypto && crypto.randomUUID)
            ? crypto.randomUUID()
            : Date.now() + "_" + Math.random();

        // ✅ LƯU CÂU HỎI SAU KHI ĐÃ CÓ message
        logToGoogle({
            message_id: messageId,
            session_id: getSessionId(),
            user_id: getUserId(),
            question: message,
            status: "asked"
        });

        addUserMessage(message);

        // ⭐ Cập nhật lịch sử đoạn chat: luôn lưu local (kể cả guest), và nếu đã đăng nhập thì sync đa thiết bị.
        try {
            const sid = getBackendSessionId();
            const ownerId = (typeof getHistoryOwnerId === "function") ? getHistoryOwnerId() : (getLoggedInUser()?.id || "guest");
            const loggedIn = (typeof isLoggedIn === "function") ? isLoggedIn() : !!getLoggedInUser()?.id;

            if (sid) {
                upsertSession(ownerId, sid, { preview: message });
                // sync lên backend để thiết bị khác cũng thấy lịch sử
                if (loggedIn) {
                    try { upsertSessionToServer(sid, { preview: message }); } catch (_) {}
                }
            } else {
                // chưa có session_id cho backend → lưu tạm để khi server trả về session_id thì gắn vào lịch sử
                setPendingSession(ownerId, { title: message, preview: message, createdAt: Date.now() });
            }
            updateHistoryUI(historySearchInput ? historySearchInput.value : "");
        } catch (_) {}

        // ✅ Lưu nhanh vào cache để reload trang là thấy ngay
        try {
            appendChatCache(getBackendSessionId(), {
                role: "user",
                text: message,
                ts: Date.now(),
                messageId
            });
        } catch (_) {}

        // Autosave metadata: reset idle timer
        try { scheduleChatAutosave(); } catch (_) {}

        messageInput.value = '';

        messageInput.style.height = "40px";
        messageInput.style.overflowY = "hidden";

        // Mỗi lần gửi tin nhắn: hủy request cũ và tạo request mới
        // (also cancels any active typewriter)
        try { cancelActiveTypewriter(true); } catch (_) {}
        abortActiveChatRequest();
        const __myNonce = __chatReqNonce;
        __chatAbortCtrl = (window.AbortController ? new AbortController() : null);

        __uiIsGenerating = true;
        setSendButtonMode('stop');
        showTypingIndicator();

        const backendSessionId = getBackendSessionId();
        const payload = backendSessionId
            ? { question: message, session_id: backendSessionId }
            : { question: message };

        fetch("https://botchat.iipmap.com/chat", {
            signal: __chatAbortCtrl ? __chatAbortCtrl.signal : undefined,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        })
            .then(res => res.json())
            .then(data => {
                // Nếu user đã bấm "Đoạn chat mới" (nonce tăng) thì bỏ qua response cũ
                if (__myNonce !== __chatReqNonce) return;

                const backendSessionIdFromServer = data && data.session_id;
                if (backendSessionIdFromServer) {
                    // nếu trước đó chưa có session_id thì cache đang nằm ở pending -> migrate sang key mới
                    try { migratePendingCacheToSession(backendSessionIdFromServer); } catch (_) {}
                    setBackendSessionId(backendSessionIdFromServer);

                    // ⭐ finalize pending history entry
                    try {
                        const ownerId = (typeof getHistoryOwnerId === "function") ? getHistoryOwnerId() : (getLoggedInUser()?.id || "guest");
                        const loggedIn = (typeof isLoggedIn === "function") ? isLoggedIn() : !!getLoggedInUser()?.id;
                        const pending = readPendingSession ? readPendingSession(ownerId) : null;
                        const title = (pending && pending.title) ? pending.title : message;

                        upsertSession(ownerId, backendSessionIdFromServer, {
                            title,
                            preview: message,
                            createdAt: (pending && pending.createdAt) ? pending.createdAt : Date.now()
                        });

                        // sync lên backend để đa thiết bị (chỉ khi đã đăng nhập)
                        if (loggedIn) {
                            try {
                                upsertSessionToServer(backendSessionIdFromServer, {
                                    title,
                                    preview: message,
                                    createdAt: (pending && pending.createdAt) ? pending.createdAt : Date.now()
                                });
                            } catch (_) {}
                        }

                        clearPendingSession(ownerId);
                        updateHistoryUI(historySearchInput ? historySearchInput.value : "");
                    } catch (_) {}
                }

                hideTypingIndicator();
                const answerRaw = (data && (data.answer ?? data.reply)) ?? "No response.";

				// ✅ Nếu answer trả về là JSON string (chart/flowchart...) → parse để render
				const parsedFromAnswer = (typeof answerRaw === "string") ? tryParseJsonDeep(answerRaw, 3) : null;
				const parsedIsViz = (parsedFromAnswer && typeof parsedFromAnswer === "object" && looksLikeStructuredViz(parsedFromAnswer));
				const effectiveData = parsedIsViz ? parsedFromAnswer : data;

				// ✅ Nếu server trả về JSON viz không có 'answer'/'message'/'text' thì không hiển thị nguyên JSON thô
				let displayText = parsedIsViz
					? (parsedFromAnswer.answer ?? parsedFromAnswer.message ?? parsedFromAnswer.text)
					: answerRaw;
				if (parsedIsViz) {
					const hasText = (typeof displayText === "string") ? displayText.trim().length > 0 : displayText != null;
					if (!hasText) displayText = getVizDefaultCaption(parsedFromAnswer);
				}


				// Decide whether to animate (typewriter) for the *current* live reply.
				const normalizedForAnim = normalizeBotMessage(displayText);
				let botEl;
				if (shouldAnimateBotText(displayText, normalizedForAnim)) {
					botEl = addBotMessage("", { messageId, question: message });
					const bubble = botEl ? botEl.querySelector('.message-bubble') : null;
					__uiActiveTypewriter = runTypewriter(
						bubble,
						String(displayText ?? ''),
						normalizedForAnim.html,
						() => {
							__uiIsGenerating = false;
							__uiActiveTypewriter = null;
							setSendButtonMode('send');
						}
					);
				} else {
					botEl = addBotMessage(displayText, { messageId, question: message });
					// No animation -> generation considered complete now.
					__uiIsGenerating = false;
					setSendButtonMode('send');
				}

                // ✅ Chart cũ (excel_visualize) + chart mới (chartjs) + flowchart (mermaid)
                handleExcelVisualizeResponse(effectiveData, botEl);
                handleChartJsResponse(effectiveData, botEl);
                handleFlowchartResponse(effectiveData, botEl);

                // ✅ Luôn hiện bản đồ khi hỏi về KCN/CCN (hoặc khi server trả excel_visualize)
                Promise.resolve(appendIndustrialMapToBot(botEl, message, effectiveData)).catch((err) => {});

				// ✅ Lưu cache câu trả lời (kèm dữ liệu chart/flowchart/map nếu có)
                try {
                    const hasViz = (effectiveData && typeof effectiveData === "object" && looksLikeStructuredViz(effectiveData));
                    appendChatCache(getBackendSessionId(), {
                        role: "assistant",
						// Giữ nguyên kiểu (string/object/array) để restore không bị rơi về "[object Object]"
						text: (displayText == null ? "" : displayText),
                        raw: (typeof answerRaw === "string") ? answerRaw : JSON.stringify(answerRaw),
                        question: message,
                        ts: Date.now(),
                        messageId,
                        vizData: hasViz ? effectiveData : null
                    });
                } catch (_) {}

                // Autosave metadata: reset idle timer
                try { scheduleChatAutosave(); } catch (_) {}

                // ⭐ Cập nhật preview lịch sử (ưu tiên câu trả lời gần nhất)
                try {
                    const sidNow = getBackendSessionId();
                    if (sidNow) {
                        const ownerId = (typeof getHistoryOwnerId === "function") ? getHistoryOwnerId() : (getLoggedInUser()?.id || "guest");
                        const loggedIn = (typeof isLoggedIn === "function") ? isLoggedIn() : !!getLoggedInUser()?.id;
                        const pv = (typeof displayText === "string") ? displayText : (typeof answerRaw === "string" ? answerRaw : JSON.stringify(displayText));
                        upsertSession(ownerId, sidNow, { preview: pv });
                        // sync đa thiết bị nếu đã đăng nhập
                        if (loggedIn) {
                            try { upsertSessionToServer(sidNow, { preview: pv }); } catch (_) {}
                        }
                        updateHistoryUI(historySearchInput ? historySearchInput.value : "");
                    }
                } catch (_) {}

                // ✅ UPDATE ANSWER VÀO GOOGLE
                logToGoogle({
                    message_id: messageId,
                    session_id: getSessionId(),
                    user_id: getUserId(),
                    question: message,
                    answer: (typeof answerRaw === "string") ? answerRaw : JSON.stringify(answerRaw),
                    status: "answered"
                });
            })
            .catch((err) => {
                // Nếu request bị hủy (bấm Đoạn chat mới) thì im lặng
                if (err && (err.name === "AbortError" || err.code === 20)) return;
                if (__myNonce !== __chatReqNonce) return;

                // Nếu user đã bấm "Đoạn chat mới" hoặc request bị hủy thì im lặng
                if (__myNonce !== __chatReqNonce) return;
                if (err && (err.name === "AbortError")) return;

                hideTypingIndicator();

				// reset UI state
				__uiIsGenerating = false;
				setSendButtonMode('send');
                addBotMessage("⚠️ Lỗi kết nối đến chatbot Render.");
            });
    }


    // ====================  UI: GENERATING STATE (STOP BUTTON + TYPEWRITER)  ====================
    // Only used for the *current* live assistant reply (NOT for history rendering).
    let __uiIsGenerating = false;
    let __uiActiveTypewriter = null; // { cancel: fn, isRunning: bool }

    function setSendButtonMode(mode) {
        try {
            const icon = sendButton ? sendButton.querySelector('i') : null;
            if (!sendButton || !icon) return;

            if (mode === 'stop') {
                sendButton.classList.add('is-generating');
                sendButton.setAttribute('aria-label', 'Dừng');
                icon.className = 'fas fa-stop';
            } else {
                sendButton.classList.remove('is-generating');
                sendButton.setAttribute('aria-label', 'Gửi');
                icon.className = 'fas fa-arrow-up';
            }
        } catch (_) {}
    }

    function cancelActiveTypewriter(keepPartial = true) {
        try {
            if (__uiActiveTypewriter && typeof __uiActiveTypewriter.cancel === 'function') {
                __uiActiveTypewriter.cancel(keepPartial);
            }
        } catch (_) {}
        __uiActiveTypewriter = null;
    }

    function stopActiveGeneration() {
        // Stop network request (if any) + stop typewriter (if any)
        try { abortActiveChatRequest(); } catch (_) {}
        cancelActiveTypewriter(true);
        __uiIsGenerating = false;
        setSendButtonMode('send');
    }

    function onSendButtonActivated() {
        if (__uiIsGenerating) {
            stopActiveGeneration();
            return;
        }
        sendMessage();
    }

    function shouldAnimateBotText(displayText, normalized) {
        if (typeof displayText !== 'string') return false;
        const txt = displayText.trim();
        if (!txt) return false;
        // Skip if message is already HTML/structured (tables/charts/maps)
        if (normalized && normalized.isHTML) return false;
        if (/(data-table|data-block|excel-viz|chartjs-viz|mermaid|map-wrap|leaflet|maplibre)/i.test(String(normalized?.html || ''))) {
            return false;
        }
        return true;
    }

    function runTypewriter(bubbleEl, finalText, finalHtml, onDone) {
        if (!bubbleEl) return null;

        // Preserve dynamic DOM that may be appended while streaming (e.g., compare tables for IIP)
        // because swapping `innerHTML` to finalHtml would otherwise wipe those nodes.
        const __swapHtmlPreserve = (html) => {
            const preserved = [];
            try {
                bubbleEl.querySelectorAll('.compare-iip-lists').forEach(n => preserved.push(n));
            } catch (_) {}

            // Detach preserved nodes before innerHTML replacement
            preserved.forEach(n => {
                try { n.remove(); } catch (_) {}
            });

            bubbleEl.innerHTML = html;

            // Re-attach preserved nodes after swap
            preserved.forEach(n => {
                try { bubbleEl.appendChild(n); } catch (_) {}
            });
        };

        // Use plain text streaming first, then swap to formatted HTML at the end.
        bubbleEl.classList.add('streaming');
        bubbleEl.innerHTML = `<div class="streaming-text"></div>`;
        const streamNode = bubbleEl.querySelector('.streaming-text');

        const text = String(finalText ?? '');
        const cps = 220; // fast
        let i = 0;
        let lastTs = performance.now();
        let cancelled = false;

        const step = (ts) => {
            if (cancelled) return;
            const dt = Math.max(0, ts - lastTs);
            lastTs = ts;
            const advance = Math.max(1, Math.floor((dt / 1000) * cps));
            i = Math.min(text.length, i + advance);
            if (streamNode) streamNode.textContent = text.slice(0, i);

            // 🚫 Không ghim xuống đáy khi streaming (theo yêu cầu)

            if (i >= text.length) {
                bubbleEl.classList.remove('streaming');
                // swap to full formatted HTML
                __swapHtmlPreserve(finalHtml);
                if (typeof onDone === 'function') onDone();
                return;
            }
            requestAnimationFrame(step);
        };

        requestAnimationFrame(step);

        return {
            isRunning: () => !cancelled && i < text.length,
            cancel: (keepPartial) => {
                cancelled = true;
                bubbleEl.classList.remove('streaming');
                if (keepPartial) {
                    // keep current plain text (no HTML formatting)
                    bubbleEl.innerHTML = `<div class="streaming-text"></div>`;
                    const n = bubbleEl.querySelector('.streaming-text');
                    if (n) n.textContent = text.slice(0, i);
                } else {
                    __swapHtmlPreserve(finalHtml);
                }
                if (typeof onDone === 'function') onDone(true);
            }
        };
    }


    // Click: send OR stop (when generating)
    sendButton.addEventListener('click', onSendButtonActivated);
    messageInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSendButtonActivated();
        }
    });


    // ====================  HIỂN THỊ TIN NHẮN NGƯỜI DÙNG  ====================

    function addUserMessage(message, files = []) {
        if (welcomeMessage && welcomeMessage.style.display !== 'none') {
            welcomeMessage.style.display = 'none';
        }

        // ⭐ QUAN TRỌNG: Xóa class 'centered' để input chuyển xuống dưới
        messageInputContainer.classList.remove('centered');
        chatContainer.classList.add('has-messages');

        // Update header actions visibility
        try { syncChatHasMessagesUI(); } catch (_) {}

        // Update header actions visibility (desktop share/3-dots, mobile 3-dots)
        try { syncChatHasMessagesUI(); } catch (_) {}


// Ẩn menu giới thiệu khi đã gửi tin nhắn đầu tiên
try {
    const unauthTopbar = document.getElementById('unauthTopbar');
    if (unauthTopbar) {
        unauthTopbar.classList.add('has-messages');
    }
} catch (_) {}


        const userMessageElement = document.createElement('div');
        userMessageElement.className = 'message user-message';

        const userMsgId = (window.crypto && crypto.randomUUID)
            ? crypto.randomUUID()
            : Date.now() + "_" + Math.random();

        userMessageElement.dataset.userMessageId = userMsgId;
        userMessageElement.dataset.text = message;

        let messageContent = `
          <div class="user-stack">
            <div class="message-bubble user-bubble">${escapeHtml(message)}</div>
            <div class="message-actions user-actions">
              ${renderActionButton('user-copy', 'fa-regular fa-copy', 'Sao chép')}
              ${renderActionButton('user-select', 'fa-solid fa-i-cursor', 'Chọn văn bản')}
              ${renderActionButton('user-edit', 'fa-regular fa-pen-to-square', 'Chỉnh sửa')}
              ${renderActionButton('user-share', 'fa-solid fa-share-nodes', 'Chia sẻ')}
            </div>
          </div>
        `;

        if (files && files.length > 0) {
            files.forEach(file => {
                messageContent += `
                <div class="file-message">
                    <i class="fas fa-file file-icon"></i>
                    <span class="file-name">${escapeHtml(file.name)}</span>
                </div>
            `;
            });
        }

        userMessageElement.innerHTML = messageContent;
        chatContainer.appendChild(userMessageElement);

        // ⭐ Auto scroll
        setTimeout(() => scrollToBottom("smooth", true), 50)
    }

    // ====================  HIỂN THỊ TIN NHẮN BOT + ACTIONS  ====================  ====================
    function renderActionButton(action, iconClass, tooltip) {
        return `
            <button class="action-btn" type="button" data-action="${action}" aria-label="${tooltip}">
                <i class="${iconClass}"></i>
                <span class="action-tooltip">${tooltip}</span>
            </button>
        `;
    }

    function normalizeBotMessage(rawMessage) {
        let finalMessage = rawMessage ?? "";
        let forcePre = false;

        try {
            // ✅ Nếu server trả object/array trực tiếp (không phải string) → đừng để rơi vào "[object Object]"
            if (rawMessage && typeof rawMessage === "object") {
                const obj = rawMessage;

                // ưu tiên: array hoặc {data:[...]}
                if (Array.isArray(obj)) {
                    finalMessage = jsonToIndustrialTableV2(obj);
                } else if (Array.isArray(obj.data)) {
                    finalMessage = jsonToIndustrialTableV2(obj.data);
                } else {
                    // các field phổ biến
                    const maybeText = obj.answer ?? obj.reply ?? obj.message ?? obj.text ?? "";
                    if (typeof maybeText === "string" && maybeText.trim()) {
                        finalMessage = maybeText;
                    } else if (maybeText && typeof maybeText === "object") {
                        if (Array.isArray(maybeText)) finalMessage = jsonToIndustrialTableV2(maybeText);
                        else if (Array.isArray(maybeText.data)) finalMessage = jsonToIndustrialTableV2(maybeText.data);
                        else {
                            finalMessage = JSON.stringify(maybeText, null, 2);
                            forcePre = true;
                        }
                    } else {
                        finalMessage = JSON.stringify(obj, null, 2);
                        forcePre = true;
                    }
                }
            } else {
                // ✅ Trường hợp message là string: thử parse JSON (1-3 lần) như cũ
                let raw = String(rawMessage ?? "");
                raw = raw.trim();

                let parsed;
                try { parsed = JSON.parse(raw); } catch (e) { }
                if (parsed && typeof parsed === "string") {
                    try { parsed = JSON.parse(parsed); } catch (e) { }
                }
                if (parsed && typeof parsed === "string") {
                    try { parsed = JSON.parse(parsed); } catch (e) { }
                }

                if (parsed && typeof parsed === "object" && Array.isArray(parsed.data)) {
                    finalMessage = jsonToIndustrialTableV2(parsed.data);
                } else if (Array.isArray(parsed)) {
                    finalMessage = jsonToIndustrialTableV2(parsed);
                } else {
                    finalMessage = rawMessage;
                }
            }
        } catch (err) {
            console.log("normalizeBotMessage ERR", err);
            finalMessage = String(rawMessage ?? "");
        }

        const isHTML = String(finalMessage).trim().startsWith("<");
        const html = isHTML
            ? String(finalMessage)
            : (forcePre
                ? `<pre class="json-block">${escapeHtmlGlobal(String(finalMessage))}</pre>`
                : formatMessage(String(finalMessage))
              );

        return { finalMessage, html, isHTML };
    }

    function addBotMessage(message, meta = {}) {
        const { messageId = "", question = "" } = meta || {};

        // ⭐ ĐẢM BẢO: Xóa class 'centered' khi bot trả lời
        messageInputContainer.classList.remove('centered');
        chatContainer.classList.add('has-messages');

        // Update header actions visibility
        try { syncChatHasMessagesUI(); } catch (_) {}

        const botMessageElement = document.createElement('div');
        botMessageElement.className = 'message bot-message';

        if (messageId) botMessageElement.dataset.messageId = messageId;
        if (question) botMessageElement.dataset.question = question;

        const normalized = normalizeBotMessage(message);

        botMessageElement.innerHTML = `
            <div class="bot-stack">
                <div class="message-bubble bot-bubble">${normalized.html}</div>
                <div class="message-actions">
                    ${renderActionButton('like', 'fa-regular fa-thumbs-up', 'Phản hồi tốt')}
                    ${renderActionButton('dislike', 'fa-regular fa-thumbs-down', 'Phản hồi không tốt')}
                    ${renderActionButton('tts', 'fa-solid fa-volume-high', 'Đọc')}
                    ${renderActionButton('refresh', 'fa-solid fa-arrows-rotate', 'Trả lời lại')}
                    ${renderActionButton('copy', 'fa-regular fa-copy', 'Sao chép')}
                    ${renderActionButton('share', 'fa-solid fa-share-nodes', 'Chia sẻ')}
                </div>
            </div>
        `;


        // Wide bubble for tables/charts so mobile doesn't feel cramped
        try {
            const bubble = botMessageElement.querySelector('.message-bubble');
            if (bubble) {
                const looksRich = /data-block|data-table|excel-viz/i.test(normalized.html);
                if (looksRich) bubble.classList.add('wide');
            }
        } catch (_) {}

        chatContainer.appendChild(botMessageElement);

        // Prefer cards on mobile for better UX
        try { autoPreferCardsOnMobile(botMessageElement); } catch (_) {}

        // 🚫 Không auto-scroll khi bot trả lời (theo yêu cầu)

        // ⭐ Return element để có thể gắn chart/table vào đúng message
        return botMessageElement;
    }

    // ====================  LOAD CHAT HISTORY FROM BACKEND (PER SESSION)  ====================

    function renderChatHistoryFast(cacheMessages) {
        if (!chatContainer) return;

        const existing = chatContainer.querySelectorAll('.message');
        existing.forEach(m => m.remove());

        if (welcomeMessage) {
            welcomeMessage.style.display = 'none';
        }
        messageInputContainer.classList.remove('centered');
        chatContainer.classList.add('has-messages');

        let lastQuestion = "";

        (cacheMessages || []).forEach((m) => {
            const role = String(m.role || m.type || '').toLowerCase();

            if (role === 'human' || role === 'user') {
                const content = String(m.text ?? m.content ?? "");
                if (!content) return;
                addUserMessage(content);
                lastQuestion = content;
                return;
            }

            if (role === 'ai' || role === 'assistant' || role === 'system') {
                const q = String(m.question || lastQuestion || "");
                const raw = m.raw ?? m.content ?? m.text ?? "";

				// Giữ nguyên kiểu dữ liệu (string/object/array) để restore bảng không bị "[object Object]"
				let displayText = (m.text ?? m.content ?? "");
                let vizData = m.vizData || null;

				// Nếu cache không có vizData, thử parse JSON từ raw/text
                try {
                    if (!vizData && typeof raw === "string") {
                        const parsed = tryParseJsonDeep(raw, 3);
						if (parsed && typeof parsed === "object") {
							// 1) Nếu là viz -> render viz + caption (tránh JSON thô)
							if (looksLikeStructuredViz(parsed)) {
								vizData = parsed;
								displayText = (parsed.answer ?? parsed.message ?? parsed.text);
								const hasText = (typeof displayText === "string") ? displayText.trim().length > 0 : displayText != null;
								if (!hasText) displayText = getVizDefaultCaption(parsed);
							}
							// 2) Không phải viz nhưng text bị rơi -> dùng parsed để dựng lại bảng
							else if (displayText === "[object Object]" || displayText === "" || displayText == null) {
								displayText = parsed;
							}
						}
                    }
                } catch (_) {}

                const botEl = addBotMessage(displayText, { question: q });

                // Render lại flowchart/chart/map nếu có
                try {
                    if (vizData) {
                        handleExcelVisualizeResponse(vizData, botEl);
                        handleChartJsResponse(vizData, botEl);
                        handleFlowchartResponse(vizData, botEl);
                    }
                } catch (_) {}

                // Luôn thử append bản đồ (hàm tự quyết định có hiển thị hay không)
                Promise.resolve(appendIndustrialMapToBot(botEl, q, vizData || null)).catch(() => {});
            }
        });

        setTimeout(() => scrollToBottom('auto', false), 100);
    }

    async function loadChatHistoryFromServer() {
        if (!chatContainer) return;
        const backendSessionId = getBackendSessionId();

        // Track whether we were able to render anything from cache.
        let renderedFromCache = false;

        // 1) Hiển thị ngay từ cache (nếu có) để load gần như tức thì
        try {
            const key = backendSessionId ? getChatCacheKey(backendSessionId) : CHAT_CACHE_PENDING_KEY;
            const cached = readChatCacheByKey(key);
            if (cached && Array.isArray(cached.messages) && cached.messages.length) {
                renderChatHistoryFast(cached.messages);
                renderedFromCache = true;
            }
        } catch (_) {}

        // Chưa có session_id backend thì không fetch history
        if (!backendSessionId) return;

        // 2) Đồng bộ với server để chắc chắn đúng nhất
        try {
            const res = await fetch(`${CHAT_HISTORY_BASE_URL}/${encodeURIComponent(backendSessionId)}`, { cache: 'no-store' });
            if (!res.ok) {
                if (res.status === 404 || res.status === 410) {
                    clearBackendSessionId();
                }
                // If we couldn't render from cache, replace loading state with a friendly error.
                if (!renderedFromCache) {
                    try {
                        const loadingEl = chatContainer.querySelector('.loading-message');
                        if (loadingEl) loadingEl.remove();
                    } catch (_) {}
                    try { addBotMessage('Không thể tải đoạn chat này. Vui lòng thử lại.'); } catch (_) {}
                }
                return;
            }

            const data = await res.json();
            const serverMessages = Array.isArray(data.messages) ? data.messages : [];
            if (!serverMessages.length) return;

            const serverSig = summarizeMessagesForCompare(serverMessages);

            const key = getChatCacheKey(backendSessionId);
            const cached = readChatCacheByKey(key);
            const cachedSig = cached && cached.serverSig ? cached.serverSig : null;

            const same = cachedSig && cachedSig.n === serverSig.n && cachedSig.lastRole === serverSig.lastRole && cachedSig.lastTextHash === serverSig.lastTextHash;
            if (same) return;

            // Convert server messages -> cache format, cố gắng phục hồi viz từ JSON string
            let lastQuestion = "";
            const converted = [];
            for (const sm of serverMessages) {
                const role = String(sm.role || sm.type || '').toLowerCase();
                const content = sm.content ?? sm.text ?? "";
                if (!content) continue;

                if (role === 'human' || role === 'user') {
                    lastQuestion = String(content);
                    converted.push({ role: 'user', text: String(content), ts: Date.now() });
                    continue;
                }

                if (role === 'ai' || role === 'assistant' || role === 'system') {
                    let vizData = null;
					// Giữ nguyên kiểu để dựng lại bảng từ JSON (tránh "[object Object]")
					let displayText = content;
                    try {
                        if (typeof content === 'string') {
                            const parsed = tryParseJsonDeep(content, 3);
							if (parsed && typeof parsed === 'object') {
								// 1) Viz -> render viz, bubble chỉ hiện caption/text (không lộ JSON thô)
								if (looksLikeStructuredViz(parsed)) {
									vizData = parsed;
									displayText = (parsed.answer ?? parsed.message ?? parsed.text);
									const hasText = (typeof displayText === 'string') ? displayText.trim().length > 0 : displayText != null;
									if (!hasText) displayText = getVizDefaultCaption(parsed);
								}
								// 2) Không phải viz nhưng content là JSON array/object -> dùng parsed để dựng bảng
								else {
									displayText = parsed;
								}
							}
                        }
                    } catch (_) {}

                    converted.push({
                        role: 'assistant',
                        text: displayText,
                        raw: (typeof content === 'string') ? content : JSON.stringify(content),
                        question: lastQuestion,
                        vizData,
                        ts: Date.now()
                    });
                }
            }

            writeChatCacheByKey(key, { updatedAt: Date.now(), serverSig, messages: converted });
            renderChatHistoryFast(converted);
        } catch (err) {
            console.warn('Không thể tải lịch sử hội thoại', err);

            if (!renderedFromCache) {
                try {
                    const loadingEl = chatContainer.querySelector('.loading-message');
                    if (loadingEl) loadingEl.remove();
                } catch (_) {}
                try { addBotMessage('Không thể tải đoạn chat này. Vui lòng thử lại.'); } catch (_) {}
            }
        }
    }

    // Show immediate UI feedback when a user selects a history item (avoid "nothing happens" delay).
    function showHistoryLoadingPlaceholder() {
        if (!chatContainer) return;

        // Stop any in-flight live generation to avoid mixing responses.
        try {
            __chatRequestNonce++;
            if (__chatAbortController) __chatAbortController.abort();
        } catch (_) {}
        __chatAbortController = null;
        try { hideTypingIndicator(); } catch (_) {}
        try { abortActiveChatRequest(); } catch (_) {}

        // Clear visible messages and show a lightweight loader.
        try {
            const existing = chatContainer.querySelectorAll('.message');
            existing.forEach(m => m.remove());
        } catch (_) {}

        if (welcomeMessage) welcomeMessage.style.display = 'none';
        messageInputContainer.classList.remove('centered');
        chatContainer.classList.add('has-messages');

        const el = document.createElement('div');
        el.className = 'message bot-message loading-message';
        el.innerHTML = `
            <div class="message-bubble bot-bubble">
                <div class="loading-row">
                    <div class="loading-spinner" aria-hidden="true"></div>
                    <div class="loading-title">Đang tải đoạn chat…</div>
                </div>
                <div class="skel" aria-hidden="true">
                    <div class="skel-line" style="width: 78%"></div>
                    <div class="skel-line" style="width: 92%"></div>
                    <div class="skel-line" style="width: 68%"></div>
                </div>
            </div>
        `;
        chatContainer.appendChild(el);

        try { setTimeout(() => scrollToBottom('auto', false), 20); } catch (_) {}
    }

// ====================  EXCEL VISUALIZE (CHART/TABLE)  ====================

    function extractExcelVisualize(data) {
        if (!data || typeof data !== "object") return null;

        // Server đôi khi trả { type: "excel_visualize", payload: { type: "excel_visualize_price", ... } }
        const payload = (data.payload && typeof data.payload === "object") ? data.payload : null;

        const topType = data.type ? String(data.type) : "";
        const payloadType = payload?.type ? String(payload.type) : "";

        const looksLikeExcelViz =
            topType.includes("excel_visualize") ||
            payloadType.includes("excel_visualize");

        if (!looksLikeExcelViz) return null;

        // chart_base64 có thể nằm ở top-level hoặc trong payload
        const chartBase64 =
            (typeof data.chart_base64 === "string" && data.chart_base64.trim()) ? data.chart_base64.trim() :
            (typeof payload?.chart_base64 === "string" && payload.chart_base64.trim()) ? payload.chart_base64.trim() :
            "";

        const items = Array.isArray(payload?.items) ? payload.items : (Array.isArray(data.items) ? data.items : []);

        return {
            type: payloadType || topType,
            province: payload?.province || data.province || "",
            industrial_type: payload?.industrial_type || data.industrial_type || "",
            items,
            chart_base64: chartBase64
        };
    }

    function parsePriceNumber(priceStr) {
        const s = String(priceStr ?? "");
        // lấy số đầu tiên (110, 120, 65...)
        const m = s.replace(/,/g, ".").match(/(\d+(?:\.\d+)?)/);
        return m ? Number(m[1]) : NaN;
    }

    function buildPriceDataBlock(items, title = "Dữ liệu so sánh giá") {
        const block = document.createElement("div");
        block.className = "data-block";

        const rows = (items || []).map((it, idx) => {
            const name = escapeHtmlGlobal(it?.name ?? it?.ten ?? it?.Tên ?? "");
            const price = escapeHtmlGlobal(it?.price ?? it?.gia ?? it?.Giá ?? "");
            return `
              <tr>
                <td class="col-stt">${idx + 1}</td>
                <td>${name || "—"}</td>
                <td class="col-area">${price || "—"}</td>
              </tr>
            `;
        }).join("");

        const cards = (items || []).map((it, idx) => {
            const name = escapeHtmlGlobal(it?.name ?? it?.ten ?? it?.Tên ?? "");
            const price = escapeHtmlGlobal(it?.price ?? it?.gia ?? it?.Giá ?? "");
            return `
              <div class="data-card">
                <div class="data-card-head">
                  <div class="data-card-title">${name || "—"}</div>
                  <div class="data-card-badge">#${idx + 1}</div>
                </div>
                <div class="data-card-line">
                  <div class="data-card-label">Giá</div>
                  <div class="data-card-value">${price || "—"}</div>
                </div>
              </div>
            `;
        }).join("");

        block.innerHTML = `
          <div class="data-block-toolbar">
            <div class="data-block-title">${escapeHtmlGlobal(title)}</div>
            <div class="data-view-tabs" role="tablist" aria-label="Chế độ xem">
              <button class="data-view-tab active" type="button" data-view-target="table" role="tab" aria-selected="true">
                <i class="fa-solid fa-table"></i> Bảng
              </button>
              <button class="data-view-tab" type="button" data-view-target="cards" role="tab" aria-selected="false">
                <i class="fa-solid fa-grip"></i> Thẻ
              </button>
            </div>
          </div>

          <div class="data-panel active" data-view-panel="table">
            <div class="data-table-wrap">
              <table class="data-table data-table-compact">
                <thead>
                  <tr>
                    <th class="col-stt">#</th>
                    <th>Khu công nghiệp</th>
                    <th class="col-area">Giá</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows || `<tr><td colspan="3">Không có dữ liệu.</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>

          <div class="data-panel" data-view-panel="cards">
            <div class="data-cards-wrap">
              <div class="data-cards">
                ${cards || `<div class="data-card"><div class="data-card-title">Không có dữ liệu.</div></div>`}
              </div>
            </div>
          </div>
        `;

        return block;
    }

    function buildBarChart(items, titleText = "Biểu đồ so sánh giá") {
        const wrap = document.createElement("div");
        wrap.className = "excel-viz-chart";
        wrap.style.border = "1px solid var(--border)";
        wrap.style.borderRadius = "16px";
        wrap.style.background = "var(--surface)";
        wrap.style.padding = "12px";
        wrap.style.marginTop = "10px";

        const title = document.createElement("div");
        title.style.fontSize = "13px";
        title.style.fontWeight = "700";
        title.style.color = "var(--title)";
        title.style.marginBottom = "10px";
        title.textContent = titleText;
        wrap.appendChild(title);

        const values = (items || []).map(it => parsePriceNumber(it?.price)).filter(v => Number.isFinite(v));
        const maxV = values.length ? Math.max(...values) : 0;

        const list = document.createElement("div");
        list.style.display = "flex";
        list.style.flexDirection = "column";
        list.style.gap = "10px";

        (items || []).forEach(it => {
            const nameRaw = String(it?.name ?? "");
            const priceRaw = String(it?.price ?? "");
            const v = parsePriceNumber(priceRaw);
            const pct = (Number.isFinite(v) && maxV > 0) ? Math.max(2, Math.round((v / maxV) * 100)) : 0;

            const row = document.createElement("div");

            const label = document.createElement("div");
            label.style.display = "flex";
            label.style.alignItems = "baseline";
            label.style.justifyContent = "space-between";
            label.style.gap = "10px";
            label.style.marginBottom = "6px";

            const left = document.createElement("div");
            left.style.fontSize = "13px";
            left.style.color = "var(--title)";
            left.style.fontWeight = "600";
            left.style.lineHeight = "1.35";
            left.textContent = nameRaw || "—";

            const right = document.createElement("div");
            right.style.fontSize = "12px";
            right.style.color = "var(--muted)";
            right.style.whiteSpace = "nowrap";
            right.textContent = priceRaw || "—";

            label.appendChild(left);
            label.appendChild(right);

            const barOuter = document.createElement("div");
            barOuter.style.height = "10px";
            barOuter.style.background = "var(--surface2)";
            barOuter.style.border = "1px solid var(--border)";
            barOuter.style.borderRadius = "999px";
            barOuter.style.overflow = "hidden";

            const barInner = document.createElement("div");
            barInner.style.height = "100%";
            barInner.style.width = pct ? `${pct}%` : "0%";
            barInner.style.background = "var(--primary-bg)"; // đồng nhất theme
            barInner.style.borderRadius = "999px";
            barOuter.appendChild(barInner);

            row.appendChild(label);
            row.appendChild(barOuter);
            list.appendChild(row);
        });

        wrap.appendChild(list);
        return wrap;
    }

    function handleExcelVisualizeResponse(data, botEl) {
        const vis = extractExcelVisualize(data);
        if (!vis || !botEl) return false;

        // remove viz cũ nếu có (khi regenerate/edit)
        botEl.querySelectorAll(".excel-viz").forEach(n => n.remove());

        const stack = botEl.querySelector(".bot-stack");
        const actions = botEl.querySelector(".message-actions");

        const vizWrap = document.createElement("div");
        vizWrap.className = "excel-viz";
        vizWrap.style.marginTop = "10px";

        const titleParts = [];
        if (vis.industrial_type) titleParts.push(vis.industrial_type);
        if (vis.province) titleParts.push(vis.province);
        const titleText = titleParts.length ? `Biểu đồ so sánh giá (${titleParts.join(" - ")})` : "Biểu đồ so sánh giá";

        if (vis.chart_base64) {
            const img = document.createElement("img");
            img.alt = titleText;
            img.src = "data:image/png;base64," + vis.chart_base64;
            img.style.maxWidth = "100%";
            img.style.display = "block";
            img.style.borderRadius = "16px";
            img.style.border = "1px solid var(--border)";
            img.style.boxShadow = "0 12px 30px rgba(0,0,0,0.06)";
            img.addEventListener("click", () => openImagePreview(img.src, img.alt));
            vizWrap.appendChild(img);
        } else if (Array.isArray(vis.items) && vis.items.length) {
            // Fallback: server không trả base64 → vẽ chart HTML bằng CSS
            vizWrap.appendChild(buildBarChart(vis.items, titleText));
        }

        // luôn kèm bảng cho dễ đối chiếu
        if (Array.isArray(vis.items) && vis.items.length) {
            vizWrap.appendChild(buildPriceDataBlock(vis.items, "Dữ liệu so sánh giá"));
        }

        // Force wide bubble + prefer cards on mobile
        try {
            const bubble = botEl.querySelector('.message-bubble');
            if (bubble) bubble.classList.add('wide');
            autoPreferCardsOnMobile(botEl);
        } catch (_) {}

        if (stack && actions) stack.insertBefore(vizWrap, actions);
        else if (stack) stack.appendChild(vizWrap);
        else botEl.appendChild(vizWrap);

        setTimeout(scrollToBottom, 80);
        return true;
    }

    // ====================  LINKIFY (tô xanh & click được)  ====================
    function linkifyHtml(html) {
        const urlRegex = /((https?:\/\/|www\.)[^\s<]+[^<.,;:"')\]\s])/g;

        return String(html)
            .split(/(<[^>]+>)/g) // giữ nguyên thẻ html (strong, br, ...)
            .map(part => {
                if (part.startsWith('<')) return part;
                return part.replace(urlRegex, (raw) => {
                    const href = raw.startsWith('http') ? raw : `https://${raw}`;
                    return `<a class="chat-link" href="${href}" target="_blank" rel="noopener noreferrer">${raw}</a>`;
                });
            })
            .join('');
    }

    // ====================  FORMAT MESSAGE (markdown-lite like ChatGPT)  ====================
    // Mục tiêu: hiển thị giống ChatGPT hơn (paragraph, list, code block, inline code) nhưng vẫn an toàn.
    function formatInlineMarkdown(s) {
        // escape trước để không bị inject HTML
        let out = escapeHtmlGlobal(String(s ?? ""));

        // **bold**
        out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

        // `inline code`
        out = out.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

        return out;
    }

    function formatMessage(text) {
        if (!text) return "";

        // normalize newline
        let src = String(text).replace(/\r\n/g, "\n");

        // 1) tách code block ``` ``` ra trước
        const codeBlocks = [];
        src = src.replace(/```([a-z0-9_-]+)?\n([\s\S]*?)```/gi, (_m, _lang, code) => {
            const idx = codeBlocks.length;
            codeBlocks.push(String(code ?? ""));
            return `@@CODEBLOCK_${idx}@@`;
        });

        const restoreCodeBlocks = (html) => {
            return String(html).replace(/@@CODEBLOCK_(\d+)@@/g, (_m, n) => {
                const i = Number(n);
                const code = (i >= 0 && i < codeBlocks.length) ? codeBlocks[i] : "";
                const safe = escapeHtmlGlobal(code.replace(/\n$/, ""));
                return `<pre class="code-block"><code>${safe}</code></pre>`;
            });
        };

        const lines = src.split("\n");
        const htmlParts = [];

        let para = [];
        let listType = null; // 'ul' | 'ol'
        let listItems = [];

        const flushParagraph = () => {
            if (!para.length) return;
            const body = para.map(formatInlineMarkdown).join("<br>");
            htmlParts.push(`<p>${restoreCodeBlocks(body)}</p>`);
            para = [];
        };

        const flushList = () => {
            if (!listType) return;
            const items = listItems.map(li => `<li>${li}</li>`).join("");
            htmlParts.push(`<${listType}>${restoreCodeBlocks(items)}</${listType}>`);
            listType = null;
            listItems = [];
        };

        for (const rawLine of lines) {
            const line = String(rawLine ?? "");
            const trimmed = line.trim();

            // blank line -> kết thúc đoạn / list
            if (!trimmed) {
                flushParagraph();
                flushList();
                continue;
            }

            // code block đứng riêng 1 dòng
            if (/^@@CODEBLOCK_\d+@@$/.test(trimmed)) {
                flushParagraph();
                flushList();
                htmlParts.push(restoreCodeBlocks(trimmed));
                continue;
            }

            // checkbox list: - [x] item / - [ ] item
            const mCb = trimmed.match(/^[-*]\s+\[(x| )\]\s+(.*)$/i);
            if (mCb) {
                const checked = String(mCb[1]).toLowerCase() === 'x';
                const content = `${checked ? '✅' : '☐'} ${mCb[2]}`;
                if (listType && listType !== 'ul') flushList();
                listType = 'ul';
                listItems.push(restoreCodeBlocks(formatInlineMarkdown(content)));
                continue;
            }

            // unordered list: - item / * item / • item
            const mUl = trimmed.match(/^[-*•]\s+(.*)$/);
            if (mUl) {
                if (listType && listType !== 'ul') flushList();
                listType = 'ul';
                listItems.push(restoreCodeBlocks(formatInlineMarkdown(mUl[1])));
                continue;
            }

            // ordered list: 1. item
            const mOl = trimmed.match(/^\d+\.\s+(.*)$/);
            if (mOl) {
                if (listType && listType !== 'ol') flushList();
                listType = 'ol';
                listItems.push(restoreCodeBlocks(formatInlineMarkdown(mOl[1])));
                continue;
            }

            // line bình thường -> paragraph
            flushList();
            para.push(line);
        }

        flushParagraph();
        flushList();

        // linkify cuối cùng (giữ nguyên thẻ HTML)
        return linkifyHtml(htmlParts.join(""));
    }

    function escapeHtml(unsafe) {
        return unsafe.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");


    }

    // ====================  TYPING INDICATOR  ====================
    function showTypingIndicator() {
        if (document.getElementById('typingIndicator')) return;

        const typingElement = document.createElement('div');
        typingElement.className = 'message bot-message';
        typingElement.id = 'typingIndicator';
        typingElement.innerHTML = `
            <div class="message-bubble bot-bubble typing-bubble">
                <img class="typing-icon" src="iip-typing.png" alt="IIP typing" />
            </div>
        `;
        chatContainer.appendChild(typingElement);

        // ⭐ Auto scroll
        setTimeout(scrollToBottom, 50);
    }

    function hideTypingIndicator() {
        const typingElement = document.getElementById('typingIndicator');
        if (typingElement) {
            typingElement.remove();
            // ⭐ Auto scroll sau khi xóa typing indicator
            setTimeout(scrollToBottom, 50);
        }
    }



    // ====================  ACTION BUTTONS (LIKE / DISLIKE / REFRESH / COPY)  ====================
    const feedbackOverlay = document.getElementById('feedbackOverlay');
    const feedbackCloseBtn = document.getElementById('feedbackCloseBtn');
    const feedbackSubmitBtn = document.getElementById('feedbackSubmitBtn');
    const feedbackChips = document.getElementById('feedbackChips');
    const feedbackDetail = document.getElementById('feedbackDetail');

    let activeFeedbackContext = null; // { messageId, question, answerText }
    let selectedFeedbackReason = "";

    function openFeedbackModal(ctx) {
        if (!feedbackOverlay) return;

        activeFeedbackContext = ctx;
        selectedFeedbackReason = "";

        // reset UI
        feedbackOverlay.classList.add('open');
        feedbackOverlay.setAttribute('aria-hidden', 'false');

        feedbackChips?.querySelectorAll('.chip')?.forEach(c => c.classList.remove('active'));
        if (feedbackDetail) feedbackDetail.value = "";
    }

    function closeFeedbackModal() {
        if (!feedbackOverlay) return;
        feedbackOverlay.classList.remove('open');
        feedbackOverlay.setAttribute('aria-hidden', 'true');
        activeFeedbackContext = null;
        selectedFeedbackReason = "";
    }

    feedbackCloseBtn?.addEventListener('click', closeFeedbackModal);
    feedbackOverlay?.addEventListener('click', (e) => {
        // click outside modal
        if (e.target === feedbackOverlay) closeFeedbackModal();
    });

    feedbackChips?.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        feedbackChips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        selectedFeedbackReason = chip.dataset.reason || chip.innerText.trim();
    });

    feedbackSubmitBtn?.addEventListener('click', () => {
        if (!activeFeedbackContext) return;

        if (!selectedFeedbackReason) {
            alert("Vui lòng chọn lý do");
            return;
        }

        const detail = (feedbackDetail?.value || "").trim();

        logToGoogle({
            event: 'reaction',              // ✅ ĐỔI DÒNG NÀY
            reaction: 'dislike',             // ✅ BẮT BUỘC
            message_id: activeFeedbackContext.messageId || "",
            session_id: getSessionId(),
            user_id: getUserId(),
            question: activeFeedbackContext.question || "",
            answer: activeFeedbackContext.answerText || "",

            feedback_reason: selectedFeedbackReason, // ✅ CỘT reason
            feedback_detail: detail                  // ✅ CỘT detail
        });

        closeFeedbackModal();
    });


    function setReactionUI(botEl, reaction) {
        const likeBtn = botEl.querySelector('.action-btn[data-action="like"]');
        const dislikeBtn = botEl.querySelector('.action-btn[data-action="dislike"]');
        if (likeBtn) likeBtn.classList.toggle('active', reaction === 'like');
        if (dislikeBtn) dislikeBtn.classList.toggle('active', reaction === 'dislike');
        botEl.dataset.reaction = reaction;
    }

    function showTempTooltip(btn, text, duration = 1200) {
        const tip = btn.querySelector('.action-tooltip');
        if (!tip) return;
        const old = tip.textContent;
        tip.textContent = text;
        btn.classList.add('show-tooltip');
        window.clearTimeout(btn._tooltipTimer);
        btn._tooltipTimer = window.setTimeout(() => {
            tip.textContent = old;
            btn.classList.remove('show-tooltip');
        }, duration);
    }

    // ====================  TTS (GOOGLE CLOUD)  ====================
    // Frontend chỉ gọi backend (/api/tts). Không bao giờ nhúng API key ở frontend.
    // Lưu ý dev-local: nếu bạn mở index.html bằng Live Server (5500/5501),
    // thì cần gọi qua backend (8080) thay vì gọi tương đối cùng origin.
    const __TTS_ENDPOINT =
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
            ? "http://localhost:8080/api/tts"
            : "/api/tts";
    const __ttsState = {
        audio: null,
        objectUrl: null,
        isLoading: false,
        currentKey: "",
        currentBotEl: null,
        currentBtn: null,
        cache: new Map() // key -> Blob
    };

    function __ttsInit() {
        if (__ttsState.audio) return;
        __ttsState.audio = new Audio();
        __ttsState.audio.preload = 'auto';
        __ttsState.audio.addEventListener('ended', () => {
            try { __ttsResetUI(); } catch (_) {}
        });
        __ttsState.audio.addEventListener('pause', () => {
            // When user pauses (not ended), keep state so they can resume.
            try {
                if (!__ttsState.isLoading && __ttsState.currentBtn && __ttsState.currentKey) {
                    const a = __ttsState.audio;
                    if (a && a.currentTime > 0 && a.currentTime < (a.duration || Infinity)) {
                        __ttsSetBtnMode(__ttsState.currentBtn, 'paused');
                    }
                }
            } catch (_) {}
        });
        __ttsState.audio.addEventListener('play', () => {
            try {
                if (!__ttsState.isLoading && __ttsState.currentBtn) {
                    __ttsSetBtnMode(__ttsState.currentBtn, 'playing');
                }
            } catch (_) {}
        });
    }

    function __ttsUpdateBtn(btn, iconClass, tipText) {
        if (!btn) return;
        try {
            const i = btn.querySelector('i');
            if (i) i.className = iconClass;
            const tip = btn.querySelector('.action-tooltip');
            if (tip) tip.textContent = tipText;
            btn.setAttribute('aria-label', tipText);
        } catch (_) {}
    }

    function __ttsSetBtnMode(btn, mode) {
        if (!btn) return;
        btn.classList.remove('tts-loading', 'tts-playing', 'tts-paused');
        if (mode === 'loading') {
            btn.classList.add('tts-loading');
            __ttsUpdateBtn(btn, 'fa-solid fa-spinner fa-spin', 'Đang tải');
            return;
        }
        if (mode === 'playing') {
            btn.classList.add('tts-playing');
            __ttsUpdateBtn(btn, 'fa-solid fa-pause', 'Tạm dừng');
            return;
        }
        if (mode === 'paused') {
            btn.classList.add('tts-paused');
            __ttsUpdateBtn(btn, 'fa-solid fa-play', 'Tiếp tục');
            return;
        }
        __ttsUpdateBtn(btn, 'fa-solid fa-volume-high', 'Đọc');
    }

    function __ttsResetUI() {
        try {
            if (__ttsState.currentBtn) __ttsSetBtnMode(__ttsState.currentBtn, 'idle');
        } catch (_) {}
        __ttsState.isLoading = false;
        __ttsState.currentKey = "";
        __ttsState.currentBotEl = null;
        __ttsState.currentBtn = null;
        try {
            if (__ttsState.audio) {
                __ttsState.audio.pause();
                __ttsState.audio.currentTime = 0;
            }
        } catch (_) {}
        try {
            if (__ttsState.objectUrl) {
                URL.revokeObjectURL(__ttsState.objectUrl);
                __ttsState.objectUrl = null;
            }
        } catch (_) {}
        try {
            if (__ttsState.audio) __ttsState.audio.removeAttribute('src');
        } catch (_) {}
    }

    function stopTTS() {
        // Exposed for other UI flows: new chat / send / regenerate
        try { __ttsResetUI(); } catch (_) {}
    }

    function __ttsMakeKey(botEl, answerText) {
        const mid = (botEl && botEl.dataset && botEl.dataset.messageId) ? String(botEl.dataset.messageId) : "";
        if (mid) return `mid:${mid}`;
        // fallback: hash text to avoid repeated calls for history messages
        return `txt:${hashString(String(answerText || ""))}`;
    }

    function __ttsCachePut(key, blob) {
        try {
            if (!key || !blob) return;
            __ttsState.cache.set(key, blob);
            // bound cache size
            const MAX = 24;
            if (__ttsState.cache.size > MAX) {
                const firstKey = __ttsState.cache.keys().next().value;
                if (firstKey) __ttsState.cache.delete(firstKey);
            }
        } catch (_) {}
    }

    async function __ttsFetchBlob(text) {
        const res = await fetch(__TTS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ text })
        });
        if (!res.ok) {
            let msg = `Lỗi TTS (${res.status})`;
            try {
                const j = await res.json();
                if (j && j.message) msg = String(j.message);
            } catch (_) {}
            const err = new Error(msg);
            err.status = res.status;
            throw err;
        }
        const ab = await res.arrayBuffer();
        return new Blob([ab], { type: 'audio/mpeg' });
    }

    async function playOrToggleTTS(botEl, btn) {
        if (!botEl || !btn) return;
        __ttsInit();

        const bubble = botEl.querySelector('.message-bubble');
        if (!bubble) return;

        // If assistant is still streaming its current reply, don't TTS yet.
        if (bubble.classList.contains('streaming') || botEl.querySelector('.streaming-text')) {
            showTempTooltip(btn, 'Đợi trả lời xong');
            return;
        }

        const answerText = (bubble.innerText || '').trim();
        if (!answerText) {
            showTempTooltip(btn, 'Không có nội dung');
            return;
        }

        const key = __ttsMakeKey(botEl, answerText);
        const a = __ttsState.audio;

        // Same message: toggle play/pause
        if (key && __ttsState.currentKey === key && a) {
            if (__ttsState.isLoading) {
                // allow user to cancel loading
                stopTTS();
                showTempTooltip(btn, 'Đã dừng');
                return;
            }
            if (!a.paused) {
                a.pause();
                __ttsSetBtnMode(btn, 'paused');
            } else {
                try {
                    await a.play();
                    __ttsSetBtnMode(btn, 'playing');
                } catch (_) {
                    showTempTooltip(btn, 'Không thể phát');
                }
            }
            return;
        }

        // New message: stop previous
        stopTTS();

        __ttsState.currentKey = key;
        __ttsState.currentBotEl = botEl;
        __ttsState.currentBtn = btn;
        __ttsState.isLoading = true;
        __ttsSetBtnMode(btn, 'loading');

        try {
            let blob = __ttsState.cache.get(key);
            if (!blob) {
                blob = await __ttsFetchBlob(answerText);
                __ttsCachePut(key, blob);
            }

            __ttsState.objectUrl = URL.createObjectURL(blob);
            a.src = __ttsState.objectUrl;
            a.currentTime = 0;
            __ttsState.isLoading = false;
            await a.play();
            __ttsSetBtnMode(btn, 'playing');
        } catch (err) {
            __ttsState.isLoading = false;
            __ttsSetBtnMode(btn, 'idle');
            const msg = (err && err.message) ? String(err.message) : 'Không thể tạo giọng đọc.';
            showTempTooltip(btn, msg);
            try { stopTTS(); } catch (_) {}
        }
    }

    async function regenerateAnswerFor(botEl) {
        // Dừng TTS đang phát (nếu có) trước khi trả lời lại.
        try { stopTTS(); } catch (_) {}

        const question = botEl.dataset.question || "";
        const messageId = botEl.dataset.messageId || "";
        if (!question) return;

        const bubble = botEl.querySelector('.message-bubble');
        if (!bubble) return;

        bubble.innerHTML = `
            <span class="typing-inline">
                <img class="typing-icon" src="iip-typing.png" alt="IIP typing" />
            </span>
        `;

        logToGoogle({
            event: 'regenerate',
            message_id: messageId,
            session_id: getSessionId(),
            user_id: getUserId(),
            question,
            status: 'requested'
        });

        try {
            const res = await fetch('https://botchat.iipmap.com/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question })
            });

            const data = await res.json();
            const answerRaw = (data && (data.answer ?? data.reply)) ?? 'No response.';

            const parsedFromAnswer = (typeof answerRaw === "string") ? tryParseJsonDeep(answerRaw, 3) : null;
            const effectiveData = (parsedFromAnswer && typeof parsedFromAnswer === "object" && looksLikeStructuredViz(parsedFromAnswer))
                ? parsedFromAnswer
                : data;

            const displayText = (parsedFromAnswer && typeof parsedFromAnswer === "object" && looksLikeStructuredViz(parsedFromAnswer))
                ? (parsedFromAnswer.answer ?? parsedFromAnswer.message ?? parsedFromAnswer.text ?? answerRaw)
                : answerRaw;

            const normalized = normalizeBotMessage(displayText);
            bubble.innerHTML = normalized.html;

            handleExcelVisualizeResponse(effectiveData, botEl);
            handleChartJsResponse(effectiveData, botEl);
            handleFlowchartResponse(effectiveData, botEl);
logToGoogle({
                event: 'regenerate',
                message_id: messageId,
                session_id: getSessionId(),
                user_id: getUserId(),
                question,
                answer: (typeof answerRaw === 'string') ? answerRaw : JSON.stringify(answerRaw),
                status: 'done'
            });
        } catch (e) {
            bubble.innerHTML = '⚠️ Lỗi kết nối đến chatbot Render.';
            logToGoogle({
                event: 'regenerate',
                message_id: messageId,
                session_id: getSessionId(),
                user_id: getUserId(),
                question,
                status: 'failed'
            });
        }
    }

    // ====================  USER MESSAGE ACTIONS (COPY/SELECT/EDIT/SHARE)  ====================
    function selectTextInElement(el) {
        if (!el) return;
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    function clearMessagesAfter(messageEl) {
        if (!messageEl) return;
        let next = messageEl.nextSibling;
        while (next) {
            const toRemove = next;
            next = next.nextSibling;
            toRemove.remove();
        }
        setTimeout(scrollToBottom, 50);
    }

    function openEditPanel(userEl) {
        if (!userEl || userEl.classList.contains('editing')) return;

        const bubble = userEl.querySelector('.message-bubble');
        const actions = userEl.querySelector('.message-actions');
        const stack = userEl.querySelector('.user-stack') || userEl;
        const currentText = (userEl.dataset.text || bubble?.innerText || '').trim();

        userEl.classList.add('editing');

        // remove old panel if any
        stack.querySelector('.edit-panel')?.remove();

        const panel = document.createElement('div');
        panel.className = 'edit-panel';
        panel.innerHTML = `
          <textarea class="edit-textarea" rows="3"></textarea>
          <div class="edit-actions">
            <button type="button" class="edit-btn" data-edit-action="cancel">Hủy</button>
            <button type="button" class="edit-btn primary" data-edit-action="save">Lưu & gửi</button>
          </div>
        `;

        stack.appendChild(panel);
        const textarea = panel.querySelector('.edit-textarea');
        if (textarea) {
            textarea.value = currentText;
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }

        // hide bubble/actions by CSS (.editing)
        try { userEl.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (_) {}
    }

    async function postChat(question) {
        const res = await fetch('https://botchat.iipmap.com/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question })
        });
        const data = await res.json();
        return data;
    }

    async function submitEditedMessage(userEl, newText) {
        // Dừng TTS nếu đang phát (tránh đọc nhầm nội dung cũ sau khi sửa)
        try { stopTTS(); } catch (_) {}

        const bubble = userEl.querySelector('.message-bubble');
        if (bubble) bubble.innerHTML = escapeHtml(newText);
        userEl.dataset.text = newText;

        // close edit mode
        userEl.classList.remove('editing');
        userEl.querySelector('.edit-panel')?.remove();

        // remove all messages after this user message (giống ChatGPT)
        clearMessagesAfter(userEl);

        const messageId = (window.crypto && crypto.randomUUID)
            ? crypto.randomUUID()
            : Date.now() + "_" + Math.random();

        // asked log
        logToGoogle({
            event: 'edit',
            message_id: messageId,
            session_id: getSessionId(),
            user_id: getUserId(),
            question: newText,
            status: 'asked'
        });

        // Mỗi lần gửi tin nhắn: hủy request cũ và tạo request mới
        try { cancelActiveTypewriter(true); } catch (_) {}
        abortActiveChatRequest();
        const __myNonce = __chatReqNonce;
        __chatAbortCtrl = (window.AbortController ? new AbortController() : null);

        __uiIsGenerating = true;
        setSendButtonMode('stop');
        showTypingIndicator();

        try {
            const backendSessionId = getBackendSessionId();
            const payload = backendSessionId ? { question: newText, session_id: backendSessionId } : { question: newText };
            const res = await fetch('https://botchat.iipmap.com/chat', {
                signal: __chatAbortCtrl ? __chatAbortCtrl.signal : undefined,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (__myNonce !== __chatReqNonce) return;
            hideTypingIndicator();
            const answerRaw = (data && (data.answer ?? data.reply)) ?? 'No response.';

            const parsedFromAnswer = (typeof answerRaw === "string") ? tryParseJsonDeep(answerRaw, 3) : null;
            const effectiveData = (parsedFromAnswer && typeof parsedFromAnswer === "object" && looksLikeStructuredViz(parsedFromAnswer))
                ? parsedFromAnswer
                : data;

            const displayText = (parsedFromAnswer && typeof parsedFromAnswer === "object" && looksLikeStructuredViz(parsedFromAnswer))
                ? (parsedFromAnswer.answer ?? parsedFromAnswer.message ?? parsedFromAnswer.text ?? answerRaw)
                : answerRaw;

            const normalizedForAnim = normalizeBotMessage(displayText);
            let botEl;
            if (shouldAnimateBotText(displayText, normalizedForAnim)) {
                botEl = addBotMessage('', { messageId, question: newText });
                const bubbleEl = botEl ? botEl.querySelector('.message-bubble') : null;
                __uiActiveTypewriter = runTypewriter(
                    bubbleEl,
                    String(displayText ?? ''),
                    normalizedForAnim.html,
                    () => {
                        __uiIsGenerating = false;
                        __uiActiveTypewriter = null;
                        setSendButtonMode('send');
                    }
                );
            } else {
                botEl = addBotMessage(displayText, { messageId, question: newText });
                __uiIsGenerating = false;
                setSendButtonMode('send');
            }

            handleExcelVisualizeResponse(effectiveData, botEl);
            handleChartJsResponse(effectiveData, botEl);
            handleFlowchartResponse(effectiveData, botEl);
logToGoogle({
                event: 'edit',
                message_id: messageId,
                session_id: getSessionId(),
                user_id: getUserId(),
                question: newText,
                answer: (typeof answerRaw === 'string') ? answerRaw : JSON.stringify(answerRaw),
                status: 'answered'
            });
        } catch (e) {
            hideTypingIndicator();
            __uiIsGenerating = false;
            setSendButtonMode('send');
            addBotMessage('⚠️ Lỗi kết nối đến chatbot Render.');
        }
    }

    chatContainer.addEventListener('click', async (e) => {
        // Edit panel actions
        const editActionBtn = e.target.closest('[data-edit-action]');
        if (editActionBtn) {
            const action = editActionBtn.dataset.editAction;
            const userEl = editActionBtn.closest('.user-message');
            if (!userEl) return;

            if (action === 'cancel') {
                userEl.classList.remove('editing');
                userEl.querySelector('.edit-panel')?.remove();
                return;
            }

            if (action === 'save') {
                const textarea = userEl.querySelector('.edit-textarea');
                const newText = (textarea?.value || '').trim();
                if (!newText) {
                    alert('Tin nhắn không được để trống');
                    return;
                }
                await submitEditedMessage(userEl, newText);
                return;
            }
        }

        const btn = e.target.closest('.action-btn');
        if (!btn) return;

        const messageEl = btn.closest('.message');
        if (!messageEl) return;

        // USER MESSAGE ACTIONS
        if (messageEl.classList.contains('user-message')) {
            const bubble = messageEl.querySelector('.message-bubble');
            const text = (messageEl.dataset.text || bubble?.innerText || '').trim();
            const action = btn.dataset.action;

            if (action === 'user-copy') {
                try {
                    await navigator.clipboard.writeText(text);
                    showTempTooltip(btn, 'Đã sao chép');
                } catch (err) {
                    showTempTooltip(btn, 'Không thể sao chép');
                }
                return;
            }

            if (action === 'user-select') {
                if (bubble) selectTextInElement(bubble);
                showTempTooltip(btn, 'Đã chọn');
                return;
            }

            if (action === 'user-share') {
                try {
                    if (navigator.share) {
                        await navigator.share({ text });
                        showTempTooltip(btn, 'Đã chia sẻ');
                    } else {
                        await navigator.clipboard.writeText(text);
                        showTempTooltip(btn, 'Đã sao chép');
                    }
                } catch (err) {
                    showTempTooltip(btn, 'Không thể chia sẻ');
                }
                return;
            }

            if (action === 'user-edit') {
                openEditPanel(messageEl);
                return;
            }

            return;
        }

        // BOT MESSAGE ACTIONS
        const botEl = messageEl.classList.contains('bot-message') ? messageEl : btn.closest('.bot-message');
        if (!botEl) return;

        const action = btn.dataset.action;
        const messageId = botEl.dataset.messageId || "";
        const question = botEl.dataset.question || "";
        const bubble = botEl.querySelector('.message-bubble');
        const answerText = bubble ? bubble.innerText.trim() : "";

        if (action === 'tts') {
            try { await playOrToggleTTS(botEl, btn); } catch (_) {}
            return;
        }

        if (action === 'copy') {
            try {
                await navigator.clipboard.writeText(answerText);
                showTempTooltip(btn, 'Đã sao chép');

                logToGoogle({
                    event: 'copy',
                    message_id: messageId,
                    session_id: getSessionId(),
                    user_id: getUserId(),
                    question,
                    status: 'done'
                });
            } catch (err) {
                showTempTooltip(btn, 'Không thể sao chép');
            }
            return;
        }


        if (action === 'share') {
            try {
                if (navigator.share) {
                    await navigator.share({ text: answerText });
                    showTempTooltip(btn, 'Đã chia sẻ');
                } else {
                    await navigator.clipboard.writeText(answerText);
                    showTempTooltip(btn, 'Đã sao chép');
                }
            } catch (err) {
                showTempTooltip(btn, 'Không thể chia sẻ');
            }
            return;
        }
        if (action === 'refresh') {
            await regenerateAnswerFor(botEl);
            return;
        }

        if (action === 'like' || action === 'dislike') {
            const current = botEl.dataset.reaction || "";
            if (current === action) return; // tránh double-click tăng lượt

            setReactionUI(botEl, action);

            logToGoogle({
                event: 'reaction',
                reaction: action,
                message_id: messageId,
                session_id: getSessionId(),
                user_id: getUserId(),
                question,
                answer: answerText,
                status: 'clicked'
            });

            if (action === 'dislike') {
                openFeedbackModal({ messageId, question, answerText });
            }
            return;
        }
    });

    // ====================  FILE UPLOAD  ====================
    fileButton.addEventListener('click', function () {
        fileInput.click();
    });

    fileInput.addEventListener('change', function (e) {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            const message = messageInput.value.trim() || "I'm sending you these files:";
            addUserMessage(message, files);
            messageInput.value = '';

            showTypingIndicator();
            setTimeout(() => {
                hideTypingIndicator();
                addBotMessage(`I received ${files.length} file(s). How can I help you with these?`);
            }, 1000);

            fileInput.value = '';
        }
    });



    async function sendAudioToGoogleSTT(blob) {
        try {
            const fd = new FormData();
            fd.append("audio", blob, "speech.webm");
            fd.append("lang", speechLang);

            const res = await fetch("https://chatiip-stt.fly.dev/stt", {
                method: "POST",
                body: fd
            });

            const data = await res.json();
            return data.text || "";
        } catch (e) {
            console.error("STT network error:", e);
            return "";
        }
    }


    function showRecordingBubble() {
        const messagesContainer =
            document.querySelector(".chat-messages") ||
            document.querySelector(".messages") ||
            document.getElementById("chatMessages");

        if (!messagesContainer) return;

        if (document.getElementById("recordingBubble")) return;

        const bubble = document.createElement("div");
        bubble.id = "recordingBubble";
        bubble.className = "message bot recording";
        bubble.innerHTML = "🎧 Đang nghe...";

        messagesContainer.appendChild(bubble);
        bubble.scrollIntoView({ behavior: "smooth" });
    }


    function removeRecordingBubble() {
        const bubble = document.getElementById("recordingBubble");
        if (bubble) bubble.remove();
    }


    async function startSpeechToText() {

        if (isRecording) return;
        showRecordingBubble();
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            let mimeType = "audio/webm";

            mediaChunks = [];
            mediaRecorder = new MediaRecorder(mediaStream, { mimeType });

            mediaRecorder.ondataavailable = e => {
                if (e.data && e.data.size > 0) mediaChunks.push(e.data);
            };

            mediaRecorder.onstop = async () => {

                removeRecordingBubble();

                const blob = new Blob(mediaChunks, { type: mimeType });

                isRecording = false;
                voiceButton.innerHTML = '<i class="fas fa-microphone"></i>';
                voiceButton.style.color = "";

                const text = await sendAudioToGoogleSTT(blob);

                if (text) {
                    addUserMessage(`🎤 ${text}`);
                    sendTextToChatbot(text);
                } else {
                    addBotMessage("⚠️ Không nghe rõ, vui lòng thử lại.");
                }

                mediaStream.getTracks().forEach(t => t.stop());
                mediaRecorder = null;
                mediaChunks = [];

                if (recordingTimer) {
                    clearTimeout(recordingTimer);
                    recordingTimer = null;
                }

            };

            mediaRecorder.start();

            recordingTimer = setTimeout(() => {
                if (isRecording) stopSpeechToText();
            }, 5000); // tự dừng sau 5 giây

            isRecording = true;
            voiceButton.innerHTML = '<i class="fas fa-stop"></i>';
            voiceButton.style.color = "#dc2626";

        } catch (err) {
            console.error(err);
            addBotMessage("⚠️ Không truy cập được microphone.");
        }
    }


    function stopSpeechToText() {
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
        }
    }




    voiceButton.addEventListener('click', function () {
        if (!isRecording) startSpeechToText();
        else stopSpeechToText();
    });


    // ====================  CHAT REQUEST CONTROL (ABORT + NONCE)  ====================
    // Khi người dùng bấm "Đoạn chat mới" trong lúc chatbot đang trả lời:
    // - Hủy request cũ (AbortController)
    // - Tăng nonce để bỏ qua mọi response về muộn
    let __chatReqNonce = 0;
    let __chatAbortCtrl = null;

    function abortActiveChatRequest() {
        try {
            __chatReqNonce++;
            if (__chatAbortCtrl) {
                __chatAbortCtrl.abort();
            }
        } catch (_) {}
        __chatAbortCtrl = null;
        try { hideTypingIndicator(); } catch (_) {}

        // Also reset stop/typewriter UI when requests are aborted (new chat / stop button / etc.)
        try { cancelActiveTypewriter(true); } catch (_) {}
        try { __uiIsGenerating = false; } catch (_) {}
        try { setSendButtonMode('send'); } catch (_) {}
    }

    function sendTextToChatbot(text) {
        if (!text.trim()) return;

        // Mỗi lần gửi tin nhắn: hủy request cũ và tạo request mới
        try { cancelActiveTypewriter(true); } catch (_) {}
        abortActiveChatRequest();
        const __myNonce = __chatReqNonce;
        __chatAbortCtrl = (window.AbortController ? new AbortController() : null);

        __uiIsGenerating = true;
        setSendButtonMode('stop');
        showTypingIndicator();

        const messageId = (window.crypto && crypto.randomUUID)
            ? crypto.randomUUID()
            : Date.now() + "_" + Math.random();

        // log asked
        logToGoogle({
            message_id: messageId,
            session_id: getSessionId(),
            user_id: getUserId(),
            question: text,
            status: "asked"
        });

        const backendSessionId = getBackendSessionId();
        const payload = backendSessionId
            ? { question: text, session_id: backendSessionId }
            : { question: text };

        fetch("https://botchat.iipmap.com/chat", {
            signal: __chatAbortCtrl ? __chatAbortCtrl.signal : undefined,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        })
            .then(res => res.json())
            .then(data => {
                // Nếu user đã bấm "Đoạn chat mới" (nonce tăng) thì bỏ qua response cũ
                if (__myNonce !== __chatReqNonce) return;

                const backendSessionIdFromServer = data && data.session_id;
                if (backendSessionIdFromServer) setBackendSessionId(backendSessionIdFromServer);

                hideTypingIndicator();
                const answerRaw = (data && (data.answer ?? data.reply)) ?? "No response.";

                const parsedFromAnswer = (typeof answerRaw === "string") ? tryParseJsonDeep(answerRaw, 3) : null;
                const effectiveData = (parsedFromAnswer && typeof parsedFromAnswer === "object" && looksLikeStructuredViz(parsedFromAnswer))
                    ? parsedFromAnswer
                    : data;

                const displayText = (parsedFromAnswer && typeof parsedFromAnswer === "object" && looksLikeStructuredViz(parsedFromAnswer))
                    ? (parsedFromAnswer.answer ?? parsedFromAnswer.message ?? parsedFromAnswer.text ?? answerRaw)
                    : answerRaw;

                const normalizedForAnim = normalizeBotMessage(displayText);
                let botEl;
                if (shouldAnimateBotText(displayText, normalizedForAnim)) {
                    botEl = addBotMessage("", { messageId, question: text });
                    const bubble = botEl ? botEl.querySelector('.message-bubble') : null;
                    __uiActiveTypewriter = runTypewriter(
                        bubble,
                        String(displayText ?? ''),
                        normalizedForAnim.html,
                        () => {
                            __uiIsGenerating = false;
                            __uiActiveTypewriter = null;
                            setSendButtonMode('send');
                        }
                    );
                } else {
                    botEl = addBotMessage(displayText, { messageId, question: text });
                    __uiIsGenerating = false;
                    setSendButtonMode('send');
                }

                handleExcelVisualizeResponse(effectiveData, botEl);
                handleChartJsResponse(effectiveData, botEl);
                handleFlowchartResponse(effectiveData, botEl);
// ✅ log answered (điểm bạn đang thiếu)
                logToGoogle({
                    message_id: messageId,
                    session_id: getSessionId(),
                    user_id: getUserId(),
                    question: text,
                    answer: (typeof answerRaw === "string") ? answerRaw : JSON.stringify(answerRaw),
                    status: "answered"
                });
            })
            .catch((err) => {
                // Nếu user đã bấm "Đoạn chat mới" hoặc request bị hủy thì im lặng
                if (__myNonce !== __chatReqNonce) return;
                if (err && (err.name === "AbortError")) return;

                hideTypingIndicator();
                __uiIsGenerating = false;
                setSendButtonMode('send');
                addBotMessage("⚠️ Lỗi kết nối chatbot.");

                // (tuỳ chọn) log fail
                logToGoogle({
                    message_id: messageId,
                    session_id: getSessionId(),
                    user_id: getUserId(),
                    question: text,
                    status: "failed"
                });
            });
    }


    window.stopRecording = function () {
        if (isRecording) stopSpeechToText();
    };

    // (Removed) Mobile focus/blur auto-scroll: caused jump when opening keyboard on phones.



    // ============================================================
    //          ChatGPT-style RAIL + SIDEBAR PANEL + HISTORY
    // ============================================================

    const sidebarPanel = document.getElementById("sidebarPanel");
    const sidebarBackdrop = document.getElementById("sidebarBackdrop");
    const toggleSidebarBtn = document.getElementById("toggleSidebarBtn");
    const mobileSidebarBtn = document.getElementById("mobileSidebarBtn");
    const sidebarCloseBtn = document.getElementById("sidebarCloseBtn");
    const newChatBtn = document.getElementById("newChatBtn");
    const newChatRailBtn = document.getElementById("newChatRailBtn");
    const mobileNewChatBtn = document.getElementById("mobileNewChatBtn");
    const searchRailBtn = document.getElementById("searchRailBtn");
    const historySearchInput = document.getElementById("historySearchInput");
    const chatHistoryList = document.getElementById("chatHistoryList");
    const historyEmpty = document.getElementById("historyEmpty");
    const newsRailBtn = document.getElementById("newsRailBtn");
    const panelNewsBtn = document.getElementById("panelNewsBtn");
    const lawsRailBtn = document.getElementById("lawsRailBtn");
    const lawsBtn = document.getElementById("lawsBtn");

    // Top-right chat actions (Share + 3-dots)
    const chatShareBtn = document.getElementById("chatShareBtn");
    const chatMoreBtn = document.getElementById("chatMoreBtn");
    const mobileChatMoreBtn = document.getElementById("mobileChatMoreBtn");

    // Track whether the current view is an active chat (has at least one message).
    // This drives the visibility of top-right actions on desktop and the 3-dots on mobile.
    function syncChatHasMessagesUI() {
        try {
            const has = !!(chatContainer && chatContainer.classList && chatContainer.classList.contains("has-messages"));
            document.body.classList.toggle("chat-has-messages", has);
        } catch (_) {}
    }

    function openSidebarPanel() {
        if (!sidebarPanel) return;
        sidebarPanel.classList.add("open");
        sidebarPanel.setAttribute("aria-hidden", "false");
        if (sidebarBackdrop) {
            sidebarBackdrop.classList.add("show");
            sidebarBackdrop.setAttribute("aria-hidden", "false");
        }
    }

    function closeSidebarPanel() {
        if (!sidebarPanel) return;
        sidebarPanel.classList.remove("open");
        sidebarPanel.setAttribute("aria-hidden", "true");
        if (sidebarBackdrop) {
            sidebarBackdrop.classList.remove("show");
            sidebarBackdrop.setAttribute("aria-hidden", "true");
        }
    }

    if (toggleSidebarBtn) toggleSidebarBtn.addEventListener("click", () => {
        if (!sidebarPanel) return;
        const isOpen = sidebarPanel.classList.contains("open");
        if (isOpen) closeSidebarPanel();
        else openSidebarPanel();
    });

    // Mobile top bar hamburger (phones)
    if (mobileSidebarBtn) mobileSidebarBtn.addEventListener("click", () => {
        if (!sidebarPanel) return;
        const isOpen = sidebarPanel.classList.contains("open");
        if (isOpen) closeSidebarPanel();
        else openSidebarPanel();
    });

    if (sidebarCloseBtn) sidebarCloseBtn.addEventListener("click", closeSidebarPanel);
    if (sidebarBackdrop) sidebarBackdrop.addEventListener("click", closeSidebarPanel);

    // ---------- Per-user history store (localStorage) ----------
    const HISTORY_KEY_PREFIX = "chatiip_chat_sessions_";
    const PENDING_KEY_PREFIX = "chatiip_pending_chat_";

    function safeJsonParse(raw, fallback) {
        try { return JSON.parse(raw); } catch (_) { return fallback; }
    }

    function getLoggedInUser() {
        try {
            const raw = localStorage.getItem("chatiip_current_user");
            if (!raw) return null;
            const u = safeJsonParse(raw, null);
            if (!u || !u.id) return null;
            return u;
        } catch (_) {
            return null;
        }
    }

    // NOTE: Theo yêu cầu: khi CHƯA đăng nhập thì KHÔNG lưu lịch sử.
    // Lịch sử chỉ có khi user đã đăng nhập.
    function getHistoryOwnerId() {
        const u = getLoggedInUser();
        return (u && u.id) ? u.id : "";
    }

    function isLoggedIn() {
        const u = getLoggedInUser();
        return !!(u && u.id);
    }

    // ---------- Auth-based layout ----------
    const unauthRefreshBtn = document.getElementById("unauthRefreshBtn");

    function applyAuthLayout() {
        try {
            const loggedIn = isLoggedIn();

            if (!loggedIn) {
                document.body.classList.add("unauth-mode");
                document.documentElement.classList.add("unauth-mode");
                try { closeSidebarPanel(); } catch (_) {}

                // Ensure guest does not rehydrate old chat on reload
                try { clearBackendSessionId(); } catch (_) {}
                try { localStorage.removeItem("chatiip_chat_cache_pending_v4"); } catch (_) {}
            } else {
                document.body.classList.remove("unauth-mode");
                document.documentElement.classList.remove("unauth-mode");
            }
        } catch (_) {}
    }

    if (unauthRefreshBtn) {
        unauthRefreshBtn.addEventListener("click", () => {
            try { window.location.reload(); } catch (_) { window.location.href = window.location.href; }
        });
    }

    function historyKey(userId) {
        return HISTORY_KEY_PREFIX + String(userId || "");
    }

    function pendingKey(userId) {
        return PENDING_KEY_PREFIX + String(userId || "");
    }

    function readSessions(userId) {
        try {
            if (!userId) return [];
            const raw = localStorage.getItem(historyKey(userId));
            const list = safeJsonParse(raw || "[]", []);
            return Array.isArray(list) ? list : [];
        } catch (_) {
            return [];
        }
    }

    function writeSessions(userId, list) {
        try {
            if (!userId) return;
            localStorage.setItem(historyKey(userId), JSON.stringify(list || []));
        } catch (_) {}
    }

    // ---------- Server sync (multi-device) ----------
    // Đồng bộ metadata lịch sử chat theo user lên backend của bạn.
    const API_BASE =
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
            ? "http://localhost:8080/api"
            : "/api";

    async function apiJson(path, options = {}) {
        const res = await fetch(API_BASE + path, {
            method: options.method || "GET",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        let data = {};
        try { data = await res.json(); } catch (_) {}
        if (!res.ok) throw new Error(data.message || "Có lỗi xảy ra.");
        return data;
    }

    function normalizeServerSessions(serverList) {
        const arr = Array.isArray(serverList) ? serverList : [];
        return arr.map((s) => {
            const created = s.createdAt ? Date.parse(s.createdAt) : NaN;
            const updated = s.updatedAt ? Date.parse(s.updatedAt) : NaN;
            return {
                sessionId: String(s.sessionId),
                title: String(s.title || "Đoạn chat"),
                preview: String(s.preview || ""),
                pinned: !!s.pinned,
                archived: !!s.archived,
                // script.js đang dùng số (ms) cho sorting
                createdAt: Number.isNaN(created) ? Date.now() : created,
                updatedAt: Number.isNaN(updated) ? Date.now() : updated
            };
        });
    }

    async function pullSessionsFromServer(user) {
        try {
            if (!user || !user.id) return;
            const data = await apiJson("/chat/sessions");
            const normalized = normalizeServerSessions(data.sessions);
            writeSessions(user.id, normalized);
            updateHistoryUI(historySearchInput ? historySearchInput.value : "");
        } catch (e) {
            // Không block UI nếu lỗi
            console.warn("Pull sessions failed", e);
        }
    }

    async function upsertSessionToServer(sessionId, patch) {
        try {
            if (!sessionId) return;
            await apiJson(`/chat/sessions/${encodeURIComponent(String(sessionId))}`, {
                method: "PUT",
                body: patch || {}
            });
        } catch (e) {
            console.warn("Upsert session failed", e);
        }
    }

    // Khi user login/logout → pull list sessions để đồng bộ đa thiết bị
    window.addEventListener("chatiip:auth-changed", (ev) => {
        const u = ev && ev.detail ? ev.detail.user : null;
        if (u && u.id) {
            pullSessionsFromServer(u);
        }
    });

    // Nếu đã login sẵn (localStorage) thì pull ngay khi tải trang
    try {
        const u0 = getLoggedInUser && getLoggedInUser();
        if (u0 && u0.id) pullSessionsFromServer(u0);
    } catch (_) {}

    function upsertSession(userId, sessionId, patch = {}) {
        if (!userId || !sessionId) return;
        const now = Date.now();
        const list = readSessions(userId);
        const idx = list.findIndex(s => String(s.sessionId) === String(sessionId));

        const hasOwn = (k) => Object.prototype.hasOwnProperty.call(patch || {}, k);

        const base = {
            sessionId: String(sessionId),
            title: "Đoạn chat",
            preview: "",
            createdAt: (patch && patch.createdAt) ? patch.createdAt : now,
            updatedAt: now
        };

        if (idx >= 0) {
            const cur = list[idx] || {};
            const merged = { ...cur, ...base, ...patch };

            // Normalize title/preview handling
            if (hasOwn("title")) {
                const t = String(patch.title || "").trim();
                merged.title = t || "Đoạn chat";
            } else {
                merged.title = cur.title || base.title;
            }

            if (hasOwn("preview")) {
                merged.preview = String(patch.preview || "");
            } else {
                merged.preview = (cur.preview || "");
            }

            merged.createdAt = cur.createdAt || base.createdAt;
            merged.updatedAt = now;
            list[idx] = merged;
        } else {
            const merged = { ...base, ...patch };
            const t = String((patch && patch.title) ? patch.title : base.title).trim();
            merged.title = t || "Đoạn chat";
            merged.preview = String((patch && patch.preview) ? patch.preview : "");
            merged.updatedAt = now;
            list.unshift(merged);
        }

        // sort newest first
        list.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
        writeSessions(userId, list);
    }

    function removeSession(userId, sessionId) {
        if (!userId || !sessionId) return;
        const list = readSessions(userId).filter(s => String(s.sessionId) !== String(sessionId));
        writeSessions(userId, list);
    }

    function setPendingSession(userId, meta) {
        try {
            if (!userId) return;
            localStorage.setItem(pendingKey(userId), JSON.stringify(meta || null));
        } catch (_) {}
    }

    function readPendingSession(userId) {
        try {
            if (!userId) return null;
            const raw = localStorage.getItem(pendingKey(userId));
            return safeJsonParse(raw || "null", null);
        } catch (_) {
            return null;
        }
    }

    function clearPendingSession(userId) {
        try { if (userId) localStorage.removeItem(pendingKey(userId)); } catch (_) {}
    }

    function formatHistoryTitle(s) {
        const t = String(s || "").trim();
        if (!t) return "Đoạn chat";
        return t.length > 52 ? (t.slice(0, 52) + "…") : t;
    }

    function updateHistoryUI(filterText = "") {
        if (!chatHistoryList || !historyEmpty) return;
        const user = getLoggedInUser();
        const ownerId = getHistoryOwnerId();
        const loggedIn = !!(user && user.id);

        // When not logged in: no sidebar history (per requirement)
        if (!loggedIn) {
            chatHistoryList.innerHTML = `<div class="sidebar-empty">Đăng nhập để xem lịch sử chat.</div>`;
            return;
        }

        const q = String(filterText || "").trim().toLowerCase();
        const activeId = String(getBackendSessionId() || "");

        // Default: ẩn các đoạn đã lưu trữ
        let list = readSessions(ownerId).filter(s => !s.archived);

        // Search
        if (q) {
            list = list.filter(s => (
                String(s.title || "").toLowerCase().includes(q) ||
                String(s.preview || "").toLowerCase().includes(q)
            ));
        }

        // Sort: pinned first, then updatedAt desc
        list.sort((a, b) => {
            const ap = a.pinned ? 1 : 0;
            const bp = b.pinned ? 1 : 0;
            if (ap != bp) return bp - ap;
            return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
        });

        // Pending (when user has typed but server hasn't returned a backend session_id yet)
        const pending = readPendingSession(ownerId);
        const hasPending = !!(pending && !activeId);

        if (!list.length && !hasPending) {
            chatHistoryList.innerHTML = `<div class="sidebar-empty">${q ? "Không tìm thấy lịch sử phù hợp." : "Chưa có lịch sử chat."}</div>`;
            return;
        }

        const pendingHtml = (hasPending && !q)
            ? `
              <div class="history-row pending" data-session-id="__pending__">
                <button class="history-item" type="button" aria-label="Đang tạo đoạn chat" disabled>
                  <div class="history-meta">
                    <div class="history-title">${escapeHtmlGlobal(formatHistoryTitle(pending.title || "Đoạn chat"))}</div>
                    <div class="history-sub">Đang gửi…</div>
                  </div>
                </button>
                <button class="history-more" type="button" aria-label="Tuỳ chọn" title="Tuỳ chọn" disabled style="opacity:.35; cursor:not-allowed;">
                  <i class="fas fa-ellipsis"></i>
                </button>
              </div>
            `
            : "";

        chatHistoryList.innerHTML = pendingHtml + list.map(item => {
            const title = formatHistoryTitle(item.title);
            const preview = String(item.preview || "").trim();
            const sub = preview ? (preview.length > 70 ? preview.slice(0, 70) + "…" : preview) : "";
            const isActive = activeId && String(item.sessionId) === activeId;
            const isPinned = !!item.pinned;
            return `
              <div class="history-row" data-session-id="${encodeURIComponent(String(item.sessionId))}">
                <button class="history-item ${isActive ? "active" : ""}" type="button" data-session-id="${encodeURIComponent(String(item.sessionId))}" aria-label="Mở đoạn chat">
                  <div class="history-meta">
                    <div class="history-title">${isPinned ? "📌 " : ""}${escapeHtmlGlobal(title)}</div>
                    <div class="history-sub">${escapeHtmlGlobal(sub)}</div>
                  </div>
                </button>
                <button class="history-more" type="button" data-action="more" data-session-id="${encodeURIComponent(String(item.sessionId))}" aria-label="Tuỳ chọn" title="Tuỳ chọn">
                  <i class="fas fa-ellipsis"></i>
                </button>
              </div>
            `;
        }).join("");
    }

    // Init layout + history based on auth state, and re-sync whenever auth changes.
    applyAuthLayout();
    try { syncChatHasMessagesUI(); } catch (_) {}
    try {
        const loggedInNow = (typeof isLoggedIn === "function") ? isLoggedIn() : false;
        if (!loggedInNow && shouldAlwaysShowLoginPrompt()) {
            openLoginPromptModal();
        }
    } catch (_) {}

    try { updateHistoryUI(""); } catch (_) {}

    window.addEventListener("chatiip:auth-changed", () => {
        try { applyAuthLayout(); } catch (_) {}
        try { syncChatHasMessagesUI(); } catch (_) {}
        try { updateHistoryUI(historySearchInput ? historySearchInput.value : ""); } catch (_) {}
    });

    // ---------- Mini toast (local, lightweight) ----------
    function showToast(message, type) {
        try {
            const msg = String(message || "").trim();
            if (!msg) return;

            let wrap = document.getElementById("miniToastWrap");
            if (!wrap) {
                wrap = document.createElement("div");
                wrap.id = "miniToastWrap";
                wrap.className = "mini-toast-wrap";
                document.body.appendChild(wrap);
            }

            const t = document.createElement("div");
            t.className = "mini-toast" + (type ? (" " + String(type)) : "");
            t.innerHTML = `<span class="mini-toast-text">${escapeHtmlGlobal(msg)}</span><button class="mini-toast-close" aria-label="Đóng">&times;</button>`;
            wrap.appendChild(t);

            const remove = () => {
                t.classList.add("hide");
                setTimeout(() => { try { t.remove(); } catch (_) {} }, 250);
            };
            t.querySelector(".mini-toast-close")?.addEventListener("click", remove);
            setTimeout(remove, 3200);
        } catch (_) {}
    }

    // ---------- Archive overlay ----------
    let archiveOverlayEl = null;

    function ensureArchiveOverlay() {
        if (archiveOverlayEl) return archiveOverlayEl;
        const overlay = document.createElement("div");
        overlay.id = "archiveOverlay";
        overlay.className = "auth-overlay";
        overlay.setAttribute("aria-hidden", "true");
        overlay.innerHTML = `
          <div class="account-modal" role="dialog" aria-modal="true" aria-label="Lưu trữ">
            <button class="auth-close" id="archiveCloseBtn" aria-label="Đóng">&times;</button>
            <div class="auth-title">Lưu trữ</div>
            <div class="auth-subtitle">Quản lý các đoạn chat đã lưu trữ.</div>

            <div class="sidebar-panel-search" style="padding: 0; margin: 10px 0 12px 0;">
              <i class="fas fa-magnifying-glass"></i>
              <input id="archiveSearchInput" type="text" placeholder="Tìm trong lưu trữ..." autocomplete="off" />
            </div>

            <div class="archive-list" id="archiveList"></div>
          </div>
        `;
        document.body.appendChild(overlay);
        archiveOverlayEl = overlay;

        overlay.addEventListener("click", (e) => {
            if (e.target && e.target.id === "archiveOverlay") closeArchiveOverlay();
        });
        overlay.querySelector("#archiveCloseBtn")?.addEventListener("click", closeArchiveOverlay);
        overlay.querySelector("#archiveSearchInput")?.addEventListener("input", () => renderArchiveList());

        overlay.querySelector("#archiveList")?.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-arch-act]");
            if (!btn) return;
            const act = btn.getAttribute("data-arch-act");
            const sid = btn.getAttribute("data-session-id") || "";
            const ownerId = (typeof getHistoryOwnerId === "function") ? getHistoryOwnerId() : (getLoggedInUser()?.id || "guest");
            const loggedIn = (typeof isLoggedIn === "function") ? isLoggedIn() : !!getLoggedInUser()?.id;
            if (!sid) return;

            if (act === "restore") {
                upsertSession(ownerId, sid, { archived: false });
                if (loggedIn) { try { upsertSessionToServer(sid, { archived: false }); } catch (_) {} }
                showToast("Đã khôi phục khỏi lưu trữ.", "success");
                renderArchiveList();
                updateHistoryUI(historySearchInput ? historySearchInput.value : "");
                return;
            }
            if (act === "delete") {
                removeSession(ownerId, sid);
                if (loggedIn) { try { upsertSessionToServer(sid, { deleted: true }); } catch (_) {} }
                showToast("Đã xóa đoạn chat.", "success");
                renderArchiveList();
                updateHistoryUI(historySearchInput ? historySearchInput.value : "");
                return;
            }
        });

        return overlay;
    }

    function openArchiveOverlay() {
        // Guest cũng được phép xem lưu trữ (lưu trên thiết bị). Nếu đăng nhập sẽ đồng bộ qua backend.
        const el = ensureArchiveOverlay();
        el.classList.add("show");
        el.setAttribute("aria-hidden", "false");
        document.body.classList.add("modal-open");
        renderArchiveList();
        try {
            if (!isLoggedIn()) {
                showToast("Lưu trữ đang được lưu trên thiết bị này. Đăng nhập để đồng bộ đa thiết bị.", "info");
            }
        } catch (_) {}
        setTimeout(() => {
            try { el.querySelector("#archiveSearchInput")?.focus(); } catch (_) {}
        }, 40);
    }

    function closeArchiveOverlay() {
        if (!archiveOverlayEl) return;
        archiveOverlayEl.classList.remove("show");
        archiveOverlayEl.setAttribute("aria-hidden", "true");
        const anyOpen = document.querySelector(".auth-overlay.show");
        if (!anyOpen) document.body.classList.remove("modal-open");
    }

    function renderArchiveList() {
        if (!archiveOverlayEl) return;
        const listEl = archiveOverlayEl.querySelector("#archiveList");
        const qEl = archiveOverlayEl.querySelector("#archiveSearchInput");
        if (!listEl) return;

        const ownerId = (typeof getHistoryOwnerId === "function") ? getHistoryOwnerId() : (getLoggedInUser()?.id || "guest");

        const q = String(qEl?.value || "").trim().toLowerCase();
        let list = readSessions(ownerId).filter(s => !!s.archived);
        if (q) {
            list = list.filter(s => (
                String(s.title || "").toLowerCase().includes(q) ||
                String(s.preview || "").toLowerCase().includes(q)
            ));
        }

        list.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

        if (!list.length) {
            listEl.innerHTML = `<div class="sidebar-empty">${q ? "Không có kết quả." : "Chưa có đoạn chat nào được lưu trữ."}</div>`;
            return;
        }

        listEl.innerHTML = list.map(item => {
            const title = formatHistoryTitle(item.title);
            const sid = encodeURIComponent(String(item.sessionId));
            return `
              <div class="archive-row">
                <div class="archive-meta">
                  <div class="archive-title">${escapeHtmlGlobal(title)}</div>
                </div>
                <div class="archive-actions">
                  <button class="pill-btn" data-arch-act="restore" data-session-id="${sid}" type="button">Khôi phục</button>
                  <button class="pill-btn danger" data-arch-act="delete" data-session-id="${sid}" type="button">Xóa</button>
                </div>
              </div>
            `;
        }).join("");
    }

    window.addEventListener("chatiip:open-archive", openArchiveOverlay);


    // ---------- History menu (3 dots) ----------
    let historyMenuEl = null;
    let historyMenuSid = null;

    function ensureHistoryMenu() {
        if (historyMenuEl) return historyMenuEl;
        const el = document.createElement("div");
        el.id = "historyContextMenu";
        el.className = "history-menu";
        el.setAttribute("aria-hidden", "true");
        el.innerHTML = `
          <button class="history-menu-item" type="button" data-act="share">
            <i class="fas fa-arrow-up-from-bracket"></i>
            <span>Chia sẻ</span>
          </button>
          <button class="history-menu-item" type="button" data-act="rename">
            <i class="fas fa-pen"></i>
            <span>Đổi tên</span>
          </button>
          <button class="history-menu-item" type="button" data-act="pin">
            <i class="fas fa-thumbtack"></i>
            <span id="historyMenuPinText">Ghim đoạn chat</span>
          </button>
          <button class="history-menu-item" type="button" data-act="archive">
            <i class="fas fa-box-archive"></i>
            <span>Lưu trữ</span>
          </button>
          <div class="history-menu-sep"></div>
          <button class="history-menu-item danger" type="button" data-act="delete">
            <i class="fas fa-trash"></i>
            <span>Xóa</span>
          </button>
        `;
        document.body.appendChild(el);
        historyMenuEl = el;

        el.addEventListener("click", async (e) => {
            const btn = e.target.closest("button.history-menu-item");
            if (!btn) return;
            const act = btn.getAttribute("data-act");
            const sid = historyMenuSid;
            closeHistoryMenu();
            if (!sid) return;

            const ownerId = (typeof getHistoryOwnerId === "function") ? getHistoryOwnerId() : (getLoggedInUser()?.id || "guest");
            const loggedIn = (typeof isLoggedIn === "function") ? isLoggedIn() : !!getLoggedInUser()?.id;

            if (act == "delete") {
                removeSession(ownerId, sid);
                if (loggedIn) { try { upsertSessionToServer(sid, { deleted: true }); } catch (_) {} }
                if (String(getBackendSessionId() || "") === String(sid)) {
                    clearBackendSessionId();
                }
                updateHistoryUI(historySearchInput ? historySearchInput.value : "");
                return;
            }

            if (act == "rename") {
                const list = readSessions(ownerId);
                const cur = list.find(s => String(s.sessionId) === String(sid));
                const next = prompt("Đổi tên đoạn chat", cur?.title || "Đoạn chat");
                if (next !== null) {
                    const title = String(next).trim() || "Đoạn chat";
                    upsertSession(ownerId, sid, { title });
                    if (loggedIn) { try { upsertSessionToServer(sid, { title }); } catch (_) {} }
                    updateHistoryUI(historySearchInput ? historySearchInput.value : "");
                }
                return;
            }

            if (act == "pin") {
                const list = readSessions(ownerId);
                const cur = list.find(s => String(s.sessionId) === String(sid));
                const nextPinned = !(cur && cur.pinned);
                upsertSession(ownerId, sid, { pinned: nextPinned });
                if (loggedIn) { try { upsertSessionToServer(sid, { pinned: nextPinned }); } catch (_) {} }
                updateHistoryUI(historySearchInput ? historySearchInput.value : "");
                return;
            }

            if (act == "archive") {
                upsertSession(ownerId, sid, { archived: true });
                if (loggedIn) { try { upsertSessionToServer(sid, { archived: true }); } catch (_) {} }
                updateHistoryUI(historySearchInput ? historySearchInput.value : "");
                return;
            }

            if (act == "share") {
                try {
                    const url = new URL(window.location.href);
                    url.searchParams.set("sid", String(sid));
                    const shareUrl = url.toString();
                    if (navigator.share) {
                        await navigator.share({ title: "ChatIIP", url: shareUrl });
                    } else {
                        await navigator.clipboard.writeText(shareUrl);
                        showToast("Đã sao chép liên kết chia sẻ.", "success");
                    }
                } catch (_) {
                    showToast("Không thể chia sẻ lúc này.", "error");
                }
                return;
            }
        });

        // close on outside click
        document.addEventListener("click", (e) => {
            if (!historyMenuEl || historyMenuEl.getAttribute("aria-hidden") === "true") return;
            const inside = e.target.closest("#historyContextMenu");
            const moreBtn = e.target.closest("button.history-more");
            if (!inside && !moreBtn) closeHistoryMenu();
        });

        window.addEventListener("resize", closeHistoryMenu);
        return historyMenuEl;
    }

    function openHistoryMenu(anchorBtn, sid) {
        const menu = ensureHistoryMenu();
        historyMenuSid = sid;

        // Update pin label
        try {
            const ownerId = (typeof getHistoryOwnerId === "function") ? getHistoryOwnerId() : (getLoggedInUser()?.id || "guest");
            const list = readSessions(ownerId);
            const cur = list.find(s => String(s.sessionId) === String(sid));
            const t = menu.querySelector("#historyMenuPinText");
            if (t) t.textContent = (cur && cur.pinned) ? "Bỏ ghim" : "Ghim đoạn chat";
        } catch (_) {}

        const r = anchorBtn.getBoundingClientRect();
        const mw = 240;
        const mh = 260;
        let left = Math.min(r.left, window.innerWidth - mw - 12);
        let top = Math.min(r.bottom + 8, window.innerHeight - mh - 12);
        if (top < 12) top = 12;
        if (left < 12) left = 12;
        menu.style.left = left + "px";
        menu.style.top = top + "px";
        menu.classList.add("open");
        menu.setAttribute("aria-hidden", "false");
    }

    function closeHistoryMenu() {
        if (!historyMenuEl) return;
        historyMenuSid = null;
        historyMenuEl.classList.remove("open");
        historyMenuEl.setAttribute("aria-hidden", "true");
    }


    // ---------- Chat header menu (top-right 3 dots) ----------
    let chatMenuEl = null;
    let chatMenuSid = null;

    async function shareSessionLink(sid) {
        try {
            const url = new URL(window.location.href);
            url.searchParams.set("sid", String(sid));
            const shareUrl = url.toString();
            if (navigator.share) {
                await navigator.share({ title: "ChatIIP", url: shareUrl });
            } else {
                await navigator.clipboard.writeText(shareUrl);
                showToast("Đã sao chép liên kết chia sẻ.", "success");
            }
        } catch (_) {
            showToast("Không thể chia sẻ lúc này.", "error");
        }
    }

    function ensureChatMenu() {
        if (chatMenuEl) return chatMenuEl;
        const el = document.createElement("div");
        el.id = "chatContextMenu";
        el.className = "history-menu";
        el.setAttribute("aria-hidden", "true");
        el.innerHTML = `
          <!-- Mobile-only: Share lives inside the 3-dots menu -->
          <button class="history-menu-item" type="button" data-act="share" id="chatMenuShareItem" style="display:none">
            <i class="fas fa-arrow-up-from-bracket"></i>
            <span>Chia sẻ</span>
          </button>
          <button class="history-menu-item" type="button" data-act="pin">
            <i class="fas fa-thumbtack"></i>
            <span id="chatMenuPinText">Ghim đoạn chat</span>
          </button>
          <button class="history-menu-item" type="button" data-act="archive">
            <i class="fas fa-box-archive"></i>
            <span>Lưu trữ</span>
          </button>
          <div class="history-menu-sep"></div>
          <button class="history-menu-item danger" type="button" data-act="delete">
            <i class="fas fa-trash"></i>
            <span>Xóa</span>
          </button>
        `;
        document.body.appendChild(el);
        chatMenuEl = el;

        el.addEventListener("click", async (e) => {
            const btn = e.target.closest("button.history-menu-item");
            if (!btn) return;
            const act = btn.getAttribute("data-act");
            const sid = chatMenuSid;
            closeChatMenu();
            if (!sid) return;

            const ownerId = (typeof getHistoryOwnerId === "function") ? getHistoryOwnerId() : (getLoggedInUser()?.id || "");
            const loggedIn = (typeof isLoggedIn === "function") ? isLoggedIn() : !!getLoggedInUser()?.id;
            if (!ownerId) {
                showToast("Vui lòng đăng nhập để dùng chức năng này.", "info");
                return;
            }

            if (act === "pin") {
                const list = readSessions(ownerId);
                const cur = list.find(s => String(s.sessionId) === String(sid));
                const nextPinned = !(cur && cur.pinned);
                upsertSession(ownerId, sid, { pinned: nextPinned });
                if (loggedIn) { try { upsertSessionToServer(sid, { pinned: nextPinned }); } catch (_) {} }
                updateHistoryUI(historySearchInput ? historySearchInput.value : "");
                return;
            }

            if (act === "share") {
                // Only exposed on mobile per requirement
                try { await shareSessionLink(sid); } catch (_) { showToast("Không thể chia sẻ lúc này.", "error"); }
                return;
            }

            if (act === "archive") {
                upsertSession(ownerId, sid, { archived: true });
                if (loggedIn) { try { upsertSessionToServer(sid, { archived: true }); } catch (_) {} }
                showToast("Đã lưu trữ đoạn chat.", "success");

                // If archiving the currently opened chat, go back to the welcome/portal state
                try {
                    if (String(getBackendSessionId() || "") === String(sid)) startNewChatUI();
                    else updateHistoryUI(historySearchInput ? historySearchInput.value : "");
                } catch (_) {}
                return;
            }

            if (act === "delete") {
                // Xóa giống menu 3-chấm trong lịch sử
                removeSession(ownerId, sid);
                if (loggedIn) { try { upsertSessionToServer(sid, { deleted: true }); } catch (_) {} }
                showToast("Đã xóa đoạn chat.", "success");

                // If deleting the currently opened chat, go back to the welcome/portal state
                try {
                    if (String(getBackendSessionId() || "") === String(sid)) startNewChatUI();
                    else updateHistoryUI(historySearchInput ? historySearchInput.value : "");
                } catch (_) {}
                return;
            }
        });

        // close on outside click
        document.addEventListener("click", (e) => {
            if (!chatMenuEl || chatMenuEl.getAttribute("aria-hidden") === "true") return;
            const inside = e.target.closest("#chatContextMenu");
            const moreBtn = e.target.closest("#chatMoreBtn") || e.target.closest("#mobileChatMoreBtn");
            if (!inside && !moreBtn) closeChatMenu();
        });

        window.addEventListener("resize", closeChatMenu);
        return chatMenuEl;
    }

    function openChatMenu(anchorBtn) {
        const sid = getBackendSessionId();
        if (!sid) {
            showToast("Chưa có đoạn chat để thao tác. Hãy gửi một tin nhắn trước.", "info");
            return;
        }

        const menu = ensureChatMenu();
        chatMenuSid = sid;

        // Update pin label
        try {
            const ownerId = (typeof getHistoryOwnerId === "function") ? getHistoryOwnerId() : (getLoggedInUser()?.id || "");
            const list = ownerId ? readSessions(ownerId) : [];
            const cur = list.find(s => String(s.sessionId) === String(sid));
            const t = menu.querySelector("#chatMenuPinText");
            if (t) t.textContent = (cur && cur.pinned) ? "Bỏ ghim" : "Ghim đoạn chat";
        } catch (_) {}

        // Mobile: include Share inside the 3-dots. Desktop keeps Share as a separate top-right button.
        try {
            const isMobileMenu = anchorBtn && anchorBtn.id === "mobileChatMoreBtn";
            const shareItem = menu.querySelector("#chatMenuShareItem");
            if (shareItem) shareItem.style.display = isMobileMenu ? "flex" : "none";
        } catch (_) {}

        const r = anchorBtn.getBoundingClientRect();
        const mw = 240;
        // Slightly taller on mobile because we also show the Share row
        const mh = (anchorBtn && anchorBtn.id === "mobileChatMoreBtn") ? 260 : 220;
        let left = Math.min(r.left, window.innerWidth - mw - 12);
        let top = Math.min(r.bottom + 8, window.innerHeight - mh - 12);
        if (top < 12) top = 12;
        if (left < 12) left = 12;
        menu.style.left = left + "px";
        menu.style.top = top + "px";
        menu.classList.add("open");
        menu.setAttribute("aria-hidden", "false");
    }

    function closeChatMenu() {
        if (!chatMenuEl) return;
        chatMenuSid = null;
        chatMenuEl.classList.remove("open");
        chatMenuEl.setAttribute("aria-hidden", "true");
    }

    // Wire up Share + More buttons (Share is desktop-only; on mobile Share is inside the 3-dots menu)
    function handleChatShare() {
        const sid = getBackendSessionId();
        if (!sid) {
            showToast("Chưa có đoạn chat để chia sẻ. Hãy gửi một tin nhắn trước.", "info");
            return;
        }
        shareSessionLink(sid);
    }

    if (chatShareBtn) chatShareBtn.addEventListener("click", handleChatShare);

    function handleChatMore(e) {
        const btn = e && e.currentTarget ? e.currentTarget : null;
        if (!btn) return;
        openChatMenu(btn);
    }

    if (chatMoreBtn) chatMoreBtn.addEventListener("click", handleChatMore);
    if (mobileChatMoreBtn) mobileChatMoreBtn.addEventListener("click", handleChatMore);

    function archiveSession(userId, sid, archived) {
        upsertSession(userId, sid, { archived: !!archived });
    }

    function deleteSessionAndMaybeResetUI(userId, sid) {
        removeSession(userId, sid);
        if (String(getBackendSessionId() || "") === String(sid)) {
            clearBackendSessionId();
            try { messageInput.value = ""; } catch (_) {}
            try {
                const messages = chatContainer.querySelectorAll('.message');
                messages.forEach(m => m.remove());
                if (welcomeMessage) {
                    welcomeMessage.style.display = 'block';
                    if (!chatContainer.contains(welcomeMessage)) {
                        chatContainer.insertBefore(welcomeMessage, chatContainer.firstChild);
                    }
                }
                messageInputContainer.classList.add('centered');
                chatContainer.classList.remove('has-messages');

                // Update header actions visibility
                try { syncChatHasMessagesUI(); } catch (_) {}


// Hiện lại menu giới thiệu (nếu đang ở chế độ chưa đăng nhập)
try {
    const unauthTopbar = document.getElementById('unauthTopbar');
    if (unauthTopbar) {
        unauthTopbar.classList.remove('has-messages');
    }
} catch (_) {}

            } catch (_) {}
        }
    }

function ensureActiveSessionIsTracked() {
        const ownerId = (typeof getHistoryOwnerId === "function") ? getHistoryOwnerId() : (getLoggedInUser()?.id || "guest");
        const loggedIn = (typeof isLoggedIn === "function") ? isLoggedIn() : !!getLoggedInUser()?.id;
        const sid = getBackendSessionId();
        if (!sid) return;

        const list = readSessions(ownerId);
        const exists = list.some(s => String(s.sessionId) === String(sid));
        if (exists) return;

        // Try derive title from cache
        let title = "Đoạn chat";
        try {
            const key = getChatCacheKey(sid);
            const cached = readChatCacheByKey(key);
            const msgs = cached && Array.isArray(cached.messages) ? cached.messages : [];
            const firstUser = msgs.find(m => String(m.role || "") === "user" && (m.text || "").trim());
            if (firstUser && firstUser.text) title = String(firstUser.text);
        } catch (_) {}
        upsertSession(ownerId, sid, { title, preview: "" });
        if (loggedIn) { try { upsertSessionToServer(sid, { title, preview: "" }); } catch (_) {} }
    }

    // Listen auth changes from auth.js
    window.addEventListener("chatiip:auth-changed", () => {
        ensureActiveSessionIsTracked();
        updateHistoryUI(historySearchInput ? historySearchInput.value : "");
    });

    // Ensure history is always visible when returning from other pages (BFCache) or after refresh
    function refreshHistoryUI() {
        try { ensureActiveSessionIsTracked(); } catch (_) {}
        try { updateHistoryUI(historySearchInput ? historySearchInput.value : ""); } catch (_) {}
    }

    // Initial render (auth state may already exist)
    setTimeout(refreshHistoryUI, 0);

    // When coming back from News/Laws pages
    window.addEventListener("pageshow", refreshHistoryUI);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshHistoryUI(); });

    // Multi-tab updates
    window.addEventListener("storage", (e) => {
        const k = e && e.key ? String(e.key) : "";
        if (!k) return;
        if (k === "chatiip_current_user" || k === "chatiip_backend_session_id" || k.indexOf(HISTORY_KEY_PREFIX) === 0 || k.indexOf(PENDING_KEY_PREFIX) === 0) {
            refreshHistoryUI();
        }
    });

    if (historySearchInput) {
        historySearchInput.addEventListener("input", () => {
            updateHistoryUI(historySearchInput.value);
        });
    }

    if (searchRailBtn) {
        searchRailBtn.addEventListener("click", () => {
            openSidebarPanel();
            setTimeout(() => { try { historySearchInput && historySearchInput.focus(); } catch (_) {} }, 50);
        });
    }

    if (chatHistoryList) {
        chatHistoryList.addEventListener("click", (e) => {
            const moreBtn = e.target.closest("button.history-more");
            if (moreBtn) {
                e.stopPropagation();
                const sid = decodeURIComponent(moreBtn.getAttribute("data-session-id") || "");
                if (sid) openHistoryMenu(moreBtn, sid);
                return;
            }

            const itemBtn = e.target.closest("button.history-item");
            if (!itemBtn) return;
            const sid = decodeURIComponent(itemBtn.getAttribute("data-session-id") || "");
            if (!sid) return;

            // Provide immediate feedback while the selected history loads.
            try {
                const key = (typeof getChatCacheKey === "function") ? getChatCacheKey(sid) : null;
                const cached = key && (typeof readChatCacheByKey === "function") ? readChatCacheByKey(key) : null;
                const hasCache = !!(cached && Array.isArray(cached.messages) && cached.messages.length);
                if (!hasCache && typeof showHistoryLoadingPlaceholder === "function") {
                    showHistoryLoadingPlaceholder();
                }
            } catch (_) {
                try { if (typeof showHistoryLoadingPlaceholder === "function") showHistoryLoadingPlaceholder(); } catch (_) {}
            }

            setBackendSessionId(sid);
            closeSidebarPanel();
            loadChatHistoryFromServer();
            updateHistoryUI(historySearchInput ? historySearchInput.value : "");
        });
    }

    function startNewChatUI() {
        // ✅ Hủy request chatbot đang chạy (nếu có) để không append câu trả lời cũ
        try {
            __chatRequestNonce++;
            if (__chatAbortController) __chatAbortController.abort();
        } catch (_) {}
        __chatAbortController = null;
        try { hideTypingIndicator(); } catch (_) {}

        // Dừng TTS (nếu đang phát) khi bắt đầu đoạn chat mới
        try { stopTTS(); } catch (_) {}


        // Hủy mọi câu trả lời đang chạy để không bị append vào đoạn chat mới
        abortActiveChatRequest();
        // Xóa toàn bộ tin nhắn
        const messages = chatContainer.querySelectorAll('.message');
        messages.forEach(m => m.remove());

        // Hiện lại welcome
        if (welcomeMessage) {
            welcomeMessage.style.display = 'block';
            if (!chatContainer.contains(welcomeMessage)) {
                chatContainer.insertBefore(welcomeMessage, chatContainer.firstChild);
            }
        }

        // Reset session_id của backend (bắt đầu hội thoại mới)
        clearBackendSessionId();

        // Reset pending meta (guest cũng có pending)
        try {
            const ownerId = (typeof getHistoryOwnerId === "function") ? getHistoryOwnerId() : (getLoggedInUser()?.id || "guest");
            clearPendingSession(ownerId);
        } catch (_) {}

        // Đưa input về trạng thái centered
        messageInputContainer.classList.add('centered');
        chatContainer.classList.remove('has-messages');

        // Update header actions visibility
        try { syncChatHasMessagesUI(); } catch (_) {}

        // Xóa text đang nhập
        messageInput.value = "";

        closeSidebarPanel();
        updateHistoryUI(historySearchInput ? historySearchInput.value : "");
    }

    // Expose reset handler for global idle timer (auth.js)
    try {
        window.__CHATIIP_RESET_TO_WELCOME = startNewChatUI;
    } catch (_) {}

    if (newChatBtn) newChatBtn.addEventListener("click", startNewChatUI);
    if (newChatRailBtn) newChatRailBtn.addEventListener("click", startNewChatUI);
    if (mobileNewChatBtn) mobileNewChatBtn.addEventListener("click", startNewChatUI);

    // News & Laws
    function goNews() {
        window.location.href = "news.html?v=" + encodeURIComponent(window.CHATIIP_VERSION || "");
    }
    if (newsRailBtn) newsRailBtn.addEventListener("click", goNews);
    if (panelNewsBtn) panelNewsBtn.addEventListener("click", goNews);

    function goLaws() {
        window.location.href = "laws.html?v=" + encodeURIComponent(window.CHATIIP_VERSION || "");
    }
    if (lawsRailBtn) lawsRailBtn.addEventListener("click", goLaws);
    if (lawsBtn) lawsBtn.addEventListener("click", goLaws);




    // ⭐ Toggle chế độ xem (Bảng/Thẻ) cho các khối dữ liệu
    document.addEventListener("click", (e) => {
        const tab = e.target.closest(".data-view-tab");
        if (!tab) return;

        const block = tab.closest(".data-block");
        if (!block) return;

        const target = tab.getAttribute("data-view-target");
        if (!target) return;

        // Tabs
        block.querySelectorAll(".data-view-tab").forEach((b) => {
            const isActive = b === tab;
            b.classList.toggle("active", isActive);
            b.setAttribute("aria-selected", isActive ? "true" : "false");
        });

        // Panels
        block.querySelectorAll(".data-panel").forEach((panel) => {
            panel.classList.toggle("active", panel.getAttribute("data-view-panel") === target);
        });

        // Không auto-scroll khi chỉ đổi chế độ xem (Bảng/Thẻ).

    });

    
    // ⭐ TẢI LỊCH SỬ HỘI THOẠI KHI VÀO LẠI TRANG (DỰA TRÊN session_id TỪ BACKEND)
    try {
        loadChatHistoryFromServer();
    } catch (e) {
        console.warn('Không thể load lịch sử hội thoại lúc khởi động', e);
    }

// ⭐ Auto scroll: chỉ khi thêm message mới (không scroll khi tương tác map / tile load)
    try {
        const chatObserver = new MutationObserver((mutations) => {
            let should = false;
            for (const mu of mutations) {
                for (const node of (mu.addedNodes || [])) {
                    if (node && node.nodeType === 1 && node.classList && node.classList.contains("message")) {
                        should = true;
                        break;
                    }
                }
                if (should) break;
            }
            if (should) scrollToBottom();
        });
        // chỉ quan sát các con trực tiếp của chatContainer → tránh trigger bởi DOM thay đổi bên trong bản đồ
        chatObserver.observe(chatContainer, { childList: true, subtree: false });
    } catch (e) {
        // ignore
    }

});
