'use strict';
/* حزمة نصية واحدة: تصدير المشروع كنص + خريطة ملفات، واستيراد نص لتوليد الملفات.
   الصيغة:  === FILE: path (N lines) ===  ثم المحتوى. القراءة في parseBundle (12-patch-ui.js). */
const BUNDLE_HEAD = /^\s*# CodePatcher Bundle/;
/* بعد ui.close يلزم انتظار قصير قبل فتح نافذة أخرى (سباق history.back في ui) */
const bundleWait = ms => new Promise(r => setTimeout(r, ms));
const bundleOpt = { instr: true, limit: 0 };
const bLines = c => { const t = String(c).replace(/\s+$/, ''); return t === '' ? 0 : t.split('\n').length; };
function estTokens(s) { let a = 0, o = 0; for (let i = 0; i < s.length; i++) (s.charCodeAt(i) < 128 ? a++ : o++); return Math.ceil(a / 3.6 + o / 1.6); }

function bundleTree(names, bins) {
  const T = {};
  const add = (n, b) => { const p = n.split('/').filter(Boolean); let o = T; p.forEach((seg, i) => { if (i === p.length - 1) o[seg] = b ? 'b' : 'f'; else { if (typeof o[seg] !== 'object') o[seg] = {}; o = o[seg]; } }); };
  names.forEach(n => add(n, false)); bins.forEach(n => add(n, true));
  const isD = v => typeof v === 'object', lines = [];
  const walk = (o, pre) => {
    const ks = Object.keys(o).sort((a, b) => (isD(o[b]) - isD(o[a])) || (a < b ? -1 : a > b ? 1 : 0));
    ks.forEach((k, i) => {
      const last = i === ks.length - 1;
      lines.push(pre + (last ? '└── ' : '├── ') + k + (isD(o[k]) ? '/' : '') + (o[k] === 'b' ? '  [binary]' : ''));
      if (isD(o[k])) walk(o[k], pre + (last ? '    ' : '│   '));
    });
  };
  walk(T, ''); return lines.join('\n');
}

function bundleInstr(n) {
  return '# Instructions: this is a full project snapshot. Read it, then follow my request.\n' +
    '# When you change files, reply with each CHANGED file in full: a line like  === FILE: path/to/file ===  then its complete content\n' +
    '# (no placeholders, no omitted parts, nothing else between files). Do not repeat unchanged files.' +
    (n > 1 ? '\n# The project is sent in ' + n + ' parts: wait until all parts arrive before answering.' : '');
}

/* يبني الأجزاء: limit = حد التوكنات التقريبي للجزء (0 = كل شيء في جزء واحد). الملف الواحد لا يُقسَّم. */
function bundleBuild(sel, limit, instr) {
  const fl = files.filter(f => !sel || f.name.startsWith(sel + '/')).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const bins = [...BIN.keys()].map(n => n.replace(/^\/+/, '')).filter(n => !sel || n.startsWith(sel + '/')).sort();
  const blocks = fl.map(f => { const t = nl(f.content).replace(/\s+$/, ''); return '=== FILE: ' + f.name + ' (' + bLines(t) + ' lines) ===\n' + t + '\n\n'; });
  const root = sel || commonRoot(fl) || 'Project';
  const meta = '# المشروع: ' + root + ' — ' + fl.length + ' ملف' + (bins.length ? ' + ' + bins.length + ' ثنائي' : '') + ' — ' + new Date().toISOString().slice(0, 10);
  const head1 = N => '# CodePatcher Bundle v1\n' + meta + (N > 1 ? ' — جزء 1/' + N : '') + '\n' + (instr ? bundleInstr(N) + '\n' : '') +
    '\n## خريطة الملفات\n' + bundleTree(fl.map(f => f.name), bins) + '\n\n## محتوى الملفات\n\n';
  const groups = [[]]; let tok = estTokens(head1(2));
  blocks.forEach(b => {
    const bt = estTokens(b), g = groups[groups.length - 1];
    if (limit && g.length && tok + bt > limit) { groups.push([b]); tok = 40 + bt; } else { g.push(b); tok += bt; }
  });
  const N = groups.length;
  return groups.map((g, i) => {
    const head = i === 0 ? head1(N) : '# CodePatcher Bundle v1 (تكملة)\n# جزء ' + (i + 1) + '/' + N + ' — الخريطة في الجزء الأول\n\n';
    const tail = N > 1 ? '# — نهاية الجزء ' + (i + 1) + '/' + N + (i + 1 < N ? ' — سيصل الجزء التالي' : ' — انتهى') + ' —\n' : '';
    return head + g.join('') + tail;
  });
}

function bundleMapText(sel) {
  const fl = files.filter(f => !sel || f.name.startsWith(sel + '/')).map(f => f.name), bins = [...BIN.keys()].map(n => n.replace(/^\/+/, '')).filter(n => !sel || n.startsWith(sel + '/'));
  return '# CodePatcher Map\n# ' + (sel || commonRoot() || 'Project') + ' — ' + fl.length + ' ملف\n\n' + bundleTree(fl, bins) + '\n';
}
function downloadText(text, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); a.download = name; a.style.display = 'none';
  document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function exportBundleDialog(sel) {
  const c = cur(); if (c) c.content = editor.value;
  sel = sel || '';
  if (!files.some(f => !sel || f.name.startsWith(sel + '/'))) return toast('لا ملفات للتصدير', 'err');
  const I = n => '<svg class="ic" aria-hidden="true"><use href="#i-' + n + '"/></svg> ';
  const draw = () => {
    const parts = bundleBuild(sel, bundleOpt.limit, bundleOpt.instr), all = parts.join('\n');
    const chip = (v, t) => '<button type="button" class="btn' + (bundleOpt.limit === v ? ' primary' : '') + '" data-act="lim" data-v="' + v + '">' + t + '</button>';
    const partsHtml = parts.length > 1
      ? parts.map((p, i) => uiRow('cp', 'copy', 'نسخ الجزء ' + (i + 1) + '/' + parts.length + ' ' + uiSub('~' + estTokens(p) + ' tok'), '', 'data-i="' + i + '"')).join('')
      : uiRow('cp', 'copy', 'نسخ', '', 'data-i="0"');
    ui.show('<h3>' + I('file-md') + 'نص واحد ' + uiSub('· ~' + estTokens(all) + ' tok · ' + all.length + ' ch') + '</h3>' +
      uiNote('تقسيم لأجزاء (توكنات تقريبية لكل جزء)') +
      '<div class="srow">' + chip(0, 'كامل') + chip(6000, '6k') + chip(12000, '12k') + chip(24000, '24k') + '</div>' +
      (parts.length > 3 ? uiScroll(partsHtml, 'sm') : partsHtml) +
      uiRow('map', 'list', 'نسخ خريطة الملفات فقط (بدون محتوى)') +
      uiRow('dl', 'arrow-down', 'تنزيل ملف .txt') +
      uiRow('ins', bundleOpt.instr ? 'check-square' : 'square', 'تعليمات للنموذج في البداية') +
      uiNote('الصور والملفات الثنائية تظهر في الخريطة فقط. الملف الأكبر من الحد يبقى في جزء واحد.') +
      '<button type="button" class="btn" data-ui="cancel">إغلاق</button>', (act, el) => {
        if (act === 'lim') { bundleOpt.limit = +el.dataset.v; return draw(); }
        if (act === 'ins') { bundleOpt.instr = !bundleOpt.instr; return draw(); }
        if (act === 'cp') { const t = parts[+el.dataset.i || 0]; return copyToClipboard(t).then(() => toast('نُسخ' + (parts.length > 1 ? ' الجزء ' + ((+el.dataset.i || 0) + 1) + '/' + parts.length : '') + ' (~' + estTokens(t) + ' توكن)', 'ok')); }
        if (act === 'map') { const t = bundleMapText(sel); return copyToClipboard(t).then(() => toast('نُسخت الخريطة (~' + estTokens(t) + ' توكن)', 'ok')); }
        if (act === 'dl') { downloadText(all, (cleanName(sel ? sel.split('/').pop() : commonRoot()) || 'project') + '-bundle.txt'); return toast('نُزّل الملف', 'ok'); }
      });
  };
  draw();
}

/* ===== الاستيراد ===== */
function bundleSafeName(n) {
  n = String(n || '').trim().replace(/\\+/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  if (!n || n.split('/').some(s => s === '..' || s === '')) return '';
  return n;
}
function bundleCleanSub(v) {
  return String(v || '').replace(/\\+/g, '/').split('/')
    .map(s => s.replace(/[:*?"<>|\u0000-\u001f]/g, '').trim().replace(/\s+/g, '-'))
    .filter(s => s && s !== '.' && s !== '..').join('/');
}
function unwrapBundleFence(raw) {
  const s = nl(raw), tr = s.trim();
  if (/^```[^\n]*\n[\s\S]*\n?```$/.test(tr)) {
    const inner = tr.replace(/^```[^\n]*\n?/, '').replace(/\n?```\s*$/, '');
    if (inner.trim()) return inner;
  }
  const L = s.split('\n');
  let firstMark = -1;
  for (let i = 0; i < L.length; i++) { if (bundleMark(L[i])) { firstMark = i; break; } }
  if (firstMark > 0) {
    const fences = [];
    for (let i = 0; i < firstMark; i++) if (/^\s*```/.test(L[i])) fences.push(i);
    if (fences.length % 2 === 1) {
      let lastNonEmpty = L.length - 1;
      while (lastNonEmpty > firstMark && !L[lastNonEmpty].trim()) lastNonEmpty--;
      if (lastNonEmpty > firstMark && /^\s*```\s*$/.test(L[lastNonEmpty])) {
        const cand = L.slice(fences[fences.length - 1] + 1, lastNonEmpty).join('\n');
        if (parseBundle(cand)) return cand;
      }
    }
  }
  return s;
}

/* خريطة شجرية (├── └── │ أو مسافات أو قائمة مسارات) ← { files, dirs(فارغة), bins } */
function parseTreeMap(text) {
  const nodes = [], bins = [], stack = [];
  nl(text).split('\n').forEach(raw => {
    if (!raw.trim() || /^\s*#/.test(raw)) return;
    const pre = /^[\s│├└─|`+\-\\¦]*/.exec(raw)[0];
    let name = raw.slice(pre.length).replace(/\s+#.*$/, '').replace(/\s+(?:←|<-+|—|\/\/).*$/, '').trim();
    const isBin = /\s*\[binary\]\s*$/i.test(name); name = name.replace(/\s*\[binary\]\s*$/i, '').trim();
    if (!name || name.length > 120 || /[<>:"|?*\u0000-\u001f]/.test(name)) return;
    const indent = pre.length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1]; if (parent) { parent.isDir = true; parent.kids = true; }
    const isDir = /\/$/.test(name), clean = name.replace(/\/+$/, '');
    if (!clean) return;
    const node = { indent, path: (parent ? parent.path + '/' : '') + clean, isDir, kids: false, bin: isBin };
    stack.push(node); nodes.push(node);
  });
  return {
    files: nodes.filter(n => !n.isDir && !n.bin).map(n => n.path),
    dirs: nodes.filter(n => n.isDir && !n.kids).map(n => n.path),
    bins: nodes.filter(n => n.bin).map(n => n.path),
    looksTree: nodes.length > 0 && nodes.some(n => n.path.includes('/') || /[.]/.test(n.path) || n.isDir)
  };
}

/* يحوّل النص إلى خطة: [{ rel, content, warn, empty }] (rel بلا جذر المشروع) + اسم جذر مقترح */
function bundlePlan(text) {
  const cleaned = unwrapBundleFence(text);
  const blocks = parseBundle(cleaned), warns = [], bad = []; let raw = [], bins = [], fromMap = false;
  if (blocks && blocks.length) {
    blocks.forEach(p => { const n = bundleSafeName(p.name); if (!n) { bad.push(p.name); return; } if (p.warn) warns.push(n + ': ' + p.warn); raw.push({ path: n, content: p.content }); });
  } else {
    const m = parseTreeMap(cleaned); if (!m.looksTree) return null;
    fromMap = true; bins = m.bins;
    m.files.forEach(f => { const n = bundleSafeName(f); if (n) raw.push({ path: n, content: '', empty: true }); else bad.push(f); });
    m.dirs.forEach(d => { const n = bundleSafeName(d); if (n) raw.push({ path: n + '/.gitkeep', content: '', empty: true }); else bad.push(d); });
  }
  const seen = new Map(); raw.forEach(r => { if (seen.has(r.path)) warns.push(r.path + ': مكرر — اعتُمدت الأخيرة'); seen.set(r.path, r); });
  raw = [...seen.values()];
  if (!raw.length) return null;
  const tops = new Set(raw.map(r => r.path.includes('/') ? r.path.split('/')[0] : null));
  const root = (tops.size === 1 && !tops.has(null)) ? [...tops][0] : '';
  const list = raw.map(r => ({ rel: root ? r.path.slice(root.length + 1) : r.path, content: r.content, empty: !!r.empty })).filter(r => r.rel);
  return { list, root, warns, bad, bins, fromMap };
}

async function saveBundleToDeviceDir(items) {
  if (typeof window.showDirectoryPicker !== 'function' || window.self !== window.top) return { status: 'na' };
  try {
    const rootDir = await window.showDirectoryPicker({ mode: 'readwrite' });
    let count = 0;
    for (const it of items) {
      const segs = it.path.split('/').filter(Boolean), fname = segs.pop();
      if (!fname) continue;
      let d = rootDir;
      for (const s of segs) d = await d.getDirectoryHandle(s, { create: true });
      const fh = await d.getFileHandle(fname, { create: true });
      const w = await fh.createWritable();
      await w.write(it.content);
      await w.close();
      count++;
    }
    return { status: 'ok', count, dirName: rootDir.name || '' };
  } catch (e) {
    if (e && e.name === 'AbortError') return { status: 'abort' };
    return { status: 'fail', message: e && e.message };
  }
}

async function saveBundleAsZip(items, zipBase) {
  const enc = new TextEncoder();
  const entries = items.map(it => ({ name: it.path.replace(/^\/+/, ''), data: enc.encode(it.content) }));
  const zblob = await zipC(entries);
  const fileName = (cleanName(zipBase) || 'generated-files') + '.zip';
  const canPick = typeof window.showSaveFilePicker === 'function' && window.self === window.top;
  if (canPick) {
    try {
      const h = await showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }] });
      const w = await h.createWritable(); await w.write(zblob); await w.close();
      return { status: 'ok', method: 'pick', fileName: h.name || fileName, count: entries.length };
    } catch (e) {
      if (e && e.name === 'AbortError') return { status: 'abort' };
    }
  }
  const zfile = (typeof File === 'function') ? new File([zblob], fileName, { type: 'application/zip' }) : null;
  if (zfile && typeof tryShare === 'function') {
    const r = await tryShare(zfile, fileName);
    if (r === 'ok') return { status: 'ok', method: 'share', fileName, count: entries.length };
    if (r === 'abort') return { status: 'abort' };
  }
  const url = URL.createObjectURL(zblob);
  const a = document.createElement('a'); a.href = url; a.download = fileName; a.style.display = 'none';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { status: 'ok', method: 'dl', fileName, count: entries.length };
}

async function saveBundleSingleFile(relPath, content) {
  const fname = relPath.split('/').pop() || 'file.txt';
  const canPick = typeof window.showSaveFilePicker === 'function' && window.self === window.top;
  if (canPick) {
    try {
      const h = await showSaveFilePicker({ suggestedName: fname });
      const w = await h.createWritable(); await w.write(content); await w.close();
      return { status: 'ok', method: 'pick', fileName: h.name || fname };
    } catch (e) {
      if (e && e.name === 'AbortError') return { status: 'abort' };
    }
  }
  const sf = (typeof File === 'function') ? new File([content], fname, { type: 'text/plain;charset=utf-8' }) : null;
  if (sf && typeof tryShare === 'function') {
    const r = await tryShare(sf, fname);
    if (r === 'ok') return { status: 'ok', method: 'share', fileName: fname };
    if (r === 'abort') return { status: 'abort' };
  }
  downloadText(content, fname);
  return { status: 'ok', method: 'dl', fileName: fname };
}

async function importBundleText(text, fresh, prePlan) {
  if (!prePlan) await bundleWait(130);
  const plan = prePlan || bundlePlan(text);
  if (!plan) { toast('لم أجد كتل === FILE: === ولا خريطة ملفات في النص', 'err'); return 0; }
  if (plan.list.length > MAX_COUNT) { plan.warns.push('تجاوز حد ' + MAX_COUNT + ' ملف — تُركت الزيادة'); plan.list.length = MAX_COUNT; }
  const I = n => '<svg class="ic" aria-hidden="true"><use href="#i-' + n + '"/></svg> ';
  let name = bundleCleanSub(plan.root) || '';
  let loc = fresh ? '' : (typeof treeCwd === 'string' ? treeCwd : '');
  const extra = [];
  const canDir = typeof window.showDirectoryPicker === 'function' && window.self === window.top;
  const finalOf = (r, nm, lc) => bundleSafeName([lc, nm, r.rel].filter(Boolean).join('/'));
  const devPathOf = (r, nm) => bundleSafeName([nm, r.rel].filter(Boolean).join('/'));
  const stats = (nm, lc) => {
    const its = plan.list.map(r => ({ r, path: finalOf(r, nm, lc) })).filter(x => x.path);
    const ex = x => files.find(f => f.name === x.path);
    return { its, nNew: its.filter(x => !ex(x)).length, nSame: its.filter(x => ex(x) && ex(x).content === x.r.content).length };
  };
  const prevHTML = (nm, lc) => {
    const st = stats(nm, lc), nRep = st.its.length - st.nNew - st.nSame;
    const destLabel = [lc, nm].filter(Boolean).join('/') || '/ (جذر المشروع)';
    return '<b>جديد ' + st.nNew + '</b> · <b>يُستبدل ' + nRep + '</b> · <b>مطابق ' + st.nSame + '</b>' +
      '<div class="slabel ltr-text" dir="ltr">📁 ' + esc(destLabel) + '</div>' +
      '<div class="slabel ltr-text" dir="ltr">' +
      st.its.slice(0, 4).map(x => esc(x.path)).join('<br>') + (st.its.length > 4 ? '<br>… +' + (st.its.length - 4) : '') + '</div>';
  };
  const note = (t, a) => a.length ? '<div class="slabel">' + t + ' <span dir="ltr">' + a.slice(0, 5).map(esc).join(' ، ') + (a.length > 5 ? ' … +' + (a.length - 5) : '') + '</span></div>' : '';
  return new Promise(res => {
    let settled = false;
    const done = v => { if (!settled) { settled = true; res(v); } };
    const draw = () => {
      const folderSet = new Set(['', ...allFolders(), ...extra]);
      if (loc) folderSet.add(loc);
      const folders = ['', ...[...folderSet].filter(Boolean).sort()];
      ui.resolve = null;
      ui.show('<h3>' + I('import') + 'أين تحفظ الملفات المولّدة؟ ' + uiSub('· ' + plan.list.length + ' ملف') + '</h3>' +
        (plan.fromMap ? uiNote('خريطة بلا محتوى — ستُنشأ الملفات فارغة والمجلدات الفارغة بملف .gitkeep.') : '') +
        '<div class="slabel-row"><span class="slabel">المجلد داخل المشروع</span><button type="button" class="pmini" data-act="nf">+ مجلد جديد</button></div>' +
        uiScroll(folderRows(folders, loc), 'sm') +
        '<div class="slabel">اسم مجلد فرعي إضافي (اختياري — اتركه فارغاً للحفظ مباشرة)</div>' +
        '<input type="text" id="bnName" dir="ltr" placeholder="مثال: my-app" value="' + esc(name) + '">' +
        '<div class="issue" id="bnPrev">' + prevHTML(name, loc) + '</div>' +
        note('تنبيه:', plan.warns) + note('مرفوض:', plan.bad) + (plan.bins.length ? note('ثنائية لا تُولَّد:', plan.bins) : '') +
        '<div class="srow"><button type="button" class="btn primary" data-act="merge">' + I('save') + 'حفظ في المجلد المحدد</button><button type="button" class="btn" data-act="fresh">فتح كمشروع جديد</button></div>' +
        '<div class="bn-sec"><div class="slabel">أو حفظ على الجهاز مباشرة (تختار المكان)</div>' +
        (canDir ? uiRow('dir', 'folder-plus', 'اختيار مجلد على الجهاز…', 'يكتب الملفات والمجلدات المولّدة في مجلد تختاره') : '') +
        uiRow('zip', 'export', 'حفظ كملف ZIP (تختار المكان)…', 'يحزم الملفات المولّدة فقط مع منتقي مكان الحفظ') +
        (plan.list.length === 1 ? uiRow('one', 'file', 'حفظ الملف على الجهاز…', esc(plan.list[0].rel.split('/').pop())) : '') +
        '</div>' +
        '<button type="button" class="btn" data-ui="cancel">إلغاء</button>', async (act, el) => {
          const inp = $('bnName'); if (inp) name = bundleCleanSub(inp.value);
          if (act === 'fold') { loc = folders[+el.dataset.i] || ''; return draw(); }
          if (act === 'nf') {
            ui.resolve = null;
            const rawDir = await ui.prompt('اسم المجلد الجديد (يمكنك كتابة مسار مثل src/ui)', '', 'إنشاء');
            const sub = bundleCleanSub(rawDir);
            if (sub) {
              const target = [loc, sub].filter(Boolean).join('/');
              const parts = target.split('/');
              for (let k = 1; k <= parts.length; k++) extra.push(parts.slice(0, k).join('/'));
              loc = target;
            }
            return draw();
          }
          if (act === 'dir') {
            const devItems = plan.list.map(r => ({ path: devPathOf(r, name), content: r.content })).filter(x => x.path);
            const r = await saveBundleToDeviceDir(devItems);
            if (r.status === 'abort') return;
            if (r.status === 'ok') {
              ui.resolve = null; ui.close(null);
              toast('حُفظ ' + r.count + ' ملف في مجلد الجهاز: ' + (r.dirName || 'المجلد المحدد'), 'ok');
              log('ok', 'حفظ توليد نصي على الجهاز: ' + r.count + ' ملف → ' + (r.dirName || 'مجلد الجهاز'));
              return done(r.count);
            }
            toast('تعذّر الكتابة على المجلد — جرّب الحفظ كـ ZIP' + (r.message ? ' (' + r.message + ')' : ''), 'err');
            return;
          }
          if (act === 'zip') {
            const devItems = plan.list.map(r => ({ path: devPathOf(r, name), content: r.content })).filter(x => x.path);
            const zipBase = cleanName((name || '').split('/').pop() || plan.root || (devItems[0] && devItems[0].path.split('/')[0].replace(/\.[^.]+$/, '')) || 'generated-files');
            const r = await saveBundleAsZip(devItems, zipBase);
            if (r.status === 'abort') return;
            ui.resolve = null; ui.close(null);
            toast((r.method === 'pick' || r.method === 'share' ? 'تم حفظ ' : 'نُزّل ') + r.count + ' ملف: ' + r.fileName, 'ok');
            log('ok', 'تصدير توليد نصي ZIP: ' + r.count + ' ملف (' + r.fileName + ')');
            return done(r.count);
          }
          if (act === 'one' && plan.list.length === 1) {
            const item = plan.list[0];
            const r = await saveBundleSingleFile(item.rel, item.content);
            if (r.status === 'abort') return;
            ui.resolve = null; ui.close(null);
            toast((r.method === 'pick' || r.method === 'share' ? 'تم حفظ الملف: ' : 'نُزّل الملف: ') + r.fileName, 'ok');
            return done(1);
          }
          if (act !== 'merge' && act !== 'fresh') return;
          if (act === 'fresh' && !fresh && files.length) {
            ui.resolve = null;
            const ok = await ui.confirm('سيُستبدل المشروع الحالي (' + files.length + ' ملف) بالملفات المولّدة. متابعة؟', 'فتح كمشروع جديد');
            if (!ok) return draw();
          }
          const useLoc = act === 'fresh' ? '' : loc;
          const its = stats(name, useLoc).its.filter(x => act === 'fresh' || !files.some(f => f.name === x.path && f.content === x.r.content));
          const wipe = act === 'fresh' ? new Map(BIN) : null;
          ui.resolve = null; ui.close(null); await bundleWait(130);
          if (!its.length) { toast('لا شيء ليتغيّر — كل الملفات مطابقة', ''); return done(0); }
          const n = await addItems(its.map(x => { const old = files.find(f => f.name === x.path); return { name: x.path, content: x.r.content, eol: old ? old.eol : 'lf', enc: old ? old.enc : 'utf-8' }; }), wipe);
          if (n) {
            const destDir = [useLoc, name].filter(Boolean).join('/');
            const pref = its.find(x => /(^|\/)index\.html?$/i.test(x.path)) || its[0];
            const tgt = pref && files.find(f => f.name === pref.path);
            if (tgt) activeId = tgt.id;
            if (typeof treeCwd === 'string') treeCwd = destDir || (tgt ? tgt.name.split('/').slice(0, -1).join('/') : '');
            render(); scheduleSave();
            const where = destDir ? destDir : '/ (جذر المشروع)';
            toast('تم حفظ ' + n + ' ملف في ' + where + (act === 'merge' ? ' — للتراجع: تبويب باتشات' : ''), 'ok');
            log('ok', 'توليد من نص: ' + n + ' ملف → ' + where);
          }
          done(n || 0);
        });
      ui.resolve = () => done(0);
      const inp = $('bnName');
      if (inp) inp.addEventListener('input', () => {
        name = bundleCleanSub(inp.value);
        const pv = $('bnPrev');
        if (pv) pv.innerHTML = prevHTML(name, loc);
      });
    };
    draw();
  });
}
function importBundleDialog() {
  ui.show('<h3>استيراد من نص</h3><div class="slabel">الصق حزمة (=== FILE: ===) أو خريطة ملفات (شجرة) أو اختر ملف .txt</div>' +
    '<textarea class="plain" id="bnIn" spellcheck="false" autocapitalize="off"></textarea>' +
    '<div class="srow"><button type="button" class="btn" data-act="paste">لصق</button><button type="button" class="btn" data-act="pick">ملف .txt…</button></div>' +
    '<div class="srow"><button type="button" class="btn" data-ui="cancel">إلغاء</button><button type="button" class="btn primary" data-act="parse">تحليل واختيار الحفظ</button></div>', async act => {
      const ta = $('bnIn');
      if (act === 'paste') { try { ta.value = await navigator.clipboard.readText(); } catch (e) { toast('لا إذن للحافظة — الصق يدوياً داخل الخانة', 'err'); } return; }
      if (act === 'pick') {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.txt,.md,text/plain';
        inp.onchange = async () => { const f = inp.files && inp.files[0]; if (f) ta.value = await f.text(); };
        return inp.click();
      }
      if (act === 'parse') {
        const t = ta.value;
        if (!t.trim()) { toast('الخانة فارغة', 'err'); ta.focus(); return; }
        const plan = bundlePlan(t);
        if (!plan) { toast('لم أجد كتل === FILE: === ولا خريطة ملفات في النص', 'err'); ta.focus(); return; }
        await importBundleText(t, false, plan);
      }
    });
  setTimeout(() => { const t = $('bnIn'); if (t) t.focus(); }, 80);
}
function bundleMenu() {
  const I = n => '<svg class="ic" aria-hidden="true"><use href="#i-' + n + '"/></svg> ';
  ui.show('<h3>' + I('file-md') + 'المشروع كنص واحد</h3>' +
    uiRow('out', 'export', 'نسخ المشروع كنص (للذكاء الاصطناعي)') +
    uiRow('in', 'import', 'توليد ملفات ومجلدات من نص (حزمة أو خريطة)'), act => {
      ui.close(null);
      if (act === 'out') setTimeout(() => exportBundleDialog(''), 120);
      else if (act === 'in') setTimeout(importBundleDialog, 120);
    });
}

