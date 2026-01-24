const API = "/api/news";



// Lấy slug từ URL
const params = new URLSearchParams(window.location.search);
const slug = params.get("slug");

// DOM elements
const titleEl = document.getElementById("articleTitle");
const subEl = document.getElementById("articleSubtitle");
const imgEl = document.getElementById("articleImage");
const dateEl = document.getElementById("articleDate");
const contentEl = document.getElementById("articleContent");
const relatedListEl = document.getElementById("relatedList");

// Back button: ưu tiên quay lại trạng thái tìm kiếm/scroll của news bằng history.back()
const articleBackBtn = document.getElementById("articleBackBtn");
if (articleBackBtn) {
  articleBackBtn.addEventListener("click", () => {
    try {
      if (history.length > 1) history.back();
      else window.location.href = "news.html";
    } catch (_) {
      window.location.href = "news.html";
    }
  });
}

// ===============================
// ⭐ Skeleton Loading
// ===============================
function showSkeleton() {
    titleEl.innerHTML = "Đang tải bài viết...";
    subEl.innerHTML = "";
    contentEl.innerHTML = `
        <p style="opacity:0.6;">Đang tải nội dung...</p>
    `;
    imgEl.style.display = "none";
}

// ===============================
// ⭐ SEO Dynamic (Google + FB + Zalo)
// ===============================
function updateSEO(item) {
    const title = item.pageTitle || item.title;
    // ✅ FIX: tránh lỗi nếu item.content bị null/undefined
    const plain = (item.content || "").replace(/<[^>]*>?/gm, "");
    const desc = item.pageDescription
        || item.subtitle
        || plain.slice(0, 160);
    const keywords = item.pageKeywords || "";
    const img = item.ogImage || item.img || "https://chatiip.com/iip.jpg";
    const url = item.canonical || `https://chatiip.com/article.html?slug=${item.slug}`;
    const h1 = item.pageHeading || item.title;

    // H1
    titleEl.textContent = h1;

    document.title = title;

    document.querySelector('meta[name="description"]')?.setAttribute("content", desc);
    document.querySelector('meta[name="keywords"]')?.setAttribute("content", keywords);

    document.getElementById("ogTitle")?.setAttribute("content", title);
    document.getElementById("ogDescription")?.setAttribute("content", desc);
    document.getElementById("ogImage")?.setAttribute("content", img);
    document.getElementById("ogUrl")?.setAttribute("content", url);

    document.getElementById("twitterTitle")?.setAttribute("content", title);
    document.getElementById("twitterDescription")?.setAttribute("content", desc);
    document.getElementById("twitterImage")?.setAttribute("content", img);

    let canonicalTag = document.querySelector('link[rel="canonical"]');
    if (!canonicalTag) {
        canonicalTag = document.createElement("link");
        canonicalTag.rel = "canonical";
        document.head.appendChild(canonicalTag);
    }
    canonicalTag.href = url;

    const jsonLd = {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": h1,
        "description": desc,
        "image": [img],
        "datePublished": item.publishedAt,
        "dateModified": item.modifiedAt
    };
    document.getElementById("seoJsonLd").textContent = JSON.stringify(jsonLd, null, 2);
}



// ===============================
// ⭐ Load bài viết theo slug
// ===============================
async function loadArticle() {
    if (!slug) {
        contentEl.innerHTML = "<p>❌ Không tìm thấy bài viết.</p>";
        return;
    }

    showSkeleton();

    try {
        const res = await fetch(`${API}/${slug}`);

        if (!res.ok) {
            contentEl.innerHTML = "<p>❌ Bài viết không tồn tại.</p>";
            return;
        }

        const item = await res.json();

        // Hiển thị dữ liệu
        titleEl.textContent = item.title;
        subEl.textContent = item.subtitle || "";

        // Ngày đăng
        dateEl.textContent = item.publishedAt
            ? new Date(item.publishedAt).toLocaleDateString("vi-VN")
            : "Không rõ ngày";

        // Ảnh
        imgEl.src = item.img || "https://chatiip.com/iip.jpg";
        imgEl.style.display = "block";

        // Nội dung
        contentEl.innerHTML = item.content;

        // SEO
        updateSEO(item);
        document.getElementById("breadcrumbJson").textContent = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Trang chủ", "item": "https://chatiip.com" },
    { "@type": "ListItem", "position": 2, "name": "Tin tức", "item": "https://chatiip.com/news.html" },
    { "@type": "ListItem", "position": 3, "name": item.title, "item": `https://chatiip.com/article.html?slug=${item.slug}` }
  ]
}, null, 2);


        // Cuộn lên đầu
        window.scrollTo({ top: 0, behavior: "smooth" });

        // Gọi bài viết liên quan
        loadRelated(item.slug);

    } catch (err) {
        console.error("Lỗi load bài:", err);
        contentEl.innerHTML = "<p>⚠️ Lỗi tải bài viết.</p>";
    }
}

// ===============================
// ⭐ Bài viết liên quan
// ===============================
async function loadRelated(currentSlug) {
    try {
        const res = await fetch(API);
        const all = await res.json();

        const filtered = all
            .filter(n => n.slug !== currentSlug)
            .slice(0, 4); // Lấy 4 bài mới nhất

        relatedListEl.innerHTML = "";

        filtered.forEach(n => {
            const div = document.createElement("div");
            div.className = "related-item";
            div.innerHTML = `
                <div class="related-item-title">${n.title}</div>
            `;
            div.onclick = () => {
                window.location.href = `article.html?slug=${n.slug}&v=${encodeURIComponent(window.CHATIIP_VERSION||'')}`;
            };
            relatedListEl.appendChild(div);
        });

        if (filtered.length === 0) {
            relatedListEl.innerHTML = `<p>Không có bài viết liên quan.</p>`;
        }

    } catch (e) {
        console.error("Lỗi load related:", e);
    }
}

loadArticle();
