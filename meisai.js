// ============================================
// 銀行・カード明細取込モジュール (meisai.js)
// ============================================

// ── 対応フォーマット定義 ──
const MEISAI_FORMATS = {
  jcb: {
    name: 'JCB法人カード',
    detect: (rows) => rows.some(r => r.join('').includes('今回のお支払日')),
    parse: parseJCB
  },
  yucho: {
    name: 'ゆうちょ銀行',
    detect: (rows) => rows.some(r => r.join('').includes('お客さま口座番号') || r.join('').includes('受入金額')),
    parse: parseYucho
  },
  aozora: {
    name: 'あおぞら銀行',
    detect: (rows) => rows.length > 0 && rows[0].join('').includes('入金金額') && rows[0].join('').includes('出金金額'),
    parse: parseAozora
  }
};

// ── 勘定科目の自動推定 ──
const ACCOUNT_RULES = [
  { pattern: /コメリ|ダイレックス|ダイソー|ユーホー|フレスタ|ファミマ|ファミリーマート|セブン|ウォンツ|ショップワールド|無印|ザグザグ|ミナモア|道の駅|Amazon|ホームセンター/, account: '消耗品費' },
  { pattern: /オプテージ|NTT|ドコモ|au|ソフトバンク|通信|インターネット/, account: '通信費' },
  { pattern: /CLIP.STUDIO|クリップスタジオ/, account: '消耗品費' },
  { pattern: /ENEOS|エネオス|出光|昭和シェル|ガソリン|燃料/, account: '燃料費' },
  { pattern: /年会費|カード年会費/, account: '諸会費' },
  { pattern: /手数料/, account: '支払手数料' },
  { pattern: /社会保険|年金機構/, account: '法定福利費' },
  { pattern: /税務署|地方税|租税/, account: '租税公課' },
  { pattern: /会計事務所|税理士|ペイペイ.*会計|カイケイ/, account: '支払報酬' },
  { pattern: /利息|利子/, account: '受取利息' },
  { pattern: /ユニクロ|GU|しまむら|洋服/, account: '消耗品費' },
];

function guessAccount(text) {
  for (const rule of ACCOUNT_RULES) {
    if (rule.pattern.test(text)) return rule.account;
  }
  return 'その他経費';
}

function normalize(s) {
  return s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
          .replace(/　/g, ' ').trim();
}

function parseAmt(s) {
  const n = parseInt((s || '').replace(/[,，¥￥\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function fmtDate(s) {
  s = (s || '').replace(/[\/\-\s]/g, '').trim();
  if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return s;
}

// ── JCB パーサー ──
function parseJCB(rows) {
  let payDate = '';
  const items = [];
  for (const row of rows) {
    if (row[2] && row[2].includes('今回のお支払日')) payDate = fmtDate(row[3]);
    if (row[0] && row[0].startsWith('****')) {
      const shop = normalize(row[3] || '');
      const amount = parseAmt(row[4]);
      if (amount > 0) {
        items.push({
          date: payDate,
          useDate: fmtDate(row[2]),
          source: 'JCB',
          debit: guessAccount(shop),
          credit: 'JCBカード',
          amount,
          shopName: shop,
          memo: '',
          checked: false,
          id: `jcb_${payDate}_${items.length}`
        });
      }
    }
  }
  return items;
}

// ── ゆうちょ パーサー ──
function parseYucho(rows) {
  const items = [];
  // ヘッダー行を探して列インデックスを特定
  let dateCol=0, nyukinCol=2, haraiCol=3, d1Col=4, d2Col=5;
  for (const row of rows) {
    if (row.join('').includes('取引日') && row.join('').includes('受入金額')) {
      dateCol   = row.findIndex(c => c.includes('取引日'));
      nyukinCol = row.findIndex(c => c.includes('受入金額'));
      haraiCol  = row.findIndex(c => c.includes('払出金額'));
      d1Col     = row.findIndex(c => c.includes('詳細１'));
      d2Col     = row.findIndex(c => c.includes('詳細２'));
      break;
    }
  }

  for (const row of rows) {
    const dateStr = (row[dateCol] || '').trim();
    if (!/^\d{8}$/.test(dateStr)) continue;
    const date = fmtDate(dateStr);
    const nyukin = parseAmt(row[nyukinCol]);
    const harai  = parseAmt(row[haraiCol]);
    const d1 = (row[d1Col] || '').trim();
    const d2 = (row[d2Col] || '').trim();
    const combined = d1 + ' ' + d2;

    let debit, credit, shopName;

    if (/JCB/i.test(d2) || /JCB/i.test(d1)) {
      // JCBカード引落し（自払 / JCB ｶｰﾄﾞ）
      debit = 'JCBカード'; credit = '普通預金（ゆうちょ）'; shopName = 'JCBカード支払';
    } else if (/イデミツ|ｲﾃﾞﾐﾂ|出光/i.test(combined)) {
      // 出光カード引落し
      debit = '出光カード（未払金）'; credit = '普通預金（ゆうちょ）'; shopName = '出光カード支払';
    } else if (/社会保険|年金/.test(combined)) {
      // 社会保険料納付
      debit = '法定福利費'; credit = '普通預金（ゆうちょ）'; shopName = '社会保険料納付';
    } else if (/受取利子|利子|利息/.test(d1) && nyukin > 0) {
      // 預金利息の入金
      debit = '普通預金（ゆうちょ）'; credit = '受取利息'; shopName = '利息';
    } else if (/税金|源泉/.test(d1) && harai > 0) {
      // 利息の源泉税
      debit = '租税公課'; credit = '普通預金（ゆうちょ）'; shopName = '税金';
    } else if (/料　金|料金|手数料/.test(d1) && harai > 0) {
      debit = '支払手数料'; credit = '普通預金（ゆうちょ）'; shopName = '手数料';
    } else if (/カード/.test(d1) && nyukin > 0) {
      // ATMで野菜売上などの現金をゆうちょへ入金
      debit = '普通預金（ゆうちょ）'; credit = '売上高'; shopName = 'ATM入金（現金→ゆうちょ）';
    } else if (/振込/.test(d1) && nyukin > 0) {
      debit = '普通預金（ゆうちょ）'; credit = '売上高'; shopName = d1 + (d2 ? ' '+d2 : '');
    } else if (nyukin > 0) {
      debit = '普通預金（ゆうちょ）'; credit = '仮受金'; shopName = d1 + (d2 ? ' '+d2 : '');
    } else {
      debit = 'その他経費'; credit = '普通預金（ゆうちょ）'; shopName = d1 + (d2 ? ' '+d2 : '');
    }

    const amount = nyukin > 0 ? nyukin : harai;
    if (amount > 0) {
      items.push({
        date, useDate: '', source: 'ゆうちょ',
        debit, credit, amount,
        shopName: normalize(shopName),
        memo: '', checked: false,
        id: `yucho_${date}_${items.length}`
      });
    }
  }
  return items;
}

// ── あおぞら パーサー ──
function parseAozora(rows) {
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    const date = fmtDate(row[0]);
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) continue;
    const desc = normalize(row[1] || '');
    const nyukin = parseAmt(row[2]);
    const harai  = parseAmt(row[3]);

    let debit, credit, shopName, amount;

    if (/利息/.test(desc) && nyukin > 0) {
      // 預金利息の入金
      debit = '普通預金（あおぞら）'; credit = '受取利息'; shopName = desc; amount = nyukin;
    } else if (/ATM利用手数料|ATM手数料/.test(desc)) {
      // ATM手数料
      debit = '支払手数料'; credit = '普通預金（あおぞら）'; shopName = desc; amount = harai;
    } else if (/^ATM/.test(desc) && nyukin > 0) {
      // ゆうちょからあおぞらへのATM振替入金
      debit = '普通預金（あおぞら）'; credit = '普通預金（ゆうちょ）'; shopName = 'ゆうちょ→あおぞら 口座間振替'; amount = nyukin;
    } else if (/振込手数料/.test(desc) && harai > 0) {
      // 振込手数料
      debit = '支払手数料'; credit = '普通預金（あおぞら）'; shopName = desc; amount = harai;
    } else if (/ペイペイ|カイケイ|会計|税理士/.test(desc) && harai > 0) {
      // 税理士報酬
      debit = '支払報酬'; credit = '普通預金（あおぞら）'; shopName = desc; amount = harai;
    } else if (/税務署|地方税共同機構|PE/.test(desc) && harai > 0) {
      // 税金支払い
      debit = '租税公課'; credit = '普通預金（あおぞら）'; shopName = desc; amount = harai;
    } else if (nyukin > 0) {
      debit = '普通預金（あおぞら）'; credit = '雑収入'; shopName = desc; amount = nyukin;
    } else {
      debit = 'その他経費'; credit = '普通預金（あおぞら）'; shopName = desc; amount = harai;
    }

    if (amount > 0) {
      items.push({
        date, useDate: '', source: 'あおぞら',
        debit, credit, amount, shopName,
        memo: '', checked: false,
        id: `aozora_${date}_${i}`
      });
    }
  }
  return items;
}

// ── CSV読み込み（文字コード自動判定） ──
async function readCSVFile(file) {
  const tryDecode = (encoding) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file, encoding);
  });

  // バイナリで読んで文字コードを判定
  const buf = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(new Uint8Array(e.target.result));
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });

  // UTF-8 BOM（EF BB BF）チェック
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return await tryDecode('UTF-8');
  }

  // Shift_JIS判定：0x81〜0x9F または 0xE0〜0xFC のバイトがあればShift_JIS
  for (let i = 0; i < Math.min(buf.length, 2000); i++) {
    const b = buf[i];
    if ((b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xFC)) {
      return await tryDecode('Shift_JIS');
    }
  }

  // デフォルトはUTF-8
  return await tryDecode('UTF-8');
}

function parseCSVText(text) {
  // BOM除去
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    // 簡易CSVパース（ダブルクォート対応）
    const row = [];
    let inQuote = false, cell = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && !inQuote) { inQuote = true; continue; }
      if (ch === '"' && inQuote) {
        if (line[i+1] === '"') { cell += '"'; i++; }
        else inQuote = false;
        continue;
      }
      if (ch === ',' && !inQuote) { row.push(cell); cell = ''; continue; }
      cell += ch;
    }
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ── フォーマット自動検出 ──
function detectFormat(rows) {
  for (const [key, fmt] of Object.entries(MEISAI_FORMATS)) {
    if (fmt.detect(rows)) return { key, ...fmt };
  }
  return null;
}

// ── メインの取込処理（アプリから呼ぶ） ──
async function importMeisaiFile(file) {
  const text = await readCSVFile(file);
  const rows = parseCSVText(text);
  const fmt = detectFormat(rows);
  if (!fmt) throw new Error('対応していないフォーマットです。JCB・ゆうちょ・あおぞらのCSVを選んでください。');
  const items = fmt.parse(rows);
  if (!items.length) throw new Error('明細データが見つかりませんでした。');
  return { format: fmt.name, items };
}
