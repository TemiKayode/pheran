(function () {
  // Inject drawer HTML + styles once DOM is ready
  function init() {
    // ── Styles ──
    const style = document.createElement('style')
    style.textContent = `
      .nav-drawer-overlay{
        position:fixed;inset:0;background:rgba(28,25,23,0.55);z-index:500;
        opacity:0;pointer-events:none;transition:opacity 280ms ease;
        backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);
      }
      .nav-drawer-overlay.open{opacity:1;pointer-events:all;}
      .nav-drawer{
        position:fixed;top:0;left:0;bottom:0;width:300px;max-width:85vw;
        background:#fff;z-index:501;
        transform:translateX(-100%);transition:transform 300ms cubic-bezier(.25,.46,.45,.94);
        display:flex;flex-direction:column;box-shadow:4px 0 32px rgba(0,0,0,0.12);
      }
      .nav-drawer.open{transform:translateX(0);}
      .nav-drawer-head{
        display:flex;align-items:center;justify-content:space-between;
        padding:16px 20px;border-bottom:1px solid #F0EBF9;flex-shrink:0;
      }
      .nav-drawer-logo{
        font-family:'Cormorant Garamond',Georgia,serif;font-size:1.3rem;font-weight:700;
        letter-spacing:.18em;color:#2D1B4E;text-decoration:none;
        display:flex;align-items:center;gap:8px;
      }
      .nav-drawer-logo img{height:36px;width:auto;object-fit:contain;}
      .nav-drawer-close{
        width:36px;height:36px;border-radius:50%;background:#F0EBF9;border:none;
        cursor:pointer;display:flex;align-items:center;justify-content:center;
        color:#5B2D8E;font-size:1.2rem;line-height:1;transition:background 150ms;
      }
      .nav-drawer-close:hover{background:#E2D9F3;}
      .nav-drawer-links{
        flex:1;overflow-y:auto;padding:12px 0;
      }
      .nav-drawer-link{
        display:flex;align-items:center;gap:14px;
        padding:14px 24px;text-decoration:none;
        font-family:'Montserrat','Inter',sans-serif;font-size:0.95rem;font-weight:600;
        letter-spacing:.04em;color:#1C1927;
        border-left:3px solid transparent;transition:all 150ms;
      }
      .nav-drawer-link:hover,.nav-drawer-link.active{
        background:#F0EBF9;color:#5B2D8E;border-left-color:#5B2D8E;
      }
      .nav-drawer-link svg{flex-shrink:0;opacity:.7;}
      .nav-drawer-link:hover svg,.nav-drawer-link.active svg{opacity:1;}
      .nav-drawer-divider{height:1px;background:#F0EBF9;margin:8px 20px;}
      .nav-drawer-foot{
        padding:20px 24px;border-top:1px solid #F0EBF9;flex-shrink:0;
      }
      .nav-drawer-foot a{
        display:block;text-align:center;padding:12px;background:#2D1B4E;color:#fff;
        border-radius:10px;text-decoration:none;font-family:'Montserrat','Inter',sans-serif;
        font-size:.82rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
        transition:background 150ms;
      }
      .nav-drawer-foot a:hover{background:#5B2D8E;}
    `
    document.head.appendChild(style)

    // ── Drawer HTML ──
    const logoSrc = document.querySelector('a.logo img, span.logo img')
    const logoEl = logoSrc
      ? `<img src="${logoSrc.src}" alt="PHERAN">`
      : 'PHERAN'

    const currentPage = location.pathname.split('/').pop() || 'homepage.html'

    function navLink(href, label, iconPath) {
      const active = currentPage === href ? ' active' : ''
      return `<a class="nav-drawer-link${active}" href="${href}">
        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">${iconPath}</svg>
        ${label}
      </a>`
    }

    const overlay = document.createElement('div')
    overlay.className = 'nav-drawer-overlay'
    overlay.id = 'nav-drawer-overlay'

    const drawer = document.createElement('div')
    drawer.className = 'nav-drawer'
    drawer.id = 'nav-drawer'
    drawer.setAttribute('role', 'dialog')
    drawer.setAttribute('aria-label', 'Site navigation')
    drawer.innerHTML = `
      <div class="nav-drawer-head">
        <a class="nav-drawer-logo" href="homepage.html">${logoEl}</a>
        <button class="nav-drawer-close" id="nav-drawer-close" aria-label="Close menu">✕</button>
      </div>
      <div class="nav-drawer-links">
        ${navLink('homepage.html', 'Home',
          '<path d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/>')}
        ${navLink('category.html', 'Shop',
          '<path d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"/>')}
        ${navLink('custom.html', 'Custom Orders',
          '<path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z"/>')}
        ${navLink('gallery.html', 'Gallery',
          '<path d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"/>')}
        ${navLink('about.html', 'About',
          '<path d="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"/>')}
        <div class="nav-drawer-divider"></div>
        ${navLink('account.html', 'My Account',
          '<path d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"/>')}
        ${navLink('support.html', 'Help & Support',
          '<path d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"/>')}
      </div>
      <div class="nav-drawer-foot">
        <a href="custom.html">Design Something Custom →</a>
      </div>
    `

    document.body.appendChild(overlay)
    document.body.appendChild(drawer)

    // ── Events ──
    function openMenu() {
      overlay.classList.add('open')
      drawer.classList.add('open')
      document.body.style.overflow = 'hidden'
      document.getElementById('nav-drawer-close').focus()
    }
    function closeMenu() {
      overlay.classList.remove('open')
      drawer.classList.remove('open')
      document.body.style.overflow = ''
    }

    const menuBtn = document.getElementById('menu-btn')
    if (menuBtn) menuBtn.addEventListener('click', openMenu)
    overlay.addEventListener('click', closeMenu)
    document.getElementById('nav-drawer-close').addEventListener('click', closeMenu)

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawer.classList.contains('open')) closeMenu()
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
