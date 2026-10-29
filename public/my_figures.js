// «Мої фігурки»: anonymous history (httpOnly cookie identity) — grid, 3D view per version, revert, delete; «Відкат до попередньої» after regeneration.
(() => {
  let CFG = { figures: false }, TOK = null;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const csrf = async () => TOK || (TOK = (await (await fetch('/api/my/csrf', { credentials: 'same-origin' })).json()).csrf);
  async function call(method, u, body) { const go = async () => fetch('/api/my' + u, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(method !== 'GET' ? { 'X-CSRF-Token': await csrf() } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let r = await go(); if (r.status === 403 && method !== 'GET') { TOK = null; r = await go(); } let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw new Error(j.error || 'Помилка'); return j; }
  const img = (b64, alt) => b64 ? `<img src="data:image/webp;base64,${esc(b64)}" alt="${esc(alt)}" loading="lazy">` : '<div class="mfNo">—</div>';
  const when = t => new Date(+t).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
  const RS = { generate: 'створено', regenerate: 'перегенерація', face_pick: 'вибір обличчя', manual: 'вручну', revert: 'відкат' };
  const warn = () => CFG.figures_persistent ? '' : '<div class="mfWarn" role="note">⚠ Збереження тимчасове до підключення бази: історія може зникнути після перезапуску сервера.</div>';
  const css = `#mfBtn{margin-left:auto;background:#181b23;color:#e9ecf2;border:1px solid #2a2f3c;border-radius:10px;padding:9px 14px;font-weight:700;cursor:pointer}#mfBtn:hover{border-color:#ffd500}
  #mfM{position:fixed;inset:0;background:#000b;display:none;z-index:70;overflow:auto}#mfM .b{background:#12151d;color:#e9ecf2;border:1px solid #2a2f3c;border-radius:14px;margin:4vh auto;padding:18px;width:min(1100px,94vw)}
  #mfM h2{margin:0 0 10px}.mfTop{display:flex;gap:10px;align-items:center}.mfTop .sp{flex:1}.mfX{background:none;border:0;color:#9aa3b5;font-size:26px;cursor:pointer}
  .mfGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}.mfCard{background:#181b23;border:1px solid #2a2f3c;border-radius:12px;padding:8px;cursor:pointer;text-align:left;color:inherit;font:inherit}.mfCard:hover{border-color:#ffd500}
  .mfPair{display:flex;gap:6px}.mfPair img,.mfPair .mfNo{width:50%;aspect-ratio:1;object-fit:contain;background:#0e1015;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#555}
  .mfT{font-weight:700;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mfS{color:#9aa3b5;font-size:12px}
  .mfWarn{background:#3a2a00;border:1px solid #ffd50066;color:#ffe680;border-radius:10px;padding:8px 12px;margin:8px 0}
  .mfView{display:flex;gap:14px;flex-wrap:wrap}.mfView iframe{flex:1 1 520px;height:min(70vh,640px);border:0;border-radius:12px;background:#0e1015}
  .mfSide{flex:0 1 300px}.mfTl{display:flex;gap:8px;overflow-x:auto;padding:8px 0}.mfV{flex:0 0 86px;background:#181b23;border:2px solid #2a2f3c;border-radius:10px;padding:4px;cursor:pointer;color:inherit;font:11px system-ui}
  .mfV img{width:100%;aspect-ratio:1;object-fit:contain}.mfV.sel{border-color:#0a6cff}.mfV.cur{box-shadow:0 0 0 2px #ffd500 inset}
  .mfBtn2{background:#0a6cff;color:#fff;border:0;border-radius:9px;padding:9px 14px;font-weight:700;cursor:pointer;margin:4px 6px 4px 0}.mfBtn2.red{background:#e3000b}.mfBtn2.gh{background:#2a2f3c}.mfBtn2:disabled{opacity:.5;cursor:default}`;
  let M, B, SEL = null;
  function ui() { if (M) return; const st = document.createElement('style'); st.textContent = css; document.head.append(st);
    const h = document.querySelector('header'); const btn = Object.assign(document.createElement('button'), { id: 'mfBtn', type: 'button', textContent: '🗂 Мої фігурки' }); btn.onclick = openList; (h || document.body).append(btn);
    M = Object.assign(document.createElement('div'), { id: 'mfM' }); M.setAttribute('role', 'dialog'); M.setAttribute('aria-label', 'Мої фігурки'); M.innerHTML = '<div class="b"></div>'; document.body.append(M); B = M.firstChild;
    M.addEventListener('click', e => { if (e.target === M) close(); }); document.addEventListener('keydown', e => { if (e.key === 'Escape' && M.style.display === 'block') close(); });
    B.addEventListener('click', onClick); }
  const close = () => { M.style.display = 'none'; B.innerHTML = ''; };
  const top = (t, back) => `<div class="mfTop">${back ? '<button class="mfBtn2 gh" data-a="list">← Усі фігурки</button>' : ''}<h2 class="sp">${esc(t)}</h2><button class="mfX" data-a="close" aria-label="Закрити">×</button></div>${warn()}`;
  async function openList() { ui(); M.style.display = 'block'; B.innerHTML = top('Мої фігурки') + '<p class="mfS">Завантаження…</p>';
    try { const j = await call('GET', '/figures'); CFG.figures_persistent = j.persistent;
      B.innerHTML = top('Мої фігурки') + (j.figures.length ? `<div class="mfGrid">${j.figures.map(f => `<button class="mfCard" data-f="${esc(f.id)}"><div class="mfPair">${img(f.photo_thumb, 'фото')}${img(f.png_thumb, 'фігурка')}</div><div class="mfT">${esc(f.title)}</div><div class="mfS">${when(f.updated_at)} · версій: ${esc(f.versions)}</div></button>`).join('')}</div>` : '<p class="mfS">Поки порожньо. Створи фігурку — вона з’явиться тут автоматично.</p>') + `<p class="mfS">Анонімно: без реєстрації й особистих даних, прив’язано до цього браузера. До ${esc(j.limits?.figures || 50)} фігурок, ${esc(j.limits?.versions || 20)} версій кожна.</p>`;
    } catch (e) { B.innerHTML = top('Мої фігурки') + `<div class="mfWarn">${esc(e.message)}</div>`; } }
  let FIG = null;
  async function openFig(id, n) { B.innerHTML = top('Фігурка', true) + '<p class="mfS">Завантаження…</p>';
    try { FIG = (await call('GET', '/figures/' + id)).figure; SEL = n || FIG.current_version; await paintFig(); } catch (e) { B.innerHTML = top('Фігурка', true) + `<div class="mfWarn">${esc(e.message)}</div>`; } }
  async function paintFig() { const f = FIG;
    B.innerHTML = top(f.title, true) + `<div class="mfView"><iframe id="mfV3" title="3D фігурка" allow="fullscreen"></iframe><div class="mfSide"><div class="mfPair">${img(f.photo_thumb, 'фото')}</div>
      <p class="mfS">Версія <b id="mfSelN">${SEL}</b> з ${f.versions.length ? f.versions[f.versions.length - 1].n : 0}${SEL === f.current_version ? ' (поточна)' : ''}</p>
      <button class="mfBtn2" data-a="revert" ${SEL === f.current_version ? 'disabled' : ''}>↺ Повернути цю версію</button><button class="mfBtn2 red" data-a="del">🗑 Видалити</button><p class="mfS" id="mfMsg" aria-live="polite"></p></div></div>
      <h3>Історія версій</h3><div class="mfTl">${f.versions.map(v => `<button class="mfV${v.n === SEL ? ' sel' : ''}${v.n === f.current_version ? ' cur' : ''}" data-v="${v.n}" title="${esc(RS[v.reason] || v.reason)} · ${when(v.created_at)}">${img(v.png_thumb, 'версія ' + v.n)}<div>#${v.n} ${esc(RS[v.reason] || v.reason)}</div></button>`).join('')}</div>`;
    try { const o = await call('POST', '/figures/' + f.id + '/open', { version: SEL }); const fr = B.querySelector('#mfV3'); if (fr) fr.src = o.viewer3d; } catch (e) { const m = B.querySelector('#mfMsg'); if (m) m.textContent = e.message; } }
  async function onClick(e) { const t = e.target.closest('[data-a],[data-f],[data-v]'); if (!t) return;
    if (t.dataset.f) return openFig(t.dataset.f); if (t.dataset.v) { SEL = +t.dataset.v; return paintFig(); }
    const a = t.dataset.a; if (a === 'close') return close(); if (a === 'list') return openList();
    if (a === 'revert') { t.disabled = true; try { const o = await call('POST', '/figures/' + FIG.id + '/revert', { version: SEL }); FIG.current_version = o.version; await paintFig(); B.querySelector('#mfMsg').textContent = '✔ Версію ' + o.version + ' зроблено поточною'; } catch (er) { B.querySelector('#mfMsg').textContent = er.message; t.disabled = false; } }
    if (a === 'del') { if (!confirm('Видалити фігурку з усією історією?')) return; try { await call('DELETE', '/figures/' + FIG.id); openList(); } catch (er) { B.querySelector('#mfMsg').textContent = er.message; } } }
  // after /api/generate (called from index.html): rollback button + temporary-storage note
  function afterGen(r) { const my = r && r.my; if (!my) return; const tb = document.querySelector('#gen .toolbar'); if (!tb) return;
    if (my.version > 1) { const b = Object.assign(document.createElement('button'), { className: 'btn', type: 'button', id: 'mfUndo', textContent: '↶ Відкат до попередньої' }); b.setAttribute('data-needs-idle', '');
      b.onclick = async () => { b.disabled = true; try { const o = await call('POST', '/figures/' + my.figure_id + '/revert', { version: my.version - 1 }); const fr = document.getElementById('v3'); if (typeof GEN !== 'undefined' && GEN) { GEN.id = o.out_id; GEN.roles = []; } if (fr) fr.src = o.viewer3d; if (window.FacePicker) window.FacePicker.setFigure(o.out_id); b.textContent = '✔ Повернуто версію ' + o.version; } catch (e) { b.textContent = '⚠ ' + e.message; b.disabled = false; } };
      tb.insertBefore(b, tb.children[1] || null); }
    if (!my.persistent && !document.getElementById('mfTmp')) { const p = document.createElement('p'); p.id = 'mfTmp'; p.className = 'mut'; p.textContent = '🗂 Збережено в «Мої фігурки» (збереження тимчасове до підключення бази).'; tb.after(p); } }
  window.MyFigs = { afterGen, open: openList };
  fetch('/config.json').then(r => r.json()).then(c => { CFG = c; if (c.figures) ui(); }).catch(() => {});
})();
