/**
 * ============================================
 * RICH COUNTRY LIFE 日計表 — GAS バックエンド
 * ============================================
 *
 * セットアップ手順:
 * 1. このファイルの内容を、Googleスプレッドシートの
 *    「拡張機能 → Apps Script」に貼り付ける
 * 2. 下の SPREADSHEET_ID と PASSCODE を書き換える
 * 3. setupAllSheets() を実行（▶ボタン）してシートを自動作成
 * 4. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *    → アクセスできるユーザー「全員」→ デプロイ
 * 5. 表示されたURLを index.html と同じフォルダの config.js に貼り付け
 */

// ▼▼▼ ここを書き換えてください ▼▼▼
const SPREADSHEET_ID = 'ここにスプレッドシートIDを貼り付け';
const PASSCODE = '1234'; // config.js のPASSCODEと必ず同じ値にする
const RECEIPT_FOLDER_NAME = 'たいよう_レシート'; // Googleドライブの保存先フォルダ名
// ▲▲▲ ここまで ▲▲▲

const SHEET_ENTRIES = 'entries';
const SHEET_KYUYO = 'kyuyo';
const SHEET_SETTINGS = 'settings';
const SHEET_MEISAI = 'meisai';

// ============================================
// 初回セットアップ：シートを自動作成
// ============================================
function setupAllSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  if (!ss.getSheetByName(SHEET_ENTRIES)) {
    const sh = ss.insertSheet(SHEET_ENTRIES);
    sh.appendRow(['date', 'data_json', 'updated_at']);
  }
  if (!ss.getSheetByName(SHEET_KYUYO)) {
    const sh = ss.insertSheet(SHEET_KYUYO);
    sh.appendRow(['month', 'data_json', 'updated_at']);
  }
  if (!ss.getSheetByName(SHEET_MEISAI)) {
    const sh = ss.insertSheet(SHEET_MEISAI);
    sh.appendRow(['id', 'data_json', 'updated_at']);
  }
  if (!ss.getSheetByName(SHEET_SETTINGS)) {
    const sh = ss.insertSheet(SHEET_SETTINGS);
    sh.appendRow(['key', 'value_json', 'updated_at']);
    sh.appendRow(['accounts', JSON.stringify(['仕入','消耗品費','通信費','交通費','光熱費','広告宣伝費','役員報酬','法定福利費','預り金','その他経費']), new Date().toISOString()]);
    sh.appendRow(['bizList', JSON.stringify([{id:'veg',name:'野菜'},{id:'seminar',name:'セミナー業'}]), new Date().toISOString()]);
    sh.appendRow(['kyuyoSettings', JSON.stringify({salary:45000, shakai:23124}), new Date().toISOString()]);
  }

  // デフォルトシート「シート1」が空なら削除
  const defaultSheet = ss.getSheetByName('シート1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  Logger.log('セットアップ完了！');
}

// ============================================
// エントリーポイント
// ============================================
function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ success: false, error: 'リクエストの解析に失敗しました' });
  }

  if (req.passcode !== PASSCODE) {
    return jsonResponse({ success: false, error: 'パスコードが違います' });
  }

  try {
    let data;
    switch (req.action) {
      case 'loadAll':         data = loadAll(); break;
      case 'saveEntry':       data = saveEntry(req.payload); break;
      case 'saveKyuyo':       data = saveKyuyo(req.payload); break;
      case 'saveKyuyoSettings': data = saveSetting('kyuyoSettings', req.payload); break;
      case 'saveAccounts':    data = saveSetting('accounts', req.payload); break;
      case 'saveBizList':     data = saveSetting('bizList', req.payload); break;
      case 'uploadReceipt':   data = uploadReceipt(req.payload); break;
      case 'saveMeisai':      data = saveMeisai(req.payload); break;
      case 'clearAll':        data = clearAll(); break;
      default:
        return jsonResponse({ success: false, error: '不明なactionです: ' + req.action });
    }
    return jsonResponse({ success: true, data });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// データ読み込み
// ============================================
function loadAll() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const entries = readJsonSheet(ss, SHEET_ENTRIES, 'date');
  const kyuyo = readJsonSheet(ss, SHEET_KYUYO, 'month');
  const meisai = readJsonSheet(ss, SHEET_MEISAI, 'id');

  const settingsSheet = ss.getSheetByName(SHEET_SETTINGS);
  const settingsRows = settingsSheet.getDataRange().getValues();
  const settings = {};
  for (let i = 1; i < settingsRows.length; i++) {
    const [key, valueJson] = settingsRows[i];
    if (!key) continue;
    try { settings[key] = JSON.parse(valueJson); } catch (e) { /* skip */ }
  }

  return {
    entries: entries,
    kyuyo: kyuyo,
    meisai: meisai,
    accounts: settings.accounts || [],
    bizList: settings.bizList || [],
    kyuyoSettings: settings.kyuyoSettings || { salary: 45000, shakai: 23124 }
  };
}

function readJsonSheet(ss, sheetName, keyColName) {
  const sheet = ss.getSheetByName(sheetName);
  const rows = sheet.getDataRange().getValues();
  const result = [];
  for (let i = 1; i < rows.length; i++) {
    const [key, dataJson] = rows[i];
    if (!key || !dataJson) continue;
    try { result.push(JSON.parse(dataJson)); } catch (e) { /* skip broken row */ }
  }
  return result;
}

// ============================================
// 日計エントリーの保存（同じ日付があれば上書き）
// ============================================
function saveEntry(entry) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_ENTRIES);
  upsertRow(sheet, entry.date, entry);
  return entry;
}

// ============================================
// 給与・社保の保存（同じ月があれば上書き）
// ============================================
function saveKyuyo(record) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_KYUYO);
  upsertRow(sheet, record.month, record);
  return record;
}

// 共通：1列目のキーが一致する行があれば上書き、なければ追加
function upsertRow(sheet, key, dataObj) {
  const data = sheet.getDataRange().getValues();
  const now = new Date().toISOString();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(JSON.stringify(dataObj));
      sheet.getRange(i + 1, 3).setValue(now);
      return;
    }
  }
  sheet.appendRow([key, JSON.stringify(dataObj), now]);
}

// ============================================
// 設定の保存（accounts / bizList / kyuyoSettings）
// ============================================
function saveSetting(key, value) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_SETTINGS);
  const data = sheet.getDataRange().getValues();
  const now = new Date().toISOString();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(JSON.stringify(value));
      sheet.getRange(i + 1, 3).setValue(now);
      return value;
    }
  }
  sheet.appendRow([key, JSON.stringify(value), now]);
  return value;
}

// ============================================
// 領収書アップロード（Googleドライブ）
// ============================================
function uploadReceipt(payload) {
  const folder = getOrCreateReceiptFolder();
  const bytes = Utilities.base64Decode(payload.base64);
  const blob = Utilities.newBlob(bytes, 'image/jpeg', sanitizeFilename(payload.date, payload.filename));
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { fileUrl: file.getUrl(), fileId: file.getId() };
}

function getOrCreateReceiptFolder() {
  const folders = DriveApp.getFoldersByName(RECEIPT_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(RECEIPT_FOLDER_NAME);
}

function sanitizeFilename(date, originalName) {
  const ext = (originalName && originalName.includes('.')) ? originalName.split('.').pop() : 'jpg';
  const ts = new Date().getTime();
  return `${date}_${ts}.${ext}`;
}

// ============================================
// 銀行・カード明細の一括保存
// ============================================
function saveMeisai(items) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_MEISAI);
  // 全件クリアして書き直す（件数が少ないので全置換が確実）
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 3).clearContent();
  const now = new Date().toISOString();
  if (items && items.length) {
    const rows = items.map(item => [item.id, JSON.stringify(item), now]);
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }
  return { saved: items ? items.length : 0 };
}

// ============================================
// 全データ削除（リセット）
// ============================================
function clearAll() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  [SHEET_ENTRIES, SHEET_KYUYO, SHEET_MEISAI].forEach(name => {
    const sheet = ss.getSheetByName(name);
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  });
  return { cleared: true };
}
