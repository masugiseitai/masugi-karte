// ===== 広告費／経費・月間目標 =====
// 広告費の「項目」は集客媒体名。CPA＝その月の広告費 ÷ その媒体から来た新規数
// 「毎月自動」にした行は、登録した月から止めた月の前まで毎月同じ金額で数える
let EM = null;
function expRows(ym) {
  return Store.all('expenses').filter(e => e.auto ? (e.date.slice(0, 7) <= ym && (!e.until || ym < e.until)) : e.date.startsWith(ym));
}
function adCost(ym, media) { return expRows(ym).filter(e => e.kind === 'ad' && (!media || e.name === media)).reduce((s, e) => s + (+e.amount || 0), 0); }
function costSum(ym) { return expRows(ym).filter(e => e.kind === 'cost').reduce((s, e) => s + (+e.amount || 0), 0); }
function goalOf(ym) { return (settings().goals || {})[ym] || 0; }
function newByMedia(ym) {
  const g = {}; Store.all('customers').forEach(c => { if (firstVisitDate(c.id).startsWith(ym)) { const m = c.media || '（未設定）'; g[m] = (g[m] || 0) + 1; } }); return g;
}

function viewExpenses() {
  EM = EM || today().slice(0, 7);
  const rows = expRows(EM).sort((a, b) => a.kind.localeCompare(b.kind) || a.date.localeCompare(b.date));
  const media = activeList('media'), pastNames = [...new Set(Store.all('expenses').filter(e => e.kind === 'cost').map(e => e.name))];
  const [y, m] = EM.split('-');
  $('#view').innerHTML = `
  <div class="row"><h1>広告費／経費</h1><div class="auto monthsel">月選択 <button data-em="-1">◀ 前月</button><b>${+y}年${+m}月</b><button data-em="1">翌月 ▶</button></div></div>
  <div class="grid2">
    <div class="card"><h2>登録</h2>
      <label>区分</label>
      <div class="row" style="justify-content:flex-start"><button class="chip auto on" data-ek="ad">広告費</button><button class="chip auto" data-ek="cost">経費</button></div>
      <label>日付</label><input type="date" id="e_date" value="${EM === today().slice(0, 7) ? today() : EM + '-01'}">
      <label>項目</label>
      <select id="e_media">${media.map(x => `<option>${esc(x)}</option>`).join('')}</select>
      <input id="e_name" list="e_names" placeholder="例：家賃、材料費、通信費" hidden><datalist id="e_names">${pastNames.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <label>金額</label><input type="number" id="e_amount" placeholder="円">
      <label style="font-weight:400"><input type="checkbox" id="e_auto" style="width:auto;height:auto"> 毎月自動で登録する（家賃・毎月の広告など）</label>
      <br><button class="primary" id="e_save" style="min-width:120px">登録</button>
      <p class="muted">広告費は「集客媒体」ごとに登録します。新規の方の集客媒体と合わせて、CPA（新規1人あたりの広告費）を出します。</p>
    </div>
    <div class="card"><h2>${+m}月の一覧</h2>
      <table class="sum"><tr><th></th><th class="num">金額</th></tr><tr><td>広告費</td><td class="num">${yen(adCost(EM))}</td></tr><tr><td>経費</td><td class="num">${yen(costSum(EM))}</td></tr><tr><th>合計</th><th class="num">${yen(adCost(EM) + costSum(EM))}</th></tr></table>
      <div class="tablewrap"><table><tr><th>区分</th><th>日付</th><th>項目</th><th class="num">金額</th><th>自動</th><th></th></tr>
      ${rows.map(e => `<tr><td>${e.kind === 'ad' ? '広告費' : '経費'}</td><td>${e.auto ? '毎月' : e.date.replace(/-/g, '/')}</td><td>${esc(e.name)}</td><td class="num">${yen(e.amount)}</td>
        <td>${e.auto ? `<button class="chip" data-stop="${e.id}">今月から止める</button>` : ''}</td><td>${e.auto && e.date.slice(0, 7) !== EM ? '' : `<button class="x" data-edel="${e.id}" title="削除">×</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">この月の登録はありません</td></tr>'}
      </table></div>
      <p class="muted">「毎月自動」は登録した月から毎月数えます。やめる時は、やめたい月を開いて「今月から止める」を押してください。</p>
    </div>
  </div>`;
  let kind = 'ad';
  document.querySelectorAll('[data-em]').forEach(b => b.onclick = () => { EM = addMonth(EM, +b.dataset.em); viewExpenses(); });
  document.querySelectorAll('[data-ek]').forEach(b => b.onclick = () => {
    kind = b.dataset.ek; document.querySelectorAll('[data-ek]').forEach(x => x.classList.toggle('on', x === b));
    $('#e_media').hidden = kind !== 'ad'; $('#e_name').hidden = kind === 'ad';
  });
  $('#e_save').onclick = () => {
    const name = kind === 'ad' ? $('#e_media').value : $('#e_name').value.trim(), amount = +$('#e_amount').value, date = $('#e_date').value;
    if (!name) return toast('項目を入れてください'); if (!amount) return toast('金額を入れてください');
    Store.put('expenses', { kind, date, name, amount, auto: $('#e_auto').checked });
    EM = date.slice(0, 7); toast('登録しました'); viewExpenses();
  };
  document.querySelectorAll('[data-edel]').forEach(b => b.onclick = () => { if (confirm('削除しますか？')) { Store.del('expenses', b.dataset.edel); viewExpenses(); } });
  document.querySelectorAll('[data-stop]').forEach(b => b.onclick = () => {
    const e = Store.get('expenses', b.dataset.stop); if (!confirm(`「${e.name}」を${+EM.slice(5)}月から止めますか？（先月までは残ります）`)) return;
    e.until = EM; Store.put('expenses', e); viewExpenses();
  });
}

let GY = null;
function viewGoal() {
  GY = GY || +today().slice(0, 4);
  const months = Array.from({ length: 12 }, (_, i) => GY + '-' + String(i + 1).padStart(2, '0'));
  const ym = today().slice(0, 7);
  $('#view').innerHTML = `
  <div class="row"><h1>月間目標</h1><div class="auto monthsel">年選択 <button data-gy="-1">◀ 前年</button><b>${GY}年</b><button data-gy="1">翌年 ▶</button></div></div>
  <div class="card"><h2>${GY}年の月間目標</h2><div class="tablewrap"><table>
    <tr><th>月</th><th>売上目標</th><th class="num">実績</th><th class="num">達成率</th><th class="num">前年同月</th><th style="width:28%"></th></tr>
    ${months.map(m => { const s = monthStats(m).sales, g = goalOf(m), ly = monthStats(addMonth(m, -12)).sales, fc = m === ym ? s / new Date().getDate() * +lastDay(m).slice(8) : s;
      return `<tr><td>${+m.slice(5)}月${m === ym ? ' <span class="tag new">今月</span>' : ''}</td>
      <td><input type="number" data-goal="${m}" value="${g || ''}" placeholder="例：1500000" style="max-width:160px"></td>
      <td class="num">${yen(s)}${m === ym ? '<div class="muted">月末予測 ' + yen(fc) + '</div>' : ''}</td>
      <td class="num">${g ? `<span class="${s >= g ? 'up' : ''}">${pct(s, g)}%</span>` : '-'}</td><td class="num">${yen(ly)}</td>
      <td>${g ? `<div class="meter"><i style="width:${Math.min(100, pct(s, g))}%"></i></div>` : ''}</td></tr>`; }).join('')}
  </table></div>
  <p class="row" style="justify-content:flex-start"><span class="auto">まとめて入れる：</span><input type="number" id="g_all" placeholder="毎月の目標" style="max-width:160px"><button class="auto" id="g_fill">空いている月に入れる</button></p>
  <p class="muted">入れた目標は、ダッシュボードと売上推移の「目標達成率」「目標まで」に使います。</p></div>`;
  const save = (m, v) => { const st = settings(); st.goals = st.goals || {}; if (v) st.goals[m] = v; else delete st.goals[m]; Store.setAll('settings', st); };
  document.querySelectorAll('[data-gy]').forEach(b => b.onclick = () => { GY += +b.dataset.gy; viewGoal(); });
  document.querySelectorAll('[data-goal]').forEach(i => i.onchange = () => { save(i.dataset.goal, +i.value); toast('保存しました'); viewGoal(); });
  $('#g_fill').onclick = () => { const v = +$('#g_all').value; if (!v) return; months.forEach(m => { if (!goalOf(m)) save(m, v); }); toast('保存しました'); viewGoal(); };
}

// 分析：経費関連（12ヶ月の売上・広告費・経費・差引）
function aExpenses() {
  const months = Array.from({ length: 12 }, (_, i) => addMonth(AM, i - 11));
  const rows = months.map(m => { const s = monthStats(m).sales, ad = adCost(m), c = costSum(m), nw = Object.values(newByMedia(m)).reduce((a, b) => a + b, 0); return { m, s, ad, c, nw, rest: s - ad - c }; });
  const tot = k => rows.reduce((a, r) => a + r[k], 0);
  const mediaRows = Object.entries(newByMedia(AM)); activeList('media').forEach(n => { if (adCost(AM, n) && !mediaRows.find(x => x[0] === n)) mediaRows.push([n, 0]); });
  $('#view').innerHTML = aHead('経費関連', monthPicker()) + `
  <div class="card"><h2>広告費と経費（12ヶ月）</h2>${legend([[COL.main, '売上'], ['#f4a0a0', '広告費'], ['#f3c26b', '経費']])}
    ${groupChart(months.map(m => +m.slice(5) + '月'), [rows.map(r => r.s), rows.map(r => r.ad), rows.map(r => r.c)], [COL.main, '#f4a0a0', '#f3c26b'])}
    <div class="tablewrap"><table><tr><th>月</th><th class="num">売上</th><th class="num">広告費</th><th class="num">経費</th><th class="num">差引</th><th class="num">広告費の割合</th><th class="num">新規</th><th class="num">CPA</th></tr>
    ${rows.map(r => `<tr><td>${r.m.replace('-', '年')}月</td><td class="num">${yen(r.s)}</td><td class="num">${yen(r.ad)}</td><td class="num">${yen(r.c)}</td><td class="num ${r.rest < 0 ? 'down' : ''}">${yen(r.rest)}</td><td class="num">${pct(r.ad, r.s)}%</td><td class="num">${r.nw}人</td><td class="num">${r.nw && r.ad ? yen(r.ad / r.nw) : '-'}</td></tr>`).join('')}
    <tr><th>合計</th><th class="num">${yen(tot('s'))}</th><th class="num">${yen(tot('ad'))}</th><th class="num">${yen(tot('c'))}</th><th class="num">${yen(tot('rest'))}</th><th class="num">${pct(tot('ad'), tot('s'))}%</th><th class="num">${tot('nw')}人</th><th class="num">${tot('nw') && tot('ad') ? yen(tot('ad') / tot('nw')) : '-'}</th></tr></table></div></div>
  <div class="card"><h2>集客媒体別のCPA（${+AM.slice(5)}月）</h2><table><tr><th>媒体名</th><th class="num">新規来院数</th><th class="num">広告費</th><th class="num">CPA</th></tr>
    ${mediaRows.map(([n, c]) => { const a = adCost(AM, n); return `<tr><td>${esc(n)}</td><td class="num">${c}人</td><td class="num">${yen(a)}</td><td class="num">${a ? (c ? yen(a / c) : '新規なし') : '-'}</td></tr>`; }).join('') || '<tr><td colspan="4" class="muted">データがありません</td></tr>'}</table>
    <p class="muted">CPAが5,000円以下なら、広告の費用対効果が良い目安です（COCKPITの基準）。</p></div>`;
  bindMonth(aExpenses);
}
function groupChart(labels, sets, colors) {
  const W = 640, H = 200, P = { l: 44, r: 8, t: 10, b: 24 }, max = Math.max(1, ...sets.flat()), step = Math.max(1, niceStep(max)), top = Math.ceil(max / step) * step;
  const bw = (W - P.l - P.r) / labels.length, y = v => P.t + (H - P.t - P.b) * (1 - v / top); let g = '';
  for (let k = 0, v = 0; v <= top; k++, v = k * step) g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#eee"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#888">${manFmt(v)}</text>`;
  labels.forEach((l, i) => { const w = bw * .75 / sets.length; sets.forEach((s, j) => { const x = P.l + i * bw + bw * .125 + j * w; g += `<rect x="${x}" y="${y(s[i])}" width="${w - 1}" height="${y(0) - y(s[i])}" fill="${colors[j]}"><title>${l} ${manFmt(s[i])}</title></rect>`; });
    g += `<text x="${P.l + i * bw + bw / 2}" y="${H - 7}" text-anchor="middle" font-size="10" fill="#888">${l}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart">${g}</svg>`;
}
