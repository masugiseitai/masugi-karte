// ===== 共通 =====
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yen = n => (Math.round(n) || 0).toLocaleString('ja-JP') + '円';
const man = n => (n / 10000).toFixed(1) + '万円';
const today = () => ymd(new Date());
const fullName = c => c ? c.sei + ' ' + c.mei : '（不明）';
const kana = c => (c.seiKana || '') + ' ' + (c.meiKana || '');
const pmOf = id => Store.all('pms').find(p => p.id === id);
const settings = () => Store.all('settings');
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); }
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5); }
function hira(s) { return String(s || '').replace(/[ァ-ン]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s/g, ''); }

// ===== 集計の部品 =====
function visitsOf(cid) { return Store.all('visits').filter(v => v.customerId === cid).sort((a, b) => a.date.localeCompare(b.date)); }
function lastVisit(cid) { const v = visitsOf(cid); return v[v.length - 1]; }
function firstVisitDate(cid) { const v = visitsOf(cid); return v[0]?.date || ''; }
function salesOfVisit(v) { return v.items.reduce((s, it) => s + (pmOf(it.pm)?.noSales ? 0 : (+it.paid || 0)), 0); }
// 回数券・プリペイドの「財布」。購入ごとに1つ。古い物から使う
const TYPE_NAME = { normal: '通常', ticket: '回数券', prepaid: 'プリペイド' };
function grantFields(ref) {
  const t = ref.type || 'normal';
  return t === 'normal' || !ref.grant ? { grantType: '', grant: 0 } :
    { grantType: t, grant: +ref.grant, expireMonths: +ref.expireMonths || 0, expireFrom: ref.expireFrom || 'purchase', endOfMonth: !!ref.endOfMonth };
}
function expiryOf(w, lastDate) {
  if (!w.expireMonths) return '';
  const base = new Date(w.expireFrom === 'lastVisit' ? lastDate : w.bought);
  const d = new Date(base.getFullYear(), base.getMonth() + w.expireMonths, w.endOfMonth ? 0 : base.getDate());
  if (w.endOfMonth) d.setMonth(d.getMonth() + 1, 0);
  return ymd(d);
}
function wallets(cid, extraItems = [], onDate) {
  const ws = []; const vs = visitsOf(cid); const lastDate = vs[vs.length - 1]?.date || today();
  const all = vs.map(v => ({ date: v.date, items: v.items }));
  if (extraItems.length) all.push({ date: onDate || today(), items: extraItems });
  const isBuy = it => it.grant && it.grantType && it.pm !== 'ticket' && it.pm !== 'prepaid';
  all.forEach(v => [...v.items.filter(isBuy), ...v.items.filter(it => !isBuy(it))].forEach(it => {
    if (isBuy(it)) {
      ws.push({ type: it.grantType, name: it.name, bought: v.date, grant: it.grant, left: it.grant, expireMonths: it.expireMonths, expireFrom: it.expireFrom, endOfMonth: it.endOfMonth });
    }
    const use = it.pm === 'ticket' ? ['ticket', 1] : it.pm === 'prepaid' ? ['prepaid', +it.paid || 0] : null;
    if (use) {
      let need = use[1];
      ws.filter(w => w.type === use[0] && w.left > 0).forEach(w => { const exp = expiryOf(w, lastDate); if (need > 0 && (!exp || exp >= v.date)) { const t = Math.min(w.left, need); w.left -= t; need -= t; } });
      if (need > 0) ws.push({ type: use[0], name: '（残高不足）', bought: v.date, grant: 0, left: -need, short: true });
    }
  }));
  ws.forEach(w => { w.expires = expiryOf(w, lastDate); w.expired = !!w.expires && w.expires < today(); });
  return ws;
}
function balance(cid, type, extraItems, onDate) {
  return wallets(cid, extraItems, onDate).filter(w => w.type === type && (!w.expired || w.short)).reduce((s, w) => s + w.left, 0);
}
function ticketLeft(cid) { return balance(cid, 'ticket'); }
function nextExpiry(cid, type) { return wallets(cid).filter(w => w.type === type && w.left > 0 && !w.expired && w.expires).map(w => w.expires).sort()[0] || ''; }
function usualMenu(cid) {
  const vs = visitsOf(cid).reverse();
  for (const v of vs) for (const it of v.items) if (it.kind === 'menu' && !it.grant) return Store.get('menus', it.refId) || null;
  return null;
}
const activeList = (coll, keepId) => Store.all(coll).filter(x => !x.hidden || x.id === keepId);
function searchCustomers(q) {
  q = hira(q); if (!q) return [];
  return Store.all('customers').filter(c => {
    const k = hira(c.seiKana + c.meiKana), n = (c.sei + c.mei);
    return k.startsWith(q) || hira(c.seiKana).startsWith(q) || n.includes(q) || c.karte === q;
  }).slice(0, 12);
}
function newItem(kind = 'menu', refId, pm = 'cash') {
  const list = activeList(kind === 'menu' ? 'menus' : 'products');
  const ref = list.find(x => x.id === refId) || list[0];
  const p = pmOf(pm);
  return { kind, refId: ref.id, name: ref.name, price: ref.price, pm, paid: feeAmount(ref.price, p), ...grantFields(ref) };
}
function memoFrom(num, noSeitai) {
  const presets = settings().memoPresets;
  let m = presets[num - 1] || '';
  if (noSeitai) m = m.replace(/ ?整体/, '');
  return m;
}

// ===== 画面切り替え =====
const routes = { visit: viewVisit, bulk: viewBulk, customers: viewCustomers, customer: viewCustomer, sales: viewSales, visits: viewVisits, newcustomer: viewNewCustomer, master: viewMaster, a: viewAnalysis, expenses: viewExpenses, goal: viewGoal };
function router() {
  if (document.body.classList.contains('login') || !Store.all('menus').length) return;
  const [name, arg] = location.hash.replace(/^#\//, '').split('/');
  const r = routes[name] ? name : 'visit';
  document.querySelectorAll('.side a').forEach(a => a.classList.toggle('on', a.dataset.nav === (r === 'customer' ? 'customers' : r === 'master' ? 'master-' + arg : r === 'a' ? 'a-' + (A_PAGES[arg] ? arg : 'report') : r)));
  document.body.classList.remove('open');
  routes[r](arg);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', router);
$('#burger').onclick = () => document.body.classList.toggle(innerWidth <= 900 ? 'open' : 'closed');

// ===== 来院登録 =====
let VS = null; // 来院登録の入力状態
function viewVisit() {
  VS = { date: today(), customer: null, items: [], memo: '', memoNum: 0, noSeitai: false };
  renderVisit();
}
function renderVisit() {
  const c = VS.customer;
  const pms = activeList('pms');
  const lv = c && lastVisit(c.id);
  const tl = c ? ticketLeft(c.id) : 0;
  const pl = c ? balance(c.id, 'prepaid') : 0;
  const tAfter = c ? balance(c.id, 'ticket', VS.items, VS.date) : 0, pAfter = c ? balance(c.id, 'prepaid', VS.items, VS.date) : 0;
  const hasWallet = c && wallets(c.id).some(w => w.type);
  const kindName = it => it.kind === 'menu' ? 'メニュー' : '物販';
  $('#view').innerHTML = `
  <div class="grid2">
   <div class="card">
      <h2>来院登録</h2>
      <label>日付</label>
      <input type="date" id="vdate" value="${VS.date}">
      <label>顧客選択<span class="req">*</span></label>
      ${c ? `<div class="picked"><div><b>${esc(fullName(c))}</b> <span class="muted">${esc(kana(c))}・No.${esc(c.karte)}</span><br>
          <span class="muted">前回 ${lv ? lv.date + '（' + daysBetween(lv.date, VS.date) + '日前）' : 'なし'}</span></div>
          <button class="auto" id="unpick">変更</button></div>
          ${hasWallet || tAfter !== tl || pAfter !== pl ? `<div class="wallet">
            ${tl || tAfter !== tl ? `<div class="row"><div>回数券 残り <b>${tl}回</b>${nextExpiry(c.id, 'ticket') ? ' <span class="muted">期限 ' + nextExpiry(c.id, 'ticket').replace(/-/g, '/') + '</span>' : ''}
               ${tAfter !== tl ? ' → 登録後 <b class="' + (tAfter < 0 ? 'down' : '') + '">' + tAfter + '回</b>' : ''}</div>
               ${tl > 0 && !VS.items.some(x => x.pm === 'ticket') ? '<button class="primary auto" id="useTicket">回数券で施術</button>' : ''}</div>` : ''}
            ${pl || pAfter !== pl ? `<div class="row"><div>プリペイド残高 <b>${yen(pl)}</b>${pAfter !== pl ? ' → 登録後 <b class="' + (pAfter < 0 ? 'down' : '') + '">' + yen(pAfter) + '</b>' : ''}</div></div>` : ''}
          </div>` : ''}`
        : `<input id="q" placeholder="ひらがな・漢字・カルテ番号で入力してください" autocomplete="off" style="max-width:340px"><div class="results" id="res" hidden style="max-width:340px"></div>
           <p><button class="green" id="newc">+ 顧客新規登録</button></p><div id="newform"></div>`}
      ${c ? `
      ${VS.items.map((it, i) => `
       <div class="item">
        <div class="row"><label>${kindName(it)}${VS.items.filter((x, j) => j <= i && x.kind === it.kind).length}</label><button class="x auto" data-del="${i}" title="削除">×</button></div>
        <select data-i="${i}" data-f="ref">${activeList(it.kind === 'menu' ? 'menus' : 'products', it.refId).map(m => `<option value="${m.id}" ${m.id === it.refId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
        ${it.grant ? `<p class="muted" style="margin:6px 0 0">${TYPE_NAME[it.grantType]}を購入：${it.grantType === 'ticket' ? it.grant + '回分' : yen(it.grant) + '分'}${it.expireMonths ? '・期限 ' + it.expireMonths + 'ヶ月' : ''}</p>` : ''}
        <div class="row">
          <div><label>金額</label><input type="number" data-i="${i}" data-f="price" value="${it.price}"></div>
          <div><label>支払い方法</label><select data-i="${i}" data-f="pm">${activeList('pms', it.pm).map(p => `<option value="${p.id}" ${p.id === it.pm ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div><label>入金額${pmOf(it.pm)?.fee ? ' <span class="muted">手数料' + pmOf(it.pm).fee + '%引き</span>' : ''}</label><input type="number" data-i="${i}" data-f="paid" value="${it.paid}"></div>
        </div>
       </div>`).join('')}
      <div class="row" style="justify-content:flex-start"><button class="green auto" id="addMenu">+ メニュー</button><button class="green auto" id="addProd">+ 物販</button></div>
      <label>メモ</label>
      <div class="row" style="margin-bottom:6px;justify-content:flex-start">
        ${settings().memoPresets.map((m, i) => `<button class="chip auto ${VS.memoNum === i + 1 ? 'on' : ''}" data-memo="${i + 1}">${i + 1}：${esc(m)}</button>`).join('')}
        <button class="chip auto ${VS.noSeitai ? 'on' : ''}" id="noSeitai">整体なし</button>
      </div>
      <textarea id="memo">${esc(VS.memo)}</textarea>
      <p class="muted">前回のメモ：${esc(lv?.memo || 'なし')}</p>
      <label>登録スタッフ</label><select disabled style="max-width:200px"><option>${esc(settings().staff)}</option></select>
      <p class="row"><span>合計 <b style="font-size:18px">${yen(VS.items.reduce((s, it) => s + (+it.price || 0), 0))}</b>
        <span class="muted">（売上 ${yen(VS.items.reduce((s, it) => s + (pmOf(it.pm)?.noSales ? 0 : +it.paid || 0), 0))}）</span></span></p>
      <button class="primary" id="save" style="min-width:120px">登録</button>
      ` : `<p class="muted">患者さんを選ぶと、前回と同じメニュー・支払い・メモが入ります。</p>`}
   </div>
   ${todayList(VS.date)}
  </div>`;
  bindVisit();
}
function todayList(date) {
  const vs = Store.all('visits').filter(v => v.date === date);
  const byPm = {}; let total = 0;
  vs.forEach(v => v.items.forEach(i => { const n = pmOf(i.pm)?.name; byPm[n] = (byPm[n] || 0) + (+i.paid || 0); if (!pmOf(i.pm)?.noSales) total += +i.paid || 0; }));
  const people = new Set(vs.map(v => v.customerId)).size;
  return `<div class="card"><h2>${date === today() ? '本日' : date.replace(/-/g, '/') + ' に'}登録したデータ<a href="#/visits">来院一覧はこちら</a></h2>
  <table class="sum"><tr><th></th><th>金額</th></tr><tr><td>合計</td><td class="num">${total.toLocaleString()} 円</td></tr>
   ${Object.entries(byPm).map(([n, a]) => `<tr><td>${esc(n)}</td><td class="num">${a.toLocaleString()} 円</td></tr>`).join('')}</table>
  <div class="tablewrap"><table><tr><th>来院日</th><th>カルテ番号</th><th>名前</th><th>商品名</th><th>金額</th><th>支払方法</th><th>メモ</th><th></th></tr>
  ${vs.map(v => { const c = Store.get('customers', v.customerId); return `<tr><td>${v.date.replace(/-/g, '/')}</td><td>${esc(c?.karte)}</td><td><a href="#/customer/${v.customerId}">${esc(fullName(c))}</a></td>
    <td>${v.items.map(i => esc(i.name)).join('<br>')}</td><td class="num">${v.items.map(i => yen(i.paid)).join('<br>')}</td>
    <td>${v.items.map(i => esc(pmOf(i.pm)?.name)).join('<br>')}</td><td>${esc(v.memo)}</td>
    <td><button class="x" data-delv="${v.id}" title="取り消し">×</button></td></tr>`; }).join('') || '<tr><td colspan="8" class="muted">まだありません</td></tr>'}
  </table></div>
  <p class="muted">登録人数：${people}人<br>※同一人物を同じ日に２回以上登録した場合、１人とカウントされます</p></div>`;
}
function pickCustomer(c) {
  VS.customer = c;
  const lv = lastVisit(c.id);
  let items = lv ? lv.items.filter(it => !it.grant).map(it => ({ ...it })) : [];
  const tl = ticketLeft(c.id), um = usualMenu(c.id);
  if (lv && lv.items.some(it => it.grant) && tl > 0) items = [ticketUseItem(um)];
  items.forEach(it => { if (it.pm === 'ticket' && tl <= 0) { it.pm = 'cash'; it.paid = it.price; } });
  if (!items.length) items = [um ? newItem('menu', um.id, lv?.items[0]?.pm || 'cash') : newItem('menu', 'm7', 'cash')];
  VS.items = items;
  VS.memo = lv?.memo || ''; VS.memoNum = 0;
  renderVisit();
}
function ticketUseItem(menu) {
  const it = newItem('menu', menu?.id, 'ticket'); it.paid = it.price; return it;
}
function bindVisit() {
  const ut = $('#useTicket'); if (ut) ut.onclick = () => {
    const menu = usualMenu(VS.customer.id);
    const i = VS.items.findIndex(x => x.kind === 'menu' && !x.grant && x.pm !== 'ticket');
    if (i >= 0) { VS.items[i].pm = 'ticket'; VS.items[i].paid = VS.items[i].price; } else VS.items.push(ticketUseItem(menu));
    renderVisit();
  };
  $('#vdate').onchange = e => { VS.date = e.target.value; renderVisit(); };
  const q = $('#q');
  if (q) {
    q.focus();
    q.oninput = () => {
      const r = searchCustomers(q.value), box = $('#res');
      box.hidden = !q.value;
      box.innerHTML = r.map(c => { const lv = lastVisit(c.id); return `<div data-c="${c.id}"><span><b>${esc(fullName(c))}</b> <span class="muted">${esc(kana(c))}</span></span><span class="muted">No.${esc(c.karte)}・前回 ${lv ? lv.date : '-'}</span></div>`; }).join('') || '<div class="muted">見つかりません</div>';
      box.querySelectorAll('[data-c]').forEach(d => d.onclick = () => pickCustomer(Store.get('customers', d.dataset.c)));
    };
    q.onkeydown = e => { if (e.key === 'Enter') { const f = $('#res [data-c]'); if (f) f.click(); } };
    $('#newc').onclick = e => { e.preventDefault(); $('#newform').innerHTML = customerForm({}, true); bindCustomerForm({}, c => pickCustomer(c)); };
  }
  const un = $('#unpick'); if (un) un.onclick = () => { VS.customer = null; renderVisit(); };
  document.querySelectorAll('[data-f]').forEach(el => el.onchange = () => {
    const it = VS.items[el.dataset.i], f = el.dataset.f;
    if (f === 'ref') { const ref = Store.get(it.kind === 'menu' ? 'menus' : 'products', el.value); Object.assign(it, { refId: ref.id, name: ref.name, price: ref.price, paid: feeAmount(ref.price, pmOf(it.pm)) }, grantFields(ref)); }
    if (f === 'price') { it.price = +el.value; it.paid = it.pm === 'ticket' ? it.price : feeAmount(it.price, pmOf(it.pm)); }
    if (f === 'pm') { it.pm = el.value; it.paid = it.pm === 'ticket' ? it.price : feeAmount(it.price, pmOf(it.pm)); }
    if (f === 'paid') it.paid = +el.value;
    renderVisit();
  });
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { VS.items.splice(+b.dataset.del, 1); renderVisit(); });
  const am = $('#addMenu'); if (am) am.onclick = () => { VS.items.push(newItem('menu', null, VS.items[0]?.pm || 'cash')); renderVisit(); };
  const ap = $('#addProd'); if (ap) ap.onclick = () => { VS.items.push(newItem('product', null, VS.items[0]?.pm || 'cash')); renderVisit(); };
  document.querySelectorAll('[data-memo]').forEach(b => b.onclick = () => { VS.memoNum = +b.dataset.memo; VS.memo = memoFrom(VS.memoNum, VS.noSeitai); renderVisit(); });
  const ns = $('#noSeitai'); if (ns) ns.onclick = () => { VS.noSeitai = !VS.noSeitai; VS.memo = VS.memoNum ? memoFrom(VS.memoNum, VS.noSeitai) : (VS.noSeitai ? VS.memo.replace(/ ?整体/, '') : VS.memo); renderVisit(); };
  const mm = $('#memo'); if (mm) mm.oninput = () => { VS.memo = mm.value; };
  const sv = $('#save'); if (sv) sv.onclick = () => {
    if (!VS.items.length) return toast('メニューを入れてください');
    const tA = balance(VS.customer.id, 'ticket', VS.items, VS.date), pA = balance(VS.customer.id, 'prepaid', VS.items, VS.date);
    if ((tA < 0 || pA < 0) && !confirm('回数券・プリペイドの残りが足りません。このまま登録しますか？')) return;
    Store.put('visits', { date: VS.date, customerId: VS.customer.id, staff: settings().staff, items: VS.items, memo: VS.memo });
    toast(fullName(VS.customer) + 'さんを登録しました');
    const d = VS.date; viewVisit(); VS.date = d; renderVisit();
  };
  document.querySelectorAll('[data-delv]').forEach(b => b.onclick = () => { if (confirm('この登録を取り消しますか？')) { Store.del('visits', b.dataset.delv); renderVisit(); } });
}

// ===== まとめて登録 =====
let BS = null;
function parseBulk(t) {
  t = t.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const out = []; const re = /([^\s、,。・\d]+?)(?:さん|様|くん)\s*(\d|いち|に)?/g; let m;
  while ((m = re.exec(t))) out.push({ name: m[1], num: m[2] === 'いち' ? 1 : m[2] === 'に' ? 2 : m[2] ? +m[2] : 0 });
  if (!out.length) t.split(/[\s、,]+/).filter(Boolean).forEach(tok => { const mm = tok.match(/^(.+?)(\d)?$/); out.push({ name: mm[1], num: mm[2] ? +mm[2] : 0 }); });
  return out;
}
function matchName(name) {
  const n = name.replace(/\s/g, ''), h = hira(n);
  return Store.all('customers').filter(c => c.sei === n || c.sei + c.mei === n || hira(c.seiKana) === h || hira(c.seiKana + c.meiKana) === h);
}
function viewBulk() { BS = BS || { date: today(), text: '', noSeitai: false, rows: [] }; renderBulk(); }
function renderBulk() {
  const menus = activeList('menus'), pms = activeList('pms');
  $('#view').innerHTML = `
  <h1>まとめて登録 <small>音声入力から一括で来院登録</small></h1>
  <div class="card">
    <p class="muted" style="margin-top:0">音声入力そのままでOK。「細井さん1 増茂さん2 鈴木さん」のように書くと、前回と同じメニュー・支払いで並びます。数字はメモ（1・2・3）です。</p>
    <div class="row"><div><label>来院日</label><input type="date" id="bdate" value="${BS.date}"></div>
      <div class="auto"><label>&nbsp;</label><button class="chip ${BS.noSeitai ? 'on' : ''}" id="bns">今日は全員 整体なし</button></div></div>
    <label>今日来た人</label>
    <textarea id="btext" placeholder="山田さん1 佐藤さん2 鈴木さん">${esc(BS.text)}</textarea>
    <br><br><button class="primary" id="bparse">読み取る</button>
  </div>
  ${BS.rows.length ? `<div class="card"><h2>確認（${BS.rows.length}人）</h2><div class="tablewrap"><table>
   <tr><th>読み取り</th><th>患者さん</th><th>メニュー</th><th>支払い</th><th class="num">入金</th><th>メモ</th></tr>
   ${BS.rows.map((r, i) => `<tr>
    <td>${esc(r.name)}${r.num ? '（' + r.num + '）' : ''}</td>
    <td>${r.cands.length ? `<select data-r="${i}" data-f="cid">${r.cands.map(c => `<option value="${c.id}" ${c.id === r.cid ? 'selected' : ''}>${esc(fullName(c))}</option>`).join('')}</select>${r.cands.length > 1 ? '<div class="muted">候補が' + r.cands.length + '人</div>' : ''}` : '<span class="down">見つかりません</span>'}</td>
    <td>${r.cid ? `<select data-r="${i}" data-f="menu">${menus.map(m => `<option value="${m.id}" ${m.id === r.item.refId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>` : ''}</td>
    <td>${r.cid ? `<select data-r="${i}" data-f="pm">${pms.map(p => `<option value="${p.id}" ${p.id === r.item.pm ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>${r.ticketLeft > 0 ? '<div class="muted">回数券 残り' + r.ticketLeft + '回</div>' : ''}` : ''}</td>
    <td class="num">${r.cid ? yen(r.item.paid) : ''}</td>
    <td>${r.cid ? `<input data-r="${i}" data-f="memo" value="${esc(r.memo)}">` : ''}</td></tr>`).join('')}
   </table></div><br><button class="primary big" id="bsave">${BS.rows.filter(r => r.cid).length}人をまとめて登録する</button></div>` : ''}
  ${todayList(BS.date)}`;
  $('#bdate').onchange = e => { BS.date = e.target.value; renderBulk(); };
  $('#btext').oninput = e => { BS.text = e.target.value; };
  $('#bns').onclick = () => { BS.noSeitai = !BS.noSeitai; if (BS.rows.length) buildRows(); renderBulk(); };
  $('#bparse').onclick = () => { buildRows(); renderBulk(); };
  document.querySelectorAll('[data-r]').forEach(el => el.onchange = () => {
    const r = BS.rows[el.dataset.r], f = el.dataset.f;
    if (f === 'cid') { r.cid = el.value; fillRow(r); }
    if (f === 'menu') { const m = Store.get('menus', el.value); Object.assign(r.item, { refId: m.id, name: m.name, price: m.price, paid: r.item.pm === 'ticket' ? m.price : feeAmount(m.price, pmOf(r.item.pm)) }, grantFields(m)); }
    if (f === 'pm') { r.item.pm = el.value; r.item.paid = el.value === 'ticket' ? r.item.price : feeAmount(r.item.price, pmOf(el.value)); }
    if (f === 'memo') r.memo = el.value;
    renderBulk();
  });
  const bs = $('#bsave'); if (bs) bs.onclick = () => {
    const ok = BS.rows.filter(r => r.cid);
    ok.forEach(r => Store.put('visits', { date: BS.date, customerId: r.cid, staff: settings().staff, items: [{ ...r.item }], memo: r.memo }));
    toast(ok.length + '人を登録しました');
    BS = { date: BS.date, text: '', noSeitai: false, rows: [] }; renderBulk();
  };
}
function buildRows() {
  BS.rows = parseBulk(BS.text).map(p => { const cands = matchName(p.name); const r = { ...p, cands, cid: cands[0]?.id || '' }; fillRow(r); return r; });
}
function fillRow(r) {
  if (!r.cid) return;
  const lv = lastVisit(r.cid);
  const tl = ticketLeft(r.cid), um = usualMenu(r.cid);
  const base = lv?.items.find(i => i.kind === 'menu' && !i.grant) || (lv?.items.some(i => i.grant) && tl > 0 ? ticketUseItem(um) : null) || (um ? newItem('menu', um.id, 'cash') : newItem('menu', 'm7', 'cash'));
  r.item = { ...base };
  if (r.item.pm === 'ticket' && tl <= 0) { r.item.pm = 'cash'; r.item.paid = r.item.price; }
  r.ticketLeft = tl;
  r.memo = r.num ? memoFrom(r.num, BS.noSeitai) : (BS.noSeitai ? (lv?.memo || '').replace(/ ?整体/, '') : (lv?.memo || ''));
}

// ===== 顧客 =====
let CF = { q: '', filter: 'all' };
function customerRows() {
  const dd = settings().dormantDays, t = today(), ym = t.slice(0, 7);
  return Store.all('customers').map(c => {
    const vs = visitsOf(c.id); const last = vs[vs.length - 1]?.date || ''; const first = vs[0]?.date || '';
    return { c, first, last, ago: last ? daysBetween(last, t) : null, count: vs.length, total: vs.reduce((s, v) => s + salesOfVisit(v), 0), isNew: first.startsWith(ym), dormant: last && daysBetween(last, t) >= dd };
  });
}
function viewCustomers() {
  let rows = customerRows();
  const q = hira(CF.q);
  if (q) rows = rows.filter(r => hira(r.c.seiKana + r.c.meiKana).includes(q) || (r.c.sei + r.c.mei).includes(CF.q) || r.c.karte === CF.q);
  if (CF.filter === 'active') rows = rows.filter(r => !r.dormant);
  if (CF.filter === 'dormant') rows = rows.filter(r => r.dormant);
  if (CF.filter === 'new') rows = rows.filter(r => r.isNew);
  if (CF.filter === 'ticket') rows = rows.filter(r => ticketLeft(r.c.id) > 0 || balance(r.c.id, 'prepaid') > 0);
  rows.sort((a, b) => (b.last || '').localeCompare(a.last || ''));
  const all = customerRows();
  const f = (k, l, n) => `<button class="chip auto ${CF.filter === k ? 'on' : ''}" data-cf="${k}">${l}（${n}）</button>`;
  $('#view').innerHTML = `
  <div class="row"><h1>顧客一覧</h1><div class="auto"><button class="green" id="addc">+ 顧客新規登録</button></div></div>
  <div class="card">
    <input id="cq" placeholder="名前・ふりがな・カルテ番号で探す" value="${esc(CF.q)}">
    <div class="row" style="margin-top:10px">${f('all', '全員', all.length)}${f('active', '通院中', all.filter(r => !r.dormant).length)}${f('dormant', '休眠 ' + settings().dormantDays + '日以上', all.filter(r => r.dormant).length)}${f('new', '今月の新規', all.filter(r => r.isNew).length)}${f('ticket', '回数券・プリペイド残りあり', all.filter(r => ticketLeft(r.c.id) > 0 || balance(r.c.id, 'prepaid') > 0).length)}</div>
  </div>
  <div id="newform"></div>
  <div class="card tablewrap"><table>
   <tr><th>No.</th><th>名前</th><th>主訴</th><th>媒体</th><th>初回</th><th>最終来院</th><th class="num">回数</th><th class="num">累計</th></tr>
   ${rows.map(r => `<tr><td>${esc(r.c.karte)}</td><td><a href="#/customer/${r.c.id}"><b>${esc(fullName(r.c))}</b></a><div class="muted">${esc(kana(r.c))}</div></td>
     <td>${esc(r.c.chief)}</td><td>${esc(r.c.media)}</td><td>${r.first}</td>
     <td>${r.last}<div>${r.dormant ? `<span class="tag dormant">${r.ago}日来ていない</span>` : r.ago != null ? `<span class="muted">${r.ago}日前</span>` : ''}${r.isNew ? ' <span class="tag new">新規</span>' : ''}</div></td>
     <td class="num">${r.count}回</td><td class="num">${yen(r.total)}</td></tr>`).join('')}
  </table></div>`;
  const cq = $('#cq'); cq.oninput = () => { CF.q = cq.value; const pos = cq.selectionStart; viewCustomers(); const n = $('#cq'); n.focus(); n.setSelectionRange(pos, pos); };
  document.querySelectorAll('[data-cf]').forEach(b => b.onclick = () => { CF.filter = b.dataset.cf; viewCustomers(); });
  $('#addc').onclick = () => { $('#newform').innerHTML = `<div class="card">${customerForm({}, true)}</div>`; bindCustomerForm({}, c => { location.hash = '#/customer/' + c.id; }); };
}
function customerForm(c, isNew) {
  const sym = Store.all('symptoms'), med = Store.all('media');
  const nextKarte = String(Math.max(1000, ...Store.all('customers').map(x => +x.karte || 0)) + 1);
  return `<h2>${isNew ? '新規の方を登録' : '基本情報'}</h2>
  <div class="row"><div><label>姓</label><input id="f_sei" value="${esc(c.sei)}"></div><div><label>名</label><input id="f_mei" value="${esc(c.mei)}"></div></div>
  <div class="row"><div><label>せい</label><input id="f_seiKana" value="${esc(c.seiKana)}"></div><div><label>めい</label><input id="f_meiKana" value="${esc(c.meiKana)}"></div></div>
  <div class="row"><div><label>カルテ番号</label><input id="f_karte" value="${esc(c.karte || nextKarte)}"></div>
    <div><label>性別</label><select id="f_gender">${['男性', '女性', '無回答'].map(g => `<option ${g === (c.gender || '男性') ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
    <div><label>生年月日</label><input type="date" id="f_birth" value="${esc(c.birth)}"></div></div>
  <div class="row"><div><label>電話番号</label><input id="f_tel" inputmode="tel" value="${esc(c.tel)}"></div><div><label>メール</label><input id="f_email" value="${esc(c.email)}"></div></div>
  <label>住所</label><input id="f_address" value="${esc(c.address)}">
  <div class="row" style="align-items:flex-start"><div><label>主訴</label><select id="f_chief"><option></option>${sym.map(s => `<option ${s === c.chief ? 'selected' : ''}>${esc(s)}</option>`).join('')}<option value="__other">その他（書き込む）</option></select>
      <input id="f_chiefOther" placeholder="主訴を書き込んでください（次から選択肢に出ます）" style="margin-top:6px" hidden></div>
    <div><label>集客媒体</label><select id="f_media"><option></option>${med.map(s => `<option ${s === c.media ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div></div>
  <label>特記事項</label><textarea id="f_note">${esc(c.note)}</textarea>
  <br><br><button class="primary" id="f_save">${isNew ? '登録する' : '保存する'}</button>`;
}
function bindCustomerForm(c, after) {
  $('#f_chief').onchange = e => { const o = $('#f_chiefOther'); o.hidden = e.target.value !== '__other'; if (!o.hidden) o.focus(); };
  $('#f_save').onclick = () => {
    const keys = ['sei', 'mei', 'seiKana', 'meiKana', 'karte', 'gender', 'birth', 'tel', 'email', 'address', 'chief', 'media', 'note'];
    keys.forEach(k => c[k] = $('#f_' + k).value.trim());
    if (c.chief === '__other') {
      const other = $('#f_chiefOther').value.trim();
      if (!other) return toast('主訴を書き込んでください');
      c.chief = other;
      if (!Store.all('symptoms').includes(other)) { Store.addValue('symptoms', other); var addMsg = '（主訴に「' + other + '」を追加しました）'; }
    }
    if (!c.sei) return toast('姓を入れてください');
    c.seiKana = hira(c.seiKana); c.meiKana = hira(c.meiKana); c.tags = c.tags || [];
    const saved = Store.put('customers', c); toast('保存しました' + (typeof addMsg !== 'undefined' && addMsg ? addMsg : '')); after(saved);
  };
}
function viewCustomer(id) {
  const c = Store.get('customers', id); if (!c) return viewCustomers();
  const vs = visitsOf(id).reverse(), total = vs.reduce((s, v) => s + salesOfVisit(v), 0), last = vs[0]?.date;
  const tl = ticketLeft(id), ago = last ? daysBetween(last, today()) : null;
  $('#view').innerHTML = `
  <p><a href="#/customers">← 顧客一覧</a></p>
  <h1>${esc(fullName(c))} <span class="muted">${esc(kana(c))}・No.${esc(c.karte)}</span></h1>
  <div class="kpis">
    <div class="kpi"><div class="s">来院回数</div><div class="v">${vs.length}回</div></div>
    <div class="kpi"><div class="s">累計（LTV）</div><div class="v">${man(total)}</div></div>
    <div class="kpi"><div class="s">最終来院</div><div class="v">${ago != null ? ago + '日前' : '-'}</div><div class="s">${last || ''}</div></div>
    <div class="kpi"><div class="s">回数券 残り</div><div class="v">${tl > 0 ? tl + '回' : '-'}</div></div>
  </div><br>
  <div class="grid2 even">
    <div class="card">${customerForm(c, false)}</div>
    ${wallets(id).some(w => w.type) ? `<div class="card"><h2>回数券・プリペイド</h2><div class="tablewrap"><table>
      <tr><th>種類</th><th>名前</th><th>購入日</th><th class="num">付与</th><th class="num">残り</th><th>期限</th></tr>
      ${wallets(id).map(w => `<tr><td>${TYPE_NAME[w.type]}</td><td>${esc(w.name)}</td><td>${w.bought.replace(/-/g, '/')}</td>
        <td class="num">${w.type === 'ticket' ? w.grant + '回' : yen(w.grant)}</td><td class="num ${w.left < 0 ? 'down' : ''}">${w.type === 'ticket' ? w.left + '回' : yen(w.left)}</td>
        <td>${w.expires ? w.expires.replace(/-/g, '/') : 'なし'}${w.expired ? ' <span class="tag dormant">期限切れ</span>' : ''}</td></tr>`).join('')}
    </table></div></div>` : ''}
    <div class="card"><h2>来院履歴</h2><div class="tablewrap"><table><tr><th>日付</th><th>内容</th><th class="num">入金</th><th>メモ</th></tr>
      ${vs.map(v => `<tr><td>${v.date}</td><td>${v.items.map(i => esc(i.name) + ' <span class="muted">' + esc(pmOf(i.pm)?.name) + '</span>').join('<br>')}</td><td class="num">${yen(salesOfVisit(v))}</td><td>${esc(v.memo)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">まだありません</td></tr>'}
    </table></div></div>
  </div>`;
  bindCustomerForm(c, () => viewCustomer(id));
}

// ===== 売上 =====
let SM = today().slice(0, 7);
function monthStats(ym) {
  const vs = Store.all('visits').filter(v => v.date.startsWith(ym));
  const sales = vs.reduce((s, v) => s + salesOfVisit(v), 0);
  const nobe = vs.length;
  const people = new Set(vs.map(v => v.customerId)).size;
  const newc = Store.all('customers').filter(c => firstVisitDate(c.id).startsWith(ym)).length;
  return { ym, vs, sales, nobe, people, newc, unit: nobe ? sales / nobe : 0 };
}
function addMonth(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return ymd(d).slice(0, 7); }
function cmp(a, b) { if (!b) return '<span class="muted">-</span>'; const r = (a / b - 1) * 100; return `<span class="${r >= 0 ? 'up' : 'down'}">${r >= 0 ? '+' : ''}${r.toFixed(1)}%</span>`; }
function viewSales() {
  const cur = monthStats(SM), prev = monthStats(addMonth(SM, -1)), prev2 = monthStats(addMonth(SM, -2)), ly = monthStats(addMonth(SM, -12));
  const hist = Array.from({ length: 13 }, (_, i) => monthStats(addMonth(SM, i - 12)));
  const max = Math.max(1, ...hist.map(h => h.sales));
  const byPm = {}, byMenu = {}; let treat = 0, prod = 0;
  cur.vs.forEach(v => v.items.forEach(it => {
    const p = pmOf(it.pm); const amt = p?.noSales ? 0 : +it.paid || 0;
    byPm[p?.name] = byPm[p?.name] || { n: 0, amt: 0 }; byPm[p?.name].n++; byPm[p?.name].amt += +it.paid || 0;
    byMenu[it.name] = byMenu[it.name] || { n: 0, amt: 0 }; byMenu[it.name].n++; byMenu[it.name].amt += amt;
    it.kind === 'menu' ? (treat += amt) : (prod += amt);
  }));
  const [y, m] = SM.split('-');
  const ICON = {
    yen: '<svg class="ico" viewBox="0 0 54 54"><circle cx="27" cy="27" r="25" fill="#d6ecc4"/><text x="27" y="36" text-anchor="middle" font-size="26" fill="#fff" font-weight="700">¥</text></svg>',
    folder: '<svg class="ico" viewBox="0 0 54 54"><path d="M4 14h18l4 5h24v25H4z" fill="#cfe6b5"/><path d="M21 31h12M27 25v12" stroke="#fff" stroke-width="3"/></svg>',
    person: '<svg class="ico" viewBox="0 0 54 54"><circle cx="27" cy="15" r="9" fill="#a9d4f5"/><path d="M13 50V34a14 14 0 0128 0v16z" fill="#a9d4f5"/></svg>',
    people: '<svg class="ico" viewBox="0 0 54 54"><path d="M5 19h10M10 14v10" stroke="#a9d4f5" stroke-width="3"/><circle cx="34" cy="14" r="7" fill="#a9d4f5"/><path d="M24 48V32a10 10 0 0120 0v16z" fill="#cfe6b5"/></svg>',
  };
  const k = (ico, l, v, sub) => `<div class="kpi"><div class="head">${ICON[ico]}<div><div class="s">${l}</div><div class="v">${v}</div></div></div><div class="foot">${sub}</div></div>`;
  const u = (n, unit) => `${n}<small>${unit}</small>`;
  const line = s => `${s.ym.replace('-', '年')}月　売上 ${yen(s.sales)}／客数(のべ) ${s.nobe}人／客単価 ${yen(s.unit)}`;
  $('#view').innerHTML = `
  <div class="row"><h1>ダッシュボード <small>${+y}年${+m}月</small></h1><div class="auto monthsel">月選択 <button id="pm">◀ 前月</button><button id="nm">翌月 ▶</button></div></div>
  <div class="kpis">
    ${k('yen', '売上', u((cur.sales / 10000).toFixed(1), '万円'), (SM === today().slice(0, 7) ? '今月予測 <b>' + man(cur.sales / new Date().getDate() * new Date(+y, +m, 0).getDate()) + '</b><br>' : '') + (goalOf(SM) ? '目標達成見込 <b>' + pct(SM === today().slice(0, 7) ? cur.sales / new Date().getDate() * new Date(+y, +m, 0).getDate() : cur.sales, goalOf(SM)) + '%</b>・目標まで <b>' + man(Math.max(0, goalOf(SM) - cur.sales)) + '</b><br>' : '') + '前月比 ' + cmp(cur.sales, prev.sales) + '・前年比 ' + cmp(cur.sales, ly.sales))}
    ${k('folder', '来院顧客数', u(cur.people, '人'), 'のべ来院数 <b>' + cur.nobe + '人</b>・前年比 ' + cmp(cur.nobe, ly.nobe))}
    ${k('person', '新規顧客数', u(cur.newc, '人'), 'CPA <b>' + (cur.newc && adCost(SM) ? yen(adCost(SM) / cur.newc) : '-') + '</b>・前年同月 ' + ly.newc + '人・前月 ' + prev.newc + '人')}
    ${k('people', '顧客単価', u(Math.round(cur.unit).toLocaleString(), '円'), '前月比 ' + cmp(cur.unit, prev.unit) + '・前年比 ' + cmp(cur.unit, ly.unit))}
  </div>
  <div class="card"><h2>月ごとの売上（13ヶ月）</h2>
    <div class="bars">${hist.map(h => `<div class="b ${h.ym === SM ? 'cur' : ''}" style="height:${h.sales / max * 100}%"><em>${h.sales ? (h.sales / 10000).toFixed(0) : ''}</em><span>${+h.ym.slice(5)}月</span></div>`).join('')}</div><br>
  </div>
  <div class="grid2 even">
    <div class="card"><h2>支払い方法別</h2><table><tr><th>支払い</th><th class="num">件数</th><th class="num">金額</th></tr>
      ${Object.entries(byPm).map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">${v.n}</td><td class="num">${yen(v.amt)}</td></tr>`).join('')}</table>
      <p class="muted">施術 ${yen(treat)}／物販 ${yen(prod)}。回数券・プリペイドで払った分は売上に入れていません。</p></div>
    <div class="card"><h2>メニュー・物販別</h2><table><tr><th>名前</th><th class="num">回数</th><th class="num">売上</th></tr>
      ${Object.entries(byMenu).sort((a, b) => b[1].amt - a[1].amt).map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">${v.n}</td><td class="num">${yen(v.amt)}</td></tr>`).join('')}</table></div>
  </div>
  <div class="card"><h2>前川メソッド 月次フォーム用</h2>
    <div class="copybox" id="mf">${esc([line(cur), line(prev), line(prev2), line(ly)].join('\n'))}</div><br>
    <button id="copy">コピー</button></div>
  ${Store.cloud ? '' : '<p class="muted">試作版：データはこのブラウザの中だけに保存されています。<a href="#" id="reset">サンプルデータに戻す</a></p>'}`;
  $('#pm').onclick = () => { SM = addMonth(SM, -1); viewSales(); };
  $('#nm').onclick = () => { SM = addMonth(SM, 1); viewSales(); };
  $('#copy').onclick = () => { navigator.clipboard.writeText($('#mf').textContent).then(() => toast('コピーしました')); };
  if ($('#reset')) $('#reset').onclick = e => { e.preventDefault(); if (confirm('入力したデータを消して、サンプルに戻しますか？')) { Store.reset(); viewSales(); } };
}

// ===== 来院一覧 =====
let VM = today().slice(0, 7);
function viewVisits() {
  const vs = Store.all('visits').filter(v => v.date.startsWith(VM)).sort((a, b) => b.date.localeCompare(a.date));
  const [y, m] = VM.split('-');
  $('#view').innerHTML = `
  <div class="row"><h1>来院一覧 <small>${+y}年${+m}月</small></h1><div class="auto monthsel">期間選択 <button id="pm">◀ 前月</button><button id="nm">翌月 ▶</button></div></div>
  <div class="card tablewrap"><table><tr><th>来院日</th><th>カルテ番号</th><th>名前</th><th>商品名</th><th>金額</th><th>支払方法</th><th>担当</th><th>メモ</th></tr>
  ${vs.map(v => { const c = Store.get('customers', v.customerId); return `<tr><td>${v.date.replace(/-/g, '/')}</td><td>${esc(c?.karte)}</td><td><a href="#/customer/${v.customerId}">${esc(fullName(c))}</a></td>
    <td>${v.items.map(i => esc(i.name)).join('<br>')}</td><td class="num">${v.items.map(i => yen(i.paid)).join('<br>')}</td>
    <td>${v.items.map(i => esc(pmOf(i.pm)?.name)).join('<br>')}</td><td>${esc(v.staff)}</td><td>${esc(v.memo)}</td></tr>`; }).join('') || '<tr><td colspan="8" class="muted">この月の来院はありません</td></tr>'}
  </table><p class="muted">${vs.length}件・売上 ${yen(vs.reduce((s, v) => s + salesOfVisit(v), 0))}</p></div>`;
  $('#pm').onclick = () => { VM = addMonth(VM, -1); viewVisits(); };
  $('#nm').onclick = () => { VM = addMonth(VM, 1); viewVisits(); };
}
// ===== 顧客新規登録 =====
function viewNewCustomer() {
  $('#view').innerHTML = `<div class="grid2 even"><div class="card">${customerForm({}, true)}</div></div>`;
  bindCustomerForm({}, c => { location.hash = '#/customer/' + c.id; });
}

// ===== 設定（メニュー・物販・支払い方法・症状・集客媒体・メモのボタン） =====
const MASTER = {
  menus: { title: 'メニュー', kind: 'item', minutes: true },
  products: { title: '物販', kind: 'item' },
  pms: { title: '支払い方法', kind: 'pm' },
  symptoms: { title: '症状', kind: 'text' },
  media: { title: '集客媒体', kind: 'text' },
  memo: { title: 'メモのボタン', kind: 'memo' },
};
function viewMaster(coll) {
  const M = MASTER[coll] || MASTER.menus; coll = MASTER[coll] ? coll : 'menus';
  const used = new Set(); Store.all('visits').forEach(v => v.items.forEach(i => { used.add(i.refId); used.add(i.pm); }));
  Store.all('customers').forEach(c => { used.add(c.chief); used.add(c.media); });
  const mv = (i, n) => `<button class="x" data-mv="${i}" data-d="-1" title="上へ"${i === 0 ? ' disabled' : ''}>↑</button><button class="x" data-mv="${i}" data-d="1" title="下へ"${i === n - 1 ? ' disabled' : ''}>↓</button>`;
  let body = '';
  if (M.kind === 'item') {
    const list = Store.all(coll);
    body = `<div class="tablewrap"><table class="master"><tr><th>名前</th><th>価格(税込)</th>${M.minutes ? '<th>予約枠(分)</th>' : ''}<th>種別</th><th>付与数</th><th>利用期限</th><th>非表示</th><th>並べ替え</th><th></th></tr>
    ${list.map((m, i) => `<tr data-row="${i}">
      <td><input data-k="name" value="${esc(m.name)}" style="min-width:190px"></td>
      <td><input data-k="price" type="number" value="${m.price}" style="width:100px"></td>
      ${M.minutes ? `<td><input data-k="minutes" type="number" value="${m.minutes || 0}" style="width:70px"></td>` : ''}
      <td><select data-k="type" style="width:110px">${Object.entries(TYPE_NAME).map(([k, v]) => `<option value="${k}" ${k === (m.type || 'normal') ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td>${m.type && m.type !== 'normal' ? `<input data-k="grant" type="number" value="${m.grant || 0}" style="width:90px"> <span class="muted">${m.type === 'ticket' ? '回' : '円'}</span>` : '-'}</td>
      <td>${m.type && m.type !== 'normal' ? `<div class="row" style="flex-wrap:nowrap"><input data-k="expireMonths" type="number" value="${m.expireMonths || 0}" style="width:60px"><span class="auto muted">ヶ月</span>
        <select data-k="expireFrom" style="width:120px"><option value="purchase" ${m.expireFrom !== 'lastVisit' ? 'selected' : ''}>購入日から</option><option value="lastVisit" ${m.expireFrom === 'lastVisit' ? 'selected' : ''}>最終来院日から</option></select>
        <label class="auto" style="margin:0;font-weight:400;white-space:nowrap"><input type="checkbox" data-k="endOfMonth" ${m.endOfMonth ? 'checked' : ''} style="width:auto;height:auto"> 月末</label></div><div class="muted">0ヶ月＝期限なし</div>` : '-'}</td>
      <td><input type="checkbox" data-k="hidden" ${m.hidden ? 'checked' : ''} style="width:auto;height:auto"></td>
      <td>${mv(i, list.length)}</td>
      <td>${used.has(m.id) ? '' : `<button class="x" data-rm="${i}" title="削除">×</button>`}</td></tr>`).join('')}
    </table></div><p><button class="green" id="addRow">+ ${M.title}を追加</button></p>
    <p class="muted">回数券・プリペイドにすると、来院登録で売ったときに残り回数（残高）がつきます。使ったことのある項目は削除できないので、使わなくなったら「非表示」にしてください。</p>`;
  } else if (M.kind === 'pm') {
    const list = Store.all('pms');
    body = `<div class="tablewrap"><table class="master"><tr><th>名前</th><th>手数料(%)</th><th>売上に入れる</th><th>非表示</th><th>並べ替え</th><th></th></tr>
    ${list.map((p, i) => `<tr data-row="${i}"><td><input data-k="name" value="${esc(p.name)}" style="min-width:160px"></td>
      <td><input data-k="fee" type="number" step="0.01" value="${p.fee || 0}" style="width:90px"></td>
      <td>${p.id === 'ticket' || p.id === 'prepaid' ? '<span class="muted">入れない（購入時に計上）</span>' : `<input type="checkbox" data-k="sales" ${p.noSales ? '' : 'checked'} style="width:auto;height:auto">`}</td>
      <td><input type="checkbox" data-k="hidden" ${p.hidden ? 'checked' : ''} style="width:auto;height:auto"></td><td>${mv(i, list.length)}</td>
      <td>${used.has(p.id) || p.id === 'ticket' || p.id === 'prepaid' ? '' : `<button class="x" data-rm="${i}" title="削除">×</button>`}</td></tr>`).join('')}
    </table></div><p><button class="green" id="addRow">+ 支払い方法を追加</button></p>
    <p class="muted">クレジットカードの手数料を入れておくと、来院登録で入金額が自動で計算されます。</p>`;
  } else if (M.kind === 'text') {
    const list = Store.all(coll);
    body = `<table class="master" style="max-width:640px"><tr><th>${M.title}名</th><th>並べ替え</th><th></th></tr>
    ${list.map((t, i) => `<tr data-row="${i}"><td><input data-k="text" value="${esc(t)}"></td><td>${mv(i, list.length)}</td><td>${used.has(t) ? '' : `<button class="x" data-rm="${i}" title="削除">×</button>`}</td></tr>`).join('')}
    </table><p><button class="green" id="addRow">+ ${M.title}を追加</button></p>`;
  } else {
    const list = settings().memoPresets;
    body = `<table class="master" style="max-width:640px"><tr><th>ボタン</th><th>入る文字</th></tr>
    ${list.map((t, i) => `<tr data-row="${i}"><td>${i + 1}</td><td><input data-k="text" value="${esc(t)}"></td></tr>`).join('')}</table>
    <p class="muted">来院登録・まとめて登録の「1・2・3」で入る文字です。「整体なし」を押すと「整体」の文字だけ消えます。</p>`;
  }
  $('#view').innerHTML = `<h1>${M.title}の設定</h1><div class="card">${body}</div>`;

  const save = list => { coll === 'memo' ? (settings().memoPresets = list, Store.setAll('settings', settings())) : Store.setAll(coll, list); };
  const getList = () => coll === 'memo' ? settings().memoPresets.slice() : Store.all(coll).slice();
  document.querySelectorAll('[data-k]').forEach(el => el.onchange = () => {
    const i = +el.closest('tr').dataset.row, k = el.dataset.k, list = getList();
    if (M.kind === 'text' || M.kind === 'memo') {
      const v = el.value.trim(); if (!v) return toast('空にはできません');
      const old = list[i]; list[i] = v; save(list);
      if (M.kind === 'text') Store.all('customers').forEach(c => { if (coll === 'symptoms' && c.chief === old) { c.chief = v; Store.put('customers', c); } if (coll === 'media' && c.media === old) { c.media = v; Store.put('customers', c); } });
    } else {
      const o = list[i];
      if (el.type === 'checkbox') { if (k === 'sales') o.noSales = !el.checked; else o[k] = el.checked; }
      else o[k] = ['price', 'minutes', 'grant', 'expireMonths', 'fee'].includes(k) ? +el.value : el.value;
      save(list);
    }
    toast('保存しました'); viewMaster(coll);
  });
  document.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => {
    const i = +b.dataset.mv, j = i + +b.dataset.d, list = getList(); [list[i], list[j]] = [list[j], list[i]]; save(list); viewMaster(coll);
  });
  document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
    const i = +b.dataset.rm, list = getList(); if (!confirm('削除しますか？')) return; list.splice(i, 1); save(list); viewMaster(coll);
  });
  const add = $('#addRow'); if (add) add.onclick = () => {
    const list = getList(), id = (coll === 'pms' ? 'pm' : coll[0]) + Date.now().toString(36);
    if (M.kind === 'item') list.push({ id, name: '新しい' + M.title, price: 0, minutes: 60, type: 'normal', grant: 0 });
    else if (M.kind === 'pm') list.push({ id, name: '新しい支払い方法', fee: 0 });
    else { const v = prompt(M.title + '名を入れてください'); if (!v || list.includes(v.trim())) return; list.push(v.trim()); }
    save(list); viewMaster(coll);
    if (M.kind !== 'text') { const ins = document.querySelectorAll('tr[data-row] input[data-k=name]'); const last = ins[ins.length - 1]; last.focus(); last.select(); }
  };
}

// ===== 起動・ログイン =====
function showLogin(msg, ok) {
  document.body.classList.add('login');
  $('#view').innerHTML = `<div class="loginbox card"><h2>ますぎカルテ ログイン</h2>
    <p class="muted">登録してあるメールアドレスに、ログイン用のリンクを送ります。メールのリンクを押すと、この画面が開いてログインできます（パスワードは使いません）。</p>
    <label>メールアドレス</label><input id="l_email" type="email" autocomplete="username" value="${esc(localStorage.getItem('karte_email') || '')}">
    <p class="${ok ? 'up' : 'down'}">${esc(msg || '')}</p><button class="primary big" id="l_go">ログイン用のメールを送る</button></div>`;
  const go = async () => {
    const email = $('#l_email').value.trim(); if (!email) return;
    $('#l_go').disabled = true; $('#l_go').textContent = '送信中…';
    try { await Store.sendLink(email); showLogin('メールを送りました。届いたメールの「Log In」を押してください（迷惑メールに入ることがあります）。', true); }
    catch (e) { console.error(e); showLogin(/rate|seconds/i.test(e.message || '') ? '送信が続いたため少し待つ必要があります。1分ほどしてからもう一度押してください。' : '送れませんでした。登録してあるメールアドレスか確かめてください。'); }
  };
  $('#l_go').onclick = go; $('#l_email').onkeydown = e => { if (e.key === 'Enter') go(); };
}
function afterLogin() {
  document.body.classList.remove('login');
  if (Store.cloud) {
    $('#modeNote').textContent = 'ネット保存（自動で保存されます）'; document.title = 'ますぎカルテ'; document.querySelector('.logo small')?.remove();
    $('#logout').hidden = false; $('#logout').onclick = () => Store.logout();
    window.addEventListener('beforeunload', e => { if (Store.pending()) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('karte:changed', () => { const r = location.hash.split('/')[1]; if (['sales', 'visits', 'customers', 'a', 'goal'].includes(r)) router(); });
  }
  router();
  $('#backupLink').onclick = e => { e.preventDefault(); saveBackup(); };
}
function saveBackup() {
  const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ますぎカルテ_バックアップ_' + today() + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  localStorage.setItem('karte_last_backup', today()); toast('バックアップを保存しました（ダウンロード）');
}
(async () => {
  try { (await Store.init()) ? afterLogin() : showLogin(); }
  catch (e) { console.error(e); $('#view').innerHTML = '<div class="card down">読み込みに失敗しました。ネットにつながっているか確かめて、ページを開き直してください。</div>'; }
})();
