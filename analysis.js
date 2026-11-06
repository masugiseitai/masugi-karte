// ===== 分析（COCKPITの「分析」メニューと同じ定義で計算） =====
// 新規＝その人の初めての来院 / 再来＝2ヶ月(60日)以上空いてからの来院 / 既存＝それ以外
// 継続率＝先月来た人のうち今月も来た割合 / LTV＝期間の売上÷期間に来た実人数
// リピート率＝期間内に初めて来た人のうち、n回目まで来た人の割合
const COL = { new: '#7aa6dc', exist: '#f4a0a0', back: '#b5d98f', main: '#2473c7', sub: '#9ec1ea' };
const A_PAGES = { report: '月次レポート', sales: '売上推移', attract: '集客推移', repeat: 'リピート率', ltv: 'LTV', symptom: '症状別ランキング', area: 'エリア分析', expenses: '経費関連' };
let AM = null;            // 月を選ぶ画面の月
let AP = null;            // 期間を選ぶ画面の期間 {from,to}
let ATab = 'all';

function viewAnalysis(page) {
  if (!A_PAGES[page]) page = 'report';
  AM = AM || today().slice(0, 7);
  AP = AP || { from: today().slice(0, 7) + '-01', to: today() };
  ({ report: aReport, sales: aSales, attract: aAttract, repeat: aRepeat, ltv: aLtv, symptom: aSymptom, area: aArea, expenses: aExpenses })[page]();
}

// --- 部品 ---
function visitKinds() { // 来院1件ごとに 新規/既存/再来 を付ける
  const byC = {}; Store.all('visits').forEach(v => (byC[v.customerId] = byC[v.customerId] || []).push(v));
  const kind = {};
  Object.values(byC).forEach(list => {
    list.sort((a, b) => a.date.localeCompare(b.date));
    list.forEach((v, i) => { kind[v.id] = i === 0 ? 'new' : daysBetween(list[i - 1].date, v.date) >= 60 ? 'back' : 'exist'; });
  });
  return kind;
}
function inRange(d, from, to) { return d >= from && d <= to; }
function lastDay(ym) { const [y, m] = ym.split('-').map(Number); return ymd(new Date(y, m, 0)); }
function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
function monthPicker(id = 'am') {
  const [y, m] = AM.split('-');
  return `<div class="auto monthsel">月選択 <button data-${id}="-1">◀ 前月</button><b>${+y}年${+m}月</b><button data-${id}="1">翌月 ▶</button></div>`;
}
function bindMonth(fn) { document.querySelectorAll('[data-am]').forEach(b => b.onclick = () => { AM = addMonth(AM, +b.dataset.am); fn(); }); }
function periodPicker() {
  const t = today(), ym = t.slice(0, 7);
  const pre = [['今月', ym + '-01', t], ['先月', addMonth(ym, -1) + '-01', lastDay(addMonth(ym, -1))], ['過去3ヶ月', addMonth(ym, -2) + '-01', t],
    ['過去6ヶ月', addMonth(ym, -5) + '-01', t], ['過去1年', addMonth(ym, -11) + '-01', t], ['全期間', '2000-01-01', t]];
  return `<div class="auto monthsel">期間選択 <input type="date" id="pf" value="${AP.from}"> 〜 <input type="date" id="pt" value="${AP.to}">
    ${pre.map(p => `<button class="chip ${AP.from === p[1] && AP.to === p[2] ? 'on' : ''}" data-pre="${p[1]}|${p[2]}">${p[0]}</button>`).join('')}</div>`;
}
function bindPeriod(fn) {
  $('#pf').onchange = e => { AP.from = e.target.value; fn(); };
  $('#pt').onchange = e => { AP.to = e.target.value; fn(); };
  document.querySelectorAll('[data-pre]').forEach(b => b.onclick = () => { [AP.from, AP.to] = b.dataset.pre.split('|'); fn(); });
}
function tabs(list, fn) {
  return `<div class="tabs">${list.map(([k, l]) => `<button class="${ATab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>`;
}
function bindTabs(fn) { document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { ATab = b.dataset.tab; fn(); }); }
function legend(items) { return `<div class="legend">${items.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>`; }
// 積み上げ棒グラフ（SVG）。series=[{color,label,values[]}], labels[]
function stackChart(labels, series, opt = {}) {
  const W = 640, H = opt.h || 220, P = { l: 44, r: 8, t: 12, b: 26 };
  const tot = labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] || 0), 0));
  const max = Math.max(1, ...tot), step = Math.max(1, niceStep(max)), top = Math.ceil(max / step) * step;
  const bw = (W - P.l - P.r) / labels.length, y = v => P.t + (H - P.t - P.b) * (1 - v / top);
  let g = '';
  for (let k = 0, v = 0; v <= top; k++, v = k * step) g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#eee"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#888">${opt.fmt ? opt.fmt(v) : v}</text>`;
  labels.forEach((l, i) => {
    let acc = 0; const x = P.l + i * bw + bw * .15, w = bw * .7;
    series.forEach(s => { const v = s.values[i] || 0; if (!v) return; g += `<rect x="${x}" y="${y(acc + v)}" width="${w}" height="${y(acc) - y(acc + v)}" fill="${s.color}"><title>${l}：${s.label} ${opt.fmt ? opt.fmt(v) : v}</title></rect>`; acc += v; });
    if (labels.length <= 16 || i % 2 === 0) g += `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#888">${l}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart">${g}</svg>`;
}
function niceStep(max) { const raw = max / 5, p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 5, 10].map(m => m * p).find(s => s >= raw) || p * 10; }
const manFmt = v => v >= 10000 ? (v / 10000).toFixed(v % 10000 ? 1 : 0) + '万' : v;
function aHead(title, picker) { return `<div class="row"><h1>${title}</h1>${picker}</div>`; }

// --- 月次レポート：12ヶ月の一覧 ---
function aReport() {
  const months = Array.from({ length: 12 }, (_, i) => addMonth(AM, i - 11));
  const kinds = visitKinds();
  const rows = months.map(ym => { const s = monthStats(ym); const back = s.vs.filter(v => kinds[v.id] === 'back').length; return { ...s, back }; });
  const sum = k => rows.reduce((s, r) => s + r[k], 0);
  $('#view').innerHTML = aHead('月次レポート', monthPicker()) + `
  <div class="card"><h2>${months[0].replace('-', '年')}月 〜 ${AM.replace('-', '年')}月</h2><div class="tablewrap"><table>
   <tr><th>月</th><th class="num">売上</th><th class="num">のべ来院数</th><th class="num">来院顧客数</th><th class="num">新規</th><th class="num">再来院</th><th class="num">顧客単価</th><th class="num">前年同月比</th></tr>
   ${rows.map(r => { const ly = monthStats(addMonth(r.ym, -12)); return `<tr><td>${r.ym.replace('-', '年')}月</td><td class="num">${yen(r.sales)}</td><td class="num">${r.nobe}人</td><td class="num">${r.people}人</td><td class="num">${r.newc}人</td><td class="num">${r.back}人</td><td class="num">${yen(r.unit)}</td><td class="num">${cmp(r.sales, ly.sales)}</td></tr>`; }).join('')}
   <tr><th>合計</th><th class="num">${yen(sum('sales'))}</th><th class="num">${sum('nobe')}人</th><th class="num">-</th><th class="num">${sum('newc')}人</th><th class="num">${sum('back')}人</th><th class="num">${yen(sum('nobe') ? sum('sales') / sum('nobe') : 0)}</th><th></th></tr>
  </table></div></div>
  <div class="card"><h2>売上の推移</h2>${stackChart(months.map(m => +m.slice(5) + '月'), [{ color: COL.main, label: '売上', values: rows.map(r => r.sales) }], { fmt: manFmt })}</div>`;
  bindMonth(aReport);
}

// --- 売上推移：日別・支払い方法・施術/物販・メニュー ---
function aSales() {
  const cur = monthStats(AM), days = +lastDay(AM).slice(8);
  const isCur = AM === today().slice(0, 7);
  const forecast = isCur ? cur.sales / new Date().getDate() * days : cur.sales;
  const goal = (Store.all('settings').goals || {})[AM] || 0;
  let treat = 0, prod = 0; const byPm = {}, byMenu = {}, daily = Array(days).fill(0), dailyT = Array(days).fill(0), dailyP = Array(days).fill(0);
  cur.vs.forEach(v => v.items.forEach(it => {
    const p = pmOf(it.pm), amt = p?.noSales ? 0 : +it.paid || 0, d = +v.date.slice(8) - 1;
    (byPm[p?.name] = byPm[p?.name] || { n: 0, amt: 0 }).n++; byPm[p?.name].amt += +it.paid || 0;
    (byMenu[it.name] = byMenu[it.name] || { n: 0, amt: 0, min: 0 }).n++; byMenu[it.name].amt += amt;
    const m = it.kind === 'menu' && Store.get('menus', it.refId); if (m) byMenu[it.name].min += +m.minutes || 0;
    it.kind === 'menu' ? (treat += amt, dailyT[d] += amt) : (prod += amt, dailyP[d] += amt);
  }));
  const minutes = Object.values(byMenu).reduce((s, x) => s + x.min, 0);
  const months = Array.from({ length: 12 }, (_, i) => addMonth(AM, i - 11));
  $('#view').innerHTML = aHead('売上推移', monthPicker()) + `
  <div class="kpis">
    <div class="kpi"><div class="head"><div><div class="s">売上</div><div class="v">${(cur.sales / 10000).toFixed(1)}<small>万円</small></div></div></div><div class="foot">施術 ${yen(treat)}・物販 ${yen(prod)}</div></div>
    <div class="kpi"><div class="head"><div><div class="s">月末予測</div><div class="v">${(forecast / 10000).toFixed(1)}<small>万円</small></div></div></div><div class="foot">${isCur ? '今日までのペースから予測' : '確定'}</div></div>
    <div class="kpi"><div class="head"><div><div class="s">目標達成率</div><div class="v">${goal ? pct(forecast, goal) + '<small>%</small>' : '-'}</div></div></div><div class="foot">${goal ? '目標 ' + yen(goal) + '・あと ' + yen(Math.max(0, goal - cur.sales)) : '<a href="#/goal">月間目標</a>で登録できます'}</div></div>
    <div class="kpi"><div class="head"><div><div class="s">分単価</div><div class="v">${minutes ? Math.round(treat / minutes) : '-'}<small>円</small></div></div></div><div class="foot">施術売上 ÷ 施術時間（メニューの予約枠）</div></div>
  </div>
  <div class="card"><h2>日別の売上</h2>${legend([[COL.main, '施術'], [COL.back, '物販']])}
    ${stackChart(Array.from({ length: days }, (_, i) => i + 1 + '日'), [{ color: COL.main, label: '施術', values: dailyT }, { color: COL.back, label: '物販', values: dailyP }], { fmt: manFmt })}</div>
  <div class="grid2 even">
    <div class="card"><h2>支払い方法別</h2><table><tr><th>支払い方法</th><th class="num">件数</th><th class="num">金額</th></tr>
      ${Object.entries(byPm).map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">${v.n}</td><td class="num">${yen(v.amt)}</td></tr>`).join('')}</table>
      <p class="muted">回数券・プリペイドで払った分は売上に入りません（購入した時に売上に入っています）。</p></div>
    <div class="card"><h2>メニュー・物販別</h2><table><tr><th>名前</th><th class="num">回数</th><th class="num">売上</th><th class="num">割合</th></tr>
      ${Object.entries(byMenu).sort((a, b) => b[1].amt - a[1].amt).map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">${v.n}</td><td class="num">${yen(v.amt)}</td><td class="num">${pct(v.amt, cur.sales)}%</td></tr>`).join('')}</table></div>
  </div>
  <div class="card"><h2>月間売上推移</h2>${legend([[COL.main, '施術'], [COL.back, '物販']])}
    ${stackChart(months.map(m => +m.slice(5) + '月'), [
      { color: COL.main, label: '施術', values: months.map(m => monthStats(m).vs.reduce((s, v) => s + v.items.filter(i => i.kind === 'menu' && !pmOf(i.pm)?.noSales).reduce((a, i) => a + (+i.paid || 0), 0), 0)) },
      { color: COL.back, label: '物販', values: months.map(m => monthStats(m).vs.reduce((s, v) => s + v.items.filter(i => i.kind !== 'menu' && !pmOf(i.pm)?.noSales).reduce((a, i) => a + (+i.paid || 0), 0), 0)) }], { fmt: manFmt })}</div>`;
  bindMonth(aSales);
}

// --- 集客推移：新規・既存・再来、継続率、媒体別 ---
function aAttract() {
  const kinds = visitKinds(), cur = monthStats(AM), prev = monthStats(addMonth(AM, -1)), days = +lastDay(AM).slice(8);
  const cnt = (vs, k) => vs.filter(v => kinds[v.id] === k).length;
  const prevP = new Set(prev.vs.map(v => v.customerId)), curP = new Set(cur.vs.map(v => v.customerId));
  const cont = [...prevP].filter(c => curP.has(c)).length, leave = prevP.size - cont;
  const daily = k => Array.from({ length: days }, (_, i) => cur.vs.filter(v => +v.date.slice(8) === i + 1 && kinds[v.id] === k).length);
  const months = Array.from({ length: 12 }, (_, i) => addMonth(AM, i - 11)), ms = months.map(m => monthStats(m));
  const byMedia = {};
  cur.vs.filter(v => kinds[v.id] === 'new').forEach(v => { const m = Store.get('customers', v.customerId)?.media || '（未設定）'; byMedia[m] = (byMedia[m] || 0) + 1; });
  const yearNew = {};
  ms.forEach(s => s.vs.filter(v => kinds[v.id] === 'new').forEach(v => { const m = Store.get('customers', v.customerId)?.media || '（未設定）'; yearNew[m] = (yearNew[m] || 0) + 1; }));
  $('#view').innerHTML = aHead('集客推移', monthPicker()) + `
  <div class="kpis">
    <div class="kpi"><div class="head"><div><div class="s">のべ来院数</div><div class="v">${cur.nobe}<small>人</small></div></div></div><div class="foot">来院顧客数 ${cur.people}人</div></div>
    <div class="kpi"><div class="head"><div><div class="s">新規来院数</div><div class="v">${cnt(cur.vs, 'new')}<small>人</small></div></div></div><div class="foot">前月 ${cnt(prev.vs, 'new')}人</div></div>
    <div class="kpi"><div class="head"><div><div class="s">再来院数</div><div class="v">${cnt(cur.vs, 'back')}<small>人</small></div></div></div><div class="foot">2ヶ月以上空いてから来た方</div></div>
    <div class="kpi"><div class="head"><div><div class="s">継続率</div><div class="v">${pct(cont, prevP.size)}<small>%</small></div></div></div><div class="foot">先月${prevP.size}人のうち今月も来た ${cont}人・離脱 ${leave}人</div></div>
  </div>
  <div class="grid2 even">
    <div class="card"><h2>月間来院内訳</h2>${legend([[COL.new, '新規'], [COL.exist, '既存'], [COL.back, '再来']])}
      ${stackChart(Array.from({ length: days }, (_, i) => i + 1 + '日'), [{ color: COL.new, label: '新規', values: daily('new') }, { color: COL.exist, label: '既存', values: daily('exist') }, { color: COL.back, label: '再来', values: daily('back') }])}</div>
    <div class="card"><h2>年間来院内訳</h2>${legend([[COL.new, '新規'], [COL.exist, '既存'], [COL.back, '再来']])}
      ${stackChart(months.map(m => +m.slice(5) + '月'), ['new', 'exist', 'back'].map(k => ({ color: COL[k], label: { new: '新規', exist: '既存', back: '再来' }[k], values: ms.map(s => cnt(s.vs, k)) })))}</div>
  </div>
  <div class="grid2 even">
    <div class="card"><h2>集客媒体別の新規（${+AM.slice(5)}月）</h2><table><tr><th>媒体名</th><th class="num">新規来院数</th><th class="num">広告費</th><th class="num">CPA</th></tr>
      ${(activeList('media').forEach(n => { if (adCost(AM, n) && !byMedia[n]) byMedia[n] = 0; }), Object.entries(byMedia)).sort((a, b) => b[1] - a[1]).map(([n, v]) => { const a = adCost(AM, n); return `<tr><td>${esc(n)}</td><td class="num">${v}人</td><td class="num">${yen(a)}</td><td class="num">${a ? (v ? yen(a / v) : '新規なし') : '-'}</td></tr>`; }).join('') || '<tr><td colspan="4" class="muted">この月の新規はありません</td></tr>'}</table>
      <p class="muted">広告費は「登録 → 広告費/経費」で入れます。合計 広告費 ${yen(adCost(AM))}・CPA ${cnt(cur.vs, 'new') && adCost(AM) ? yen(adCost(AM) / cnt(cur.vs, 'new')) : '-'}</p></div>
    <div class="card"><h2>集客媒体別の新規（12ヶ月）</h2><table><tr><th>媒体名</th><th class="num">新規来院数</th><th class="num">割合</th></tr>
      ${Object.entries(yearNew).sort((a, b) => b[1] - a[1]).map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">${v}人</td><td class="num">${pct(v, Object.values(yearNew).reduce((a, b) => a + b, 0))}%</td></tr>`).join('')}</table></div>
  </div>
  <div class="card"><h2>継続率の推移</h2><div class="tablewrap"><table><tr><th>月</th>${months.map(m => `<th class="num">${+m.slice(5)}月</th>`).join('')}</tr>
    <tr><td>継続率</td>${months.map((m, i) => { const p = new Set(monthStats(addMonth(m, -1)).vs.map(v => v.customerId)), c = new Set(ms[i].vs.map(v => v.customerId)); return `<td class="num">${pct([...p].filter(x => c.has(x)).length, p.size)}%</td>`; }).join('')}</tr>
    <tr><td>新規</td>${ms.map(s => `<td class="num">${cnt(s.vs, 'new')}</td>`).join('')}</tr>
    <tr><td>再来院</td>${ms.map(s => `<td class="num">${cnt(s.vs, 'back')}</td>`).join('')}</tr></table></div></div>`;
  bindMonth(aAttract);
}

// --- リピート率：期間内の新規が何回目まで来たか ---
function repeatTable(cs, maxN = 10) {
  const n = cs.length, cnt = c => visitsOf(c.id).length;
  return `<p class="muted" style="margin:0 0 6px">来院数：${n}人（男性 ${cs.filter(c => c.gender === '男性').length}人・女性 ${cs.filter(c => c.gender === '女性').length}人）</p>
  <table><tr><th>回数</th><th class="num">リピート率（来院数）</th><th class="num">男性</th><th class="num">女性</th><th style="width:30%"></th></tr>
  ${Array.from({ length: maxN - 1 }, (_, i) => i + 2).map(k => {
    const hit = cs.filter(c => cnt(c) >= k), m = cs.filter(c => c.gender === '男性'), f = cs.filter(c => c.gender === '女性');
    const r = pct(hit.length, n);
    return `<tr><td>${k}回目</td><td class="num">${r}%（${hit.length}人）</td><td class="num">${pct(hit.filter(c => c.gender === '男性').length, m.length)}%（${hit.filter(c => c.gender === '男性').length}人）</td>
      <td class="num">${pct(hit.filter(c => c.gender === '女性').length, f.length)}%（${hit.filter(c => c.gender === '女性').length}人）</td><td><div class="meter"><i style="width:${r}%"></i></div></td></tr>`;
  }).join('')}</table>`;
}
function aRepeat() {
  const cs = Store.all('customers').filter(c => { const f = firstVisitDate(c.id); return f && inRange(f, AP.from, AP.to); });
  const groups = key => { const g = {}; cs.forEach(c => (g[c[key] || '（未設定）'] = g[c[key] || '（未設定）'] || []).push(c)); return Object.entries(g).sort((a, b) => b[1].length - a[1].length); };
  if (!['all', 'chief', 'media'].includes(ATab)) ATab = 'all';
  const body = ATab === 'all' ? `<div class="card"><h2>全体</h2>${repeatTable(cs)}</div>`
    : `<div class="grid2 even">${groups(ATab).map(([n, list]) => `<div class="card"><h2>${esc(n)}</h2>${repeatTable(list, 6)}</div>`).join('') || '<div class="card muted">データがありません</div>'}</div>`;
  $('#view').innerHTML = aHead('リピート率', periodPicker()) + `
  <div class="card"><p class="muted" style="margin:0">選んだ期間に<b>初めて来院した方</b>が、その後 何回目まで来ているかの割合です（2回目＝初回の後にもう一度来た方）。今も通院中の方は、これから回数が増えます。</p></div>
  ${tabs([['all', '全体'], ['chief', '症状別'], ['media', '集客媒体別']])}${cs.length ? body : '<div class="card">この期間に初めて来た方はいません。期間を広げてください。</div>'}`;
  bindPeriod(aRepeat); bindTabs(aRepeat);
}

// --- LTV ---
function aLtv() {
  const vs = Store.all('visits').filter(v => inRange(v.date, AP.from, AP.to));
  const per = {}; vs.forEach(v => { const p = per[v.customerId] = per[v.customerId] || { sales: 0, n: 0, last: '' }; p.sales += salesOfVisit(v); p.n++; if (v.date > p.last) p.last = v.date; });
  const ids = Object.keys(per), total = ids.reduce((s, i) => s + per[i].sales, 0), nobe = vs.length;
  const ltvOf = list => list.length ? list.reduce((s, i) => s + per[i].sales, 0) / list.length : 0;
  const by = key => { const g = {}; ids.forEach(i => { const k = Store.get('customers', i)?.[key] || '（未設定）'; (g[k] = g[k] || []).push(i); }); return Object.entries(g).sort((a, b) => ltvOf(b[1]) - ltvOf(a[1])); };
  const gender = g => ids.filter(i => Store.get('customers', i)?.gender === g);
  const rank = ids.sort((a, b) => per[b].sales - per[a].sales).slice(0, 20);
  const grpTable = (title, list) => `<div class="card"><h2>${title}</h2><table><tr><th>${title.replace('別LTV', '')}</th><th class="num">人数</th><th class="num">LTV</th><th class="num">平均回数</th></tr>
    ${list.map(([n, l]) => `<tr><td>${esc(n)}</td><td class="num">${l.length}人</td><td class="num">${man(ltvOf(l))}</td><td class="num">${(l.reduce((s, i) => s + per[i].n, 0) / l.length).toFixed(1)}回</td></tr>`).join('')}</table></div>`;
  $('#view').innerHTML = aHead('LTV', periodPicker()) + `
  <div class="kpis">
    <div class="kpi"><div class="head"><div><div class="s">LTV（1人あたりの売上）</div><div class="v">${(ltvOf(ids) / 10000).toFixed(1)}<small>万円</small></div></div></div><div class="foot">売上 ${man(total)} ÷ 来院顧客数 ${ids.length}人</div></div>
    <div class="kpi"><div class="head"><div><div class="s">平均利用回数</div><div class="v">${ids.length ? (nobe / ids.length).toFixed(1) : 0}<small>回</small></div></div></div><div class="foot">のべ ${nobe}回 ÷ ${ids.length}人</div></div>
    <div class="kpi"><div class="head"><div><div class="s">平均単価</div><div class="v">${yen(nobe ? total / nobe : 0).replace('円', '')}<small>円</small></div></div></div><div class="foot">売上 ÷ のべ来院数</div></div>
    <div class="kpi"><div class="head"><div><div class="s">男女別LTV</div><div class="v" style="font-size:20px">男 ${man(ltvOf(gender('男性')))}</div></div></div><div class="foot">女 ${man(ltvOf(gender('女性')))}</div></div>
  </div>
  <div class="grid2 even">
    <div class="card"><h2>ランキング</h2><div class="tablewrap"><table><tr><th>順位</th><th>名前</th><th class="num">支払金額</th><th class="num">回数</th><th>最終来院日</th></tr>
      ${rank.map((i, k) => `<tr><td>${k + 1}</td><td><a href="#/customer/${i}">${esc(fullName(Store.get('customers', i)))}</a></td><td class="num">${yen(per[i].sales)}</td><td class="num">${per[i].n}回</td><td>${per[i].last.replace(/-/g, '/')}</td></tr>`).join('')}</table></div></div>
    <div>${grpTable('症状別LTV', by('chief'))}${grpTable('集客媒体別LTV', by('media'))}</div>
  </div>`;
  bindPeriod(aLtv);
}

// --- 症状別ランキング ---
function aSymptom() {
  const vs = Store.all('visits').filter(v => inRange(v.date, AP.from, AP.to));
  const ids = [...new Set(vs.map(v => v.customerId))];
  const g = {}; ids.forEach(i => { const c = Store.get('customers', i); const k = c?.chief || '（未設定）'; const x = g[k] = g[k] || { n: 0, m: 0, f: 0, newc: 0, sales: 0 }; x.n++; c?.gender === '男性' ? x.m++ : c?.gender === '女性' ? x.f++ : 0; if (inRange(firstVisitDate(i), AP.from, AP.to)) x.newc++; });
  vs.forEach(v => { const k = Store.get('customers', v.customerId)?.chief || '（未設定）'; g[k].sales += salesOfVisit(v); });
  const list = Object.entries(g).sort((a, b) => b[1].n - a[1].n), max = Math.max(1, ...list.map(x => x[1].n));
  $('#view').innerHTML = aHead('症状別ランキング', periodPicker()) + `
  <div class="card"><div class="tablewrap"><table><tr><th>順位</th><th>症状</th><th class="num">人数（男女比）</th><th class="num">うち新規</th><th class="num">売上</th><th style="width:30%"></th></tr>
    ${list.map(([n, x], k) => `<tr><td>${k + 1}</td><td>${esc(n)}</td><td class="num">${x.n}人（男${x.m}：女${x.f}）</td><td class="num">${x.newc}人</td><td class="num">${yen(x.sales)}</td><td><div class="meter"><i style="width:${x.n / max * 100}%"></i></div></td></tr>`).join('') || '<tr><td colspan="6" class="muted">データがありません</td></tr>'}
  </table></div><p class="muted">選んだ期間に来院した方を、顧客情報の「主訴」で数えています。</p></div>`;
  bindPeriod(aSymptom);
}

// --- エリア分析：住所の市区町村ごとの人数・売上（期間内に来院した方） ---
function areaOf(addr) {
  const s = String(addr || '').replace(/〒?\s*\d{3}-?\d{4}\s*/, '').trim();
  const m = s.match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)\s*(.+?(?:市|区|町|村|郡.+?[町村]))/);
  return m ? { pref: m[1], city: m[2] } : { pref: '（住所なし・不明）', city: '（住所なし・不明）' };
}
let AF = { media: '', chief: '', unit: 'city' };
function aArea() {
  const vs = Store.all('visits').filter(v => inRange(v.date, AP.from, AP.to));
  const per = {}; vs.forEach(v => { const p = per[v.customerId] = per[v.customerId] || { n: 0, sales: 0 }; p.n++; p.sales += salesOfVisit(v); });
  const g = {};
  Object.keys(per).forEach(id => {
    const c = Store.get('customers', id); if (!c) return;
    if (AF.media && c.media !== AF.media) return; if (AF.chief && c.chief !== AF.chief) return;
    const a = areaOf(c.address), k = AF.unit === 'pref' ? a.pref : (a.pref === a.city ? a.city : a.pref + ' ' + a.city);
    const x = g[k] = g[k] || { people: 0, newc: 0, nobe: 0, sales: 0 };
    x.people++; x.nobe += per[id].n; x.sales += per[id].sales; if (inRange(firstVisitDate(id), AP.from, AP.to)) x.newc++;
  });
  const list = Object.entries(g).sort((a, b) => b[1].people - a[1].people), max = Math.max(1, ...list.map(x => x[1].people));
  const tot = list.reduce((s, [, x]) => s + x.people, 0);
  const opt = (arr, cur) => `<option value="">すべて</option>${arr.map(o => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}`;
  $('#view').innerHTML = aHead('エリア分析', periodPicker()) + `
  <div class="card"><div class="row" style="justify-content:flex-start">
    <div class="auto"><label style="margin-top:0">単位</label><select id="af_unit" style="width:auto"><option value="city" ${AF.unit === 'city' ? 'selected' : ''}>市区町村</option><option value="pref" ${AF.unit === 'pref' ? 'selected' : ''}>都道府県</option></select></div>
    <div class="auto"><label style="margin-top:0">集客媒体</label><select id="af_media" style="width:auto">${opt(Store.all('media'), AF.media)}</select></div>
    <div class="auto"><label style="margin-top:0">主訴</label><select id="af_chief" style="width:auto">${opt(Store.all('symptoms'), AF.chief)}</select></div>
  </div></div>
  <div class="card"><h2>来院した方の住まい（${tot}人）</h2><div class="tablewrap"><table>
    <tr><th>順位</th><th>地域</th><th class="num">人数</th><th class="num">割合</th><th class="num">うち新規</th><th class="num">のべ来院</th><th class="num">1人あたり回数</th><th class="num">売上</th><th style="width:22%"></th></tr>
    ${list.map(([n, x], i) => `<tr><td>${i + 1}</td><td>${esc(n)}</td><td class="num">${x.people}人</td><td class="num">${pct(x.people, tot)}%</td><td class="num">${x.newc}人</td><td class="num">${x.nobe}回</td><td class="num">${(x.nobe / x.people).toFixed(1)}回</td><td class="num">${yen(x.sales)}</td><td><div class="meter"><i style="width:${x.people / max * 100}%"></i></div></td></tr>`).join('') || '<tr><td colspan="9" class="muted">データがありません</td></tr>'}
  </table></div><p class="muted">顧客情報の住所から市区町村を読み取っています。チラシ・ポスティングやGoogleマップの対策地域を決める時の目安に。</p></div>`;
  bindPeriod(aArea);
  $('#af_unit').onchange = e => { AF.unit = e.target.value; aArea(); };
  $('#af_media').onchange = e => { AF.media = e.target.value; aArea(); };
  $('#af_chief').onchange = e => { AF.chief = e.target.value; aArea(); };
}
