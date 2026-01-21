/*
  Auth UI (frontend-only demo)
  - Login/Register modal (email/password)
  - Persist auth + settings in localStorage
  - After login: hide Login/Register bar on pages that have hamburger sidebar; show account in hamburger.
*/

(function () {
  const STORAGE_CURRENT = "chatiip_current_user";
  const STORAGE_USERS = "chatiip_users";
  const STORAGE_THEME = "chatiip_theme"; // 'light' | 'dark'
  const STORAGE_SETTINGS = "chatiip_settings"; // { notifications: boolean }

  // Google Sign-In (Frontend)
  // 1) Tạo Google OAuth Client ID (Web) và thêm origin/redirect theo domain của bạn.
  // 2) Dán Client ID vào đây.
  // Lưu ý: Client ID là public, không phải secret.
  // Google OAuth Client ID (Web)
  // Provided by you:
  // 847619063389-bndr6dll057jm4891cruu2as51r5mtob.apps.googleusercontent.com
  const GOOGLE_CLIENT_ID = "847619063389-bndr6dll057jm4891cruu2as51r5mtob.apps.googleusercontent.com";

  let pendingRegisterEmail = null;
  let forgotOtpSent = false;


    // Backend API
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:8080/api"
      : "/api";
  // Khi deploy đổi thành: "https://ten-backend-cua-ban.xyz/api"

  async function api(path, options = {}) {
    const res = await fetch(API_BASE + path, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include", // để nhận cookie token
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    let data = {};
    try {
      data = await res.json();
    } catch (_) {}

    if (!res.ok) {
      throw new Error(data.message || "Có lỗi xảy ra, vui lòng thử lại.");
    }
    return data;
  }

  // ---------------- Google Identity Services ----------------
  let googleGsiLoaded = false;
  let googleGsiLoadingPromise = null;

  function loadGoogleGsiScript() {
    if (googleGsiLoaded) return Promise.resolve();
    if (googleGsiLoadingPromise) return googleGsiLoadingPromise;

    googleGsiLoadingPromise = new Promise((resolve, reject) => {
      if (document.getElementById("google-gsi")) {
        googleGsiLoaded = true;
        return resolve();
      }
      const s = document.createElement("script");
      s.id = "google-gsi";
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.defer = true;
      s.onload = () => {
        googleGsiLoaded = true;
        resolve();
      };
      s.onerror = () => reject(new Error("Không tải được Google Sign-In script."));
      document.head.appendChild(s);
    });

    return googleGsiLoadingPromise;
  }

  async function renderGoogleButton() {
    const container = document.getElementById("googleSignInContainer");
    if (!container) return;

    // Nếu chưa cấu hình client id thì hiển thị gợi ý (tránh treo UI)
    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.includes("YOUR_GOOGLE_CLIENT_ID")) {
      container.innerHTML = `<div class="auth-hint" style="margin-top:8px;">Chưa cấu hình Google Client ID. Mở <b>frontend/auth.js</b> và thay biến <b>GOOGLE_CLIENT_ID</b>.</div>`;
      return;
    }

    function escapeHtmlLocal(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    try {
      await loadGoogleGsiScript();
    } catch (e) {
      container.innerHTML = `<div class="auth-hint" style="margin-top:8px;">${escapeHtmlLocal(String(e.message || e))}</div>`;
      return;
    }

    if (!(window.google && google.accounts && google.accounts.id)) {
      container.innerHTML = `<div class="auth-hint" style="margin-top:8px;">Google Sign-In chưa sẵn sàng. Hãy thử tải lại trang.</div>`;
      return;
    }

    // Reset render
    container.innerHTML = "";

    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      ux_mode: "popup",
      callback: async (resp) => {
        try {
          const data = await api("/auth/google", {
            method: "POST",
            body: { credential: resp.credential }
          });
          const user = data.user;
          setCurrentUser(user);
          closeOverlay("authOverlay");
          syncAllUI();
          showToast("Đăng nhập Google thành công!", "success");
        } catch (err) {
          showToast(err.message || "Đăng nhập Google thất bại.", "error");
        }
      }
    });

    // Render default Google button
    google.accounts.id.renderButton(container, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "pill",
      width: 320
    });
  }




  function applyAvatarElement(el, user) {
    if (!el) return;

    const hasImage =
      user &&
      typeof user.avatarUrl === "string" &&
      user.avatarUrl.trim().length > 0;

    if (hasImage) {
      el.style.backgroundImage = `url(${user.avatarUrl})`;
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = "center";
      el.textContent = "";
    } else {
      el.style.backgroundImage = "none";
      const src =
        (user && (user.name || user.email || user.provider)) || "U";
      const letter = src.trim().charAt(0).toUpperCase() || "U";
      el.textContent = letter;
    }
  }

  function safeParse(json, fallback) {
    try {
      return JSON.parse(json);
    } catch {
      return fallback;
    }
  }

  function readJSON(key, fallback) {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return safeParse(raw, fallback);
  }

  function writeJSON(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  function enhanceOtpInput(hiddenInputId) {
    const hidden = document.getElementById(hiddenInputId);
    if (!hidden) return;

    // tránh khởi tạo lại nhiều lần
    if (hidden.dataset.enhanced === "1") return;
    hidden.dataset.enhanced = "1";

    // dùng hidden để submit, hiển thị 6 ô riêng
    hidden.type = "hidden";

    const container = document.createElement("div");
    container.className = "otp-input-row";

    const inputs = [];
    const total = 6;

    function syncHidden() {
      hidden.value = inputs.map((inp) => (inp.value || "").trim()).join("");
    }

    for (let i = 0; i < total; i++) {
      const cell = document.createElement("input");
      cell.type = "text";
      cell.inputMode = "numeric";
      cell.maxLength = 1;
      cell.autocomplete = "one-time-code";
      cell.className = "otp-input-cell";

      cell.addEventListener("input", (e) => {
        const v = (e.target.value || "").replace(/\D/g, "");
        e.target.value = v.slice(0, 1);
        syncHidden();
        if (v && i < total - 1) {
          inputs[i + 1].focus();
          inputs[i + 1].select();
        }
      });

      cell.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !e.target.value && i > 0) {
          inputs[i - 1].focus();
        }
      });

      container.appendChild(cell);
      inputs.push(cell);
    }

    hidden.parentNode.insertBefore(container, hidden);
  }

  function injectOtpStyles() {
    if (document.getElementById("otp-style")) return;
    const style = document.createElement("style");
    style.id = "otp-style";
    style.textContent = `
      .otp-input-row {
        display: flex;
        justify-content: center;
        gap: 8px;
        margin: 10px 0 18px 0;
      }
      .otp-input-cell {
        width: 38px;
        height: 46px;
        text-align: center;
        font-size: 18px;
        border-radius: 10px;
        border: 1px solid rgba(148, 163, 184, 0.9);
        outline: none;
        transition: all 0.15s ease;
        background: rgba(15, 23, 42, 0.02);
      }
      .otp-input-cell:focus {
        border-color: #2563eb;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
        background: #fff;
      }
    `;
    document.head.appendChild(style);
  }

  function uuid() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch {}
    return Date.now() + "_" + Math.random().toString(16).slice(2);
  }

  // NOTE: demo only (NOT secure)
  function pwHash(pw) {
    try {
      return btoa(unescape(encodeURIComponent(pw)));
    } catch {
      return pw;
    }
  }

  function getCurrentUser() {
    return readJSON(STORAGE_CURRENT, null);
  }

  function setCurrentUser(user) {
    writeJSON(STORAGE_CURRENT, user);
    // sync with existing logging helper in script.js
    try {
      localStorage.setItem("chatiip_user_id", user?.id || "anonymous");
    } catch {}

    // notify other modules (history, UI)
    try {
      window.dispatchEvent(new CustomEvent("chatiip:auth-changed", { detail: { user } }));
    } catch {}
  }

  function clearCurrentUser() {
    localStorage.removeItem(STORAGE_CURRENT);
    localStorage.removeItem("chatiip_user_id");

    try {
      window.dispatchEvent(new CustomEvent("chatiip:auth-changed", { detail: { user: null } }));
    } catch {}
  }

  function getUsers() {
    return readJSON(STORAGE_USERS, []);
  }

  function setUsers(list) {
    writeJSON(STORAGE_USERS, list);
  }

  function getSettings() {
    return readJSON(STORAGE_SETTINGS, { notifications: true });
  }

  function setSettings(settings) {
    writeJSON(STORAGE_SETTINGS, settings);
  }

  // ---------------- Toast ----------------
  function ensureToastWrap() {
    let wrap = document.getElementById("toastWrap");
    if (wrap) return wrap;
    wrap = document.createElement("div");
    wrap.id = "toastWrap";
    wrap.className = "toast-wrap";
    document.body.appendChild(wrap);
    return wrap;
  }

  function showToast(message, type = "success") {
    const wrap = ensureToastWrap();
    const t = document.createElement("div");
    t.className = `toast toast-${type}`;
    t.innerHTML = `
      <div class="toast-icon">${type === "success" ? "✅" : type === "error" ? "⚠️" : "ℹ️"}</div>
      <div class="toast-msg">${message}</div>
      <button class="toast-close" aria-label="Đóng">&times;</button>
    `;
    wrap.appendChild(t);

    const remove = () => {
      t.classList.add("hide");
      setTimeout(() => t.remove(), 250);
    };

    t.querySelector(".toast-close")?.addEventListener("click", remove);
    setTimeout(remove, 3500);
  }

  // --------------- Theme ----------------
  function applyTheme(theme) {
    const t = theme === "dark" ? "dark" : "light";
    document.body.classList.toggle("theme-dark", t === "dark");
    localStorage.setItem(STORAGE_THEME, t);

    // Update labels if present
    const themeText = document.getElementById("themeToggleText");
    const themeIcon = document.getElementById("themeToggleIcon");
    if (themeText) themeText.textContent = t === "dark" ? "Tối" : "Sáng";
    if (themeIcon) themeIcon.className = t === "dark" ? "fas fa-moon" : "fas fa-sun";

    const modalThemeText = document.getElementById("modalThemeToggleText");
    const modalThemeIcon = document.getElementById("modalThemeToggleIcon");
    if (modalThemeText) modalThemeText.textContent = t === "dark" ? "Đang bật: Tối" : "Đang bật: Sáng";
    if (modalThemeIcon) modalThemeIcon.className = t === "dark" ? "fas fa-moon" : "fas fa-sun";
  }

  function initThemeFromStorage() {
    let theme = localStorage.getItem(STORAGE_THEME);
    if (!theme) {
      // Nếu chưa chọn thủ công -> theo hệ thống
      try {
        const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
        theme = prefersDark ? "dark" : "light";
      } catch (_){
        theme = "light";
      }
    }
    applyTheme(theme);
  }

  // --------------- UI injection ----------------
  function adjustAuthBarPosition() {
    const bar = document.getElementById("authBar");
    if (!bar) return;

    const isMobile = window.matchMedia && window.matchMedia("(max-width: 768px)").matches;

    // Reset inline styles so resize (desktop <-> mobile) always looks correct
    bar.style.position = "fixed";
    bar.style.left = "";
    bar.style.right = "";
    bar.style.transform = "";
    bar.style.top = "";

    // Desktop: sát góc phải trên
    if (!isMobile) {
      bar.style.top = "16px";
      bar.style.right = "16px";
      bar.style.left = "auto";
      bar.style.transform = "none";
      // Desktop: không cần cộng thêm padding cho chat container
      try { document.documentElement.style.setProperty("--authbar-height", "0px"); } catch (_) {}
      return;
    }

    // Mobile: giữ ở giữa nhưng phải nằm dưới mobile topbar để không bị che bởi nút hamburger.
    // Nếu không có mobile topbar thì fallback về 16px.
    const topbar = document.getElementById("mobileTopbar");
    let topOffset = 16;
    if (topbar) {
      try {
        const cs = window.getComputedStyle(topbar);
        if (cs && cs.display !== "none") {
          const h = Math.round(topbar.getBoundingClientRect().height || 0);
          if (h > 0) topOffset = h + 12;
        }
      } catch (_) {
        // ignore
      }
    }
    bar.style.top = String(topOffset) + "px";
    bar.style.left = "50%";
    bar.style.right = "auto";
    bar.style.transform = "translateX(-50%)";

    // Mobile: cập nhật biến CSS để chat container chừa chỗ cho auth bar
    try {
      const h = Math.ceil(bar.getBoundingClientRect().height || 0);
      document.documentElement.style.setProperty("--authbar-height", (h > 0 ? (h + "px") : "0px"));
    } catch (_) {}
  }

  // Decide whether to show the top auth bar (Đăng nhập/Đăng ký).
// We only show it on the chat page to avoid cluttering public pages (news/laws/doc/...).
function shouldShowAuthBar() {
  const page = document.body?.dataset?.page || "";
  if (page) return page === "chat"; // explicit override via <body data-page="...">
  // Fallback (in case data-page is missing): detect chat layout markers
  return !!(document.getElementById("chatContainer")
    || document.getElementById("messageInputContainer")
    || document.querySelector(".chat-container"));
}

function injectAuthUI() {
    const showTopBar = shouldShowAuthBar();
    if (!showTopBar) {
      const oldBar = document.getElementById("authBar");
      if (oldBar) oldBar.remove();
    }
    // Auth bar (top center)
    if (showTopBar && !document.getElementById("authBar")) {
      const bar = document.createElement("div");
      bar.id = "authBar";
      bar.className = "auth-bar";
      bar.innerHTML = `
        <button class="auth-btn" id="loginOpenBtn">Đăng nhập</button>
        <button class="auth-btn secondary" id="registerOpenBtn">Đăng ký miễn phí</button>
        <button class="auth-btn" id="accountOpenBtn" style="display:none;">
          <i class="fas fa-user"></i>
          <span id="accountOpenBtnText">Tài khoản</span>
        </button>
      `;
      document.body.appendChild(bar);
    }

    // Auth modal
    if (!document.getElementById("authOverlay")) {
      const overlay = document.createElement("div");
      overlay.id = "authOverlay";
      overlay.className = "auth-overlay";
      overlay.setAttribute("aria-hidden", "true");
      overlay.innerHTML = `
        <div class="auth-modal" role="dialog" aria-modal="true" aria-label="Đăng nhập / Đăng ký">
          <button class="auth-close" id="authCloseBtn" aria-label="Đóng">&times;</button>

          <div class="auth-title">Tài khoản ChatIIP</div>
          <div class="auth-subtitle">Đăng nhập hoặc tạo tài khoản để đồng bộ trải nghiệm.</div>

          <div class="auth-tabs" role="tablist">
            <button class="auth-tab active" id="tabLogin" data-tab="login" type="button">Đăng nhập</button>
            <button class="auth-tab" id="tabRegister" data-tab="register" type="button">Đăng ký</button>
          </div>

          <div class="auth-panel" id="panelLogin">
            <form id="loginForm" class="auth-form">
              <label class="auth-label">Email</label>
              <input class="auth-input" id="loginEmail" type="email" placeholder="vd: ten@email.com" required />

              <label class="auth-label">Mật khẩu</label>
              <input class="auth-input" id="loginPassword" type="password" placeholder="Nhập mật khẩu" required />

              <button class="auth-submit" type="submit">Đăng nhập</button>

              <div style="display:flex; align-items:center; gap:10px; margin:14px 0 8px 0; opacity:.85;">
                <div style="height:1px; flex:1; background:rgba(148,163,184,.6);"></div>
                <span style="font-size:12px;">hoặc</span>
                <div style="height:1px; flex:1; background:rgba(148,163,184,.6);"></div>
              </div>
              <div id="googleSignInContainer" style="display:flex; justify-content:center; margin:10px 0 6px 0;"></div>
              <div class="auth-hint"><button class="link-btn" id="forgotOpenBtn" type="button">Quên mật khẩu?</button></div>
              <div class="auth-hint">Chưa có tài khoản? <button class="link-btn" id="gotoRegister" type="button">Đăng ký ngay</button></div>
            </form>
          </div>

          <div class="auth-panel hidden" id="panelRegister">
            <form id="registerForm" class="auth-form">
              <label class="auth-label">Họ & tên</label>
              <input class="auth-input" id="regName" type="text" placeholder="VD: Khô Gà,Bã Mía,Mẹ Lý" required />

              <label class="auth-label">Email</label>
              <input class="auth-input" id="regEmail" type="email" placeholder="vd: ten@email.com" required />

              <label class="auth-label">Số điện thoại</label>
              <input class="auth-input" id="regPhone" type="tel" placeholder="vd: 0912 345 678" />

              <label class="auth-label">Mật khẩu</label>
              <input class="auth-input" id="regPassword" type="password" placeholder="Tối thiểu 6 ký tự" minlength="6" required />

              <label class="auth-label">Nhập lại mật khẩu</label>
              <input class="auth-input" id="regPassword2" type="password" placeholder="Nhập lại mật khẩu" minlength="6" required />

              <button class="auth-submit" type="submit">Tạo tài khoản</button>
              <div class="auth-hint">Đã có tài khoản? <button class="link-btn" id="gotoLogin" type="button">Đăng nhập</button></div>
            </form>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }


    // OTP overlay (đẹp hơn prompt)
    if (!document.getElementById("otpOverlay")) {
      const overlay = document.createElement("div");
      overlay.id = "otpOverlay";
      overlay.className = "auth-overlay";
      overlay.setAttribute("aria-hidden", "true");
      overlay.innerHTML = `
        <div class="auth-modal" role="dialog" aria-modal="true" aria-label="Xác thực email">
          <button class="auth-close" id="otpCloseBtn" aria-label="Đóng">&times;</button>
          <div class="auth-title">Nhập mã OTP</div>
          <div class="auth-subtitle">Vui lòng kiểm tra email và nhập mã gồm 6 chữ số.</div>
          <form id="otpForm" class="auth-form">
            <label class="auth-label">Mã OTP</label>
            <input
              class="auth-input"
              id="otpCodeInput"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              placeholder="123456"
              required
            />
            <button class="auth-submit" type="submit">Xác nhận</button>
            <div class="auth-hint">Không nhận được mã? Kiểm tra thư rác hoặc thử lại sau vài phút.</div>
          </form>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    // Forgot password overlay
    if (!document.getElementById("forgotOverlay")) {
      const overlay = document.createElement("div");
      overlay.id = "forgotOverlay";
      overlay.className = "auth-overlay";
      overlay.setAttribute("aria-hidden", "true");
      overlay.innerHTML = `
        <div class="auth-modal" role="dialog" aria-modal="true" aria-label="Quên mật khẩu">
          <button class="auth-close" id="forgotCloseBtn" aria-label="Đóng">&times;</button>
          <div class="auth-title">Quên mật khẩu</div>
          <div class="auth-subtitle">Nhập email để nhận mã OTP đổi mật khẩu, rồi điền OTP + mật khẩu mới.</div>
          <form id="forgotForm" class="auth-form">
            <label class="auth-label">Email</label>
            <input class="auth-input" id="forgotEmail" type="email" required placeholder="vd: ten@email.com" />

            <label class="auth-label">Mã OTP</label>
            <input
              class="auth-input"
              id="forgotCode"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              placeholder="123456"
            />

            <label class="auth-label">Mật khẩu mới</label>
            <input
              class="auth-input"
              id="forgotPassword"
              type="password"
              minlength="6"
              placeholder="Tối thiểu 6 ký tự"
            />

            <button class="auth-submit" type="submit">Gửi / Đổi mật khẩu</button>
            <div class="auth-hint">
              Bước 1: nhập email và bấm nút để gửi mã OTP.<br/>
              Bước 2: nhập OTP + mật khẩu mới và bấm lại để đổi.
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(overlay);
    }


    // Account overlay (only used on pages without sidebar)
    if (!document.getElementById("accountOverlay")) {
      const overlay = document.createElement("div");
      overlay.id = "accountOverlay";
      overlay.className = "auth-overlay";
      overlay.setAttribute("aria-hidden", "true");
      overlay.innerHTML = `
        <div class="account-modal" role="dialog" aria-modal="true" aria-label="Tài khoản">
          <button class="auth-close" id="accountCloseBtn" aria-label="Đóng">&times;</button>
          <div class="auth-title">Tài khoản</div>

          <div class="account-card">
            <div class="account-row">
              <div class="avatar" id="modalAvatar">U</div>
              <div class="account-meta">
                <div class="account-name" id="modalAccountName">User</div>
                <div class="account-email" id="modalAccountEmail">email</div>
              </div>
            </div>

            <div class="settings-group">
              <div class="settings-title">Cài đặt</div>

              <div class="setting-row">
                <div class="setting-text">
                  <div class="setting-title">Ảnh đại diện</div>
                  <div class="setting-desc">Tải ảnh từ máy hoặc nhập link ảnh.</div>
                </div>
                <button class="pill-btn" id="changeAvatarBtn" type="button">Đổi avatar</button>
                <input id="avatarFileInput" type="file" accept="image/*" style="display:none" />
              </div>


              <div class="setting-row">
                <div class="setting-text">
                  <div class="setting-title">Thông báo</div>
                  <div class="setting-desc">Bật/tắt thông báo trên web</div>
                </div>
                <label class="switch">
                  <input type="checkbox" id="modalNotifications" />
                  <span class="slider"></span>
                </label>
              </div>

              <div class="setting-row">
                <div class="setting-text">
                  <div class="setting-title">Chủ đề</div>
                  <div class="setting-desc">Sáng / tối</div>
                </div>
                <button class="pill-btn" id="modalThemeToggleBtn" type="button">
                  <i id="modalThemeToggleIcon" class="fas fa-sun"></i>
                  <span id="modalThemeToggleText">Đang bật: Sáng</span>
                </button>
              </div>

              <div class="setting-row">
                <div class="setting-text">
                  <div class="setting-title">Cài đặt chung</div>
                  <div class="setting-desc">Một số tuỳ chọn cơ bản (demo)</div>
                </div>
                <span class="badge">Đang phát triển</span>
              </div>
            </div>

            <button class="menu-item" id="openArchiveBtn" type="button">
              <i class="fas fa-box-archive"></i> Lưu trữ
            </button>

            <button class="menu-item logout-item" id="modalLogoutBtn" type="button">
              <i class="fas fa-right-from-bracket"></i> Đăng xuất
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

  }

  function openOverlay(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add("show");
    el.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    // Nếu mở auth overlay thì render Google Sign-In button (nếu có)
    if (id === "authOverlay") {
      setTimeout(() => {
        try { renderGoogleButton(); } catch (_) {}
      }, 0);
    }
  }

  function closeOverlay(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("show");
    el.setAttribute("aria-hidden", "true");
    // only remove if both overlays closed
    const anyOpen = document.querySelector(".auth-overlay.show");
    if (!anyOpen) document.body.classList.remove("modal-open");
  }

  function setAuthTab(tab) {
    const loginTab = document.getElementById("tabLogin");
    const regTab = document.getElementById("tabRegister");
    const loginPanel = document.getElementById("panelLogin");
    const regPanel = document.getElementById("panelRegister");
    if (!loginTab || !regTab || !loginPanel || !regPanel) return;

    const isLogin = tab === "login";
    loginTab.classList.toggle("active", isLogin);
    regTab.classList.toggle("active", !isLogin);
    loginPanel.classList.toggle("hidden", !isLogin);
    regPanel.classList.toggle("hidden", isLogin);

    if (isLogin) {
      setTimeout(() => {
        try { renderGoogleButton(); } catch (_) {}
      }, 0);
    }
  }

  // --------------- Account UI sync ----------------
  function syncRailAndPanelAccountUI(user) {
    // Rail avatar
    const railAvatar = document.getElementById("railAvatar");
    applyAvatarElement(railAvatar, user || null);

    // Sidebar panel footer account
    const panelName = document.getElementById("sidebarAccountName");
    const panelEmail = document.getElementById("sidebarAccountEmail");
    const panelAvatar = document.getElementById("sidebarAccountAvatar");
    if (panelName) panelName.textContent = user ? (user.name || "Tài khoản") : "Tài khoản";
    if (panelEmail) panelEmail.textContent = user ? (user.email || user.provider || "") : "Chưa đăng nhập";
    applyAvatarElement(panelAvatar, user || null);

    // Theme should still apply globally
    const theme = localStorage.getItem(STORAGE_THEME) || "light";
    applyTheme(theme);
  }

  function syncAccountModalUI(user) {
    const name = document.getElementById("modalAccountName");
    const email = document.getElementById("modalAccountEmail");
    const avatar = document.getElementById("modalAvatar");
    if (name) name.textContent = user?.name || "Tài khoản";
    if (email) email.textContent = user?.email || user?.provider || "";
    applyAvatarElement(avatar, user || null);

    const settings = getSettings();
    const notif = document.getElementById("modalNotifications");
    if (notif) notif.checked = !!settings.notifications;

    const theme = localStorage.getItem(STORAGE_THEME) || "light";
    applyTheme(theme);
  }

  function syncTopBarUI(user) {
    const bar = document.getElementById("authBar");
    if (!bar) return;

    const hasSidebar = !!document.getElementById("sidebar");
    const loginBtn = document.getElementById("loginOpenBtn");
    const regBtn = document.getElementById("registerOpenBtn");
    const accountBtn = document.getElementById("accountOpenBtn");

    if (!user) {
      // guest: show login/register
      bar.style.display = "flex";
      if (loginBtn) loginBtn.style.display = "inline-flex";
      if (regBtn) regBtn.style.display = "inline-flex";
      if (accountBtn) accountBtn.style.display = "none";
      return;
    }

    // logged in: ẩn luôn thanh Đăng nhập/Đăng ký (tài khoản đã có ở sidebar)
    bar.style.display = "none";
  }

  function syncAllUI() {
    const user = getCurrentUser();
    syncTopBarUI(user);
    syncRailAndPanelAccountUI(user);
    syncAccountModalUI(user);
  }

  // --------------- Auth actions ----------------
  async function handleRegister(name, email, password, phone) {
    const trimmedName = (name || "").trim();
    const trimmedEmail = (email || "").trim().toLowerCase();
    const trimmedPhone = (phone || "").trim();

    if (!trimmedName) {
      showToast("Vui lòng nhập họ tên.", "error");
      return;
    }
    if (!trimmedEmail) {
      showToast("Vui lòng nhập email.", "error");
      return;
    }
    if (!password || password.length < 6) {
      showToast("Mật khẩu tối thiểu 6 ký tự.", "error");
      return;
    }

    if (trimmedPhone) {
      const digits = trimmedPhone.replace(/\D/g, "");
      if (digits.length < 8 || digits.length > 15) {
        showToast("Số điện thoại không hợp lệ.", "error");
        return;
      }
    }

    try {
      await api("/auth/register", {
        method: "POST",
        body: {
          name: trimmedName,
          email: trimmedEmail,
          password,
          phone: trimmedPhone || undefined
        }
      });

      pendingRegisterEmail = trimmedEmail;

      // reset ô OTP
      const otpInput = document.getElementById("otpCodeInput");
      if (otpInput) {
        otpInput.value = "";
        const row = otpInput.previousElementSibling;
        if (row && row.classList && row.classList.contains("otp-input-row")) {
          row.querySelectorAll("input").forEach((inp) => (inp.value = ""));
        }
      }

      injectOtpStyles();
      enhanceOtpInput("otpCodeInput");
      openOverlay("otpOverlay");
      showToast("Đã gửi mã OTP đến email. Vui lòng kiểm tra hộp thư và nhập mã.", "info");
    } catch (err) {
      showToast(err.message || "Có lỗi khi đăng ký.", "error");
    }
  }

  async function handleLogin(email, password) {
    const trimmedEmail = (email || "").trim().toLowerCase();

    if (!trimmedEmail) {
      showToast("Vui lòng nhập email.", "error");
      return;
    }
    if (!password) {
      showToast("Vui lòng nhập mật khẩu.", "error");
      return;
    }

    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: {
          email: trimmedEmail,
          password
        }
      });

      const user = data.user;
      setCurrentUser(user);
      closeOverlay("authOverlay");
      syncAllUI();
      showToast("Đăng nhập thành công!", "success");
    } catch (err) {
      showToast(err.message || "Đăng nhập thất bại.", "error");
    }
  }


  function handleSocial(provider) {
    const users = getUsers();
    const id = provider + "_" + uuid();
    const name = provider === "google" ? "Google User" : "Facebook User";
    const email = `${id}@${provider}.demo`;

    const user = { id: "u_" + id, name, email, provider, createdAt: new Date().toISOString() };

    // store if not exists (by email)
    if (!users.some((u) => (u.email || "").toLowerCase() === email.toLowerCase())) {
      users.push(user);
      setUsers(users);
    }

    const sessionUser = { id: user.id, name: user.name, email: user.email, provider: user.provider };
    setCurrentUser(sessionUser);

    showToast(`Đăng nhập thành công bằng ${provider === "google" ? "Google" : "Facebook"}!`, "success");
    closeOverlay("authOverlay");
    syncAllUI();
  }

  function logout() {
    (async () => {
      try {
        await api("/auth/logout", { method: "POST" });
      } catch (_) {
        // ignore
      }
      clearCurrentUser();
      showToast("Bạn đã đăng xuất.", "info");
      closeOverlay("accountOverlay");
      syncAllUI();
    })();
  }

  // --------------- Event wiring ----------------

  async function handleOtpSubmit(e) {
    e.preventDefault();
    const codeInput = document.getElementById("otpCodeInput");
    const code = codeInput ? codeInput.value.trim() : "";
    if (!pendingRegisterEmail) {
      showToast("Không tìm thấy email cần xác thực. Hãy đăng ký lại.", "error");
      closeOverlay("otpOverlay");
      return;
    }
    if (!code) {
      showToast("Bạn chưa nhập mã OTP.", "error");
      return;
    }

    try {
      const data = await api("/auth/verify-email", {
        method: "POST",
        body: {
          email: pendingRegisterEmail,
          code
        }
      });
      const user = data.user;
      setCurrentUser(user);
      closeOverlay("otpOverlay");
      closeOverlay("authOverlay");
      syncAllUI();
      showToast("Xác thực email thành công! Bạn đã được đăng nhập.", "success");
      pendingRegisterEmail = null;
    } catch (err) {
      showToast(err.message || "Xác thực OTP thất bại.", "error");
    }
  }

  async function handleForgotSubmit(e) {
    e.preventDefault();
    const emailInput = document.getElementById("forgotEmail");
    const codeInput = document.getElementById("forgotCode");
    const pwInput = document.getElementById("forgotPassword");

    const email = emailInput ? emailInput.value.trim().toLowerCase() : "";
    const code = codeInput ? codeInput.value.trim() : "";
    const newPassword = pwInput ? pwInput.value : "";

    if (!email) {
      showToast("Vui lòng nhập email.", "error");
      return;
    }

    // Bước 1: chỉ gửi OTP
    if (!forgotOtpSent) {
      try {
        const data = await api("/auth/request-password-reset", {
          method: "POST",
          body: { email }
        });
        forgotOtpSent = true;
        showToast("Đã gửi mã OTP (nếu email tồn tại). Vui lòng kiểm tra hộp thư.", "info");

        // Hỗ trợ dev: tự điền mã OTP nếu backend trả về debugCode
        if (data && data.debugCode && codeInput) {
          codeInput.value = data.debugCode;
          const row = codeInput.previousElementSibling;
          if (row && row.classList && row.classList.contains("otp-input-row")) {
            const digits = String(data.debugCode).split("");
            row.querySelectorAll("input").forEach((inp, idx) => {
              inp.value = digits[idx] || "";
            });
          }
        }

        // focus ô nhập OTP đầu tiên
        if (codeInput) {
          const row = codeInput.previousElementSibling;
          const firstCell =
            row && row.classList && row.classList.contains("otp-input-row")
              ? row.querySelector("input.otp-input-cell")
              : null;
          if (firstCell) firstCell.focus();
          else codeInput.focus();
        }
      } catch (err) {
        showToast(err.message || "Không thể gửi mã OTP.", "error");
      }
      return;
    }

    // Bước 2: đã có OTP, tiến hành đổi mật khẩu
    if (!code) {
      showToast("Vui lòng nhập mã OTP.", "error");
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      showToast("Mật khẩu mới tối thiểu 6 ký tự.", "error");
      return;
    }

    try {
      await api("/auth/reset-password", {
        method: "POST",
        body: {
          email,
          code,
          newPassword
        }
      });
      showToast("Đổi mật khẩu thành công. Vui lòng đăng nhập lại.", "success");
      closeOverlay("forgotOverlay");
      forgotOtpSent = false;

      if (emailInput) emailInput.value = "";
      if (codeInput) {
        codeInput.value = "";
        const row = codeInput.previousElementSibling;
        if (row && row.classList && row.classList.contains("otp-input-row")) {
          row.querySelectorAll("input").forEach((inp) => (inp.value = ""));
        }
      }
      if (pwInput) pwInput.value = "";
    } catch (err) {
      showToast(err.message || "Đổi mật khẩu thất bại.", "error");
    }
  }



  async function compressImageToDataUrl(file, maxSide = 256, quality = 0.86) {
    return new Promise((resolve, reject) => {
      try {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          try {
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            const scale = Math.min(1, maxSide / Math.max(w, h));
            const cw = Math.max(1, Math.round(w * scale));
            const ch = Math.max(1, Math.round(h * scale));

            const canvas = document.createElement('canvas');
            canvas.width = cw;
            canvas.height = ch;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, cw, ch);

            // ưu tiên jpeg cho nhẹ; nếu ảnh có alpha thì dùng png
            const hasAlpha = false; // không chắc chắn → vẫn dùng jpeg
            const mime = hasAlpha ? 'image/png' : 'image/jpeg';

            const dataUrl = canvas.toDataURL(mime, quality);
            URL.revokeObjectURL(url);
            resolve(dataUrl);
          } catch (e) {
            URL.revokeObjectURL(url);
            reject(e);
          }
        };
        img.onerror = (e) => {
          URL.revokeObjectURL(url);
          reject(e);
        };
        img.src = url;
      } catch (e) {
        reject(e);
      }
    });
  }

  async function updateAvatarUrl(avatarUrl) {
    const data = await api("/auth/me", {
      method: "PUT",
      body: { avatarUrl: String(avatarUrl || "").trim() }
    });
    setCurrentUser(data.user);
    syncAllUI();
  }



  async function compressAvatarFileToDataUrl(file, maxSize = 256) {
    // Nén ảnh client-side để tránh quá nặng khi lưu dataURL
    return await new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Không đọc được file ảnh."));
        reader.onload = () => {
          const img = new Image();
          img.onerror = () => reject(new Error("File ảnh không hợp lệ."));
          img.onload = () => {
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            const scale = Math.min(1, maxSize / Math.max(w, h));
            const cw = Math.max(1, Math.round(w * scale));
            const ch = Math.max(1, Math.round(h * scale));

            const canvas = document.createElement("canvas");
            canvas.width = cw;
            canvas.height = ch;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, cw, ch);

            // jpeg thường nhỏ hơn png
            const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
            resolve(dataUrl);
          };
          img.src = String(reader.result || "");
        };
        reader.readAsDataURL(file);
      } catch (e) {
        reject(e);
      }
    });
  }
  async function handleChangeAvatar() {
    const user = getCurrentUser();
    if (!user) {
      showToast("Vui lòng đăng nhập trước.", "error");
      return;
    }

    const useUpload = window.confirm("Bạn muốn đổi avatar bằng ảnh từ máy?\n\n- Nhấn OK: chọn ảnh trên máy\n- Nhấn Cancel: nhập URL ảnh");

    if (useUpload) {
      const fileInput = document.getElementById("avatarFileInput");
      if (!fileInput) {
        showToast("Không tìm thấy bộ chọn ảnh.", "error");
        return;
      }
      // reset để chọn lại cùng 1 file vẫn trigger change
      fileInput.value = "";
      fileInput.click();
      return;
    }

    const current = user.avatarUrl || "";
    const url = window.prompt("Nhập URL ảnh avatar (jpg/png):", current);
    if (!url) return;

    try {
      const data = await api("/auth/me", {
        method: "PUT",
        body: { avatarUrl: url.trim() }
      });
      setCurrentUser(data.user);
      syncAllUI();
      showToast("Đã cập nhật avatar.", "success");
    } catch (err) {
      showToast(err.message || "Không thể cập nhật avatar.", "error");
    }
  }

  function wireEvents() {
    // Avatar upload
    document.getElementById("avatarFileInput")?.addEventListener("change", async (e) => {
      try {
        const file = e.target && e.target.files ? e.target.files[0] : null;
        if (!file) return;
        if (!/^image\//i.test(file.type)) {
          showToast("File không phải hình ảnh.", "error");
          return;
        }
        const dataUrl = await compressImageToDataUrl(file, 256, 0.86);
        await updateAvatarUrl(dataUrl);
        showToast("Đã cập nhật avatar.", "success");
      } catch (err) {
        showToast(err?.message || "Không thể cập nhật avatar.", "error");
      }
    });

    document.getElementById("forgotOpenBtn")?.addEventListener("click", () => {
      closeOverlay("authOverlay");
      openOverlay("forgotOverlay");
      forgotOtpSent = false;

      const emailInput = document.getElementById("forgotEmail");
      const codeInput = document.getElementById("forgotCode");
      const pwInput = document.getElementById("forgotPassword");
      if (emailInput) emailInput.value = "";
      if (codeInput) {
        codeInput.value = "";
        const row = codeInput.previousElementSibling;
        if (row && row.classList && row.classList.contains("otp-input-row")) {
          row.querySelectorAll("input").forEach((inp) => (inp.value = ""));
        }
      }
      if (pwInput) pwInput.value = "";
    });

    document.getElementById("forgotForm")?.addEventListener("submit", handleForgotSubmit);

    // Open/close auth
    document.getElementById("loginOpenBtn")?.addEventListener("click", () => {
      setAuthTab("login");
      openOverlay("authOverlay");
    });

    document.getElementById("registerOpenBtn")?.addEventListener("click", () => {
      setAuthTab("register");
      openOverlay("authOverlay");
    });

    document.getElementById("authCloseBtn")?.addEventListener("click", () => closeOverlay("authOverlay"));
    document.getElementById("forgotCloseBtn")?.addEventListener("click", () => {
      closeOverlay("forgotOverlay");
      forgotOtpSent = false;
    });


    // Close on backdrop click
    document.getElementById("authOverlay")?.addEventListener("click", (e) => {
      if (e.target && e.target.id === "authOverlay") closeOverlay("authOverlay");
    });

    // Tabs
    document.getElementById("tabLogin")?.addEventListener("click", () => setAuthTab("login"));
    document.getElementById("tabRegister")?.addEventListener("click", () => setAuthTab("register"));

    document.getElementById("gotoRegister")?.addEventListener("click", () => setAuthTab("register"));
    document.getElementById("gotoLogin")?.addEventListener("click", () => setAuthTab("login"));

    // Forms
    document.getElementById("registerForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = document.getElementById("regName")?.value || "";
      const email = document.getElementById("regEmail")?.value || "";
      const phone = document.getElementById("regPhone")?.value || "";
      const pw1 = document.getElementById("regPassword")?.value || "";
      const pw2 = document.getElementById("regPassword2")?.value || "";

      if (pw1 !== pw2) {
        showToast("Mật khẩu nhập lại không khớp.", "error");
        return;
      }
      handleRegister(name, email, pw1, phone);
    });

    document.getElementById("loginForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = document.getElementById("loginEmail")?.value || "";
      const pw = document.getElementById("loginPassword")?.value || "";
      handleLogin(email, pw);
    });
    // Sidebar account expand/collapse
    const toggle = document.getElementById("accountToggleBtn");
    const panel = document.getElementById("accountPanel");
    if (toggle && panel) {
      toggle.addEventListener("click", () => {
        const isOpen = panel.style.display !== "none";
        panel.style.display = isOpen ? "none" : "block";
        toggle.classList.toggle("open", !isOpen);
      });
    }

    // Sidebar login/register buttons
    document.getElementById("sidebarLoginBtn")?.addEventListener("click", () => {
      setAuthTab("login");
      openOverlay("authOverlay");
    });
    document.getElementById("sidebarRegisterBtn")?.addEventListener("click", () => {
      setAuthTab("register");
      openOverlay("authOverlay");
    });

    // Sidebar settings: notifications
    document.getElementById("settingNotifications")?.addEventListener("change", (e) => {
      const settings = getSettings();
      settings.notifications = !!e.target.checked;
      setSettings(settings);
      showToast(settings.notifications ? "Đã bật thông báo." : "Đã tắt thông báo.", "info");
    });

    // Sidebar theme
    document.getElementById("themeToggleBtn")?.addEventListener("click", () => {
      const cur = localStorage.getItem(STORAGE_THEME) || "light";
      const next = cur === "dark" ? "light" : "dark";
      applyTheme(next);
      showToast(next === "dark" ? "Đã bật chế độ tối." : "Đã bật chế độ sáng.", "info");
    });

    // Sidebar logout
    document.getElementById("logoutBtn")?.addEventListener("click", logout);

    // Rail + Panel account button (ChatGPT-style)
    const openAccountOrAuth = () => {
      const user = getCurrentUser();
      if (!user) {
        setAuthTab("login");
        openOverlay("authOverlay");
        return;
      }
      syncAccountModalUI(user);
      openOverlay("accountOverlay");
    };
    document.getElementById("railAccountBtn")?.addEventListener("click", openAccountOrAuth);
    document.getElementById("sidebarAccountBtn")?.addEventListener("click", openAccountOrAuth);

    // Account button on non-sidebar pages
    document.getElementById("accountOpenBtn")?.addEventListener("click", () => {
      const user = getCurrentUser();
      if (!user) return;
      syncAccountModalUI(user);
      openOverlay("accountOverlay");
    });

    document.getElementById("accountCloseBtn")?.addEventListener("click", () => closeOverlay("accountOverlay"));
    document.getElementById("accountOverlay")?.addEventListener("click", (e) => {
      if (e.target && e.target.id === "accountOverlay") closeOverlay("accountOverlay");
    });

    const changeAvatarBtn = document.getElementById("changeAvatarBtn");
    if (changeAvatarBtn) {
      changeAvatarBtn.addEventListener("click", handleChangeAvatar);
    }

    const avatarFileInput = document.getElementById("avatarFileInput");
    if (avatarFileInput) {
      avatarFileInput.addEventListener("change", async (e) => {
        try {
          const file = e.target && e.target.files ? e.target.files[0] : null;
          if (!file) return;
          if (!/^image\//i.test(file.type || "")) {
            showToast("Vui lòng chọn file ảnh (jpg/png).", "error");
            return;
          }

          const dataUrl = await compressAvatarFileToDataUrl(file, 256);
          const data = await api("/auth/me", {
            method: "PUT",
            body: { avatarUrl: dataUrl }
          });
          setCurrentUser(data.user);
          syncAllUI();
          showToast("Đã cập nhật avatar.", "success");
        } catch (err) {
          showToast(err.message || "Không thể cập nhật avatar.", "error");
        }
      });
    }

    document.getElementById("modalLogoutBtn")?.addEventListener("click", logout);

    document.getElementById("openArchiveBtn")?.addEventListener("click", () => {
      // Mở trang quản lý lưu trữ (do script.js xử lý)
      closeOverlay("accountOverlay");
      try { window.dispatchEvent(new CustomEvent("chatiip:open-archive")); } catch (_) {}
    });

    // Modal settings events
    document.getElementById("modalNotifications")?.addEventListener("change", (e) => {
      const settings = getSettings();
      settings.notifications = !!e.target.checked;
      setSettings(settings);
      // mirror sidebar toggle if present
      const sidebarNotif = document.getElementById("settingNotifications");
      if (sidebarNotif) sidebarNotif.checked = settings.notifications;
      showToast(settings.notifications ? "Đã bật thông báo." : "Đã tắt thông báo.", "info");
    });

    document.getElementById("modalThemeToggleBtn")?.addEventListener("click", () => {
      const cur = localStorage.getItem(STORAGE_THEME) || "light";
      const next = cur === "dark" ? "light" : "dark";
      applyTheme(next);
      showToast(next === "dark" ? "Đã bật chế độ tối." : "Đã bật chế độ sáng.", "info");
    });

    // OTP overlay events
    document.getElementById("otpForm")?.addEventListener("submit", handleOtpSubmit);
    document.getElementById("otpCloseBtn")?.addEventListener("click", () => {
      closeOverlay("otpOverlay");
    });
    document.getElementById("otpOverlay")?.addEventListener("click", (e) => {
      if (e.target && e.target.id === "otpOverlay") closeOverlay("otpOverlay");
    });

    // ESC to close
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeOverlay("authOverlay");
        closeOverlay("accountOverlay");
      }
    });
  }

  // --------------- Boot ----------------
  document.addEventListener("DOMContentLoaded", () => {
    injectAuthUI();
    adjustAuthBarPosition();
    window.addEventListener("resize", adjustAuthBarPosition);
    initThemeFromStorage();
    injectOtpStyles();
    enhanceOtpInput("otpCodeInput");
    enhanceOtpInput("forgotCode");
    wireEvents();
    syncAllUI();
  });
})();
