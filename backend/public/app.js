/* E-Read AI – Dynamic Web Client */
(() => {
  'use strict';
  const $app = document.getElementById('app');
  const apiBase = window.ELIBRARY_API_BASE_URL || (window.Capacitor?.isNativePlatform?.() ? 'http://10.0.2.2:3000/api' : '/api');
  const state = { token: null, user: null, downloads: null, categories: [], route: 'dashboard', books: { q: '', category: '', page: 1 } };

  // ---------- utils ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} },
    del: (k) => { try { sessionStorage.removeItem(k); } catch {} },
  };
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2800);
  }
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(apiBase + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && state.token) { clearSession(); render(); }
    if (!res.ok) { const e = new Error(data.error || 'Request failed'); e.data = data; throw e; }
    return data;
  }
  const isGuest = () => state.user?.role === 'guest';
  const isAdmin = () => state.user?.role === 'admin';
  function setSession(token, user) { state.token = token; state.user = user; store.set('token', token); }
  function clearSession() { state.token = null; state.user = null; state.downloads = null; store.del('token'); }
  async function refreshMe() {
    const d = await api('/auth/me'); state.user = d.user; state.downloads = d.downloads;
  }

  // ---------- auth screen ----------
  function renderAuth(mode = 'login') {
    $app.innerHTML = `
    <div class="auth">
      <section class="hero">
        <div class="brand" style="color:#1d2a26; font-size: 2rem;">E-Read <span>AI</span></div>
        <h1>Smart Reading.<br>Instant Answers.</h1>
        <p style="font-size: 1.1rem; margin-top: 0.5rem;">Explore a massive library of open-access books, powered by an intelligent AI assistant.</p>
        <ul>
          <li>Guest Access: Up to 5 free book downloads</li>
          <li>Registered Account: 10 downloads + My Library sync</li>
          <li>Seamless synchronization across Web & Android</li>
        </ul>
      </section>
      <section class="auth-card"><div class="card">
        <div class="tabs" role="tablist">
          <button role="tab" id="t-login" aria-selected="${mode === 'login'}">Log in</button>
          <button role="tab" id="t-register" aria-selected="${mode === 'register'}">Register</button>
        </div>
        <form id="form" novalidate>
          ${mode === 'register' ? `<label for="fullName">Full Name</label><input id="fullName" placeholder="Maynard To" autocomplete="name" required>` : ''}
          <label for="email">Email Address</label><input id="email" type="email" placeholder="name@example.com" autocomplete="email" required>
          <label for="password">Password</label>
          <input id="password" type="password" placeholder="••••••••" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required>
          ${mode === 'register' ? '<div class="muted" style="font-size:.8rem;margin-top:.3rem">At least 8 characters with letters and numbers.</div>' : ''}
          <div class="error" id="err"></div>
          <button class="btn primary block" type="submit" style="margin-top:1rem">${mode === 'login' ? 'Log in to E-Read' : 'Create Account'}</button>
        </form>
        <div class="divider">or</div>
        <button class="btn block" id="guest">🚀 Instant Guest Access (5 downloads)</button>
      </div></section>
    </div>`;
    document.getElementById('t-login').onclick = () => renderAuth('login');
    document.getElementById('t-register').onclick = () => renderAuth('register');
    document.getElementById('guest').onclick = async () => {
      try { const d = await api('/auth/guest', { method: 'POST' }); setSession(d.token, d.user); await boot(); }
      catch (e) { document.getElementById('err').textContent = e.message; }
    };
    document.getElementById('form').onsubmit = async (ev) => {
      ev.preventDefault();
      const err = document.getElementById('err'); err.textContent = '';
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      try {
        const body = mode === 'login' ? { email, password } : { fullName: document.getElementById('fullName').value, email, password };
        const d = await api(mode === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body });
        setSession(d.token, d.user); location.hash = '#/dashboard'; await boot();
      } catch (e) { err.textContent = e.message; }
    };
  }

  // ---------- shell ----------
  const NAV = [
    ['dashboard', '🏠', 'Dashboard'], ['catalog', '📚', 'Catalog'],
    ['library', '🔖', 'My Library'], ['ai', '✨', 'AI Assistant'],
  ];
  function shell(content) {
    const items = [...NAV, ...(isAdmin() ? [['admin', '🛠', 'Admin']] : [])];
    $app.innerHTML = `
    <div class="mobile-bar">
      <div class="brand" style="margin:0">E-Read <span>AI</span></div>
      <button class="btn sm" id="menu" aria-label="Menu">☰</button>
    </div>
    <div class="shell">
      <aside class="side" id="side">
        <div class="brand">E-Read <span>AI</span></div>
        <nav class="nav">${items.map(([r, i, l]) => `<a href="#/${r}" class="${state.route === r ? 'active' : ''}"><span>${i}</span> ${l}</a>`).join('')}</nav>
        <div class="spacer"></div>
        <div class="who">
          <b>${esc(state.user.fullName)}</b><br>
          <span class="muted" style="font-size:0.78rem">${isGuest() ? '⚡ Guest Pass' : esc(state.user.email)}</span>
        </div>
        <button class="btn sm" id="logout" style="margin-top:0.5rem">${isGuest() ? 'Exit Guest Mode' : 'Log out'}</button>
      </aside>
      <main class="main" id="view">${content}</main>
    </div>`;
    document.getElementById('menu').onclick = () => document.getElementById('side').classList.toggle('open');
    document.getElementById('logout').onclick = async () => {
      try { await api('/auth/logout', { method: 'POST' }); } catch {}
      clearSession(); location.hash = ''; renderAuth();
    };
  }

  function meter() {
    const d = state.downloads; if (!d) return '';
    const pct = Math.min(100, Math.round((d.used / d.limit) * 100));
    return `<div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <b>Download Tracker</b> <span class="badge" style="background:var(--bg); color:var(--muted); border:1px solid var(--line);">${isGuest() ? 'Guest' : 'Registered'}</span>
      </div>
      <div style="font-family:'Fraunces',serif; font-size:2rem; margin-top:0.4rem;">${d.used} <span class="muted" style="font-size:1rem">/ ${d.limit} used</span></div>
      <div class="meter"><i style="width:${pct}%"></i></div>
      ${isGuest() ? '<p class="muted" style="margin:.6rem 0 0;font-size:.85rem">💡 Upgrade to a free account to unlock 10 downloads and Library Sync.</p>' : ''}
    </div>`;
  }

  function bookCard(b) {
    const coverUrl = b.coverUrl?.startsWith('/api/')
      ? (apiBase.startsWith('http') ? new URL(b.coverUrl, apiBase).toString() : b.coverUrl)
      : b.coverUrl;
    return `<button class="book" data-id="${b.id}" aria-label="${esc(b.title)}">
      ${coverMarkup(b.title, coverUrl)}
      <div class="meta">
        <b>${esc(b.title)}</b>
        <span class="muted" style="font-size:.82rem">${esc(b.author)}</span><br>
        <span class="chip">${esc(b.category)}</span>
      </div>
    </button>`;
  }
  function coverMarkup(title, coverUrl) {
    return `<div class="cover">
      ${coverUrl
        ? `<img src="${esc(coverUrl)}" data-fallback="${esc(title)}" alt="" loading="lazy">`
        : `<span class="cover-fallback">${esc(title)}</span>`}
    </div>`;
  }
  function bindBooks(root) {
    root.querySelectorAll('.book').forEach((el) => (el.onclick = () => openBook(el.dataset.id)));
  }

  // ---------- views ----------
  async function viewDashboard() {
    const [{ total }, featured] = await Promise.all([api('/books?limit=1'), api('/books?limit=6')]);
    shell(`
      <h1>Welcome back, ${esc(state.user.fullName.split(' ')[0])} 👋</h1>
      <p class="muted">Discover, read, and search legally authorized books enhanced with AI.</p>
      
      <div class="grid stats" style="margin:1.5rem 0">
        ${meter()}
        <div class="card stat"><span class="muted">Available Titles</span><b>${total}</b><span class="muted" style="font-size:0.8rem">Expanding catalog</span></div>
        <div class="card stat"><span class="muted">Account Status</span><b style="font-size:1.4rem; color:var(--brand)">${isGuest() ? 'Guest Access' : isAdmin() ? 'Administrator' : 'Member'}</b><span class="muted" style="font-size:0.8rem">${isGuest() ? '5 downloads limit' : '10 downloads limit'}</span></div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2rem;">
        <h2>Featured Books</h2>
        <a href="#/catalog">Browse full catalog →</a>
      </div>
      <div class="grid books" id="feat" style="margin-top:0.8rem">${featured.books.map(bookCard).join('')}</div>

      <div class="card ai-box" style="margin-top:2rem; padding:1.75rem">
        <div style="display:flex; align-items:center; gap:0.6rem;">
          <h3 style="margin:0">✨ E-Read AI Assistant</h3>
          <span class="badge">Phase 2 Planned</span>
        </div>
        <p class="muted" style="margin:0.5rem 0 1rem">Ask questions about books in natural language, generate instant summaries, and request personalized reading recommendations.</p>
        <div class="prompts">
          <span class="prompt-chip">🔍 "Find me classic sci-fi novels"</span>
          <span class="prompt-chip">📖 "Summarize Pride and Prejudice"</span>
          <span class="prompt-chip">💡 "Recommend philosophy books for beginners"</span>
        </div>
      </div>`);
    bindBooks(document.getElementById('feat'));
  }

  async function viewCatalog() {
    if (!state.categories.length) state.categories = (await api('/categories')).categories;
    shell(`<h1>Catalog Explorer</h1>
      <div class="toolbar">
        <input id="q" type="search" placeholder="🔍 Search titles, authors..." value="${esc(state.books.q)}" aria-label="Search">
        <select id="cat" aria-label="Category"><option value="">All Categories</option>
          ${state.categories.map((c) => `<option value="${esc(c.name)}" ${c.name === state.books.category ? 'selected' : ''}>${esc(c.name)} (${c.count})</option>`).join('')}</select>
      </div>
      <div id="results"></div>`);

    const load = async () => {
      const { q, category, page } = state.books;
      const p = new URLSearchParams({ page, limit: 12 }); if (q) p.set('q', q); if (category) p.set('category', category);
      const d = await api('/books?' + p);
      const pages = Math.max(1, Math.ceil(d.total / d.limit));
      document.getElementById('results').innerHTML = d.books.length
        ? `<p class="muted" style="margin-bottom:0.8rem">${d.total} title${d.total === 1 ? '' : 's'} available</p>
           <div class="grid books" id="grid">${d.books.map(bookCard).join('')}</div>
           <div class="pager">
             <button class="btn sm" id="prev" ${page <= 1 ? 'disabled' : ''}>← Previous</button>
             <span class="muted" style="font-weight:600">Page ${page} of ${pages}</span>
             <button class="btn sm" id="next" ${page >= pages ? 'disabled' : ''}>Next →</button>
           </div>`
        : '<div class="empty"><h3>No books found</h3><p>Try searching for a different keyword or category.</p></div>';
      bindBooks(document.getElementById('results'));
      const pv = document.getElementById('prev'), nx = document.getElementById('next');
      if (pv) pv.onclick = () => { state.books.page--; load(); };
      if (nx) nx.onclick = () => { state.books.page++; load(); };
    };

    let timer;
    document.getElementById('q').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { state.books.q = e.target.value.trim(); state.books.page = 1; load(); }, 250); };
    document.getElementById('cat').onchange = (e) => { state.books.category = e.target.value; state.books.page = 1; load(); };
    await load();
  }

  async function viewLibrary() {
    if (isGuest()) {
      shell(`<h1>My Personal Library</h1>
        <div class="card empty">
          <h3>Member Access Only</h3>
          <p>Create a free registered account to save your favorite books, build reading lists, and sync across Web and Android.</p>
          <button class="btn primary" id="reg" style="margin-top:1rem">Create Free Account</button>
        </div>`);
      document.getElementById('reg').onclick = () => { clearSession(); renderAuth('register'); };
      return;
    }
    const [lib, fav] = await Promise.all([api('/library'), api('/favorites')]);
    shell(`<h1>My Personal Library</h1>
      <h2 style="margin-top:1.5rem">🔖 Saved Reading List</h2>
      ${lib.books.length ? `<div class="grid books" id="lib">${lib.books.map(bookCard).join('')}</div>` : '<div class="empty"><p>No books in your reading list yet. Browse the catalog to add titles!</p></div>'}
      <h2 style="margin-top:2.5rem">❤️ Favorites</h2>
      ${fav.books.length ? `<div class="grid books" id="fav">${fav.books.map(bookCard).join('')}</div>` : '<div class="empty"><p>No favorites starred yet.</p></div>'}`);
    bindBooks(document.getElementById('view'));
  }

  async function viewAI() {
    const a = await api('/ai/architecture');
    shell(`<h1>✨ E-Read AI Assistant <span class="badge">Phase 2 Sandbox</span></h1>
      <p class="muted">An intelligent reading companion deeply integrated into E-Read AI DB tools.</p>
      
      <div class="card ai-box" style="margin:1.5rem 0">
        <b>Architecture Preview</b>
        <p style="margin:.4rem 0">User Prompt → <code>${esc(a.endpoint)}</code> → Native Function Calling → Live DB Querying → Smart AI Synthesis</p>
        <div class="chat-mock">
          <input disabled placeholder="Ask E-Read AI about any book... (Unlocks in Phase 2)" aria-label="AI chat input">
          <button class="btn primary" disabled>Send</button>
        </div>
      </div>
      
      <div class="card">
        <h3>Available Agent Tools</h3>
        ${a.tools.map((t) => `<div class="tool"><code>${esc(t.name)}</code><span>${esc(t.description)}</span></div>`).join('')}
      </div>
      
      <div class="card" style="margin-top:1.25rem">
        <h3>Safety & Integrity Directives</h3>
        <ul style="padding-left:1.2rem; margin:0.5rem 0 0">${a.safety.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      </div>`);
  }

  async function viewAdmin() {
    if (!isAdmin()) { location.hash = '#/dashboard'; return; }
    const s = await api('/admin/stats');
    shell(`<h1>Administrator Dashboard</h1><p class="muted">System metrics and platform analytics.</p>
      <div class="grid stats" style="margin-top:1.5rem">
        ${[['Registered Users', s.users], ['Guest Sessions', s.guests], ['Catalog Books', `${s.books} / ${s.targetBooks}`], ['Total Downloads', s.downloads]]
          .map(([l, v]) => `<div class="card stat"><span class="muted">${l}</span><b>${v}</b></div>`).join('')}
      </div>`);
  }

  // ---------- book modal ----------
  async function openBook(id) {
    const { book: b } = await api('/books/' + id);
    const coverUrl = b.coverUrl?.startsWith('/api/')
      ? (apiBase.startsWith('http') ? new URL(b.coverUrl, apiBase).toString() : b.coverUrl)
      : b.coverUrl;
    let fav = false, inLib = false;
    if (!isGuest()) {
      const [f, l] = await Promise.all([api('/favorites'), api('/library')]);
      fav = f.books.some((x) => x.id === b.id); inLib = l.books.some((x) => x.id === b.id);
    }
    const dlg = document.createElement('dialog');
    const paint = () => {
      dlg.innerHTML = `<div class="modal">
        ${coverMarkup(b.title, coverUrl)}
        <div>
          <h2>${esc(b.title)}</h2>
          <p class="muted" style="margin:0.2rem 0 0.8rem">By <b>${esc(b.author)}</b>${b.year ? ' • ' + (b.year < 0 ? Math.abs(b.year) + ' BC' : b.year) : ''}</p>
          <div style="display:flex; gap:0.4rem; flex-wrap:wrap; margin-bottom:1rem">
            <span class="chip">${esc(b.category)}</span>
            <span class="chip">${esc(b.license)}</span>
            <span class="chip">${esc(b.source)}</span>
          </div>
          <p style="line-height:1.6">${esc(b.description)}</p>
          <div class="actions">
            <button class="btn primary" id="dl">⬇ Download Book</button>
            ${isGuest() ? '' : `
              <button class="btn" id="fav">${fav ? '❤️ Favorited' : '🤍 Favorite'}</button>
              <button class="btn" id="lib">${inLib ? '✓ In Library' : '+ Add to Library'}</button>
            `}
            <button class="btn" id="close">Close</button>
          </div>
          <p class="muted" style="font-size:.8rem;margin-top:1rem">Remaining Downloads: <b>${state.downloads?.remaining ?? '–'}</b></p>
        </div>
      </div>`;
      dlg.querySelector('#close').onclick = () => dlg.close();
      dlg.querySelector('#dl').onclick = async () => {
        try {
          const d = await api(`/books/${b.id}/download`, { method: 'POST' });
          state.downloads = d.downloads; paint();
          if (window.Capacitor?.isNativePlatform?.()) window.location.href = d.downloadUrl;
          else window.open(d.downloadUrl, '_blank', 'noopener');
          toast('✨ Download starting!');
        } catch (e) { if (e.data?.downloads) state.downloads = e.data.downloads; paint(); toast(e.message); }
      };
      const f = dlg.querySelector('#fav'), l = dlg.querySelector('#lib');
      if (f) f.onclick = async () => { await api('/favorites/' + b.id, { method: fav ? 'DELETE' : 'PUT' }); fav = !fav; paint(); toast(fav ? 'Added to favorites' : 'Removed from favorites'); };
      if (l) l.onclick = async () => { await api('/library/' + b.id, { method: inLib ? 'DELETE' : 'PUT' }); inLib = !inLib; paint(); toast(inLib ? 'Added to your library' : 'Removed from library'); };
    };
    paint();
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => { dlg.remove(); if (state.route === 'library' || state.route === 'dashboard') render(); });
    dlg.showModal();
  }

  // ---------- router ----------
  const VIEWS = { dashboard: viewDashboard, catalog: viewCatalog, library: viewLibrary, ai: viewAI, admin: viewAdmin };
  async function render() {
    if (!state.token) return renderAuth();
    state.route = (location.hash.replace('#/', '') || 'dashboard');
    if (!VIEWS[state.route]) state.route = 'dashboard';
    try { await VIEWS[state.route](); }
    catch (e) { toast(e.message); }
  }
  async function boot() {
    try { await refreshMe(); } catch { clearSession(); }
    render();
  }
  document.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG') {
      const fallback = document.createElement('span');
      fallback.className = 'cover-fallback';
      fallback.textContent = e.target.dataset.fallback || '';
      e.target.replaceWith(fallback);
    }
  }, true);
  window.addEventListener('hashchange', render);
  state.token = store.get('token');
  state.token ? boot() : renderAuth();
})();