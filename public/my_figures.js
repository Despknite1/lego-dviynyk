// Розділ «Мої фігурки»: список збережених фігурок (модальне вікно) + смуга ВАРІАНТІВ у робочому екрані.
// Клік по фігурці → вона відкривається в РОБОЧОМУ ЕКРАНІ (фото з кешу, опис, 3D). Усі варіанти з одного фото — картки поруч,
// перемикання між ними нічого не видаляє. «Ще раз» / «Перегенерувати деталі» додають НОВИЙ варіант. Видалення — лише явне, з підтвердженням.
(() => {
  let CFG = { figures: false }, TOK = null;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const csrf = async () => TOK || (TOK = (await (await fetch('/api/my/csrf', { credentials: 'same-origin' })).json()).csrf);
  async function call(method, u, body) { const go = async () => fetch('/api/my' + u, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(method !== 'GET' ? { 'X-CSRF-Token': await csrf() } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let r = await go(); if (r.status === 403 && method !== 'GET') { TOK = null; r = await go(); } let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw new Error(j.error || 'Помилка'); return j; }
  // мініатюри: ліниве завантаження + асинхронне декодування (не гальмує прокрутку)
  const img = (b64, alt) => b64 ? `<img src="data:image/webp;base64,${esc(b64)}" alt="${esc(alt)}" loading="lazy" decoding="async">` : '<div class="mfNo">—</div>';
  const when = t => new Date(+t).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
  const RS = { generate: 'створено', regenerate: 'перегенерація', face_pick: 'вибір обличчя', manual: 'вручну', revert: 'копія' };
  const warn = () => CFG.figures_persistent ? '' : '<div class="mfWarn" role="note">⚠ Збереження тимчасове до підключення бази: історія може зникнути після перезапуску сервера.</div>';
  const css = `#mfBtn{margin-left:auto;background:#181b23;color:#e9ecf2;border:1px solid #2a2f3c;border-radius:10px;padding:9px 14px;font-weight:700;cursor:pointer}#mfBtn:hover{border-color:#ffd500}
  #mfM{position:fixed;inset:0;background:#000b;display:none;z-index:70;align-items:center;justify-content:center;padding:3vh 2vw}#mfM .b{background:#12151d;color:#e9ecf2;border:1px solid #2a2f3c;border-radius:14px;padding:18px;width:min(1100px,96vw);max-height:94vh;overflow-y:auto;overscroll-behavior:contain}
  #mfM h2{margin:0 0 10px}.mfTop{display:flex;gap:10px;align-items:center}.mfTop .sp{flex:1}.mfX{background:none;border:0;color:#9aa3b5;font-size:26px;cursor:pointer}
  .mfGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}.mfCard{position:relative;background:#181b23;border:1px solid #2a2f3c;border-radius:12px;padding:8px;cursor:pointer;text-align:left;color:inherit;font:inherit;content-visibility:auto;contain-intrinsic-size:auto 170px}.mfCard:hover{border-color:#ffd500}
  .mfPair{display:flex;gap:6px}.mfPair img,.mfPair .mfNo{width:50%;aspect-ratio:1;object-fit:contain;background:#0e1015;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#555}
  .mfT{font-weight:700;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:30px}.mfS{color:#9aa3b5;font-size:12px}
  .mfDel{position:absolute;right:8px;bottom:8px;border:1px solid #2a2f3c;background:#232836;color:#ff9b9b;border-radius:8px;width:30px;height:30px;cursor:pointer}.mfDel:hover{background:#e3000b;color:#fff}
  .mfWarn{background:#3a2a00;border:1px solid #ffd50066;color:#ffe680;border-radius:10px;padding:8px 12px;margin:8px 0}`;
  let M, B;
  function ui() { if (M) return; const st = document.createElement('style'); st.textContent = css; document.head.append(st);
    const h = document.querySelector('header'); const btn = Object.assign(document.createElement('button'), { id: 'mfBtn', type: 'button', textContent: '🗂 Мої фігурки' }); btn.onclick = openList; (h || document.body).append(btn);
    M = Object.assign(document.createElement('div'), { id: 'mfM' }); M.setAttribute('role', 'dialog'); M.setAttribute('aria-label', 'Мої фігурки'); M.innerHTML = '<div class="b"></div>'; document.body.append(M); B = M.firstChild;
    M.addEventListener('click', e => { if (e.target === M) close(); }); document.addEventListener('keydown', e => { if (e.key === 'Escape' && M.style.display === 'flex') close(); });
    B.addEventListener('click', onClick); }
  // модальне вікно: прокручується лише саме вікно (сторінка під ним заблокована) — одна смуга прокрутки
  const close = () => { M.style.display = 'none'; B.innerHTML = ''; document.documentElement.classList.remove('noscroll'); };
  const top = t => `<div class="mfTop"><h2 class="sp">${esc(t)}</h2><button class="mfX" data-a="close" aria-label="Закрити">×</button></div>${warn()}`;
  async function openList() { ui(); M.style.display = 'flex'; document.documentElement.classList.add('noscroll'); B.innerHTML = top('Мої фігурки') + '<p class="mfS">Завантаження…</p>';
    try { const j = await call('GET', '/figures'); CFG.figures_persistent = j.persistent;
      B.innerHTML = top('Мої фігурки') + (j.figures.length ? `<p class="mfS">Натисни на фігурку — вона відкриється в робочому екрані з фото та всіма варіантами.</p><div class="mfGrid">${j.figures.map(f => `<div class="mfCard" role="button" tabindex="0" data-f="${esc(f.id)}"><div class="mfPair">${img(f.photo_thumb, 'фото')}${img(f.png_thumb, 'фігурка')}</div><div class="mfT">${esc(f.title)}</div><div class="mfS">${when(f.updated_at)} · варіантів: ${esc(f.versions)}</div><button class="mfDel" type="button" data-del="${esc(f.id)}" title="Видалити фігурку" aria-label="Видалити фігурку">🗑</button></div>`).join('')}</div>` : '<p class="mfS">Поки порожньо. Створи фігурку — вона з’явиться тут автоматично.</p>') + `<p class="mfS">Анонімно: без реєстрації й особистих даних, прив’язано до цього браузера. До ${esc(j.limits?.figures || 50)} фігурок, ${esc(j.limits?.versions || 20)} варіантів кожна.</p>`;
    } catch (e) { B.innerHTML = top('Мої фігурки') + `<div class="mfWarn">${esc(e.message)}</div>`; } }
  async function del(id) { if (!confirm('Видалити фігурку з усіма варіантами? Цю дію не можна скасувати.')) return false; await call('DELETE', '/figures/' + id); if (CUR && CUR.f.id === id) { CUR = null; const v = document.getElementById('variants'); if (v) v.innerHTML = ''; } return true; }
  async function onClick(e) { const d = e.target.closest('[data-del]'); if (d) { e.stopPropagation(); try { if (await del(d.dataset.del)) openList(); } catch (er) { alert(er.message); } return; }
    const t = e.target.closest('[data-a],[data-f]'); if (!t) return; if (t.dataset.a === 'close') return close(); if (t.dataset.f) return loadFig(t.dataset.f); }
  // ---- робочий екран: фігурка з історії + смуга варіантів ----
  let CUR = null; // { f: фігурка з усіма варіантами, sel: номер показаного варіанта }
  async function loadFig(id) { B.innerHTML = top('Мої фігурки') + '<p class="mfS">Відкриваю в робочому екрані…</p>';
    try { const f = (await call('GET', '/figures/' + id)).figure; const o = await call('POST', '/figures/' + id + '/open', { version: f.current_version }); close();
      window.WS.restore(f, o); CUR = { f, sel: o.version }; paintStrip(); } catch (e) { B.innerHTML = top('Мої фігурки') + `<div class="mfWarn">${esc(e.message)}</div>`; } }
  function paintStrip() { const el = document.getElementById('variants'); if (!el || !CUR) return; const f = CUR.f, vs = f.versions || [];
    el.innerHTML = `<div class="vHead"><h3>🧩 Варіанти з цього фото (${vs.length})</h3><span class="mut grow">Клік — показати варіант. Нічого не зникає: «ще раз» додає новий.</span><button type="button" class="btn ghost sm" data-vdel title="Видалити фігурку з усіма варіантами">🗑 Видалити</button></div>
      <div class="vStrip">${vs.map(v => `<button type="button" class="vCard${v.n === CUR.sel ? ' sel' : ''}" data-vn="${v.n}" title="${esc(RS[v.reason] || v.reason)} · ${when(v.created_at)}" aria-pressed="${v.n === CUR.sel}">${img(v.png_thumb, 'варіант ' + v.n)}<div>#${v.n} ${esc(RS[v.reason] || v.reason)}</div></button>`).join('')}</div>`;
    el.querySelectorAll('[data-vn]').forEach(b => b.onclick = () => pickVariant(+b.dataset.vn));
    const dx = el.querySelector('[data-vdel]'); if (dx) dx.onclick = async () => { try { if (await del(f.id)) { if (typeof removePhoto === 'function') removePhoto(); } } catch (er) { alert(er.message); } }; }
  async function pickVariant(n) { if (!CUR || n === CUR.sel || (typeof GEN !== 'undefined' && GEN.busy)) return; const prev = CUR.sel; CUR.sel = n; paintStrip();
    try { const o = await call('POST', '/figures/' + CUR.f.id + '/open', { version: n }); window.WS.showVariant(o); } catch (e) { CUR.sel = prev; paintStrip(); alert(e.message); } }
  async function refresh(figId, sel) { try { const f = (await call('GET', '/figures/' + figId)).figure; CUR = { f, sel: sel || f.current_version }; paintStrip(); } catch {} }
  // після /api/generate (викликає index.html): оновити смугу варіантів (новий варіант — вибраний) + примітка про тимчасове збереження
  function afterGen(r) { const my = r && r.my; if (!my) return; refresh(my.figure_id, my.version);
    const tb = document.querySelector('#gen .toolbar'); if (tb && !my.persistent && !document.getElementById('mfTmp')) { const p = document.createElement('p'); p.id = 'mfTmp'; p.className = 'mut'; p.textContent = '🗂 Збережено в «Мої фігурки» (збереження тимчасове до підключення бази).'; tb.after(p); } }
  document.addEventListener('facepicked', () => { if (CUR) refresh(CUR.f.id, null); }); // вибір обличчя теж зберігається як новий варіант
  window.MyFigs = { afterGen, open: openList, load: loadFig, forget: () => { CUR = null; } };
  fetch('/config.json').then(r => r.json()).then(c => { CFG = c; if (c.figures) ui(); }).catch(() => {});
})();
