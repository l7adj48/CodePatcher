'use strict';
/* الدفع إلى GitHub: commit واحد لكل الملفات المتغيرة عبر Git Data API */
const GH_KEY = 'CodePatcher_github';
function ghKey() { try { return (typeof commonRoot === 'function' && commonRoot()) || '_'; } catch (e) { return '_'; } }
function ghRaw() { let c = null; try { c = JSON.parse(localStorage.getItem(GH_KEY) || 'null'); } catch (e) { } return c || {}; }
/* لكل مشروع مستودعه المحفوظ؛ وإن لم يُضبط بعد فآخر مستودع استُعمل */
function ghCfg() {
  const c = ghRaw(), m = (c.map && c.map[ghKey()]) || c;
  return { token: c.token || '', repo: m.repo || '', branch: m.branch || 'main', dir: m.dir || '' };
}
function ghSaveCfg(n) {
  const c = ghRaw(); c.token = n.token; c.repo = n.repo; c.branch = n.branch; c.dir = n.dir;
  c.map = c.map || {}; c.map[ghKey()] = { repo: n.repo, branch: n.branch, dir: n.dir };
  try { localStorage.setItem(GH_KEY, JSON.stringify(c)); return true; } catch (e) { return false; }
}
function ghSetToken(t, login) { const c = ghRaw(); c.token = t; c.login = t ? (login || '') : ''; try { localStorage.setItem(GH_KEY, JSON.stringify(c)); return true; } catch (e) { return false; } }
async function ghVerify(t) {
  try { const u = await ghApi({ token: t }, 'GET', '/user'); return { ok: true, login: (u && u.login) || '' }; }
  catch (e) { return { ok: !(e && e.status === 401), login: '' }; }
}
function ghRepoOk(v) { return /^[\w.-]+\/[\w.-]+$/.test(v); }
function ghB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); }
async function ghBlobSha(u8) {
  if (!(window.crypto && crypto.subtle)) return '';
  const head = new TextEncoder().encode('blob ' + u8.length + '\0'), all = new Uint8Array(head.length + u8.length);
  all.set(head, 0); all.set(u8, head.length);
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
}
async function ghApi(c, method, path, body) {
  const r = await fetch('https://api.github.com' + path, {
    method, cache: 'no-store',
    headers: Object.assign({ 'Authorization': 'Bearer ' + c.token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  let j = null; try { j = await r.json(); } catch (e) { }
  if (!r.ok) { const e = new Error((j && j.message) || ('HTTP ' + r.status)); e.status = r.status; throw e; }
  return j;
}
function ghErrText(e) {
  const m = String(e && e.message || e), s = e && e.status;
  if (s === 401) return 'التوكن غير صالح أو منتهي';
  if (s === 403) return 'التوكن لا يملك صلاحية الكتابة (Contents: Read and write) أو تجاوزت الحد: ' + m;
  if (s === 404) return 'المستودع أو الفرع غير موجود، أو التوكن لا يشمل هذا المستودع';
  if (s === 409 && /empty/i.test(m)) return 'المستودع فارغ: أنشئ فيه أي ملف واحد من موقع GitHub أولاً ثم أعد المحاولة';
  if (e instanceof TypeError) return 'تعذّر الاتصال بـ GitHub — تحقق من الإنترنت';
  return m;
}
/* ملفات المشروع كما ستُرفع: الجذر المشترك يُحذف، ويُضاف مجلد المستودع الاختياري */
function ghCollect(c) {
  const cr = commonRoot(), enc = new TextEncoder(), pre = c.dir ? c.dir.replace(/^\/+|\/+$/g, '') + '/' : '';
  const fix = n => { n = n.replace(/^\/+/, ''); if (cr && n.startsWith(cr + '/')) n = n.slice(cr.length + 1); return pre + n; };
  const out = new Map();
  files.forEach(f => out.set(fix(f.name), enc.encode(withEol(f))));
  BIN.forEach((u8, n) => out.set(fix(n), u8));
  return out;
}
function ghDefMsg() { return 'تحديث من CodePatcher ' + new Date().toISOString().slice(0, 16).replace('T', ' '); }
/* msg: نص جاهز، أو undefined فيُسأل المستخدم */
async function githubPush(msg) {
  const cc = cur(); if (cc) cc.content = editor.value;
  const c = ghCfg();
  if (!c.token || !ghRepoOk(c.repo)) return githubDialog();
  if (!files.length) return toast('لا ملفات للدفع', 'err');
  if (msg === undefined) { msg = await ui.prompt('رسالة الـ commit', ghDefMsg(), 'دفع'); if (msg == null) return; }
  msg = String(msg).trim() || ghDefMsg();
  const R = '/repos/' + c.repo, say = t => toast(t, ''), brp = encodeURIComponent(c.branch).replace(/%2F/g, '/');
  try {
    say('جارٍ قراءة المستودع…');
    const ref = await ghApi(c, 'GET', R + '/git/ref/heads/' + brp);
    const head = ref.object.sha, cm = await ghApi(c, 'GET', R + '/git/commits/' + head);
    const tr = await ghApi(c, 'GET', R + '/git/trees/' + cm.tree.sha + '?recursive=1');
    const have = new Map(); (tr.tree || []).forEach(t => { if (t.type === 'blob') have.set(t.path, t.sha); });
    const all = ghCollect(c), changed = [];
    for (const [path, u8] of all) { const sha = tr.truncated ? '' : await ghBlobSha(u8); if (!sha || have.get(path) !== sha) changed.push([path, u8]); }
    if (!changed.length) return toast('لا تغييرات: المستودع مطابق للمشروع', 'ok');
    const entries = []; let done = 0, next = 0;
    const worker = async () => {
      while (next < changed.length) {
        const [path, u8] = changed[next++];
        const b = await ghApi(c, 'POST', R + '/git/blobs', { content: ghB64(u8), encoding: 'base64' });
        entries.push({ path, mode: '100644', type: 'blob', sha: b.sha });
        say('جارٍ الرفع ' + (++done) + '/' + changed.length);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const nt = await ghApi(c, 'POST', R + '/git/trees', { base_tree: cm.tree.sha, tree: entries });
    const nc = await ghApi(c, 'POST', R + '/git/commits', { message: msg, tree: nt.sha, parents: [head] });
    await ghApi(c, 'PATCH', R + '/git/refs/heads/' + brp, { sha: nc.sha });
    log('ok', 'GitHub: دُفع ' + changed.length + ' ملف إلى ' + c.repo + '@' + c.branch + ' (' + nc.sha.slice(0, 7) + ')');
    toast('تم الدفع: ' + changed.length + ' ملف في commit واحد', 'ok', { label: 'فتح الـ commit', fn: () => window.open('https://github.com/' + c.repo + '/commit/' + nc.sha, '_blank', 'noopener') });
  } catch (e) {
    log('err', 'GitHub: ' + ghErrText(e)); toast('فشل الدفع: ' + ghErrText(e), 'err');
  }
}
async function ghListRepos(c) {
  let out = [];
  for (let p = 1; p <= 3; p++) {
    const j = await ghApi(c, 'GET', '/user/repos?per_page=100&sort=pushed&page=' + p);
    out = out.concat(j); if (j.length < 100) break;
  }
  return out.filter(r => !r.permissions || r.permissions.push);
}
function ghSlug(v) { return String(v || '').trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]/g, '').replace(/^\.+/, '').slice(0, 80); }
/* ينشئ المستودع (مع README ليكون غير فارغ) ويفعّل Pages اختيارياً؛ فشل Pages لا يُفشل الإنشاء */
async function ghCreateRepo(c, st) {
  const r = await ghApi(c, 'POST', '/user/repos', { name: st.name, description: st.desc || '', private: !!st.priv, auto_init: true });
  const br = r.default_branch || 'main'; let pages = false;
  if (st.pages && !st.priv) { try { await ghApi(c, 'POST', '/repos/' + r.full_name + '/pages', { source: { branch: br, path: '/' } }); pages = true; } catch (e) { } }
  return { repo: r.full_name, branch: br, pages };
}
function ghCreateErr(e) {
  const s = e && e.status;
  if (s === 422) return 'الاسم مستخدم عندك مسبقاً أو غير صالح — جرّب اسماً آخر';
  if (s === 401) return 'التوكن غير صالح أو منتهي';
  if (s === 403 || s === 404) return 'التوكن لا يملك صلاحية إنشاء المستودعات (Administration: Read and write) — عدّل صلاحياته أو أنشئ المستودع من موقع GitHub';
  return ghErrText(e);
}
/* ===== نافذة GitHub: لوحة واحدة بعدة عروض (ربط / رئيسي / اختيار مستودع / إنشاء / إعدادات) ===== */
const GH_ATTR = ' dir="ltr" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false"';
function ghHead(sub) { return '<h3><svg class="ic" aria-hidden="true"><use href="#i-github"/></svg> GitHub ' + (sub ? uiSub(esc(sub)) : '') + '</h3>'; }
function ghChip(act, on, t) { return '<button type="button" class="btn' + (on ? ' primary' : '') + '" data-act="' + act + '">' + t + '</button>'; }
function ghRepoRows(list, q) {
  q = (q || '').trim().toLowerCase();
  const rows = list.map((r, i) => [r, i]).filter(x => !q || x[0].full_name.toLowerCase().includes(q))
    .map(x => uiRow('pick', 'github', esc(x[0].full_name), esc(x[0].default_branch) + (x[0].private ? ' · خاص' : ' · عام'), 'data-i="' + x[1] + '"')).join('');
  return rows || uiEmpty('لا نتائج');
}
const GH_ST = { view: '', repos: null, create: null };
async function githubDialog(view) {
  const c = ghCfg(), raw = ghRaw();
  if (!view) { GH_ST.create = null; view = !c.token ? 'connect' : ghRepoOk(c.repo) ? 'main' : 'pick'; }
  GH_ST.view = view;
  const go = v => githubDialog(v);
  const doOpen = u => window.open(u, '_blank', 'noopener');

  if (view === 'connect') {
    ui.show(ghHead() +
      uiNote('اربط حسابك لتدفع مشروعك إلى GitHub من هنا مباشرة.') +
      '<div class="slabel">التوكن</div><input type="password" id="ghTokIn"' + GH_ATTR + ' placeholder="github_pat_…">' +
      '<button type="button" class="btn primary" data-act="conn">ربط الحساب</button>' +
      '<button type="button" class="btn" data-act="mktok">إنشاء توكن من GitHub</button>' +
      uiNote('الصلاحيات: Contents بمستوى Read and write، وMetadata. وللمستودعات الجديدة Repository creation، وللموقع Pages. يُحفظ التوكن على هذا الجهاز فقط ولا يدخل في أي تصدير.') +
      '<button type="button" class="btn" data-ui="cancel">إغلاق</button>', async act => {
        if (act === 'mktok') return doOpen('https://github.com/settings/personal-access-tokens/new');
        if (act !== 'conn') return;
        const t = String($('ghTokIn').value || '').replace(/\s+/g, '');
        if (t.length < 20) return toast('انسخ التوكن كاملاً من GitHub', 'err');
        toast('جارٍ التحقق من التوكن…', '');
        const v = await ghVerify(t);
        if (!v.ok) return toast('التوكن غير صالح أو منتهي', 'err');
        if (!ghSetToken(t, v.login)) return toast('تعذّر حفظ التوكن في هذا المتصفح', 'err');
        toast('تم الربط' + (v.login ? ' — الحساب: ' + v.login : ''), 'ok');
        GH_ST.repos = null; go();
      });
    return;
  }

  if (view === 'main') {
    ui.show(ghHead(raw.login) +
      uiRow('repos', 'folder-open', esc(c.repo), esc(c.branch) + (c.dir ? ' · ' + esc(c.dir) : '') + ' — اضغط للتغيير') +
      '<div class="slabel">رسالة الـ commit</div><input type="text" id="ghMsg" value="' + esc(ghDefMsg()) + '">' +
      '<button type="button" class="btn primary" data-act="push">دفع المشروع إلى GitHub</button>' +
      '<div class="srow"><button type="button" class="btn" data-act="web">فتح المستودع</button><button type="button" class="btn" data-act="new">مستودع جديد</button><button type="button" class="btn" data-act="set">الإعدادات</button></div>' +
      '<button type="button" class="btn" data-ui="cancel">إغلاق</button>', act => {
        if (act === 'push') { const m = $('ghMsg').value; ui.close(null); return void setTimeout(() => githubPush(m), 120); }
        if (act === 'repos') return go('pick');
        if (act === 'new') return go('create');
        if (act === 'set') return go('set');
        if (act === 'web') return doOpen('https://github.com/' + c.repo);
      });
    return;
  }

  if (view === 'pick') {
    if (!GH_ST.repos) {
      ui.show(ghHead(raw.login) + uiEmpty('جارٍ جلب مستودعاتك…') + '<button type="button" class="btn" data-ui="cancel">إلغاء</button>');
      try { GH_ST.repos = await ghListRepos(c); }
      catch (e) { toast('تعذّر جلب المستودعات: ' + ghErrText(e), 'err'); return go(ghRepoOk(c.repo) ? 'main' : 'connect'); }
      if (GH_ST.view !== 'pick') return;
    }
    const list = GH_ST.repos;
    ui.show(ghHead(raw.login) +
      '<div class="slabel">اختر المستودع (' + list.length + ')</div><input type="text" id="ghQ"' + GH_ATTR + ' placeholder="ابحث…">' +
      uiScroll('<div id="ghList">' + ghRepoRows(list, '') + '</div>', 'lg') +
      '<div class="srow"><button type="button" class="btn" data-act="back">رجوع</button><button type="button" class="btn primary" data-act="new">مستودع جديد</button></div>', (act, el) => {
        if (act === 'back') return go(ghRepoOk(c.repo) ? 'main' : 'connect');
        if (act === 'new') return go('create');
        if (act !== 'pick') return;
        const r = list[+el.dataset.i], cur0 = ghCfg();
        ghSaveCfg({ token: c.token, repo: r.full_name, branch: r.default_branch || 'main', dir: r.full_name === cur0.repo ? cur0.dir : '' });
        toast('اخترت: ' + r.full_name, 'ok'); go('main');
      });
    $('ghQ').addEventListener('input', e => { $('ghList').innerHTML = ghRepoRows(list, e.target.value); });
    return;
  }

  if (view === 'create') {
    const st = GH_ST.create || (GH_ST.create = { name: ghSlug(ghKey() === '_' ? '' : ghKey()), desc: '', priv: false, pages: true });
    ui.show(ghHead(raw.login) +
      '<div class="slabel">اسم المستودع (حروف إنجليزية وأرقام و - فقط)</div><input type="text" id="ghNName"' + GH_ATTR + ' value="' + esc(st.name) + '">' +
      '<div class="slabel">الوصف (اختياري)</div><input type="text" id="ghNDesc" value="' + esc(st.desc) + '">' +
      '<div class="slabel">الظهور</div><div class="srow">' + ghChip('pub', !st.priv, 'عام') + ghChip('prv', st.priv, 'خاص') + '</div>' +
      '<div class="slabel">موقع المشروع (GitHub Pages)</div><div class="srow">' + ghChip('pgon', st.pages && !st.priv, 'تفعيل') + ghChip('pgoff', !st.pages || st.priv, 'بدون') + '</div>' +
      uiNote('Pages يحتاج مستودعاً عاماً في الحساب المجاني. يُنشأ المستودع ومعه ملف README ثم تدفع مشروعك إليه.') +
      '<div class="srow"><button type="button" class="btn" data-act="back">رجوع</button><button type="button" class="btn primary" data-act="mk">إنشاء</button></div>', async act => {
        const a = $('ghNName'), b = $('ghNDesc'); if (a) st.name = a.value; if (b) st.desc = b.value;
        if (act === 'back') return go(ghRepoOk(c.repo) ? 'main' : (GH_ST.repos ? 'pick' : 'connect'));
        if (act === 'pub') { st.priv = false; return go('create'); }
        if (act === 'prv') { st.priv = true; return go('create'); }
        if (act === 'pgon') { st.pages = true; return go('create'); }
        if (act === 'pgoff') { st.pages = false; return go('create'); }
        if (act !== 'mk') return;
        st.name = ghSlug(st.name); if (!st.name) return toast('اكتب اسماً بالإنجليزية', 'err');
        toast('جارٍ إنشاء المستودع…', '');
        try {
          const r = await ghCreateRepo(c, st);
          ghSaveCfg({ token: c.token, repo: r.repo, branch: r.branch, dir: '' });
          GH_ST.repos = null; GH_ST.create = null;
          log('ok', 'GitHub: أُنشئ المستودع ' + r.repo);
          toast('أُنشئ ' + r.repo + (st.pages && !st.priv ? (r.pages ? ' وفُعّل الموقع' : ' — تعذّر تفعيل Pages، فعّله من إعدادات المستودع') : ''), 'ok');
          go('main');
        } catch (e) { toast('فشل الإنشاء: ' + ghCreateErr(e), 'err'); }
      });
    return;
  }

  if (view === 'set') {
    ui.show(ghHead(raw.login) +
      '<div class="slabel">الفرع</div><input type="text" id="ghBr"' + GH_ATTR + ' value="' + esc(c.branch) + '">' +
      '<div class="slabel">مجلد داخل المستودع (اتركه فارغاً للجذر)</div><input type="text" id="ghDir"' + GH_ATTR + ' value="' + esc(c.dir) + '">' +
      '<div class="slabel">تغيير التوكن (اتركه فارغاً للإبقاء على الحالي)</div><input type="password" id="ghTokIn"' + GH_ATTR + ' placeholder="github_pat_…">' +
      '<button type="button" class="btn primary" data-act="save">حفظ</button>' +
      '<div class="srow"><button type="button" class="btn" data-act="back">رجوع</button><button type="button" class="btn dng" data-act="off">فصل الحساب</button></div>', async act => {
        if (act === 'back') return go(ghRepoOk(c.repo) ? 'main' : 'connect');
        if (act === 'off') { ghSetToken('', ''); GH_ST.repos = null; toast('تم فصل الحساب', 'ok'); return go('connect'); }
        if (act !== 'save') return;
        const t = String($('ghTokIn').value || '').replace(/\s+/g, '');
        if (t) {
          if (t.length < 20) return toast('انسخ التوكن كاملاً من GitHub', 'err');
          const v = await ghVerify(t); if (!v.ok) return toast('التوكن غير صالح أو منتهي', 'err');
          ghSetToken(t, v.login); GH_ST.repos = null;
        }
        const k = ghCfg();
        ghSaveCfg({ token: ghRaw().token, repo: k.repo, branch: $('ghBr').value.trim() || 'main', dir: $('ghDir').value.trim() });
        toast('حُفظت الإعدادات', 'ok'); go(ghRepoOk(k.repo) ? 'main' : 'pick');
      });
  }
}
