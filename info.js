(function(){
  function qs(sel, root){ return (root||document).querySelector(sel); }
  function qsa(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }

  // Preserve cache-busting query params (e.g. ?v=...) when navigating between info pages.
  // This avoids extra redirects and keeps browser back/forward history predictable.
  (function syncInternalLinksWithQuery(){
    var params = new URLSearchParams(location.search || "");
    var v = params.get('v');
    if (!v) return;
    qsa('a[href]').forEach(function(a){
      var href = a.getAttribute('href') || '';
      if (!href) return;
      // Skip anchors, mailto, tel, and external links
      if (href.charAt(0) === '#') return;
      if (/^(mailto:|tel:|https?:\/\/)/i.test(href)) return;

      try{
        var u = new URL(href, location.href);
        // Same origin only
        if (u.origin !== location.origin) return;
        if (!u.searchParams.get('v')) u.searchParams.set('v', v);
        a.setAttribute('href', u.pathname + '?' + u.searchParams.toString() + (u.hash || ''));
      }catch(_){
        // Ignore malformed URLs
      }
    });
  })();

  // Smooth anchor scroll
  qsa('a[href^="#"]').forEach(function(a){
    a.addEventListener('click', function(e){
      var id = a.getAttribute('href');
      if (!id || id === '#') return;
      var el = qs(id);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      closeDrawer();
    });
  });

  // Back to top
  var back = qs('#backToTop');
  function onScroll(){
    var y = window.scrollY || document.documentElement.scrollTop || 0;
    if (back){
      if (y > 520) back.classList.add('is-show');
      else back.classList.remove('is-show');
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (back){
    back.addEventListener('click', function(){
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Mobile drawer
  var drawer = qs('#mobileDrawer');
  var openBtn = qs('#mobileMenuBtn');
  var closeTargets = qsa('[data-drawer-close]');

  function openDrawer(){ if (drawer) drawer.classList.add('is-open'); }
  function closeDrawer(){ if (drawer) drawer.classList.remove('is-open'); }

  if (openBtn){
    openBtn.addEventListener('click', function(){
      if (!drawer) return;
      if (drawer.classList.contains('is-open')) closeDrawer();
      else openDrawer();
    });
  }

  closeTargets.forEach(function(el){
    el.addEventListener('click', closeDrawer);
  });

  // Mark active page in nav
  function norm(p){
    p = (p || '').split('?')[0].split('#')[0];
    p = p.replace(/^\.+\//, '/'); // ./foo -> /foo (best-effort)
    p = p.replace(/\/+$/, '');
    p = p.replace(/\.html$/i, '');
    return p || '/';
  }
  var path = norm(location.pathname || '');
  qsa('.info-nav a, .info-mobile-drawer a').forEach(function(a){
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return;
    // Compare normalized paths to support both clean URLs (/gioi-thieu) and file URLs (/gioi-thieu.html)
    try{
      var u = new URL(href, location.href);
      if (norm(u.pathname) === path) a.classList.add('is-active');
    }catch(_){
      if (norm(href) === path) a.classList.add('is-active');
    }
  });
})();
