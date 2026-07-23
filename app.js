// ============================================
// RICH COUNTRY LIFE 日計表アプリ
// app.js — メインロジック
// ============================================

const PAYMENTS = ['現金','JCB','郵便局','あおぞらネット','出光法人カード','その他'];
const DEF_ACCOUNTS = ['仕入','消耗品費','通信費','交通費','光熱費','広告宣伝費','役員報酬','法定福利費','預り金','その他経費'];
const CUSTOM_LABEL = '自分で入力';
const DEF_BIZ = [{ id: 'veg', name: '野菜' }, { id: 'seminar', name: 'セミナー業' }];
const MAX_IMG_DIM = 1400;
const LS_KEY = 'rcl_nikkeihyo_cache_v1';

let db = {
  entries: [], kyuyo: [], meisai: [],
  accounts: [...DEF_ACCOUNTS], bizList: [...DEF_BIZ],
  kyuyoSettings: { salary: 45000, shakai: 23124 }
};
let extraSalesIds = [], expenseIds = [], pendingImport = [];

// ============================================
// ログイン・初期化
// ============================================
function tryLogin() {
  const pass = document.getElementById('login-pass').value;
  if (pass === window.APP_CONFIG.PASSCODE) {
    sessionStorage.setItem('rcl_session', 'ok');
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    initApp();
  } else {
    document.getElementById('login-error').style.display = 'block';
  }
}
function logout() { sessionStorage.removeItem('rcl_session'); location.reload(); }

window.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem('rcl_session') === 'ok') {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    initApp();
  }
  document.getElementById('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
});

function initApp() {
  loadLocalCache();
  document.getElementById('entry-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('entry-date').addEventListener('change', onDateChange);
  onDateChange();
  renderBizSelects(); renderAccountList(); renderBizList(); populateMonthSelects();
  fetchFromServer();
}

function loadLocalCache() {
  try { const c = JSON.parse(localStorage.getItem(LS_KEY)); if (c) db = Object.assign(db, c); } catch(e) {}
}
function saveLocalCache() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch(e) {}
}

// ============================================
// GAS通信
// ============================================
function setSyncBadge(state) {
  const b = document.getElementById('sync-badge');
  if (state === 'syncing') { b.className = 'sync-badge syncing'; b.innerHTML = '<i class="ti ti-cloud-upload"></i> 同期中…'; }
  else if (state === 'ok') { b.className = 'sync-badge'; b.innerHTML = '<i class="ti ti-cloud-check"></i> 同期済み'; }
  else { b.className = 'sync-badge'; b.innerHTML = '<i class="ti ti-cloud-off"></i> オフライン'; }
}

async function gasCall(action, payload) {
  const url = window.APP_CONFIG.GAS_URL;
  const body = JSON.stringify({ action, passcode: window.APP_CONFIG.PASSCODE, payload: payload || {} });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    redirect: 'follow',
    body
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'サーバーエラー');
  return json.data;
}

async function fetchFromServer() {
  setSyncBadge('syncing');
  try {
    const data = await gasCall('loadAll', {});
    db.entries = data.entries || [];
    db.kyuyo = data.kyuyo || [];
    db.meisai = data.meisai || [];
    db.accounts = (data.accounts && data.accounts.length) ? data.accounts : [...DEF_ACCOUNTS];
    db.bizList = (data.bizList && data.bizList.length) ? data.bizList : [...DEF_BIZ];
    db.kyuyoSettings = data.kyuyoSettings || { salary: 45000, shakai: 23124 };
    saveLocalCache();
    setSyncBadge('ok');
    renderBizSelects(); renderAccountList(); renderBizList(); populateMonthSelects();
    refreshActiveTab(); updateMeisaiBadge(); onDateChange();
  } catch(e) {
    console.error(e);
    setSyncBadge('err');
    showToast('サーバーに接続できません', 'toast', 'err');
  }
}

async function pushToServer(action, payload) {
  setSyncBadge('syncing');
  try { await gasCall(action, payload); setSyncBadge('ok'); return true; }
  catch(e) { console.error(e); setSyncBadge('err'); showToast('保存に失敗しました', 'toast', 'err'); return false; }
}

function manualSync() { fetchFromServer(); }

// ============================================
// 共通ユーティリティ
// ============================================
function fmt(n) { return '¥' + Math.round(n || 0).toLocaleString(); }
function half(n) { return Math.round(n / 2); }
function showToast(msg, id = 'toast', type = 'ok') {
  const t = document.getElementById(id);
  if (!t) return;
  t.textContent = msg; t.className = 'toast ' + type; t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 2600);
}
function bizName(id) { const b = db.bizList.find(x => x.id === id); return b ? b.name : id; }
function bizTagClass(id) {
  if (id === 'veg') return 'biz-veg';
  if (id === 'seminar') return 'biz-seminar';
  return 'biz-other';
}

function switchTab(name, btn) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-btn,.side-nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelectorAll(`[data-tab="${name}"]`).forEach(b => b.classList.add('active'));
  populateMonthSelects();
  refreshTab(name);
}

function refreshActiveTab() {
  const active = document.querySelector('.section.active');
  if (active) refreshTab(active.id.replace('tab-', ''));
}

function refreshTab(name) {
  if (name === 'geppo') renderGeppo();
  if (name === 'ledger') renderLedger();
  if (name === 'export') { renderAccountList(); renderBizList(); renderStorageInfo(); }
  if (name === 'kyuyo') initKyuyo();
  if (name === 'import') renderBizSelects();
  if (name === 'meisai') { if (!db.meisai) db.meisai = []; renderMeisaiList(); updateMeisaiBadge(); }
}

function getMonths() {
  const s = new Set();
  db.entries.forEach(e => s.add(e.date.substring(0, 7)));
  db.kyuyo.forEach(k => s.add(k.month));
  const now = new Date();
  s.add(now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'));
  return [...s].sort().reverse();
}

function populateMonthSelects() {
  const months = getMonths();
  ['geppo-month', 'ledger-month', 'export-month', 'kyuyo-month'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = months.map(m => `<option value="${m}">${m.replace('-', '年')}月</option>`).join('');
    if (prev && months.includes(prev)) sel.value = prev;
  });
}

function renderBizSelects() {
  const opts = db.bizList.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  const optsWithAll = `<option value="all">全事業</option>` + opts;
  ['entry-default-biz', 'sales-cash-biz', 'import-biz'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) { const prev = sel.value; sel.innerHTML = opts; if (prev) sel.value = prev; }
  });
  ['geppo-biz', 'ledger-biz', 'export-biz'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) { const prev = sel.value; sel.innerHTML = optsWithAll; if (prev) sel.value = prev; else sel.value = 'all'; }
  });
  document.querySelectorAll('[id^="ebiz-"]').forEach(sel => { const prev = sel.value; sel.innerHTML = opts; if (prev) sel.value = prev; });
}

// ============================================
// 日計入力：売上
// ============================================
function updateSalesTotal() {
  const cash = parseFloat(document.getElementById('sales-cash').value) || 0;
  const extras = extraSalesIds.reduce((s, id) => s + (parseFloat(document.getElementById('esamt-' + id)?.value) || 0), 0);
  document.getElementById('daily-sales-total').textContent = fmt(cash + extras);
}

function addExtraSales() {
  const id = Date.now(); extraSalesIds.push(id);
  const div = document.createElement('div'); div.id = 'es-' + id; div.className = 'sales-extra';
  const bizOpts = db.bizList.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  div.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <span style="font-size:12px;font-weight:600;color:var(--text-sub);">追加売上</span>
    <button class="delete-btn" onclick="removeExtraSales(${id})"><i class="ti ti-x"></i></button></div>
    <div class="row2" style="margin-bottom:6px;">
      <div><label class="form-label">名称</label><input type="text" id="esname-${id}" placeholder="例: ECサイト" /></div>
      <div><label class="form-label">事業区分</label><select id="esbiz-${id}">${bizOpts}</select></div>
    </div>
    <div><label class="form-label">金額</label><input type="number" id="esamt-${id}" placeholder="0" min="0" oninput="updateSalesTotal()" /></div>`;
  document.getElementById('extra-sales-list').appendChild(div);
}
function removeExtraSales(id) { document.getElementById('es-' + id)?.remove(); extraSalesIds = extraSalesIds.filter(x => x !== id); updateSalesTotal(); }

// ============================================
// 日計入力：経費
// ============================================
function buildAccountOptions() { return [...db.accounts, CUSTOM_LABEL].map(a => `<option value="${a}">${a}</option>`).join(''); }
function onAccountChange(id) { document.getElementById('ecustom-wrap-' + id).style.display = document.getElementById('eacc-' + id).value === CUSTOM_LABEL ? 'block' : 'none'; }
function getAccountValue(id) {
  const sel = document.getElementById('eacc-' + id);
  if (sel.value === CUSTOM_LABEL) { const c = document.getElementById('ecustom-' + id)?.value.trim(); return c || 'その他経費'; }
  return sel.value;
}

function addExpenseRow() {
  const id = Date.now(); expenseIds.push(id);
  const div = document.createElement('div'); div.id = 'exp-' + id; div.className = 'exp-row';
  const bizOpts = db.bizList.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  div.innerHTML = `<div class="exp-row-head"><span style="font-size:12px;font-weight:600;color:var(--text-sub);">経費</span>
    <button class="delete-btn" onclick="removeExpense(${id})"><i class="ti ti-x"></i></button></div>
    <div class="row2" style="margin-bottom:8px;">
      <div><label class="form-label">科目</label>
        <select id="eacc-${id}" onchange="onAccountChange(${id})">${buildAccountOptions()}</select>
        <div id="ecustom-wrap-${id}" style="display:none;margin-top:6px;"><input type="text" id="ecustom-${id}" placeholder="科目名を入力" /></div>
      </div>
      <div><label class="form-label">事業区分</label><select id="ebiz-${id}">${bizOpts}</select></div>
    </div>
    <div class="row2" style="margin-bottom:8px;">
      <div><label class="form-label">支払手段</label><select id="epay-${id}">${PAYMENTS.map(p => `<option>${p}</option>`).join('')}</select></div>
      <div><label class="form-label">金額（円）</label><input type="number" id="eamt-${id}" placeholder="0" min="0" /></div>
    </div>
    <div style="margin-bottom:8px;"><label class="form-label">摘要</label><input type="text" id="edesc-${id}" placeholder="内容メモ" /></div>
    <div><label class="form-label">領収書</label>
      <div class="receipt-attach" id="receipt-wrap-${id}">
        <button type="button" class="receipt-add-btn" onclick="document.getElementById('receipt-file-${id}').click()"><i class="ti ti-camera"></i>写真を追加</button>
      </div>
      <input type="file" id="receipt-file-${id}" accept="image/*" capture="environment" style="display:none;" onchange="handleReceiptFile(${id}, this.files[0])" />
    </div>`;
  document.getElementById('expense-list').appendChild(div);
}
function removeExpense(id) { document.getElementById('exp-' + id)?.remove(); expenseIds = expenseIds.filter(x => x !== id); }

function handleReceiptFile(id, file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > MAX_IMG_DIM || h > MAX_IMG_DIM) { const scale = MAX_IMG_DIM / Math.max(w, h); w = Math.round(w * scale); h = Math.round(h * scale); }
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      renderReceiptThumb(id, canvas.toDataURL('image/jpeg', 0.78), file.name || 'receipt.jpg');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function renderReceiptThumb(id, dataUrl, filename) {
  const wrap = document.getElementById('receipt-wrap-' + id);
  wrap.dataset.image = dataUrl; wrap.dataset.filename = filename;
  wrap.innerHTML = `<img src="${dataUrl}" class="receipt-thumb" onclick="openLightbox('${dataUrl}')" alt="領収書" />
    <span class="receipt-badge"><i class="ti ti-check" style="font-size:9px;"></i> 添付済み</span>
    <button type="button" class="receipt-remove" onclick="removeReceiptThumb(${id})"><i class="ti ti-x"></i></button>`;
}
function removeReceiptThumb(id) {
  const wrap = document.getElementById('receipt-wrap-' + id);
  delete wrap.dataset.image; delete wrap.dataset.filename;
  wrap.innerHTML = `<button type="button" class="receipt-add-btn" onclick="document.getElementById('receipt-file-${id}').click()"><i class="ti ti-camera"></i>写真を追加</button>`;
}
function openLightbox(url) { document.getElementById('lightbox-img').src = url; document.getElementById('lightbox').classList.add('show'); }
function closeLightbox() { document.getElementById('lightbox').classList.remove('show'); }

// ============================================
// 日計：保存
// ============================================
async function saveEntry() {
  const date = document.getElementById('entry-date').value;
  if (!date) { showToast('日付を選んでください', 'toast', 'err'); return; }
  const defaultBiz = document.getElementById('entry-default-biz').value || (db.bizList[0] && db.bizList[0].id);
  const salesCash = parseFloat(document.getElementById('sales-cash').value) || 0;
  const salesCashBiz = document.getElementById('sales-cash-biz').value || defaultBiz;
  const extraSales = extraSalesIds.map(id => ({
    name: document.getElementById('esname-' + id)?.value || 'その他売上',
    amount: parseFloat(document.getElementById('esamt-' + id)?.value) || 0,
    biz: document.getElementById('esbiz-' + id)?.value || defaultBiz
  })).filter(e => e.amount > 0);
  const expensesRaw = expenseIds.map(id => {
    const wrap = document.getElementById('receipt-wrap-' + id);
    return { id, account: getAccountValue(id), payment: document.getElementById('epay-' + id)?.value || '現金',
      amount: parseFloat(document.getElementById('eamt-' + id)?.value) || 0,
      desc: document.getElementById('edesc-' + id)?.value || '',
      biz: document.getElementById('ebiz-' + id)?.value || defaultBiz,
      receiptDataUrl: wrap && wrap.dataset.image ? wrap.dataset.image : null,
      receiptFilename: wrap && wrap.dataset.filename ? wrap.dataset.filename : null };
  }).filter(e => e.amount > 0);
  const memo = document.getElementById('entry-memo').value;
  document.getElementById('loading-overlay').classList.add('show');
  try {
    const expenses = [];
    for (const ex of expensesRaw) {
      let receiptUrl = null;
      if (ex.receiptDataUrl) {
        const uploadRes = await gasCall('uploadReceipt', { date, filename: ex.receiptFilename, base64: ex.receiptDataUrl.split(',')[1] });
        receiptUrl = uploadRes.fileUrl;
      }
      expenses.push({ account: ex.account, payment: ex.payment, amount: ex.amount, desc: ex.desc, biz: ex.biz, receiptUrl });
    }
    const entry = { date, salesCash, salesCashBiz, extraSales, expenses, memo };
    const idx = db.entries.findIndex(e => e.date === date);
    if (idx >= 0) db.entries[idx] = entry; else db.entries.push(entry);
    db.entries.sort((a, b) => a.date.localeCompare(b.date));
    saveLocalCache();
    const ok = await pushToServer('saveEntry', entry);
    if (ok) showToast('保存しました ✓');
    populateMonthSelects();
    document.getElementById('sales-cash').value = ''; document.getElementById('entry-memo').value = '';
    document.getElementById('extra-sales-list').innerHTML = ''; document.getElementById('expense-list').innerHTML = '';
    extraSalesIds = []; expenseIds = []; updateSalesTotal();
    onDateChange();
  } catch(e) { console.error(e); showToast('保存中にエラーが発生しました', 'toast', 'err'); }
  finally { document.getElementById('loading-overlay').classList.remove('show'); }
}

// ============================================
// 給与・社会保険
// ============================================
function calcKyuyo(salary, shakai) {
  const honnin = half(shakai); const kaisha = shakai - honnin; const tedori = salary - honnin;
  return { salary, shakai, honnin, kaisha, tedori, total: tedori + shakai };
}
function updateKyuyoPreview() {
  const salary = parseFloat(document.getElementById('k-salary').value) || db.kyuyoSettings.salary || 45000;
  const shakai = parseFloat(document.getElementById('k-shakai').value) || db.kyuyoSettings.shakai || 23124;
  const k = calcKyuyo(salary, shakai);
  document.getElementById('prev-salary').textContent = fmt(k.salary);
  document.getElementById('prev-honnin').textContent = fmt(k.honnin);
  document.getElementById('prev-gensen').textContent = '¥0';
  document.getElementById('prev-tedori').textContent = fmt(k.tedori);
  document.getElementById('prev-kaisha').textContent = fmt(k.kaisha);
  document.getElementById('prev-total').textContent = fmt(k.total);
  document.getElementById('j1-salary').textContent = fmt(k.salary);
  document.getElementById('j1-honnin').textContent = fmt(k.honnin);
  document.getElementById('j1-tedori').textContent = fmt(k.tedori);
  document.getElementById('j2-kaisha').textContent = fmt(k.kaisha);
  document.getElementById('j2-honnin').textContent = fmt(k.honnin);
  document.getElementById('j2-total').textContent = fmt(k.shakai);
}
async function saveKyuyoSettings() {
  const salary = parseFloat(document.getElementById('k-salary').value) || 45000;
  const shakai = parseFloat(document.getElementById('k-shakai').value) || 23124;
  db.kyuyoSettings = { salary, shakai }; saveLocalCache();
  await pushToServer('saveKyuyoSettings', db.kyuyoSettings);
  showToast('設定を保存しました', 'kyuyo-toast'); updateKyuyoPreview();
}
function initKyuyo() {
  document.getElementById('k-salary').value = db.kyuyoSettings.salary || 45000;
  document.getElementById('k-shakai').value = db.kyuyoSettings.shakai || 23124;
  updateKyuyoPreview(); checkKyuyoAlready();
  document.getElementById('kyuyo-month').onchange = checkKyuyoAlready;
}
function checkKyuyoAlready() {
  const month = document.getElementById('kyuyo-month')?.value;
  const already = db.kyuyo.some(k => k.month === month);
  document.getElementById('kyuyo-already').style.display = already ? 'block' : 'none';
}
async function recordKyuyo() {
  const month = document.getElementById('kyuyo-month').value;
  const salary = parseFloat(document.getElementById('k-salary').value) || db.kyuyoSettings.salary || 45000;
  const shakai = parseFloat(document.getElementById('k-shakai').value) || db.kyuyoSettings.shakai || 23124;
  const k = calcKyuyo(salary, shakai);
  const record = { month, salary: k.salary, shakai: k.shakai, honnin: k.honnin, kaisha: k.kaisha, tedori: k.tedori };
  const idx = db.kyuyo.findIndex(r => r.month === month);
  if (idx >= 0) db.kyuyo[idx] = record; else db.kyuyo.push(record);
  db.kyuyo.sort((a, b) => a.month.localeCompare(b.month));
  saveLocalCache();
  const ok = await pushToServer('saveKyuyo', record);
  if (ok) showToast(month.replace('-', '年') + '月の給与・社保を記録しました', 'kyuyo-toast');
  checkKyuyoAlready(); populateMonthSelects();
}

// ============================================
// 売上CSV取込
// ============================================
function onDragOver(e) { e.preventDefault(); document.getElementById('drop-zone').classList.add('drag'); }
function onDragLeave() { document.getElementById('drop-zone').classList.remove('drag'); }
function onDrop(e) { e.preventDefault(); document.getElementById('drop-zone').classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }
function handleFile(file) {
  if (!file) return;
  if (!file.name.endsWith('.csv')) { showToast('CSVファイルを選んでください', 'import-toast', 'err'); return; }
  const reader = new FileReader();
  reader.onload = e => { try { parseCSV(e.target.result, file.name); } catch(err) { showToast('読み込みエラー: ' + err.message, 'import-toast', 'err'); } };
  reader.readAsText(file, 'UTF-8');
}
function parseCSV(text, filename) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('データが空です');
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const COL = { date: headers.indexOf('date'), cash: headers.indexOf('sales_cash'), exname: headers.indexOf('sales_extra_name'), examt: headers.indexOf('sales_extra_amount'), memo: headers.indexOf('memo') };
  if (COL.date < 0 || COL.cash < 0) throw new Error('"date"と"sales_cash"列が必要です');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const date = cols[COL.date] || '';
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) continue;
    rows.push({ date, cash: parseFloat(cols[COL.cash]) || 0, exname: COL.exname >= 0 ? cols[COL.exname] || '' : '', examt: COL.examt >= 0 ? parseFloat(cols[COL.examt]) || 0 : 0, memo: COL.memo >= 0 ? cols[COL.memo] || '' : '' });
  }
  if (!rows.length) throw new Error('有効なデータがありません');
  pendingImport = rows;
  const totalSales = rows.reduce((s, r) => s + r.cash + r.examt, 0);
  const overlap = rows.filter(r => db.entries.some(e => e.date === r.date)).length;
  document.getElementById('preview-stats').innerHTML = `
    <div class="jizuke-row"><span>ファイル名</span><span style="font-weight:600;">${filename}</span></div>
    <div class="jizuke-row"><span>読込件数</span><span style="font-weight:600;">${rows.length}日分</span></div>
    <div class="jizuke-row"><span>売上合計</span><span style="font-weight:600;color:var(--green);">${fmt(totalSales)}</span></div>
    ${overlap ? `<div class="jizuke-row"><span style="color:var(--amber);">上書き</span><span style="font-weight:600;color:var(--amber);">${overlap}日分</span></div>` : ''}`;
  document.getElementById('preview-body').innerHTML = rows.filter(r => r.cash + r.examt > 0).slice(0, 10).map(r =>
    `<tr><td>${r.date.substring(5)}</td><td class="amt green">${r.cash ? fmt(r.cash) : '-'}</td><td class="amt">${r.examt ? fmt(r.examt) : '-'}</td><td style="font-size:11px;color:var(--text-sub);">${r.memo || ''}</td></tr>`
  ).join('');
  document.getElementById('import-preview').style.display = 'block';
}
async function executeImport() {
  const biz = document.getElementById('import-biz').value || (db.bizList[0] && db.bizList[0].id);
  let added = 0, updated = 0;
  document.getElementById('loading-overlay').classList.add('show');
  try {
    for (const r of pendingImport) {
      const extraSales = r.exname && r.examt > 0 ? [{ name: r.exname, amount: r.examt, biz }] : [];
      const idx = db.entries.findIndex(e => e.date === r.date);
      let entry;
      if (idx >= 0) { db.entries[idx].salesCash = r.cash; db.entries[idx].salesCashBiz = biz; db.entries[idx].extraSales = extraSales; if (r.memo) db.entries[idx].memo = r.memo; entry = db.entries[idx]; updated++; }
      else { entry = { date: r.date, salesCash: r.cash, salesCashBiz: biz, extraSales, expenses: [], memo: r.memo }; db.entries.push(entry); added++; }
      await pushToServer('saveEntry', entry);
    }
    db.entries.sort((a, b) => a.date.localeCompare(b.date));
    saveLocalCache(); populateMonthSelects();
    pendingImport = []; document.getElementById('import-preview').style.display = 'none'; document.getElementById('csv-file').value = '';
    showToast(`完了！ 新規${added}件・更新${updated}件`, 'import-toast');
  } finally { document.getElementById('loading-overlay').classList.remove('show'); }
}

// ============================================
// 月報
// ============================================
function renderGeppo() {
  const month = document.getElementById('geppo-month').value;
  const bizFilter = document.getElementById('geppo-biz').value || 'all';
  const entries = db.entries.filter(e => e.date.startsWith(month));
  const kyuyo = db.kyuyo.find(k => k.month === month);
  let ts = 0, te = 0; const salesBreak = {}, payBreak = {}, bizBreak = {};
  entries.forEach(e => {
    if (e.salesCash > 0 && (bizFilter === 'all' || e.salesCashBiz === bizFilter)) {
      ts += e.salesCash; salesBreak['現金売上'] = (salesBreak['現金売上'] || 0) + e.salesCash; bizBreak[e.salesCashBiz] = (bizBreak[e.salesCashBiz] || 0) + e.salesCash;
    }
    (e.extraSales || []).forEach(es => { if (bizFilter !== 'all' && es.biz !== bizFilter) return; ts += es.amount; salesBreak[es.name] = (salesBreak[es.name] || 0) + es.amount; bizBreak[es.biz] = (bizBreak[es.biz] || 0) + es.amount; });
    (e.expenses || []).forEach(ex => { if (bizFilter !== 'all' && ex.biz !== bizFilter) return; te += ex.amount; payBreak[ex.payment] = (payBreak[ex.payment] || 0) + ex.amount; });
  });
  if (kyuyo && bizFilter === 'all') te += kyuyo.salary + kyuyo.kaisha;
  document.getElementById('g-sales').textContent = fmt(ts);
  document.getElementById('g-expense').textContent = fmt(te);
  document.getElementById('g-profit').textContent = fmt(ts - te);
  document.getElementById('g-kyuyo').textContent = kyuyo ? fmt(kyuyo.salary) : '未記録';
  document.getElementById('g-days').textContent = entries.length + '日';
  const bb = document.getElementById('g-biz-breakdown');
  const bbe = Object.entries(bizBreak).filter(([,v]) => v > 0);
  bb.innerHTML = bbe.length ? bbe.map(([k,v]) => `<div class="ledger-row"><span class="biz-tag ${bizTagClass(k)}">${bizName(k)}</span><span class="green" style="font-weight:600;">${fmt(v)}</span></div>`).join('') : '<div class="empty-state">売上なし</div>';
  const sb = document.getElementById('g-sales-breakdown');
  const sbe = Object.entries(salesBreak).filter(([,v]) => v > 0);
  sb.innerHTML = sbe.length ? sbe.map(([k,v]) => `<div class="ledger-row"><span>${k}</span><span class="green" style="font-weight:600;">${fmt(v)}</span></div>`).join('') : '<div class="empty-state">売上なし</div>';
  const pb = document.getElementById('g-payment-breakdown');
  const pbe = Object.entries(payBreak).filter(([,v]) => v > 0);
  pb.innerHTML = pbe.length ? pbe.map(([k,v]) => `<div class="ledger-row"><span>${k}</span><span class="red" style="font-weight:600;">${fmt(v)}</span></div>`).join('') : '<div class="empty-state">経費なし</div>';
  const dl = document.getElementById('g-daily-list');
  if (!entries.length) { dl.innerHTML = '<div class="empty-state">データなし</div>'; return; }
  dl.innerHTML = `<table class="dt"><thead><tr><th>日</th><th class="amt">売上</th><th class="amt">経費</th><th class="amt">粗利</th></tr></thead><tbody>${entries.map(e => {
    const s = (bizFilter === 'all' || e.salesCashBiz === bizFilter ? e.salesCash : 0) + (e.extraSales || []).filter(x => bizFilter === 'all' || x.biz === bizFilter).reduce((a,x) => a+x.amount, 0);
    const ex = (e.expenses || []).filter(x => bizFilter === 'all' || x.biz === bizFilter).reduce((a,x) => a+x.amount, 0);
    const pr = s - ex;
    return `<tr><td>${e.date.substring(5)}</td><td class="amt green">${fmt(s)}</td><td class="amt red">${ex ? fmt(ex) : '-'}</td><td class="amt ${pr >= 0 ? 'green' : 'red'}">${fmt(pr)}</td></tr>`;
  }).join('')}</tbody></table>`;
}

// ============================================
// 仕訳帳
// ============================================
function renderLedger() {
  const month = document.getElementById('ledger-month').value;
  const bizFilter = document.getElementById('ledger-biz').value || 'all';
  const entries = db.entries.filter(e => e.date.startsWith(month));
  const kyuyo = db.kyuyo.find(k => k.month === month);
  const c = document.getElementById('ledger-entries');
  let html = '';
  if (kyuyo && bizFilter === 'all') {
    html += `<div style="font-size:11px;font-weight:600;color:var(--text-sub);padding:6px 0 4px;">給与・社会保険</div>`;
    html += `<div class="ledger-row"><div><div style="font-weight:600;">${month.replace('-','/')} <span class="biz-tag biz-other">役員報酬</span></div><div class="ledger-date">借方：役員報酬　貸方：預り金＋普通預金</div></div><span class="blue">${fmt(kyuyo.salary)}</span></div>`;
    html += `<div class="ledger-row"><div><div style="font-weight:600;">${month.replace('-','/')} <span class="biz-tag biz-other">社会保険納付</span></div><div class="ledger-date">借方：法定福利費＋預り金　貸方：普通預金</div></div><span class="red">${fmt(kyuyo.shakai)}</span></div>`;
    html += `<div style="font-size:11px;font-weight:600;color:var(--text-sub);padding:10px 0 4px;">日々の記録</div>`;
  }
  entries.forEach(e => {
    if (e.salesCash > 0 && (bizFilter === 'all' || e.salesCashBiz === bizFilter))
      html += `<div class="ledger-row"><div><div style="font-weight:600;">${e.date.substring(5)} 現金売上 <span class="biz-tag ${bizTagClass(e.salesCashBiz)}">${bizName(e.salesCashBiz)}</span></div>${e.memo ? `<div class="ledger-date">${e.memo}</div>` : ''}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="green">${fmt(e.salesCash)}</span>
          <button class="btn btn-outline" style="padding:3px 8px;font-size:10px;" onclick="editEntry('${e.date}');switchTab('nikkkei',document.querySelector('[data-tab=nikkkei]'))"><i class="ti ti-pencil"></i></button>
        </div></div>`;
    (e.extraSales || []).forEach(es => {
      if (bizFilter !== 'all' && es.biz !== bizFilter) return;
      html += `<div class="ledger-row"><div><div style="font-weight:600;">${e.date.substring(5)} ${es.name} <span class="biz-tag ${bizTagClass(es.biz)}">${bizName(es.biz)}</span></div></div><span class="green">${fmt(es.amount)}</span></div>`;
    });
    (e.expenses || []).forEach(ex => {
      if (bizFilter !== 'all' && ex.biz !== bizFilter) return;
      const hasReceipt = ex.receiptUrl ? `<a href="${ex.receiptUrl}" target="_blank" rel="noopener" class="receipt-badge" style="margin-left:8px;text-decoration:none;"><i class="ti ti-photo" style="font-size:10px;"></i> 領収書</a>` : '';
      html += `<div class="ledger-row"><div><div style="font-weight:600;">${e.date.substring(5)} ${ex.account} <span class="biz-tag ${bizTagClass(ex.biz)}">${bizName(ex.biz)}</span></div><div class="ledger-date">${ex.payment}${ex.desc ? ' / ' + ex.desc : ''}</div></div><div style="display:flex;align-items:center;"><span class="red">${fmt(ex.amount)}</span>${hasReceipt}</div></div>`;
    });
  });
  // 銀行・カード明細（確認済）を追加
  if (bizFilter === 'all') {
    const meisaiItems = (db.meisai || []).filter(m => m.date.startsWith(month) && m.checked);
    if (meisaiItems.length) {
      html += `<div style="font-size:11px;font-weight:600;color:var(--text-sub);padding:10px 0 4px;border-top:1px solid var(--border-light);margin-top:8px;">銀行・カード明細（確認済）</div>`;
      meisaiItems.forEach(m => {
        const srcClass = m.source === 'JCB' ? 'source-jcb' : m.source === 'ゆうちょ' ? 'source-yucho' : 'source-aozora';
        html += `<div class="ledger-row"><div><div style="font-weight:600;">${m.date.substring(5)} <span class="source-badge ${srcClass}">${m.source}</span> ${m.debit}</div><div class="ledger-date">${m.shopName}${m.memo ? ' / ' + m.memo : ''} → 貸方: ${m.credit}</div></div><span class="red">¥${m.amount.toLocaleString()}</span></div>`;
      });
    }
  }
  if (!html) html = '<div class="empty-state">データなし</div>';
  c.innerHTML = html;
}

// ============================================
// 事業区分・勘定科目
// ============================================
function renderBizList() {
  const list = document.getElementById('biz-list'); if (!list) return;
  list.innerHTML = db.bizList.map((b, i) => `<div class="biz-mgmt-row"><span class="biz-tag ${bizTagClass(b.id)}">${b.name}</span><input type="text" value="${b.name}" onchange="renameBiz(${i}, this.value)" /><button class="delete-btn" onclick="removeBiz(${i})"><i class="ti ti-x"></i></button></div>`).join('');
}
async function renameBiz(i, name) { if (!name.trim()) return; db.bizList[i].name = name.trim(); saveLocalCache(); await pushToServer('saveBizList', db.bizList); renderBizSelects(); renderBizList(); showToast('更新しました', 'toast2'); }
async function removeBiz(i) { if (db.bizList.length <= 1) { showToast('最低1つは必要です', 'toast2', 'err'); return; } if (!confirm(db.bizList[i].name + ' を削除しますか？')) return; db.bizList.splice(i, 1); saveLocalCache(); await pushToServer('saveBizList', db.bizList); renderBizSelects(); renderBizList(); }
async function addBiz() { const name = prompt('事業区分名を入力してください'); if (name && name.trim()) { const id = 'biz_' + Date.now(); db.bizList.push({ id, name: name.trim() }); saveLocalCache(); await pushToServer('saveBizList', db.bizList); renderBizSelects(); renderBizList(); showToast('追加しました', 'toast2'); } }
function renderAccountList() {
  const list = document.getElementById('account-list'); if (!list) return;
  list.innerHTML = db.accounts.map((a, i) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="flex:1;font-size:13px;">${a}</span><button class="delete-btn" onclick="removeAccount(${i})"><i class="ti ti-x"></i></button></div>`).join('') + `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;opacity:0.45;"><span style="flex:1;font-size:13px;font-style:italic;">${CUSTOM_LABEL}（固定）</span></div>`;
}
async function addAccount() { const name = prompt('科目名を入力してください'); if (name && name.trim()) { db.accounts.push(name.trim()); saveLocalCache(); await pushToServer('saveAccounts', db.accounts); renderAccountList(); showToast('追加しました', 'toast2'); } }
async function removeAccount(i) { if (!confirm(db.accounts[i] + ' を削除しますか？')) return; db.accounts.splice(i, 1); saveLocalCache(); await pushToServer('saveAccounts', db.accounts); renderAccountList(); }

// ============================================
// 領収書容量表示
// ============================================
function renderStorageInfo() {
  const receiptCount = db.entries.reduce((sum, e) => sum + (e.expenses || []).filter(ex => ex.receiptUrl).length, 0);
  document.getElementById('storage-info').innerHTML = `
    <div class="jizuke-row"><span>添付された領収書</span><span style="font-weight:600;">${receiptCount}枚</span></div>
    <div class="jizuke-row"><span>保存先</span><span style="font-weight:600;">Googleドライブ「たいよう_レシート」フォルダ</span></div>
    <div style="font-size:11px;color:var(--text-sub);margin-top:6px;">※ Googleドライブの容量に依存します</div>`;
}

// ============================================
// CSV出力
// ============================================
function exportCSV(type) {
  const month = document.getElementById('export-month').value;
  const bizFilter = document.getElementById('export-biz').value || 'all';
  const entries = db.entries.filter(e => e.date.startsWith(month));
  const kyuyo = db.kyuyo.find(k => k.month === month);
  const meisaiItems = (db.meisai || []).filter(m => m.date.startsWith(month) && m.checked);
  const bizSuffix = bizFilter === 'all' ? '' : '_' + bizName(bizFilter);
  let csv = '', filename = '';

  if (type === 'daily') {
    csv = '日付,事業区分,現金売上,追加売上合計,売上合計,経費合計,粗利益,メモ\n';
    entries.forEach(e => {
      const cashIn = (bizFilter === 'all' || e.salesCashBiz === bizFilter) ? e.salesCash : 0;
      const es = (e.extraSales || []).filter(x => bizFilter === 'all' || x.biz === bizFilter).reduce((a,x) => a+x.amount, 0);
      const s = cashIn + es; const ex = (e.expenses || []).filter(x => bizFilter === 'all' || x.biz === bizFilter).reduce((a,x) => a+x.amount, 0);
      if (s === 0 && ex === 0 && bizFilter !== 'all') return;
      csv += `${e.date},${bizFilter === 'all' ? '全事業' : bizName(bizFilter)},${cashIn},${es},${s},${ex},${s-ex},"${e.memo || ''}"\n`;
    });
    filename = `日計表${bizSuffix}_${month}.csv`;
  } else if (type === 'monthly') {
    let ts = 0, te = 0; const sb = {};
    entries.forEach(e => {
      if (bizFilter === 'all' || e.salesCashBiz === bizFilter) { ts += e.salesCash; sb['現金売上'] = (sb['現金売上'] || 0) + e.salesCash; }
      (e.extraSales || []).forEach(es => { if (bizFilter === 'all' || es.biz === bizFilter) { ts += es.amount; sb[es.name] = (sb[es.name] || 0) + es.amount; } });
      (e.expenses || []).forEach(ex => { if (bizFilter === 'all' || ex.biz === bizFilter) te += ex.amount; });
    });
    if (kyuyo && bizFilter === 'all') te += kyuyo.salary + kyuyo.kaisha;
    if (bizFilter === 'all') meisaiItems.forEach(m => te += m.amount);
    csv = '項目,金額\n売上合計,' + ts + '\n';
    Object.entries(sb).forEach(([k,v]) => { csv += `${k},${v}\n`; });
    csv += `経費合計,${te}\n`;
    if (kyuyo && bizFilter === 'all') csv += `役員報酬,${kyuyo.salary}\n法定福利費,${kyuyo.kaisha}\n`;
    csv += `粗利益,${ts-te}\n営業日数,${entries.length}\n`;
    filename = `月報${bizSuffix}_${month}.csv`;
  } else if (type === 'jizuke') {
    csv = '日付,口座・区分,借方科目,貸方科目,金額,利用先,摘要・品目\n';
    if (kyuyo && bizFilter === 'all') {
      csv += `${month}-01,給与,役員報酬,預り金,${kyuyo.honnin},社保本人負担分,\n`;
      csv += `${month}-01,給与,役員報酬,普通預金（ゆうちょ）,${kyuyo.tedori},役員報酬手取振込,\n`;
      csv += `${month}-01,給与,法定福利費,普通預金（ゆうちょ）,${kyuyo.kaisha},社保会社負担分,\n`;
      csv += `${month}-01,給与,預り金,普通預金（ゆうちょ）,${kyuyo.honnin},社保本人分納付,\n`;
    }
    entries.forEach(e => {
      if (e.salesCash > 0 && (bizFilter === 'all' || e.salesCashBiz === bizFilter)) csv += `${e.date},売上,現金,売上,${e.salesCash},現金売上,\n`;
      (e.extraSales || []).forEach(es => { if (bizFilter === 'all' || es.biz === bizFilter) csv += `${e.date},売上,売掛金,売上,${es.amount},"${es.name}",\n`; });
      (e.expenses || []).forEach(ex => { if (bizFilter === 'all' || ex.biz === bizFilter) csv += `${e.date},経費,${ex.account},${ex.payment},${ex.amount},"${ex.desc || ''}",\n`; });
    });
    if (bizFilter === 'all') meisaiItems.forEach(m => { csv += `${m.date},${m.source},${m.debit},${m.credit},${m.amount},"${m.shopName}","${m.memo || ''}"\n`; });
    filename = `仕訳帳${bizSuffix}_${month}.csv`;
  } else {
    csv = '日付,区分,口座,借方科目,貸方科目,金額,利用先,摘要,領収書URL\n';
    if (kyuyo && bizFilter === 'all') {
      csv += `${month}-01,給与,,役員報酬,預り金,${kyuyo.salary},,\n`;
      csv += `${month}-01,給与,,法定福利費,普通預金（ゆうちょ）,${kyuyo.kaisha},,\n`;
    }
    entries.forEach(e => {
      if (e.salesCash > 0 && (bizFilter === 'all' || e.salesCashBiz === bizFilter)) csv += `${e.date},売上,,現金,売上,${e.salesCash},現金売上,,\n`;
      (e.extraSales || []).forEach(es => { if (bizFilter === 'all' || es.biz === bizFilter) csv += `${e.date},売上,,"${es.name}",,${es.amount},"${es.name}",,\n`; });
      (e.expenses || []).forEach(ex => { if (bizFilter === 'all' || ex.biz === bizFilter) csv += `${e.date},経費,,${ex.account},${ex.payment},${ex.amount},,"${ex.desc || ''}",${ex.receiptUrl || ''}\n`; });
    });
    if (bizFilter === 'all') meisaiItems.forEach(m => { csv += `${m.date},銀行明細,${m.source},${m.debit},${m.credit},${m.amount},"${m.shopName}","${m.memo || ''}",\n`; });
    filename = `全データ${bizSuffix}_${month}.csv`;
  }
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  showToast(filename + ' をダウンロード', 'toast2');
}

// ============================================
// データリセット
// ============================================
async function clearAllData() {
  if (!confirm('全データを削除します。元に戻せません。よろしいですか？')) return;
  if (!confirm('本当によろしいですか？')) return;
  document.getElementById('loading-overlay').classList.add('show');
  try {
    await pushToServer('clearAll', {});
    db = { entries: [], kyuyo: [], meisai: [], accounts: [...DEF_ACCOUNTS], bizList: [...DEF_BIZ], kyuyoSettings: { salary: 45000, shakai: 23124 } };
    saveLocalCache(); showToast('リセットしました', 'toast2');
    populateMonthSelects(); renderBizSelects(); renderAccountList(); renderBizList();
  } finally { document.getElementById('loading-overlay').classList.remove('show'); }
}

// ============================================
// 銀行・カード明細管理
// ============================================
function meisaiDragOver(e) { e.preventDefault(); document.getElementById('meisai-drop').classList.add('drag'); }
function meisaiDragLeave() { document.getElementById('meisai-drop').classList.remove('drag'); }
function meisaiDrop(e) { e.preventDefault(); document.getElementById('meisai-drop').classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) onMeisaiFileSelect(f); }

async function onMeisaiFileSelect(file) {
  if (!file) return;
  document.getElementById('loading-overlay').classList.add('show');
  try {
    const result = await importMeisaiFile(file);
    let added = 0, skipped = 0;
    for (const item of result.items) {
      if (!db.meisai.find(m => m.id === item.id)) { db.meisai.push(item); added++; } else skipped++;
    }
    db.meisai.sort((a, b) => a.date.localeCompare(b.date));
    saveLocalCache();
    showMeisaiToast(`${result.format}：${added}件取込みました${skipped > 0 ? `（重複${skipped}件スキップ）` : ''}`, 'ok');
    document.getElementById('meisai-file').value = '';
    renderMeisaiList(); updateMeisaiBadge();
  } catch(e) { showMeisaiToast(e.message, 'err'); }
  finally { document.getElementById('loading-overlay').classList.remove('show'); }
}

function showMeisaiToast(msg, type = 'ok') {
  const t = document.getElementById('meisai-toast');
  t.textContent = msg; t.className = 'toast ' + type; t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 3000);
}

function updateMeisaiBadge() {
  if (!db.meisai) return;
  const unchecked = db.meisai.filter(m => !m.checked).length;
  const badge = document.getElementById('meisai-badge');
  if (badge) badge.style.display = unchecked > 0 ? 'inline' : 'none';
  const banner = document.getElementById('meisai-pending-banner');
  const text = document.getElementById('meisai-pending-text');
  if (banner && text) {
    if (unchecked > 0) { banner.style.display = 'flex'; text.textContent = `未確認の明細が ${unchecked} 件あります。`; }
    else banner.style.display = 'none';
  }
}

function renderMeisaiList() {
  if (!db.meisai || !db.meisai.length) { document.getElementById('meisai-list-area').style.display = 'none'; return; }
  document.getElementById('meisai-list-area').style.display = 'block';
  const filterMonth = document.getElementById('meisai-filter-month').value;
  const filterSource = document.getElementById('meisai-filter-source').value;
  const filterChecked = document.getElementById('meisai-filter-checked').value;
  const months = [...new Set(db.meisai.map(m => m.date.substring(0, 7)))].sort().reverse();
  const monthSel = document.getElementById('meisai-filter-month');
  const prevMonth = monthSel.value;
  monthSel.innerHTML = '<option value="all">全月</option>' + months.map(m => `<option value="${m}">${m.replace('-','年')}月</option>`).join('');
  if (prevMonth && months.includes(prevMonth)) monthSel.value = prevMonth;
  let items = db.meisai;
  if (filterMonth !== 'all') items = items.filter(m => m.date.startsWith(filterMonth));
  if (filterSource !== 'all') items = items.filter(m => m.source === filterSource);
  if (filterChecked === 'unchecked') items = items.filter(m => !m.checked);
  if (filterChecked === 'checked') items = items.filter(m => m.checked);
  const tbody = document.getElementById('meisai-tbody');
  tbody.innerHTML = items.map(item => {
    const srcClass = item.source === 'JCB' ? 'source-jcb' : item.source === 'ゆうちょ' ? 'source-yucho' : 'source-aozora';
    const accountOpts = [...(db.accounts || []), 'その他経費'].map(a => `<option value="${a}" ${item.debit === a ? 'selected' : ''}>${a}</option>`).join('');
    const creditOpts = ['JCBカード','出光法人カード','普通預金（ゆうちょ）','普通預金（あおぞら）','現金','役員報酬','受取利息','雑収入','仮受金','その他'].map(a => `<option value="${a}" ${item.credit === a ? 'selected' : ''}>${a}</option>`).join('');
    return `<tr class="${item.checked ? 'checked-row' : ''}" id="mrow-${item.id}">
      <td style="text-align:center;"><input type="checkbox" ${item.checked ? 'checked' : ''} onchange="toggleMeisaiCheck('${item.id}', this.checked)" /></td>
      <td style="white-space:nowrap;font-size:11px;">${item.date}<br><span style="color:var(--text-sub);">${item.useDate ? '利用:'+item.useDate : ''}</span></td>
      <td><span class="source-badge ${srcClass}">${item.source}</span></td>
      <td><select onchange="updateMeisaiField('${item.id}','debit',this.value)">${accountOpts}</select></td>
      <td><select onchange="updateMeisaiField('${item.id}','credit',this.value)">${creditOpts}</select></td>
      <td style="text-align:right;font-weight:600;white-space:nowrap;">¥${item.amount.toLocaleString()}</td>
      <td style="font-size:11px;color:var(--text-sub);">${item.shopName || ''}</td>
      <td><input type="text" value="${item.memo || ''}" placeholder="品目・内容を入力" onchange="updateMeisaiField('${item.id}','memo',this.value)" /></td>
    </tr>`;
  }).join('');
  const total = items.reduce((s,m) => s+m.amount, 0);
  const unchecked = items.filter(m => !m.checked).length;
  document.getElementById('meisai-list-footer').innerHTML = `表示: ${items.length}件 / 合計: ¥${total.toLocaleString()} ／ <span class="unchecked-badge">未確認 ${unchecked}件</span>`;
  updateMeisaiBadge();
}

function updateMeisaiField(id, field, value) { const item = db.meisai.find(m => m.id === id); if (!item) return; item[field] = value; saveLocalCache(); }

function toggleMeisaiCheck(id, checked) {
  const item = db.meisai.find(m => m.id === id); if (!item) return;
  item.checked = checked;
  const row = document.getElementById('mrow-' + id); if (row) row.className = checked ? 'checked-row' : '';
  saveLocalCache(); updateMeisaiBadge();
}

function bulkCheckAll() {
  const fm = document.getElementById('meisai-filter-month').value;
  const fs = document.getElementById('meisai-filter-source').value;
  db.meisai.forEach(m => { if (fm !== 'all' && !m.date.startsWith(fm)) return; if (fs !== 'all' && m.source !== fs) return; m.checked = true; });
  saveLocalCache(); renderMeisaiList();
}
function bulkUncheckAll() { db.meisai.forEach(m => m.checked = false); saveLocalCache(); renderMeisaiList(); }

async function saveMeisaiToServer() {
  document.getElementById('loading-overlay').classList.add('show');
  try { const ok = await pushToServer('saveMeisai', db.meisai); if (ok) showMeisaiToast('明細データを保存しました ✓'); }
  finally { document.getElementById('loading-overlay').classList.remove('show'); }
}

// ============================================
// ============================================
// 日付変更時：その日の既存データを表示
// ============================================
function onDateChange() {
  const date = document.getElementById('entry-date').value;
  const area = document.getElementById('existing-entry-area');
  const detail = document.getElementById('existing-entry-detail');
  if (!area || !detail) return;

  const entry = db.entries.find(e => e.date === date);
  if (!entry) { area.style.display = 'none'; return; }

  const totalSales = entry.salesCash + (entry.extraSales || []).reduce((a,x) => a+x.amount, 0);
  const totalExp = (entry.expenses || []).reduce((a,x) => a+x.amount, 0);
  const expList = (entry.expenses || []).map(ex =>
    `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border-light);font-size:12px;">
      <span style="color:var(--text-sub);">${ex.account}${ex.desc ? ' / '+ex.desc : ''} <span style="font-size:10px;">(${ex.payment})</span></span>
      <div style="display:flex;align-items:center;gap:6px;">
        <span class="red" style="font-weight:600;">¥${ex.amount.toLocaleString()}</span>
        ${ex.receiptUrl
          ? `<a href="${ex.receiptUrl}" target="_blank" rel="noopener" style="text-decoration:none;background:#EAF3DE;color:#3B6D11;font-size:10px;padding:2px 7px;border-radius:8px;font-weight:600;"><i class="ti ti-camera"></i> 領収書あり</a>`
          : `<span style="background:#F1EFE8;color:#8A7B66;font-size:10px;padding:2px 7px;border-radius:8px;">領収書なし</span>`
        }
      </div>
    </div>`
  ).join('');

  detail.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:8px;">
      <div class="metric" style="flex:1;padding:8px;"><div class="metric-label">売上</div><div style="font-size:15px;font-weight:600;" class="green">¥${totalSales.toLocaleString()}</div></div>
      <div class="metric" style="flex:1;padding:8px;"><div class="metric-label">経費</div><div style="font-size:15px;font-weight:600;" class="red">¥${totalExp.toLocaleString()}</div></div>
    </div>
    ${expList}
    <div style="display:flex;gap:8px;margin-top:10px;">
      <button class="btn btn-soft" style="flex:1;font-size:12px;" onclick="editEntry('${date}')"><i class="ti ti-pencil"></i>この日を編集</button>
      <button class="btn btn-outline" style="flex:1;font-size:12px;color:var(--red);" onclick="deleteEntry('${date}')"><i class="ti ti-trash"></i>削除</button>
    </div>`;
  area.style.display = 'block';
}

// ── 編集：その日のデータをフォームに読み込む ──
function editEntry(date) {
  const entry = db.entries.find(e => e.date === date);
  if (!entry) return;

  // フォームをリセット
  document.getElementById('sales-cash').value = '';
  document.getElementById('entry-memo').value = '';
  document.getElementById('extra-sales-list').innerHTML = '';
  document.getElementById('expense-list').innerHTML = '';
  extraSalesIds = []; expenseIds = [];

  // 日付・売上・メモをセット
  document.getElementById('entry-date').value = entry.date;
  document.getElementById('sales-cash').value = entry.salesCash || '';
  document.getElementById('entry-memo').value = entry.memo || '';

  // 事業区分
  if (entry.salesCashBiz) {
    const bizSel = document.getElementById('sales-cash-biz');
    if (bizSel) bizSel.value = entry.salesCashBiz;
  }

  // 追加売上
  (entry.extraSales || []).forEach(es => {
    addExtraSales();
    const id = extraSalesIds[extraSalesIds.length - 1];
    const nameEl = document.getElementById('esname-' + id);
    const amtEl = document.getElementById('esamt-' + id);
    const bizEl = document.getElementById('esbiz-' + id);
    if (nameEl) nameEl.value = es.name;
    if (amtEl) amtEl.value = es.amount;
    if (bizEl && es.biz) bizEl.value = es.biz;
  });

  // 経費
  (entry.expenses || []).forEach(ex => {
    addExpenseRow();
    const id = expenseIds[expenseIds.length - 1];
    const accEl = document.getElementById('eacc-' + id);
    const payEl = document.getElementById('epay-' + id);
    const amtEl = document.getElementById('eamt-' + id);
    const descEl = document.getElementById('edesc-' + id);
    const bizEl = document.getElementById('ebiz-' + id);
    if (accEl) { accEl.value = ex.account; onAccountChange(id); }
    if (payEl) payEl.value = ex.payment;
    if (amtEl) amtEl.value = ex.amount;
    if (descEl) descEl.value = ex.desc || '';
    if (bizEl && ex.biz) bizEl.value = ex.biz;
  });

  updateSalesTotal();

  // 画面上部にスクロール
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast(date + ' のデータを読み込みました。編集後に保存してください。');
}

// ── 削除 ──
async function deleteEntry(date) {
  if (!confirm(date + ' の記録を削除しますか？')) return;
  db.entries = db.entries.filter(e => e.date !== date);
  saveLocalCache();

  // サーバーに削除を通知
  document.getElementById('loading-overlay').classList.add('show');
  try {
    await pushToServer('deleteEntry', { date });
    showToast(date + ' を削除しました');
    populateMonthSelects();
    onDateChange();
  } catch(e) {
    showToast('削除に失敗しました', 'toast', 'err');
  } finally {
    document.getElementById('loading-overlay').classList.remove('show');
  }
}
