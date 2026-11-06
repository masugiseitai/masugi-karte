// ===== COCKPITからの取り込み =====
// COCKPITのタブで読み取ったデータを、postMessage で受け取る（c-pit.com からだけ受け付ける）。
// 番号はCOCKPITのものを使う（顧客 k+番号、来院 v+番号）ので、何度取り込んでも重ならない。
const COCKPIT_ORIGIN = 'https://c-pit.com';
let IMP = null; // { raw, conv, status }

window.addEventListener('message', e => {
  if (e.origin !== COCKPIT_ORIGIN || !e.data || e.data.type !== 'karte-import') return;
  IMP = { raw: e.data.payload, conv: null, status: '' };
  try { IMP.conv = convertCockpit(IMP.raw); } catch (err) { console.error(err); IMP.status = '変換でエラー：' + err.message; }
  e.source.postMessage({ type: 'karte-import-ack', customers: IMP.conv?.customers.length, visits: IMP.conv?.visits.length }, e.origin);
  location.hash = '#/import'; viewImport();
});
// ログインが済んでから「受け取れます」とCOCKPITのタブに知らせる
function karteReady() { if (window.opener) { try { window.opener.postMessage({ type: 'karte-ready' }, COCKPIT_ORIGIN); } catch (e) { } } }

const num = s => +(String(s || '').replace(/[^\d.\-]/g, '')) || 0;
const sv = x => (x && typeof x === 'object') ? x : { v: x || '', t: x || '' };
function normDate(s) { const m = String(s || '').match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/); return m ? m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') : ''; }

function convertCockpit(raw) {
  const PM = { '現金': 'cash', 'クレジットカード': 'card', 'PayPay': 'paypay', '回数券': 'ticket', 'プリペイドカード': 'prepaid' };
  const pms = Store.all('pms').map(p => ({ ...p }));
  const pmId = name => { if (PM[name]) return PM[name]; let p = pms.find(x => x.name === name); if (!p) { p = { id: 'pm_' + pms.length, name, fee: 0 }; pms.push(p); } return p.id; };

  // メニュー・物販（COCKPITの番号で作り直す）
  const menus = raw.menus.map(r => {
    const c = r.cells, name = c[0], tm = name.match(/(\d+)回.*回数券|回数券.*?(\d+)回/);
    return { id: 'c' + r.cid, name, price: num(c[2]), minutes: num(c[3]), hidden: !!r.checks[r.checks.length - 1],
      type: tm ? 'ticket' : 'normal', grant: tm ? +(tm[1] || tm[2]) : 0, expireMonths: 0, expireFrom: 'purchase', endOfMonth: false, cockpitId: r.cid };
  });
  const products = raw.products.map(r => {
    const c = r.cells, t = c[2] || '';
    const type = /回数券/.test(t) ? 'ticket' : /プリペ/.test(t) ? 'prepaid' : 'normal';
    return { id: 'p' + r.cid, name: c[0], price: num(c[1]), type, grant: type === 'normal' ? 0 : num(c[3]), expireMonths: num(c[4]), expireFrom: /最終/.test(c[4]) ? 'lastVisit' : 'purchase', endOfMonth: /月末/.test(c[4]), hidden: !!r.checks[r.checks.length - 1], cockpitId: r.cid };
  });
  const findOrAdd = (list, prefix, id, name, price) => {
    let m = list.find(x => x.id === prefix + id) || list.find(x => x.name === name);
    if (!m) { m = { id: prefix + (id || name), name: name || '（名前なし）', price: price || 0, minutes: 0, type: 'normal', grant: 0, hidden: true }; list.push(m); }
    return m;
  };

  // 顧客
  const symptoms = Store.all('symptoms').slice(), media = Store.all('media').slice();
  const customers = raw.customers.map(o => {
    const t = k => sv(o[k]).t, v = k => sv(o[k]).v;
    const y = num(v('birth_year')), mo = num(v('birth_month')), d = num(v('birth_day'));
    const chief = (v('symptom_id') && v('symptom_id') !== '0' ? t('symptom_id') : '') || o.symptom_name || '';
    const med = v('media_id') && v('media_id') !== '0' ? t('media_id') : '';
    if (chief && !symptoms.includes(chief)) symptoms.push(chief);
    if (med && !media.includes(med)) media.push(med);
    const sex = t('sex');
    return {
      id: 'k' + o.cid, cockpitId: o.cid, karte: sv(o.karte_num).v || '', sei: sv(o.sei).v, mei: sv(o.mei).v, seiKana: hira(sv(o.sei_kana).v), meiKana: hira(sv(o.mei_kana).v),
      gender: /女/.test(sex) ? '女性' : /男/.test(sex) ? '男性' : '無回答',
      birth: y > 1900 && mo && d ? y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0') : '',
      tel: sv(o.tel).v, tel2: sv(o.tel_2).v, address: [sv(o.zip01).v ? '〒' + sv(o.zip01).v : '', v('pref01') && v('pref01') !== '0' ? t('pref01') : '', sv(o.addr01).v].filter(Boolean).join(' '),
      email: sv(o.mail).v, chief, media: med, searchEngine: v('yog') && v('yog') !== '0' ? t('yog') : '', note: sv(o.special_note).v, memo: sv(o.memo).v,
      tags: (o.tags || []).filter(Boolean), cockpitType: t('customer_type'), created: '',
    };
  });

  // 来院（COCKPITは1行＝1品目。同じ人・同じ日はまとめて1回の来院にする）
  const iName = raw.vlistHead ? raw.vlistHead.indexOf('商品名') : 3;
  const groups = {};
  raw.visits.forEach(r => {
    const day = normDate(sv(r.day).v || (r.row || [])[0]); const cust = sv(r.customer).v; if (!day || !cust) return;
    const it = sv(r.item), isProd = String(sv(r.type).v) !== '0';
    const name = (it.v && it.v !== '0' ? it.t : '') || (r.row || [])[iName] || '';
    const price = num(sv(r.price).v);
    const ref = isProd ? findOrAdd(products, 'p', it.v !== '0' ? it.v : '', name, price) : findOrAdd(menus, 'c', it.v !== '0' ? it.v : '', name, price);
    const g = grantFields(ref);
    const pmsOf = (r.pms && r.pms.length) ? r.pms : [{ pm: { t: '現金' }, amt: price }];
    const items = pmsOf.map((p, j) => ({ kind: isProd ? 'product' : 'menu', refId: ref.id, name: ref.name, price: j === 0 ? price : 0, pm: pmId(sv(p.pm).t), paid: num(sv(p.amt).v), ...(j === 0 ? g : { grantType: '', grant: 0 }) }));
    const key = cust + '|' + day;
    const G = groups[key] = groups[key] || { ids: [], date: day, customerId: 'k' + cust, staff: sv(r.staff).t || '真杉 孝博', items: [], memos: [] };
    G.ids.push(+r.cid); G.items.push(...items);
    const memo = sv(r.memo).v; if (memo && !G.memos.includes(memo)) G.memos.push(memo);
  });
  const visits = Object.values(groups).map(G => ({ id: 'v' + Math.min(...G.ids), date: G.date, customerId: G.customerId, staff: G.staff, items: G.items, memo: G.memos.join(' / '), cockpitIds: G.ids }));
  visits.sort((a, b) => a.date.localeCompare(b.date));
  // 顧客の登録日＝初来院日
  const first = {}; visits.forEach(v => { if (!first[v.customerId]) first[v.customerId] = v.date; });
  customers.forEach(c => c.created = first[c.id] || '');
  return { menus, products, pms, symptoms, media, customers, visits, rows: raw.visits.length };
}

function viewImport() {
  const C = IMP && IMP.conv;
  if (!C) {
    $('#view').innerHTML = `<h1>COCKPITから取り込む</h1><div class="card">${IMP?.status ? '<p class="down">' + esc(IMP.status) + '</p>' : ''}
      <p>COCKPITのタブから送られてくるデータを待っています。COCKPITの画面で読み取りが終わると、ここに件数が出ます。</p></div>`;
    return;
  }
  const byMonth = {}; C.visits.forEach(v => { const m = v.date.slice(0, 7); const s = byMonth[m] = byMonth[m] || { n: 0, sales: 0 }; s.n++; s.sales += v.items.reduce((a, it) => a + (C.pms.find(p => p.id === it.pm)?.noSales ? 0 : it.paid), 0); });
  const months = Object.keys(byMonth).sort().slice(-12);
  const already = Store.all('visits').length;
  $('#view').innerHTML = `<h1>COCKPITから取り込む</h1>
  <div class="kpis">
    <div class="kpi"><div class="head"><div><div class="s">顧客</div><div class="v">${C.customers.length}<small>人</small></div></div></div><div class="foot">主訴 ${C.symptoms.length}種・集客媒体 ${C.media.length}種</div></div>
    <div class="kpi"><div class="head"><div><div class="s">来院</div><div class="v">${C.visits.length}<small>回</small></div></div></div><div class="foot">COCKPITの行数 ${C.rows}（同じ日の物販などはまとめて1回）</div></div>
    <div class="kpi"><div class="head"><div><div class="s">期間</div><div class="v" style="font-size:18px">${C.visits[0]?.date || '-'}</div></div></div><div class="foot">〜 ${C.visits[C.visits.length - 1]?.date || '-'}</div></div>
    <div class="kpi"><div class="head"><div><div class="s">メニュー／物販</div><div class="v">${C.menus.length}<small>／${C.products.length}</small></div></div></div><div class="foot">使わなくなった物は非表示で入ります</div></div>
  </div>
  <div class="card"><h2>直近12ヶ月の売上（COCKPITの月次と同じか確かめる用）</h2><div class="tablewrap"><table><tr><th>月</th><th class="num">のべ</th><th class="num">売上</th></tr>
    ${months.map(m => `<tr><td>${m.replace('-', '年')}月</td><td class="num">${byMonth[m].n}</td><td class="num">${yen(byMonth[m].sales)}</td></tr>`).join('')}</table></div></div>
  <div class="card">${already ? `<p class="down">今入っている来院 ${already}件はそのまま残り、同じCOCKPITの番号のものは上書きされます。</p>` : ''}
    <button class="primary big" id="doImport">この内容で取り込む</button><p id="impMsg" class="muted"></p></div>`;
  $('#doImport').onclick = async () => {
    $('#doImport').disabled = true; $('#impMsg').textContent = '取り込み中…';
    ['menus', 'products', 'pms', 'symptoms', 'media'].forEach(k => Store.setAll(k, C[k]));
    Store.bulkPut([...C.customers.map(o => ['customers', o]), ...C.visits.map(o => ['visits', o])]);
    const wait = async () => { while (Store.pending()) { $('#impMsg').textContent = 'ネットに保存中… 残り ' + Store.pending() + '件'; await new Promise(r => setTimeout(r, 1000)); } };
    await wait(); $('#impMsg').textContent = '取り込みが終わりました。'; toast('取り込みました');
    setTimeout(() => { location.hash = '#/a/report'; }, 1200);
  };
}
