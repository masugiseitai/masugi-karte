// ===== 電子カルテ =====
// 1回の来院＝1枚のカルテ。必須は「施術内容」（今までのメモと同じ。記号ボタンや1・2・3で入る）。
// 「今日の状態」「反応・所見」「次回・指導」は書きたい日だけ。
// 真正性：書いた人・日時を残し、後から直すと前の内容を修正履歴に残す（消さない）。
// 今までの分：COCKPITのメモをそのまま各日の「施術内容」として表示する（元の記録は書き換えない）。
const DEFAULT_CODES = ['j+', 'j寒', 'i-', 'n+', 'd-', 'e-', '頭鍼', '整体', 'お灸', 'モーゼ', '肝', '@'].map(code => ({ code, meaning: '' }));
const S_CHIPS = ['前回より楽', '変わらない', 'つらい', '検査前', '検査後'];
const O_CHIPS = ['施術後 楽になった', '施術後 変化少ない', '腰・骨盤まわりが軽い', 'お腹の張りが減った'];
const P_CHIPS = ['同じ流れで継続', '次回 検査結果を確認', '食事の見直しを伝えた', '睡眠の見直しを伝えた'];

function codes() { const s = settings(); return (s.codes && s.codes.length) ? s.codes : DEFAULT_CODES; }
function codeMeaning(text) {
  const map = codes().filter(c => c.meaning);
  if (!map.length || !text) return '';
  const hit = map.filter(c => String(text).includes(c.code)).map(c => c.code + '＝' + c.meaning);
  return hit.join('、');
}
const ADVERSE = ['特になし', '内出血', '気分不良', '痛みが残る', 'だるさ', 'やけど', 'その他'];
const CONSENT_FROM = '2026-11-07'; // この日以降に初めて来た方は、初診の説明と同意を記録する
function needsConsent(c) { if (!c || c.consent) return false; const f = firstVisitDate(c.id); return !f || f >= CONSENT_FROM; }
function consentNotice(c) {
  return needsConsent(c) ? `<div class="consent-warn">初診の説明と同意がまだ記録されていません。<button class="chip auto" id="consentBtn">説明して同意を得た（記録する）</button></div>` : '';
}
const chipRow = (list, key) => `<div class="row" style="justify-content:flex-start;margin:4px 0">${list.map(t => `<button class="chip auto" data-kchip="${key}" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;

// 来院登録の中のカルテ欄
function karteFormHtml(S, lv) {
  const open = !!(S.kS || S.kO || S.kP);
  return `<label>カルテ（施術内容）<span class="req">*</span></label>
    <div class="row" style="margin-bottom:4px;justify-content:flex-start">
      ${settings().memoPresets.map((m, i) => `<button class="chip auto ${S.memoNum === i + 1 ? 'on' : ''}" data-memo="${i + 1}">${i + 1}：${esc(m)}</button>`).join('')}
      <button class="chip auto ${S.noSeitai ? 'on' : ''}" id="noSeitai">整体なし</button>
    </div>
    <div class="row codes" style="margin-bottom:6px;justify-content:flex-start">${codes().map(c => `<button class="chip auto" data-code="${esc(c.code)}" title="${esc(c.meaning)}">${esc(c.code)}</button>`).join('')}</div>
    <textarea id="memo" style="min-height:56px">${esc(S.memo)}</textarea>
    ${codeMeaning(S.memo) ? `<p class="muted" style="margin:2px 0">${esc(codeMeaning(S.memo))}</p>` : ''}
    <label>施術後の異常</label>
    <div class="row" style="justify-content:flex-start;margin:4px 0">${ADVERSE.map(a => `<button class="chip auto ${(S.kAd || '特になし').split('、').includes(a) ? 'on' : ''}" data-ad="${a}">${a}</button>`).join('')}</div>
    ${(S.kAd || '特になし') !== '特になし' ? `<input id="kAdN" placeholder="どこに・どの程度・どう対応したか" value="${esc(S.kAdN || '')}">` : ''}
    <details class="kmore" ${open ? 'open' : ''}><summary>今日の状態・反応・次回（書きたい日だけ）</summary>
      <label>今日の状態（本人の訴え・前回からの変化）</label>${chipRow(S_CHIPS, 'kS')}<textarea id="kS" style="min-height:48px">${esc(S.kS || '')}</textarea>
      <label>反応・所見（施術前後の変化・気づいたこと）</label>${chipRow(O_CHIPS, 'kO')}<textarea id="kO" style="min-height:48px">${esc(S.kO || '')}</textarea>
      <label>次回・指導（次にやること・伝えたこと）</label>${chipRow(P_CHIPS, 'kP')}<textarea id="kP" style="min-height:48px">${esc(S.kP || '')}</textarea>
    </details>
    ${lv ? `<div class="lastkarte"><b>前回のカルテ</b>（${lv.date.replace(/-/g, '/')}）${esc(lv.memo || '記載なし')}${lv.karteS ? '<br>状態：' + esc(lv.karteS) : ''}${lv.karteP ? '<br>次回：' + esc(lv.karteP) : ''}</div>` : ''}`;
}
function bindKarteForm(S, rerender) {
  document.querySelectorAll('[data-code]').forEach(b => b.onclick = () => {
    const m = $('#memo'); S.memo = (m.value.trim() + ' ' + b.dataset.code).trim(); S.memoNum = 0; rerender();
  });
  document.querySelectorAll('[data-kchip]').forEach(b => b.onclick = () => {
    const k = b.dataset.kchip, el = $('#' + k); S[k] = (el.value.trim() ? el.value.trim() + '、' : '') + b.dataset.t; rerender();
  });
  ['kS', 'kO', 'kP', 'kAdN'].forEach(k => { const el = $('#' + k); if (el) el.oninput = () => { S[k] = el.value; }; });
  document.querySelectorAll('[data-ad]').forEach(b => b.onclick = () => {
    const a = b.dataset.ad; let cur = (S.kAd || '特になし').split('、').filter(x => x !== '特になし');
    if (a === '特になし') cur = []; else cur = cur.includes(a) ? cur.filter(x => x !== a) : cur.concat(a);
    S.kAd = cur.length ? cur.join('、') : '特になし'; rerender();
  });
  const cb = $('#consentBtn'); if (cb) cb.onclick = () => {
    const c = S.customer; c.consent = { date: S.date || today(), by: settings().staff }; Store.put('customers', c); toast('初診の説明と同意を記録しました'); rerender();
  };
}

// カルテ1枚（顧客画面・印刷で使う）
function karteCard(v, opt = {}) {
  const items = v.items.map(i => esc(i.name)).join('・');
  const mean = codeMeaning(v.memo);
  const migrated = v.cockpitIds && !v.karteUpdatedAt && !v.karteS && !v.karteO && !v.karteP;
  return `<div class="kcard" data-vid="${v.id}">
    <div class="khead"><b>${v.date.replace(/-/g, '/')}</b><span class="muted">${items}</span>
      <span class="muted kby">${esc(v.staff || '')}${migrated ? '・COCKPITのメモより' : ''}${v.karteHistory?.length ? '・<a href="#" data-khist="' + v.id + '">修正' + v.karteHistory.length + '回</a>' : ''}</span>
      ${opt.edit ? `<button class="chip auto" data-kedit="${v.id}">直す</button>` : ''}</div>
    <div class="kbody">
      ${v.karteS ? `<div><span class="kl">状態</span>${esc(v.karteS)}</div>` : ''}
      <div><span class="kl">施術</span>${esc(v.memo || '（記載なし）')}${mean ? `<span class="muted">（${esc(mean)}）</span>` : ''}</div>
      ${v.karteO ? `<div><span class="kl">反応</span>${esc(v.karteO)}</div>` : ''}
      ${v.karteP ? `<div><span class="kl">次回</span>${esc(v.karteP)}</div>` : ''}
      ${v.karteAdverse && v.karteAdverse !== '特になし' ? `<div class="down"><span class="kl" style="background:#dd4b39">異常</span>${esc(v.karteAdverse)}${v.karteAdverseNote ? '：' + esc(v.karteAdverseNote) : ''}</div>` : v.karteAdverse ? '<div class="muted" style="font-size:12px">施術後の異常なし</div>' : ''}
    </div>
    <div class="khist" id="kh_${v.id}" hidden>${(v.karteHistory || []).map(h => `<div class="muted">${esc(h.at.replace('T', ' ').slice(0, 16))} ${esc(h.by || '')} が修正。前の内容：施術「${esc(h.before.memo || '')}」${h.before.karteS ? ' 状態「' + esc(h.before.karteS) + '」' : ''}${h.before.karteO ? ' 反応「' + esc(h.before.karteO) + '」' : ''}${h.before.karteP ? ' 次回「' + esc(h.before.karteP) + '」' : ''}${h.before.karteAdverse ? ' 異常「' + esc(h.before.karteAdverse) + (h.before.karteAdverseNote ? '：' + esc(h.before.karteAdverseNote) : '') + '」' : ''}</div>`).join('')}</div>
  </div>`;
}
// 顧客画面のカルテ欄
function kartePanel(c) {
  const vs = visitsOf(c.id).reverse();
  const tests = (c.tests || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  return `<div class="card"><div class="row"><h2>カルテ（${vs.length}回）</h2><div class="auto"><button id="kPrint">印刷・PDF</button></div></div>
      <div class="row" style="margin-bottom:8px"><input id="kSearch" placeholder="カルテの中を探す（例：頭鍼、検査、腰）"></div>
      <div id="kList">${vs.map(v => karteCard(v, { edit: true })).join('') || '<p class="muted">まだありません</p>'}</div></div>
    <div class="card"><h2>カルテの基本情報</h2>
      <label>既往歴・病院での診断や治療</label><textarea id="c_history">${esc(c.history || '')}</textarea>
      <label>服薬・サプリ</label><textarea id="c_meds">${esc(c.meds || '')}</textarea>
      <label>施術で気をつけること（禁忌・注意）</label><textarea id="c_caution">${esc(c.caution || '')}</textarea>
      <label>初診の説明と同意</label>
      <label style="font-weight:400"><input type="checkbox" id="c_consent" style="width:auto;height:auto" ${c.consent ? 'checked' : ''}> 施術の内容とリスクを説明し、同意を得た</label>
      <input type="date" id="c_consentDate" value="${esc(c.consent?.date || '')}" style="margin-top:4px">
      ${c.consent ? `<p class="muted">記録：${esc(c.consent.date)}（${esc(c.consent.by || '')}）</p>` : needsConsent(c) ? '<p class="down">まだ記録されていません</p>' : '<p class="muted">2026/11/7より前からの方は任意です</p>'}
      <br><br><button class="primary" id="c_save">基本情報を保存</button></div>
    <div class="card"><h2>精液検査の記録</h2><div class="tablewrap"><table>
      <tr><th>検査日</th><th class="num">濃度(百万/ml)</th><th class="num">運動率(%)</th><th class="num">正常形態(%)</th><th class="num">DFI(%)</th><th>病院・メモ</th><th></th></tr>
      ${tests.map(t => `<tr><td>${esc(t.date.replace(/-/g, '/'))}</td><td class="num">${esc(t.conc)}</td><td class="num">${esc(t.motility)}</td><td class="num">${esc(t.morph)}</td><td class="num">${esc(t.dfi)}</td><td>${esc(t.note)}</td><td><button class="x" data-tdel="${esc(t.id)}">×</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">まだありません</td></tr>'}
      <tr><td><input type="date" id="t_date" value="${today()}"></td><td><input id="t_conc" inputmode="decimal" style="width:80px"></td><td><input id="t_motility" inputmode="decimal" style="width:70px"></td><td><input id="t_morph" inputmode="decimal" style="width:70px"></td><td><input id="t_dfi" inputmode="decimal" style="width:70px"></td><td><input id="t_note"></td><td><button class="green" id="t_add">追加</button></td></tr>
    </table></div><p class="muted">WHOの下限（第6版）：濃度16・運動率42・正常形態4。</p></div>`;
}
function bindKartePanel(c, rerender) {
  $('#kSearch').oninput = e => { const q = e.target.value.trim(); document.querySelectorAll('#kList .kcard').forEach(el => el.hidden = !!q && !el.textContent.includes(q)); };
  document.querySelectorAll('[data-khist]').forEach(a => a.onclick = e => { e.preventDefault(); const el = $('#kh_' + a.dataset.khist); el.hidden = !el.hidden; });
  document.querySelectorAll('[data-kedit]').forEach(b => b.onclick = () => editKarte(b.dataset.kedit, rerender));
  $('#kPrint').onclick = () => { location.hash = '#/kprint/' + c.id; };
  $('#c_save').onclick = () => {
    c.history = $('#c_history').value.trim(); c.meds = $('#c_meds').value.trim(); c.caution = $('#c_caution').value.trim();
    if ($('#c_consent').checked) c.consent = { date: $('#c_consentDate').value || today(), by: c.consent?.by || settings().staff };
    else if (c.consent && confirm('同意の記録を外しますか？')) { c.consentRemoved = (c.consentRemoved || []).concat({ ...c.consent, removedAt: new Date().toISOString() }); delete c.consent; }
    Store.put('customers', c); toast('保存しました'); rerender();
  };
  $('#t_add').onclick = () => {
    const t = { id: Date.now().toString(36), date: $('#t_date').value, conc: $('#t_conc').value.trim(), motility: $('#t_motility').value.trim(), morph: $('#t_morph').value.trim(), dfi: $('#t_dfi').value.trim(), note: $('#t_note').value.trim() };
    if (!t.date) return toast('検査日を入れてください');
    c.tests = (c.tests || []).concat(t); Store.put('customers', c); toast('検査の記録を追加しました'); rerender();
  };
  document.querySelectorAll('[data-tdel]').forEach(b => b.onclick = () => { if (!confirm('この検査の記録を消しますか？')) return; c.tests = (c.tests || []).filter(t => t.id !== b.dataset.tdel); Store.put('customers', c); rerender(); });
}
function editKarte(vid, rerender) {
  const v = Store.get('visits', vid), card = document.querySelector(`.kcard[data-vid="${vid}"]`);
  card.innerHTML = `<div class="khead"><b>${v.date.replace(/-/g, '/')}</b><span class="muted">直しています（前の内容は修正履歴に残ります）</span></div>
    <label>施術</label><textarea id="e_memo" style="min-height:48px">${esc(v.memo || '')}</textarea>
    <label>状態</label><textarea id="e_kS" style="min-height:40px">${esc(v.karteS || '')}</textarea>
    <label>反応</label><textarea id="e_kO" style="min-height:40px">${esc(v.karteO || '')}</textarea>
    <label>次回</label><textarea id="e_kP" style="min-height:40px">${esc(v.karteP || '')}</textarea>
    <label>施術後の異常</label><input id="e_ad" value="${esc(v.karteAdverse || '')}" placeholder="特になし／内出血 など"><input id="e_adn" value="${esc(v.karteAdverseNote || '')}" placeholder="どこに・どの程度・どう対応したか" style="margin-top:4px">
    <p class="row" style="justify-content:flex-start"><button class="primary auto" id="e_ok">保存</button><button class="auto" id="e_cancel">やめる</button></p>`;
  $('#e_cancel').onclick = rerender;
  $('#e_ok').onclick = () => {
    const after = { memo: $('#e_memo').value.trim(), karteS: $('#e_kS').value.trim(), karteO: $('#e_kO').value.trim(), karteP: $('#e_kP').value.trim(), karteAdverse: $('#e_ad').value.trim(), karteAdverseNote: $('#e_adn').value.trim() };
    const before = { memo: v.memo || '', karteS: v.karteS || '', karteO: v.karteO || '', karteP: v.karteP || '', karteAdverse: v.karteAdverse || '', karteAdverseNote: v.karteAdverseNote || '' };
    if (JSON.stringify(after) === JSON.stringify(before)) return rerender();
    v.karteHistory = (v.karteHistory || []).concat({ at: new Date().toISOString(), by: settings().staff, before });
    Object.assign(v, after, { karteUpdatedAt: new Date().toISOString() });
    Store.put('visits', v); toast('カルテを直しました（修正履歴に残しました）'); rerender();
  };
}

// 印刷用（時系列のカルテ一式）
function viewKartePrint(cid) {
  const c = Store.get('customers', cid); if (!c) return;
  const vs = visitsOf(cid);
  $('#view').innerHTML = `<div class="noprint row" style="margin-bottom:10px"><a href="#/customer/${cid}">← 戻る</a><div class="auto"><button class="primary" onclick="window.print()">印刷・PDFに保存</button></div></div>
  <div class="print">
    <h1 style="color:#333">施術録（カルテ）</h1>
    <table class="sum"><tr><th>氏名</th><td>${esc(fullName(c))}（${esc(kana(c))}）</td><th>カルテ番号</th><td>${esc(c.karte)}</td></tr>
      <tr><th>性別</th><td>${esc(c.gender)}</td><th>生年月日</th><td>${esc(c.birth)}</td></tr>
      <tr><th>主訴</th><td colspan="3">${esc(c.chief)}</td></tr>
      ${c.history ? `<tr><th>既往歴</th><td colspan="3">${esc(c.history)}</td></tr>` : ''}
      ${c.meds ? `<tr><th>服薬・サプリ</th><td colspan="3">${esc(c.meds)}</td></tr>` : ''}
      ${c.caution ? `<tr><th>注意</th><td colspan="3">${esc(c.caution)}</td></tr>` : ''}
      <tr><th>説明と同意</th><td colspan="3">${c.consent ? esc(c.consent.date) + ' 施術の内容とリスクを説明し同意を得た（' + esc(c.consent.by || '') + '）' : '記録なし'}</td></tr>
      <tr><th>施術所</th><td colspan="3">ますぎ鍼灸マッサージ院</td></tr></table>
    ${(c.tests || []).length ? `<h2>精液検査</h2><table><tr><th>検査日</th><th>濃度</th><th>運動率</th><th>正常形態</th><th>DFI</th><th>メモ</th></tr>${c.tests.slice().sort((a, b) => a.date.localeCompare(b.date)).map(t => `<tr><td>${esc(t.date)}</td><td>${esc(t.conc)}</td><td>${esc(t.motility)}</td><td>${esc(t.morph)}</td><td>${esc(t.dfi)}</td><td>${esc(t.note)}</td></tr>`).join('')}</table>` : ''}
    <h2>施術の記録（${vs.length}回）</h2>${vs.map(v => karteCard(v)).join('')}
    <p class="muted">出力日 ${today()}・ますぎカルテ</p></div>`;
}

// 設定：カルテの記号
function viewCodes() {
  const list = codes().map(c => ({ ...c }));
  const used = {}; Store.all('visits').forEach(v => (v.memo || '').split(/[\s　]+/).forEach(t => list.forEach(c => { if (t.includes(c.code)) used[c.code] = (used[c.code] || 0) + 1; })));
  $('#view').innerHTML = `<h1>カルテの記号</h1><div class="card">
    <p class="muted" style="margin-top:0">来院登録のカルテ欄に並ぶボタンです。意味を入れておくと、カルテと印刷に「j+＝…」のように書き添えます（意味は院長の言葉で）。</p>
    <table class="master" style="max-width:760px"><tr><th>記号</th><th>意味</th><th class="num">今までの回数</th><th>並べ替え</th><th></th></tr>
    ${list.map((c, i) => `<tr data-row="${i}"><td><input data-k="code" value="${esc(c.code)}" style="width:90px"></td><td><input data-k="meaning" value="${esc(c.meaning)}" placeholder="意味（院長の言葉で）"></td>
      <td class="num">${used[c.code] || 0}</td><td><button class="x" data-mv="${i}" data-d="-1"${i === 0 ? ' disabled' : ''}>↑</button><button class="x" data-mv="${i}" data-d="1"${i === list.length - 1 ? ' disabled' : ''}>↓</button></td><td><button class="x" data-rm="${i}">×</button></td></tr>`).join('')}
    </table><p><button class="green" id="addCode">+ 記号を追加</button></p></div>`;
  const save = l => { const s = settings(); s.codes = l; Store.setAll('settings', s); };
  document.querySelectorAll('[data-k]').forEach(el => el.onchange = () => { const i = +el.closest('tr').dataset.row; list[i][el.dataset.k] = el.value.trim(); save(list); toast('保存しました'); });
  document.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const i = +b.dataset.mv, j = i + +b.dataset.d; [list[i], list[j]] = [list[j], list[i]]; save(list); viewCodes(); });
  document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { if (!confirm('この記号のボタンを消しますか？（今までのカルテは消えません）')) return; list.splice(+b.dataset.rm, 1); save(list); viewCodes(); });
  $('#addCode').onclick = () => { const v = prompt('記号を入れてください'); if (!v) return; list.push({ code: v.trim(), meaning: '' }); save(list); viewCodes(); };
}
