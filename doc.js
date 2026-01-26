

const API_DOCS = "/api/docs";

const params = new URLSearchParams(window.location.search);
const slug = params.get("slug");
const initialTab = (params.get("tab") || "summary").toLowerCase();

// DOM
const docHeaderSub = document.getElementById("docHeaderSub");
const docTitleEl = document.getElementById("docTitle");
const docMetaEl = document.getElementById("docMeta");
const docTagsEl = document.getElementById("docTags");

const outlineTreeEl = document.getElementById("outlineTree");
const outlineEmptyEl = document.getElementById("outlineEmpty");

const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = {
  summary: document.getElementById("tabSummary"),
  content: document.getElementById("tabContent"),
  outline: document.getElementById("tabOutline"),
  download: document.getElementById("tabDownload")
};

const summaryBox = document.getElementById("summaryBox");
const contentBox = document.getElementById("contentBox");
const outlineBox = document.getElementById("outlineBox");
const downloadBox = document.getElementById("downloadBox");

let currentDoc = null;

function escapeHtml(str) {
  // ✅ Không dùng replaceAll để tránh lỗi trên một số trình duyệt cũ
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("vi-VN");
}

function badgeClassByStatus(status) {
  const s = String(status || "").trim();
  if (s === "Còn hiệu lực") return "status-ok";
  if (s === "Hết hiệu lực") return "status-expired";
  return "status-unknown";
}

function setTab(tabName) {
  const name = (tabName || "summary").toLowerCase();

  tabButtons.forEach((btn) => {
    const active = btn.getAttribute("data-tab") === name;
    btn.classList.toggle("active", active);
  });

  Object.entries(tabPanels).forEach(([k, el]) => {
    if (!el) return;
    el.style.display = k === name ? "block" : "none";
  });

  // Update URL param (không reload)
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", name);
    history.replaceState({}, "", url.toString());
  } catch {
    // ignore
  }
}

function wireTabs() {
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      setTab(btn.getAttribute("data-tab"));
    });
  });
}

function updateSEO(doc) {
  const title = doc?.title ? String(doc.title) : "Văn bản pháp luật";
  const desc = doc?.trichYeu
    ? String(doc.trichYeu).replace(/\s+/g, " ").trim().slice(0, 160)
    : "Chi tiết văn bản pháp luật: tóm tắt, nội dung, lược đồ, tải về.";

  const pageTitle = `${title} | ChatIIP`;
  const url = window.location.href;

  document.title = pageTitle;

  // Meta description
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute("content", desc);

  // Canonical
  let canonicalTag = document.querySelector('link[rel="canonical"]');
  if (!canonicalTag) {
    canonicalTag = document.createElement("link");
    canonicalTag.rel = "canonical";
    document.head.appendChild(canonicalTag);
  }
  canonicalTag.href = url;

  // OpenGraph
  document.getElementById("ogTitle")?.setAttribute("content", pageTitle);
  document.getElementById("ogDescription")?.setAttribute("content", desc);
  document.getElementById("ogUrl")?.setAttribute("content", url);

  // Twitter
  document.getElementById("twitterTitle")?.setAttribute("content", pageTitle);
  document.getElementById("twitterDescription")?.setAttribute("content", desc);
  document.getElementById("twitterImage")?.setAttribute("content", "https://chatiip.com/iip.jpg");

  // JSON-LD
  try {
    const jsonLdEl = document.getElementById("docJsonLd");
    if (jsonLdEl) {
      const jsonLd = {
        "@context": "https://schema.org",
        "@type": "CreativeWork",
        "name": title,
        "headline": title,
        "description": desc,
        "url": url
      };

      // Optional enrichments when available
      if (doc?.ngayBanHanh) jsonLd.datePublished = doc.ngayBanHanh;
      if (doc?.ngayHieuLuc) jsonLd.dateModified = doc.ngayHieuLuc;
      if (doc?.coQuanBanHanh) jsonLd.publisher = { "@type": "Organization", "name": String(doc.coQuanBanHanh) };
      if (doc?.soHieu) jsonLd.identifier = String(doc.soHieu);

      jsonLdEl.textContent = JSON.stringify(jsonLd, null, 2);
    }
  } catch {
    // ignore
  }
}

function renderMetaChip(label, value, extraClass = "") {
  if (!value) return "";
  return `<span class="meta-chip ${extraClass}"><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}</span>`;
}

function renderStatusPill(value) {
  const v = value || "Không xác định";
  return `<span class="status-pill ${badgeClassByStatus(v)}">${escapeHtml(v)}</span>`;
}

function renderDocInfo(doc) {
  if (!doc) return;

  const title = doc.title || "(Không tiêu đề)";
  docTitleEl.textContent = title;
  if (docHeaderSub) docHeaderSub.textContent = `${doc.soHieu ? doc.soHieu + " · " : ""}${doc.loaiVanBan || ""}`.trim() || "Văn bản pháp luật";

  const majorMinor = `${doc.categoryMajor || "Khác"}${doc.categoryMinor ? " / " + doc.categoryMinor : ""}`;

  docMetaEl.innerHTML = `
    ${renderStatusPill(doc.tinhTrang)}
    ${renderMetaChip("Số hiệu", doc.soHieu)}
    ${renderMetaChip("Loại", doc.loaiVanBan)}
    ${renderMetaChip("Cơ quan", doc.coQuanBanHanh)}
    ${renderMetaChip("Phân loại", majorMinor)}
    ${renderMetaChip("Ban hành", fmtDate(doc.ngayBanHanh))}
    ${renderMetaChip("Hiệu lực", fmtDate(doc.ngayHieuLuc))}
    ${renderMetaChip("Hết hiệu lực", fmtDate(doc.ngayHetHieuLuc))}
  `;

  const tags = Array.isArray(doc.tags) ? doc.tags : [];
  if (tags.length > 0) {
    docTagsEl.innerHTML = tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join("");
  } else {
    docTagsEl.innerHTML = "";
  }
}

function renderSummary(doc) {
  const sum = (doc?.trichYeu || "").trim();
  if (summaryBox) {
    if (sum) {
      summaryBox.innerHTML = `<div class="summary-text">${escapeHtml(sum)}</div>`;
    } else {
      summaryBox.innerHTML = `<div class="empty-panel">Chưa có trích yếu.</div>`;
    }
  }
}

// Render textContent thành HTML có anchor để mục lục nhảy tới
function renderTextContentWithAnchors(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd());

  const reChapter = /^(CHƯƠNG|CHUONG)\s+([IVXLC0-9]+)\b[:\-\.]?\s*(.*)$/i;
  const reSection = /^(MỤC|MUC)\s+([IVXLC0-9]+)\b[:\-\.]?\s*(.*)$/i;
  const reArticle = /^(ĐIỀU|DIEU)\s+(\d+[A-Z]?)\b[:\-\.]?\s*(.*)$/i;

  let html = "<div class=\"text-content\">";

  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();

    if (!line) {
      html += `<div class="lc-line blank">&nbsp;</div>`;
      continue;
    }

    let m;
    m = line.match(reChapter);
    if (m) {
      const key = `chuong_${m[2]}`;
      html += `<div class="lc-heading chapter" id="${escapeHtml(key)}"><span>${escapeHtml(line)}</span></div>`;
      continue;
    }

    m = line.match(reSection);
    if (m) {
      const key = `muc_${m[2]}`;
      html += `<div class="lc-heading section" id="${escapeHtml(key)}"><span>${escapeHtml(line)}</span></div>`;
      continue;
    }

    m = line.match(reArticle);
    if (m) {
      const key = `dieu_${m[2]}`;
      html += `<div class="lc-heading article" id="${escapeHtml(key)}"><span>${escapeHtml(line)}</span></div>`;
      continue;
    }

    html += `<div class="lc-line">${escapeHtml(line)}</div>`;
  }

  html += "</div>";
  return html;
}

function renderContent(doc) {
  const text = (doc?.textContent || "").trim();
  const file = doc?.file || null;

  if (!contentBox) return;

  if (text) {
    contentBox.innerHTML = renderTextContentWithAnchors(text);
    return;
  }

  // Không có textContent -> ưu tiên hiển thị file (PDF) nếu có
  if (file && file.publicUrl) {
    const url = file.publicUrl;
    const ext = String(file.originalName || "").toLowerCase();
    const isPdf = (file.mimeType === "application/pdf") || ext.endsWith(".pdf") || url.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      contentBox.innerHTML = `
        <div class="file-view">
          <iframe class="file-iframe" src="${escapeHtml(url)}" title="Văn bản PDF"></iframe>
        </div>
        <div class="file-hint">Nếu không xem được, hãy dùng tab <b>Tải về</b>.</div>
      `;
    } else {
      contentBox.innerHTML = `
        <div class="empty-panel">Văn bản hiện chưa có nội dung text để hiển thị. File gốc không phải PDF nên không thể xem trực tiếp tại đây.</div>
        <div class="file-hint">Hãy chuyển sang tab <b>Tải về</b> để tải file.</div>
      `;
    }

    return;
  }

  contentBox.innerHTML = `<div class="empty-panel">Chưa có nội dung để hiển thị.</div>`;
}

function renderOutlineTree(nodes, targetEl, onClick) {
  if (!targetEl) return;

  targetEl.innerHTML = "";

  function renderNode(node) {
    const wrapper = document.createElement("div");
    wrapper.className = "outline-item";

    const label = (node && node.label) ? String(node.label) : "(Không tên)";
    const key = (node && node.key) ? String(node.key) : "";

    wrapper.innerHTML = `<div class="label">${escapeHtml(label)}</div>`;

    wrapper.addEventListener("click", () => {
      if (typeof onClick === "function") onClick({ key, label });
    });

    if (Array.isArray(node?.children) && node.children.length > 0) {
      const childBox = document.createElement("div");
      childBox.className = "outline-children";
      node.children.forEach((c) => childBox.appendChild(renderNode(c)));
      wrapper.appendChild(childBox);
    }

    return wrapper;
  }

  (nodes || []).forEach((n) => targetEl.appendChild(renderNode(n)));
}

function scrollToAnchor(key) {
  if (!key) return false;
  const el = document.getElementById(key);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  // highlight tạm
  try {
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1200);
  } catch {
    // ignore
  }
  return true;
}

function renderOutline(doc) {
  const nodes = Array.isArray(doc?.outline) ? doc.outline : [];

  const hasOutline = nodes.length > 0;
  if (outlineEmptyEl) outlineEmptyEl.style.display = hasOutline ? "none" : "block";

  if (hasOutline) {
    renderOutlineTree(nodes, outlineTreeEl, ({ key }) => {
      // Khi click mục lục: mở tab content và scroll
      setTab("content");
      // chờ DOM update
      setTimeout(() => {
        if (!scrollToAnchor(key)) {
          // nếu không có anchor (vd: đang xem PDF) -> chuyển sang tab outline
          setTab("outline");
        }
      }, 50);
    });

    // render bản lược đồ trong tab Outline
    renderOutlineTree(nodes, outlineBox, ({ key }) => {
      setTab("content");
      setTimeout(() => {
        scrollToAnchor(key);
      }, 50);
    });

  } else {
    if (outlineTreeEl) outlineTreeEl.innerHTML = "";
    if (outlineBox) outlineBox.innerHTML = `<div class="empty-panel">Chưa có lược đồ.</div>`;
  }
}

function renderDownload(doc) {
  if (!downloadBox) return;

  const file = doc?.file || null;
  const id = doc?._id;

  if (!file && !id) {
    downloadBox.innerHTML = `<div class="empty-panel">Không có file để tải.</div>`;
    return;
  }

  const downloadUrl = id ? `${API_DOCS}/${id}/download` : "#";
  const publicUrl = file?.publicUrl || "";

  downloadBox.innerHTML = `
    <div class="download-actions">
      ${id ? `<a class="download-btn" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noopener"><i class="fa-solid fa-download"></i> Tải về</a>` : ""}
      ${publicUrl ? `<a class="download-btn secondary" href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener"><i class="fa-regular fa-file"></i> Mở file</a>` : ""}
    </div>

    <div class="download-meta">
      <div class="row"><span class="k">Tên file</span><span class="v">${escapeHtml(file?.originalName || "(Không rõ)")}</span></div>
      <div class="row"><span class="k">Định dạng</span><span class="v">${escapeHtml(file?.mimeType || "")}</span></div>
      <div class="row"><span class="k">Dung lượng</span><span class="v">${typeof file?.size === "number" ? (Math.round(file.size / 1024) + " KB") : ""}</span></div>
    </div>

    <div class="file-hint">Nếu file là PDF, bạn có thể xem trực tiếp trong tab <b>Nội dung</b>.</div>
  `;
}

async function loadDoc() {
  if (!slug) {
    docTitleEl.textContent = "❌ Thiếu slug văn bản";
    if (summaryBox) summaryBox.innerHTML = `<div class="empty-panel">URL cần có dạng: <code>doc.html?slug=...</code></div>`;
    setTab("summary");
    return;
  }

  docTitleEl.textContent = "Đang tải...";
  if (docHeaderSub) docHeaderSub.textContent = "Đang tải dữ liệu...";

  try {
    const res = await fetch(`${API_DOCS}/${encodeURIComponent(slug)}`);
    if (!res.ok) {
      docTitleEl.textContent = "❌ Không tìm thấy văn bản";
      if (summaryBox) summaryBox.innerHTML = `<div class="empty-panel">Văn bản không tồn tại hoặc đã bị xoá.</div>`;
      setTab("summary");
      return;
    }

    const doc = await res.json();
    currentDoc = doc;

    renderDocInfo(doc);
    renderSummary(doc);
    renderContent(doc);
    renderOutline(doc);
    renderDownload(doc);

    updateSEO(doc);

  } catch (e) {
    console.error("loadDoc error:", e);
    docTitleEl.textContent = "⚠️ Lỗi tải dữ liệu";
    if (summaryBox) summaryBox.innerHTML = `<div class="empty-panel">Vui lòng thử lại hoặc kiểm tra backend.</div>`;
  }
}

// ------------------------------
// Init
// ------------------------------

wireTabs();
setTab(initialTab);
loadDoc();
