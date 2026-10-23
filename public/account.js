// Account UI (shown only when the server enables accounts). No secrets stored client-side; session is an httpOnly cookie.
(async () => {
  let cfg; try { cfg = await (await fetch('/config.json')).json(); } catch { return; } if (!cfg.accounts) return;
  const css = document.createElement('style'); css.textContent = `#acctBtn{position:fixed;top:12px;right:14px;z-index:50;background:#f5c518;color:#111;border:0;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer}
  #acctM{position:fixed;inset:0;background:#000a;display:none;align-items:center;justify-content:center;z-index:60}#acctM .b{background:#161a22;color:#eee;border:1px solid #333;border-radius:12px;padding:20px;width:min(360px,92vw);font:14px system-ui}
  #acctM input,#acctM select{width:100%;box-sizing:border-box;margin:5px 0 10px;padding:9px;border-radius:7px;border:1px solid #444;background:#0e1117;color:#eee}#acctM button{background:#f5c518;border:0;border-radius:7px;padding:9px 14px;font-weight:700;cursor:pointer;margin-right:6px}
  #acctM a{color:#f5c518;cursor:pointer}#acctMsg{min-height:18px;color:#ffb4a8;margin:6px 0}`; document.head.append(css);
  const btn = Object.assign(document.createElement('button'), { id: 'acctBtn', textContent: 'Увійти' }); document.body.append(btn);
  const m = Object.assign(document.createElement('div'), { id: 'acctM' }); m.innerHTML = '<div class="b"></div>'; document.body.append(m); const box = m.firstChild;
  m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
  const csrf = async () => (await (await fetch('/auth/csrf', { credentials: 'same-origin' })).json()).csrf;
  const post = async (u, body) => { const r = await fetch(u, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await csrf() }, body: JSON.stringify(body) }); let j = {}; try { j = await r.json(); } catch {} return { ok: r.ok, ...j }; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const val = id => box.querySelector('#' + id)?.value || undefined; const msg = t => { box.querySelector('#acctMsg').textContent = t || ''; };
  async function me() { const r = await fetch('/auth/me', { credentials: 'same-origin' }); return r.ok ? (await r.json()).user : null; }
  async function refresh() { const u = await me(); btn.textContent = u ? '👤 ' + u.email : 'Увійти'; return u; }
  const views = {
    login: () => `<h3>Вхід</h3><label>Email<input id="e" type="email" autocomplete="email"></label><label>Пароль<input id="p" type="password" autocomplete="current-password"></label><div id="acctMsg"></div><button data-a="login">Увійти</button><br><br><a data-v="register">Створити акаунт</a> · <a data-v="reset">Забули пароль?</a>`,
    register: () => `<h3>Реєстрація</h3><label>Email<input id="e" type="email" autocomplete="email"></label><label>Пароль (10+ символів, літери й цифри)<input id="p" type="password" autocomplete="new-password"></label><label>Запасний email (необов'язково)<input id="b" type="email"></label><label>Телефон (необов'язково, +380…)<input id="ph" type="tel"></label><div id="acctMsg"></div><button data-a="register">Створити</button> <a data-v="login">Вже є акаунт</a>`,
    reset: () => `<h3>Скидання пароля</h3><label>Email акаунта<input id="e" type="email"></label><label>Куди надіслати код<select id="ch"><option value="primary">Основний email</option><option value="backup">Запасний email</option>${cfg.sms_reset ? '<option value="sms">SMS</option>' : ''}</select></label><div id="acctMsg"></div><button data-a="reqcode">Надіслати код</button><hr style="border-color:#333"><label>Код з листа<input id="c" inputmode="numeric" maxlength="6"></label><label>Новий пароль<input id="np" type="password" autocomplete="new-password"></label><button data-a="confirm">Змінити пароль</button> <a data-v="login">Назад</a>`,
    me: u => `<h3>Акаунт</h3><p>${esc(u.email)}</p><p>Запасний email: ${esc(u.backup_email || '—')}<br>Телефон: ${esc(u.phone || '—')}</p><div id="acctMsg"></div><button data-a="logout">Вийти</button>`,
  };
  const show = (v, u) => { box.innerHTML = views[v](u); m.style.display = 'flex'; };
  box.addEventListener('click', async e => { const v = e.target.dataset.v, a = e.target.dataset.a; if (v) return show(v); if (!a) return; msg('…');
    let r;
    if (a === 'login') r = await post('/auth/login', { email: val('e'), password: val('p') });
    if (a === 'register') r = await post('/auth/register', { email: val('e'), password: val('p'), backup_email: val('b'), phone: val('ph') });
    if (a === 'logout') r = await post('/auth/logout', {});
    if (a === 'reqcode') { r = await post('/auth/reset/request', { email: val('e'), channel: val('ch') }); return msg(r.message || r.error); }
    if (a === 'confirm') { r = await post('/auth/reset/confirm', { email: val('e'), code: val('c'), new_password: val('np') }); if (r.ok) { msg('Пароль змінено. Увійдіть.'); return setTimeout(() => show('login'), 900); } return msg(r.error); }
    if (r && r.ok) { m.style.display = 'none'; refresh(); } else msg(r?.error || 'Помилка'); });
  btn.onclick = async () => { const u = await me(); u ? show('me', u) : show('login'); };
  refresh();
})();
