// ===== CSV保存→スプレッドシート保存に変更する差分 =====
const TOKEN = 'TOKEN-TEST';                  // 使わないなら空でOK
const FOLDER_NAME = 'APM_CSV';

function doPost(e) {
  try {
    if (TOKEN && String(e.parameter.token || '') !== TOKEN) {
      return _json({ error: 'unauthorized' });
    }

    const raw  = (e.postData && e.postData.contents) || '';
    const data = JSON.parse(raw || '{}');

    if (data.kind === 'ping') return _json({ ok: true, pong: Date.now() });

    const filename = String(data.filename || ('dump_' + Date.now() + '.csv'));
    const csv      = String(data.csv || '');
    const folder   = getOrCreateFolder_(FOLDER_NAME);

    // ① スプレッドシートを作成
    const baseName = filename.replace(/\.csv$/i, '');
    const ss = SpreadsheetApp.create(baseName);
    const sheet = ss.getActiveSheet();

    // ② CSVをパースして貼り付け
    const rows = Utilities.parseCsv(csv); // デフォでカンマ区切り・UTF-8を想定
    if (rows.length) {
      sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    }

    // ③ フォルダへ移動
    DriveApp.getFileById(ss.getId()).moveTo(folder);

    // ④ メタがあれば別シートに保存（任意）
    if (data.meta) {
      const metaSheet = ss.insertSheet('meta');
      const metaPairs = Object.entries(data.meta).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
      if (metaPairs.length) {
        metaSheet.getRange(1, 1, metaPairs.length, 2).setValues(metaPairs);
      }
    }

    return _json({ ok: true, id: ss.getId(), url: ss.getUrl(), name: ss.getName() });
  } catch (err) {
    return _json({ error: String(err) });
  }
}

function getOrCreateFolder_(name) {
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}
function _json(obj){ return ContentService.createTextOutput(JSON.stringify(obj))
  .setMimeType(ContentService.MimeType.JSON); }
