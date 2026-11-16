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
function ghSetToken(t) { const c = ghRaw(); c.token = t; try { localStorage.setItem(GH_KEY, JSON.stringify(c)); return true; } catch (e) { return false; } }
/* خانة التوكن: يُلصق ويُفحص ثم يُحفظ على الجهاز فقط */
async function ghAskToken() {
  const v = await ui.prompt('الصق توكن GitHub هنا', '', 'حفظ');
  const t = String(v || '').replace(/\s+/g, '');
  if (!t) return '';
  if (t.length < 20) { toast('هذا لا يبدو توكناً صحيحاً — انسخه كاملاً من GitHub', 'err'); return ''; }
  let who = '';
  try { const u = await ghApi({ token: t }, 'GET', '/user'); who = u && u.login ? u.login : ''; }
  catch (e) { if (e && e.status === 401) { toast('التوكن غير صالح أو منتهي', 'err'); return ''; } }
  if (!ghSetToken(t)) { toast('تعذّر حفظ التوكن في هذا المتصفح', 'err'); return ''; }
  toast('حُفظ التوكن' + (who ? ' — الحساب: ' + who : ''), 'ok');
  return t;
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
async function githubPush() {
  const cc = cur(); if (cc) cc.content = editor.value;
  let c = ghCfg();
  if (!c.token) { if (!(await ghAskToken())) return; c = ghCfg(); }
  if (!ghRepoOk(c.repo)) return githubPick();
  if (!files.length) return toast('لا ملفات للدفع', 'err');
  const msg = await ui.prompt('رسالة الـ commit', 'تحديث من CodePatcher ' + new Date().toISOString().slice(0, 16).replace('T', ' '), 'دفع');
  if (msg == null) return;
  const R = '/repos/' + c.repo, say = t => toast(t, '');
  try {
    say('جارٍ قراءة المستودع…');
    const ref = await ghApi(c, 'GET', R + '/git/ref/heads/' + encodeURIComponent(c.branch).replace(/%2F/g, '/'));
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
    const nc = await ghApi(c, 'POST', R + '/git/commits', { message: msg.trim() || 'تحديث من CodePatcher', tree: nt.sha, parents: [head] });
    await ghApi(c, 'PATCH', R + '/git/refs/heads/' + encodeURIComponent(c.branch).replace(/%2F/g, '/'), { sha: nc.sha });
    log('ok', 'GitHub: دُفع ' + changed.length + ' ملف إلى ' + c.repo + '@' + c.branch + ' (' + nc.sha.slice(0, 7) + ')');
    toast('تم الدفع: ' + changed.length + ' ملف في commit واحد', 'ok', { label: 'فتح الـ commit', fn: () => window.open('https://github.com/' + c.repo + '/commit/' + nc.sha, '_blank', 'noopener') });
  } catch (e) {
    log('err', 'GitHub: ' + ghErrText(e)); toast('فشل الدفع: ' + ghErrText(e), 'err');
  }
}
function githubSettings(thenPush) {
  const c = ghCfg();
  ui.show('<h3>إعدادات GitHub</h3>' +
    '<div class="slabel">المستودع (owner/repo)</div><input type="text" id="ghRepo" dir="ltr" autocapitalize="off" autocomplete="off" spellcheck="false" value="' + esc(c.repo) + '">' +
    '<div class="slabel">الفرع</div><input type="text" id="ghBranch" dir="ltr" autocapitalize="off" autocomplete="off" spellcheck="false" value="' + esc(c.branch) + '">' +
    '<div class="slabel">مجلد داخل المستودع (اتركه فارغاً للجذر)</div><input type="text" id="ghDir" dir="ltr" autocapitalize="off" autocomplete="off" spellcheck="false" value="' + esc(c.dir) + '">' +
    '<div class="slabel">التوكن' + (c.token ? ' (محفوظ — اتركه فارغاً للإبقاء عليه)' : '') + '</div><input type="password" id="ghTok" dir="ltr" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="github_pat_…">' +
    uiNote('أنشئ توكن من GitHub ← Settings ← Developer settings ← Fine-grained tokens. اختر مستودعك فقط، وصلاحية Contents: Read and write. يُحفظ على هذا الجهاز فقط ولا يدخل في أي تصدير.') +
    '<div class="srow"><button type="button" class="btn" data-ui="cancel">إلغاء</button><button type="button" class="btn primary" data-act="ghsave">حفظ</button></div>', (act) => {
      if (act !== 'ghsave') return;
      const repo = $('ghRepo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, ''), branch = $('ghBranch').value.trim() || 'main', dir = $('ghDir').value.trim(), tok = $('ghTok').value.trim() || c.token;
      if (!ghRepoOk(repo)) return toast('اكتب المستودع بصيغة owner/repo', 'err');
      if (!tok) return toast('ألصق التوكن', 'err');
      if (!ghSaveCfg({ token: tok, repo, branch, dir })) return toast('تعذّر حفظ الإعدادات في هذا المتصفح', 'err');
      ui.close(null); toast('حُفظت إعدادات GitHub', 'ok');
      if (thenPush === true) setTimeout(githubPush, 150);
    });
}
async function ghListRepos(c) {
  let out = [];
  for (let p = 1; p <= 3; p++) {
    const j = await ghApi(c, 'GET', '/user/repos?per_page=100&sort=pushed&page=' + p);
    out = out.concat(j); if (j.length < 100) break;
  }
  return out.filter(r => !r.permissions || r.permissions.push);
}
async function githubPick() {
  let c = ghCfg(); if (!c.token) { if (!(await ghAskToken())) return; c = ghCfg(); }
  toast('جارٍ جلب مستودعاتك…', '');
  let list; try { list = await ghListRepos(c); } catch (e) { return toast('تعذّر جلب المستودعات: ' + ghErrText(e), 'err'); }
  if (!list.length) return toast('لا مستودعات متاحة لهذا التوكن', 'err');
  const rows = list.map((r, i) => uiRow('pick', 'external', esc(r.full_name), esc(r.default_branch) + (r.private ? ' · خاص' : ' · عام'), 'data-i="' + i + '"')).join('');
  ui.show('<h3>اختر المستودع ' + uiSub(list.length) + '</h3>' + uiScroll(rows, 'lg') + '<button type="button" class="btn" data-ui="cancel">إلغاء</button>', (act, el) => {
    if (act !== 'pick') return;
    const r = list[+el.dataset.i], cur0 = ghCfg();
    ghSaveCfg({ token: c.token, repo: r.full_name, branch: r.default_branch || 'main', dir: r.full_name === cur0.repo ? cur0.dir : '' });
    ui.close(null); toast('اخترت: ' + r.full_name, 'ok'); setTimeout(githubDialog, 150);
  });
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
async function githubCreate() {
  let c = ghCfg(); if (!c.token) { if (!(await ghAskToken())) return; c = ghCfg(); }
  const st = { name: ghSlug(ghKey() === '_' ? '' : ghKey()), desc: '', priv: false, pages: true };
  const inp = (id, v) => '<input type="text" id="' + id + '" dir="ltr" autocapitalize="off" autocomplete="off" spellcheck="false" value="' + esc(v) + '">';
  const chip = (act, on, t) => '<button type="button" class="btn' + (on ? ' primary' : '') + '" data-act="' + act + '">' + t + '</button>';
  const draw = () => {
    ui.show('<h3>مستودع جديد</h3>' +
      '<div class="slabel">الاسم (حروف إنجليزية وأرقام و - فقط)</div>' + inp('ghNName', st.name) +
      '<div class="slabel">الوصف (اختياري)</div>' + inp('ghNDesc', st.desc) +
      '<div class="slabel">الظهور</div><div class="srow">' + chip('pub', !st.priv, 'عام') + chip('prv', st.priv, 'خاص') + '</div>' +
      '<div class="slabel">موقع المشروع (GitHub Pages)</div><div class="srow">' + chip('pgon', st.pages && !st.priv, 'تفعيل') + chip('pgoff', !st.pages || st.priv, 'بدون') + '</div>' +
      uiNote('Pages يحتاج مستودعاً عاماً في الحساب المجاني. يُنشأ المستودع ومعه ملف README ثم تدفع مشروعك إليه.') +
      '<div class="srow"><button type="button" class="btn" data-ui="cancel">إلغاء</button><button type="button" class="btn primary" data-act="mk">إنشاء</button></div>', async act => {
        const a = $('ghNName'), b = $('ghNDesc'); if (a) st.name = a.value; if (b) st.desc = b.value;
        if (act === 'pub') { st.priv = false; return draw(); }
        if (act === 'prv') { st.priv = true; return draw(); }
        if (act === 'pgon') { st.pages = true; return draw(); }
        if (act === 'pgoff') { st.pages = false; return draw(); }
        if (act !== 'mk') return;
        st.name = ghSlug(st.name); if (!st.name) return toast('اكتب اسماً بالإنجليزية', 'err');
        toast('جارٍ إنشاء المستودع…', '');
        try {
          const r = await ghCreateRepo(c, st);
          ghSaveCfg({ token: c.token, repo: r.repo, branch: r.branch, dir: '' });
          log('ok', 'GitHub: أُنشئ المستودع ' + r.repo);
          ui.close(null);
          toast('أُنشئ ' + r.repo + (st.pages && !st.priv ? (r.pages ? ' وفُعّل الموقع' : ' — تعذّر تفعيل Pages، فعّله من إعدادات المستودع') : ''), 'ok', { label: 'دفع المشروع الآن', fn: githubPush });
        } catch (e) { toast('فشل الإنشاء: ' + ghCreateErr(e), 'err'); }
      });
  };
  draw();
}
function githubDialog() {
  const c = ghCfg(), ok = !!(c.token && ghRepoOk(c.repo)), pages = ok ? 'https://' + c.repo.split('/')[0].toLowerCase() + '.github.io/' + c.repo.split('/')[1] + '/' : '';
  const I = n => '<svg class="ic" aria-hidden="true"><use href="#i-' + n + '"/></svg> ';
  ui.show('<h3>' + I('external') + 'GitHub ' + uiSub(ok ? esc(c.repo) + '@' + esc(c.branch) : 'غير مضبوط') + '</h3>' +
    uiRow('push', 'arrow-down', 'دفع المشروع إلى GitHub', ok ? 'commit واحد للملفات المتغيرة فقط' : 'يلزم ضبط المستودع والتوكن أولاً') +
    uiRow('tok', 'edit', 'التوكن', c.token ? 'محفوظ ✓ — اضغط لتغييره' : 'غير محفوظ — اضغط للصقه') +
    uiRow('new', 'plus', 'مستودع جديد', 'الاسم والوصف ثم يُنشأ ويُضبط تلقائياً') +
    uiRow('pick', 'folder-open', 'اختيار مستودع من حسابك') +
    uiRow('set', 'edit', 'إعدادات GitHub') +
    (ok ? uiRow('pages', 'external', 'فتح الموقع (GitHub Pages)', esc(pages)) : '') +
    uiNote('الملفات المحذوفة من المشروع لا تُحذف من المستودع. بعد الدفع يحتاج GitHub Pages إلى دقيقة ليُحدّث الموقع.') +
    '<button type="button" class="btn" data-ui="cancel">إغلاق</button>', act => {
      if (act === 'push') { ui.close(null); return void setTimeout(githubPush, 120); }
      if (act === 'tok') { ui.close(null); return void setTimeout(async () => { await ghAskToken(); githubDialog(); }, 120); }
      if (act === 'new') { ui.close(null); return void setTimeout(githubCreate, 120); }
      if (act === 'pick') { ui.close(null); return void setTimeout(githubPick, 120); }
      if (act === 'set') { ui.close(null); return void setTimeout(githubSettings, 120); }
      if (act === 'pages') { window.open(pages, '_blank', 'noopener'); }
    });
}
