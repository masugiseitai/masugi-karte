// データ保存の窓口。
//  ・config.js に Supabase の URL とキーがあれば「ネット保存」（ログイン必須）
//  ・無ければ「試作モード」（このブラウザの中だけ・ダミーデータ）
// 患者さん・来院・経費は1件ずつ、設定（メニュー等）は種類ごとに1行で karte_records 表に入れる。
const RECORD_COLLS = ['customers', 'visits', 'expenses'];
const Store = (() => {
  const CFG = window.KARTE_CONFIG || {};
  const cloud = !!(CFG.supabaseUrl && CFG.supabaseKey);
  const KEY = 'masugi_karte_v1', QKEY = 'masugi_karte_queue';
  let db = null, sb = null, lastSync = null, flushing = false;
  let queue = []; try { queue = JSON.parse(localStorage.getItem(QKEY)) || []; } catch (e) { }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function migrate() { (db.menus || []).forEach(m => { if (m.ticket && !m.type) { m.type = 'ticket'; m.grant = m.ticket; delete m.ticket; } }); }
  function loadLocal() {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db) { db = Seed.build(); saveLocal(); }
    migrate();
  }
  function saveLocal() { if (!cloud) localStorage.setItem(KEY, JSON.stringify(db)); }

  // ---- ネット保存 ----
  function status(msg, bad) { const el = document.getElementById('syncState'); if (el) { el.textContent = msg; el.className = bad ? 'bad' : ''; } }
  function enqueue(coll, id, data) {
    queue = queue.filter(q => !(q.coll === coll && q.id === id)); queue.push({ coll, id, data });
    localStorage.setItem(QKEY, JSON.stringify(queue)); flush();
  }
  async function flush() {
    if (!cloud || flushing || !queue.length) { if (!queue.length) status('保存済み'); return; }
    flushing = true; status('保存中…');
    try {
      while (queue.length) {
        const batch = queue.slice(0, 200);
        const { error } = await sb.from('karte_records').upsert(batch.map(q => ({ coll: q.coll, id: q.id, data: q.data })));
        if (error) throw error;
        queue = queue.slice(batch.length); localStorage.setItem(QKEY, JSON.stringify(queue));
      }
      status('保存済み');
    } catch (e) { console.error(e); status('保存できていません（自動で再試行します）', true); setTimeout(() => { flushing = false; flush(); }, 15000); return; }
    flushing = false;
  }
  function applyRow(r) {
    if (RECORD_COLLS.includes(r.coll)) {
      const list = db[r.coll] || (db[r.coll] = []); const i = list.findIndex(x => x.id === r.id);
      if (r.data && r.data._deleted) { if (i >= 0) list.splice(i, 1); }
      else if (i >= 0) list[i] = r.data; else list.push(r.data);
    } else if (r.coll === 'kv') db[r.id] = r.data;
  }
  async function fetchRows(since) {
    const rows = []; let from = 0;
    for (;;) {
      let q = sb.from('karte_records').select('coll,id,data,updated_at').order('updated_at').range(from, from + 999);
      if (since) q = q.gt('updated_at', since);
      const { data, error } = await q; if (error) throw error;
      rows.push(...data); if (data.length < 1000) break; from += 1000;
    }
    return rows;
  }
  async function pull(since) {
    const rows = await fetchRows(since);
    rows.forEach(applyRow);
    // 自分がまだ送っていない変更を上書きしない
    queue.forEach(q => applyRow({ coll: q.coll, id: q.id, data: q.data }));
    if (rows.length) lastSync = rows[rows.length - 1].updated_at;
    return rows.length;
  }
  async function loadCloud() {
    db = {}; RECORD_COLLS.forEach(c => db[c] = []);
    await pull(null);
    if (!db.menus) { // 初回：設定だけ入れる（患者さんは空）
      const m = Seed.masters(); Object.keys(m).forEach(k => { db[k] = m[k]; enqueue('kv', k, m[k]); });
    }
    migrate(); flush();
    // 別の端末（iPad等）で入れた分を取り込む
    const refresh = async () => { try { if (await pull(lastSync)) window.dispatchEvent(new Event('karte:changed')); } catch (e) { console.error(e); } };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    setInterval(refresh, 60000);
  }

  return {
    cloud,
    async init() {
      if (!cloud) { loadLocal(); return true; }
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
      const { data } = await sb.auth.getSession();
      if (!data.session) return false;
      await loadCloud(); return true;
    },
    // パスワードなし：メールに届くリンクを押すとログインできる（登録済みの人だけ）
    async sendLink(email) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error; localStorage.setItem('karte_email', email);
    },
    async logout() { if (queue.length) await flush(); await sb.auth.signOut(); location.reload(); },
    user: async () => cloud ? (await sb.auth.getUser()).data.user : null,
    all(coll) { return db[coll] || []; },
    get(coll, id) { return this.all(coll).find(x => x.id === id); },
    put(coll, obj) {
      const list = db[coll] || (db[coll] = []);
      if (!obj.id) { obj.id = uid(); obj.created = new Date().toISOString(); list.push(obj); }
      else { const i = list.findIndex(x => x.id === obj.id); i >= 0 ? (list[i] = obj) : list.push(obj); }
      cloud ? enqueue(coll, obj.id, obj) : saveLocal(); return obj;
    },
    setAll(coll, arr) { db[coll] = arr; cloud ? enqueue('kv', coll, arr) : saveLocal(); },
    addValue(coll, value) { const a = (db[coll] || (db[coll] = [])); a.push(value); this.setAll(coll, a); },
    del(coll, id) { db[coll] = this.all(coll).filter(x => x.id !== id); cloud ? enqueue(coll, id, { id, _deleted: true }) : saveLocal(); },
    reset() { if (cloud) return; localStorage.removeItem(KEY); loadLocal(); },
    pending: () => queue.length,
    exportJSON() { return JSON.stringify(db, null, 1); },
  };
})();

// 試作用の初期データ（設定はCOCKPITの実データ、患者さんはダミー）
const Seed = {
  masters() { const d = this.build(); delete d.customers; delete d.visits; return d; },
  build() {
    const menus = [
      ['男性不妊7700', 7700, 60], ['男性不妊8000', 8000, 60], ['男性不妊8800', 8800, 60], ['男性不妊9900', 9900, 60],
      ['手指鍼 7000', 7000, 60], ['手指鍼9000', 9000, 60], ['整体7,700', 7700, 0], ['新規4980', 4980, 90],
      ['新規1980', 1980, 0], ['初回お試し', 2980, 40], ['初回6980', 6980, 90],
      ['鍼灸施術 5回回数券', 42500, 60, 5], ['鍼灸施術 10回回数券', 80000, 60, 10],
    ].map((m, i) => ({ id: 'm' + i, name: m[0], price: m[1], minutes: m[2], type: m[3] ? 'ticket' : 'normal', grant: m[3] || 0, expireMonths: m[3] ? 6 : 0, expireFrom: 'purchase', endOfMonth: false }));
    const products = [['ハーブティ', 6800], ['お灸', 3200], ['モリンガ', 6480], ['治療代3500', 3500], ['アーシングレンタル', 1000], ['お灸3300', 3300], ['動画', 10000]]
      .map((p, i) => ({ id: 'p' + i, name: p[0], price: p[1], type: 'normal', grant: 0 }));
    const pms = [
      { id: 'cash', name: '現金', fee: 0 }, { id: 'card', name: 'クレジットカード', fee: 3.26 },
      { id: 'paypay', name: 'PayPay', fee: 0 }, { id: 'ticket', name: '回数券', fee: 0, noSales: true },
      { id: 'prepaid', name: 'プリペイドカード', fee: 0, noSales: true },
    ];
    const symptoms = ['精子数、運動率が低い', '精子数が少ない', '高速運動率が低い', '無精子症', '運動率が低い', '奇形率が高い', '顕微授精がうまくいかない', 'タイミング法がうまくいかない', '女性の不妊症', 'FSHが高い', 'ED', '坐骨神経痛', '椎間板ヘルニア', 'すべり症', '眼精疲労', '脊柱管狭窄症', '緑内障', '腰痛', '慢性腰痛', 'ギックリ腰', '夜間頻尿', '起立性調節障害'];
    const media = ['インスタ', 'YouTube', 'SEO', 'Google広告', 'チラシ', 'LINE', 'Meta広告', '紹介'];

    // ダミー患者
    const names = [
      ['山田', '太郎', 'やまだ', 'たろう', 'm4', 'cash', 'インスタ', '精子数が少ない'],
      ['佐藤', '健一', 'さとう', 'けんいち', 'm0', 'card', 'Meta広告', '運動率が低い'],
      ['鈴木', '大輔', 'すずき', 'だいすけ', 'm2', 'paypay', 'SEO', '精子数、運動率が低い'],
      ['高橋', '翔', 'たかはし', 'しょう', 'm0', 'card', 'Google広告', 'ED'],
      ['田中', '恵', 'たなか', 'めぐみ', 'm4', 'card', 'インスタ', '女性の不妊症', '女性'],
      ['伊藤', '拓也', 'いとう', 'たくや', 'm2', 'cash', 'YouTube', '無精子症'],
      ['渡辺', '亮', 'わたなべ', 'りょう', 'm1', 'card', 'Meta広告', '奇形率が高い'],
      ['中村', '直樹', 'なかむら', 'なおき', 'm5', 'cash', '紹介', '眼精疲労'],
      ['小林', '悠', 'こばやし', 'ゆう', 'm0', 'paypay', 'SEO', '顕微授精がうまくいかない'],
      ['加藤', '浩二', 'かとう', 'こうじ', 'm3', 'card', 'インスタ', 'FSHが高い'],
      ['吉田', '由美', 'よしだ', 'ゆみ', 'm4', 'cash', 'チラシ', '坐骨神経痛', '女性'],
      ['山本', '和也', 'やまもと', 'かずや', 'm2', 'card', 'Google広告', '高速運動率が低い'],
    ];
    const customers = names.map((n, i) => ({
      id: 'c' + i, karte: String(1001 + i), sei: n[0], mei: n[1], seiKana: n[2], meiKana: n[3], gender: n[8] || '男性',
      birth: '', tel: '', address: '', email: '', chief: n[7], media: n[6], note: '', tags: [],
      _menu: n[4], _pm: n[5], created: '',
    }));

    // ダミー来院（過去14ヶ月）
    const visits = []; let vid = 0;
    const today = new Date();
    const memos = ['j+ 整体', 'j寒 整体', 'j+ 整体 i-'];
    customers.forEach((c, ci) => {
      const startBack = 120 + ((ci * 37) % 300);         // 初回は何日前か
      const gap = 7 + (ci % 3) * 7;                       // 通う間隔
      const stopBack = ci % 4 === 0 ? 70 + ci * 3 : 0;   // 休眠になった人
      const sb = ci === 11 ? 4 : startBack;               // 1人は今月の新規
      for (let back = sb; back >= stopBack; back -= gap) {
        const d = new Date(today); d.setDate(d.getDate() - back);
        if (d.getDay() === 3) d.setDate(d.getDate() + 1);
        const first = back === sb;
        const menu = menus.find(m => m.id === (first ? 'm7' : c._menu));
        const pm = pms.find(p => p.id === (first ? 'cash' : c._pm));
        visits.push({
          id: 'v' + (vid++), date: ymd(d), customerId: c.id, staff: '真杉 孝博',
          items: [{ kind: 'menu', refId: menu.id, name: menu.name, price: menu.price, pm: pm.id, paid: feeAmount(menu.price, pm) }],
          memo: first ? '初回' : memos[(back + ci) % 3],
        });
      }
      c.created = visits.filter(v => v.customerId === c.id)[0]?.date || '';
      delete c._menu; delete c._pm;
    });
    return { menus, products, pms, symptoms, media, customers, visits, settings: { staff: '真杉 孝博', dormantDays: 60, memoPresets: memos } };
  },
};

function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function feeAmount(price, pm) { return pm && pm.fee ? Math.round(price * (1 - pm.fee / 100)) : price; }
