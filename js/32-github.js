'use strict';
/* الدفع إلى GitHub: commit واحد لكل الملفات المتغيرة عبر Git Data API */
const GH_KEY = 'CodePatcher_github';
function ghCfg() {
  let c = null; try { c = JSON.parse(localStorage.getItem(GH_KEY) || 'null'); } catch (e) { }
  c = c || {}; return { token: c.token || '', repo: c.repo || '', branch: c.branch || 'main', dir: c.dir || '' };
}
function ghSaveCfg(c) { try { localStorage.setItem(GH_KEY, JSON.stringify(c)); return true; } catch (e) { return false; } }
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
  const c = ghCfg();
  if (!c.token || !ghRepoOk(c.repo)) return githubSettings(true);
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
function githubDialog() {
  const c = ghCfg(), ok = !!(c.token && ghRepoOk(c.repo)), pages = ok ? 'https://' + c.repo.split('/')[0].toLowerCase() + '.github.io/' + c.repo.split('/')[1] + '/' : '';
  const I = n => '<svg class="ic" aria-hidden="true"><use href="#i-' + n + '"/></svg> ';
  ui.show('<h3>' + I('external') + 'GitHub ' + uiSub(ok ? esc(c.repo) + '@' + esc(c.branch) : 'غير مضبوط') + '</h3>' +
    uiRow('push', 'arrow-down', 'دفع المشروع إلى GitHub', ok ? 'commit واحد للملفات المتغيرة فقط' : 'يلزم ضبط المستودع والتوكن أولاً') +
    uiRow('set', 'edit', 'إعدادات GitHub') +
    (ok ? uiRow('pages', 'external', 'فتح الموقع (GitHub Pages)', esc(pages)) : '') +
    uiNote('الملفات المحذوفة من المشروع لا تُحذف من المستودع. بعد الدفع يحتاج GitHub Pages إلى دقيقة ليُحدّث الموقع.') +
    '<button type="button" class="btn" data-ui="cancel">إغلاق</button>', act => {
      if (act === 'push') { ui.close(null); return void setTimeout(githubPush, 120); }
      if (act === 'set') { ui.close(null); return void setTimeout(githubSettings, 120); }
      if (act === 'pages') { window.open(pages, '_blank', 'noopener'); }
    });
}
