// "Найпохожіші обличчя": after a figure is built, show 4–6 of the closest SAFE official faces (POST /api/face-options, no Gemini),
// «Обрати» applies the face (POST /api/face-apply), locks the head (🔒 Голова) and rebuilds the 3D figure in the viewer iframe.
window.FacePicker = (() => {
  const $ = id => document.getElementById(id), esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let figId = null, busy = false, chosen = null, token = 0;
  const post = async (p, b) => { const r = await fetch('/api/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; };
  const msg = t => { const m = $('fpMsg'); if (m) m.textContent = t || ''; };
  function card(o) {
    const sel = o.part === chosen;
    return `<div class="fp-card${sel ? ' sel' : ''}" data-face="${esc(o.part)}"><img src="${esc(o.thumb)}" alt="${esc(o.title)}" loading="lazy" width="96" height="96"><div class="fp-label">${esc(o.label)}</div><span class="fp-score" title="Наскільки обличчя схоже на твоє за статтю / віком / виразом / окулярами / бровами">схожість ${o.score}%</span><button type="button" class="btn${sel ? '' : ' blue'}" data-pick="${esc(o.part)}" ${busy ? 'disabled' : ''}>${sel ? '✓ Обрано' : 'Обрати'}</button></div>`;
  }
  function paint(list, note) {
    const el = $('facePanel'); if (!el) return;
    if (!list.length) { el.innerHTML = note ? `<div class="fp"><h3>Найпохожіші обличчя</h3><p class="mut fp-hint">${esc(note)}</p></div>` : ''; return; }
    el.innerHTML = `<div class="fp" role="group" aria-label="Найпохожіші обличчя"><h3>🙂 Найпохожіші обличчя</h3><p class="mut fp-hint">Підібрано за статтю, віком, виразом, окулярами, бровами. Натисни «Обрати» — обличчя замінить поточне, голова зафіксується 🔒, 3D перебудується.</p><div class="fp-grid">${list.map(card).join('')}</div><div class="fp-msg mut" id="fpMsg" aria-live="polite"></div></div>`;
    el.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => pick(b.dataset.pick));
    el._list = list;
  }
  async function show(id, opts = {}) {
    figId = id; chosen = null; const my = ++token; const el = $('facePanel'); if (!el || !id) return;
    el.innerHTML = '<div class="fp"><h3>🙂 Найпохожіші обличчя</h3><p class="mut fp-hint"><span class="spin"></span>Підбираю…</p></div>';
    try { const r = await post('face-options', { id, n: opts.n || 6 }); if (my !== token) return; chosen = r.current && r.options.some(o => o.part === r.current) ? r.current : null; paint(r.options || [], r.note_uk); }
    catch (e) { if (my === token) el.innerHTML = '<div class="fp"><p class="mut fp-hint">Не вдалося підібрати обличчя (спробуй пізніше).</p></div>'; }
  }
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
  return { show, pick, get chosen() { return chosen; } };
})();
