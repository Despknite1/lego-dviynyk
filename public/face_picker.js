// Бокова панель «Найпохожіші обличчя» поруч із 3D-переглядачем (відкривається ЛИШЕ з рядка «Голова» у списку деталей справа).
// "Найпохожіші обличчя": a side panel to the RIGHT of the 3D screen (its own column, the viewer shrinks — nothing overlaps the figure). Opens ONLY from the head
// (row «Голова» / button 🙂 in the parts list; the viewer iframe posts {lego_head}). Clicks on the 3D figure itself never open it. — it is no longer a separate block below.
// Shows 4–6 of the closest SAFE official faces (POST /api/face-options, no Gemini),
// «Обрати» applies the face (POST /api/face-apply), locks the head (🔒 Голова) and rebuilds the 3D figure in the viewer iframe.
window.FacePicker = (() => {
  const $ = id => document.getElementById(id), esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let figId = null, busy = false, chosen = null, token = 0, loaded = false, loading = false;
  const post = async (p, b) => { const r = await fetch('/api/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; };
  const msg = t => { const m = $('fpMsg'); if (m) m.textContent = t || ''; };
  function card(o) {
    const sel = o.part === chosen;
    return `<div class="fp-card${sel ? ' sel' : ''}" data-face="${esc(o.part)}"><img src="${esc(o.thumb)}" alt="${esc(o.title)}" loading="lazy" decoding="async" width="96" height="96"><div class="fp-label">${esc(o.label)}</div><span class="fp-score" title="Наскільки обличчя схоже на твоє за статтю / віком / виразом / окулярами / бровами">схожість ${o.score}%</span><button type="button" class="btn${sel ? '' : ' blue'}" data-pick="${esc(o.part)}" ${busy ? 'disabled' : ''}>${sel ? '✓ Обрано' : 'Обрати'}</button></div>`;
  }
  function paint(list, note) {
    const el = $('facePanel'); if (!el) return;
    if (!list.length) { el.innerHTML = `<div class="fp"><div class="fp-head"><h3>🙂 Найпохожіші обличчя</h3><button type="button" class="fp-x" data-fp-close aria-label="Закрити">×</button></div><p class="mut fp-hint">${esc(note || 'Підходящих облич не знайдено.')}</p></div>`; const x0 = el.querySelector('[data-fp-close]'); if (x0) x0.onclick = close; return; }
    el.innerHTML = `<div class="fp" role="group" aria-label="Найпохожіші обличчя"><div class="fp-head"><h3>🙂 Найпохожіші обличчя</h3><button type="button" class="fp-x" data-fp-close aria-label="Закрити" title="Закрити (Esc)">×</button></div><p class="mut fp-hint">Підібрано за статтю, віком, виразом, окулярами, бровами. «Обрати» — обличчя замінить поточне, голова зафіксується 🔒, 3D перебудується.</p><div class="fp-grid">${list.map(card).join('')}</div><div class="fp-msg mut" id="fpMsg" aria-live="polite"></div></div>`;
    el.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => pick(b.dataset.pick));
    const x = el.querySelector('[data-fp-close]'); if (x) x.onclick = close;
    el._list = list;
  }
  const head = () => '<div class="fp-head"><h3>🙂 Найпохожіші обличчя</h3><button type="button" class="fp-x" data-fp-close aria-label="Закрити" title="Закрити (Esc)">×</button></div>';
  const isOpen = () => { const el = $('facePanel'); return !!(el && el.classList.contains('open')); };
  let closedAt = 0; // після закриття ширина 3D змінюється, і рядок «Голова» може «наїхати» під нерухомий курсор — не відкриваємо панель знову від такого наведення
  function close() { const el = $('facePanel'); if (el) el.classList.remove('open'); closedAt = Date.now(); }
  // a new figure: forget the old list, close the flyout (lazy: nothing is fetched until the head is hovered / clicked)
  function setFigure(id) { figId = id || null; chosen = null; token++; loaded = false; loading = false; busy = false; const el = $('facePanel'); if (el) { el.classList.remove('open'); el.innerHTML = ''; el._list = null; } }
  async function load(n) {
    const el = $('facePanel'); if (!el || !figId || loading) return; loading = true; const my = token;
    el.innerHTML = '<div class="fp">' + head() + '<p class="mut fp-hint"><span class="spin"></span>Підбираю…</p></div>'; const x = el.querySelector('[data-fp-close]'); if (x) x.onclick = close;
    try { const r = await post('face-options', { id: figId, n: n || 6 }); if (my !== token) return; chosen = r.current && r.options.some(o => o.part === r.current) ? r.current : null; loaded = true; paint(r.options || [], r.note_uk); }
    catch (e) { if (my === token) { el.innerHTML = '<div class="fp">' + head() + '<p class="mut fp-hint">Не вдалося підібрати обличчя (спробуй пізніше).</p></div>'; const x2 = el.querySelector('[data-fp-close]'); if (x2) x2.onclick = close; } }
    finally { if (my === token) loading = false; }
  }
  // open the flyout (and fetch the options the first time for this figure)
  function open() {
    const el = $('facePanel'); if (!el || !figId) return; const was = el.classList.contains('open'); el.classList.add('open');
    if (!loaded && !loading) load(); else if (!was && matchMedia('(max-width:760px)').matches) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const show = (id, opts = {}) => { setFigure(id); open(); };
  addEventListener('message', e => { if (e.origin !== location.origin || !e.data || !e.data.lego_head) return; const v = e.data.lego_head; if (!v || v.id !== figId) return; if (v.open) { if (v.src === 'row' && Date.now() - closedAt < 900) return; open(); } else close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) close(); });
  const waitReady = async (f, ms = 90000) => { const t0 = Date.now(); await new Promise(z => setTimeout(z, 60)); while (Date.now() - t0 < ms) { const w = f.contentWindow; if (w && w.READY === true) return true; if (w && w.READY === 'error') return false; await new Promise(z => setTimeout(z, 150)); } return false; };
  async function pick(part) {
    if (busy || !figId) return; const el = $('facePanel'), list = (el && el._list) || []; busy = true; const my = token; paint(list); el.querySelectorAll('[data-pick]').forEach(b => b.disabled = true); msg('Застосовую обличчя…');
    try {
      const r = await post('face-apply', { id: figId, part }); if (my !== token) return;
      const f = $('v3'); if (f && f.contentWindow && typeof f.contentWindow.rebuild === 'function') { f.contentWindow.rebuild(r.spec); await waitReady(f); }
      if (typeof GEN !== 'undefined' && GEN) { if (!GEN.roles.includes('Голова')) GEN.roles.push('Голова'); if (r.signature) { GEN.sig = r.signature; if (GEN.hist.length) GEN.hist[GEN.hist.length - 1] = r.signature; } try { f.contentWindow.postMessage({ set_locks: GEN.roles }, location.origin); } catch {} if (typeof paintLockBar === 'function') paintLockBar(); }
      chosen = part; busy = false; paint(list); msg('Готово: обличчя застосовано, голову зафіксовано 🔒. «Згенерувати ще раз» залишить цю голову.');
      document.dispatchEvent(new CustomEvent('facepicked', { detail: { id: figId, part } }));
    } catch (e) { busy = false; paint(list); msg('Не вдалося застосувати обличчя: ' + (e && e.message ? e.message : 'помилка')); }
    busy = false;
  }
  return { show, setFigure, open, close, pick, isOpen, get chosen() { return chosen; } };
})();
