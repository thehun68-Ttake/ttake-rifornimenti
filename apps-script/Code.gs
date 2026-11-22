/**
 * TTake Aerobatic Team - Registro rifornimenti
 * Backend su Google Sheets: questo script salva e legge i rifornimenti nel foglio a cui è collegato.
 *
 * 1) Cambia il codice di accesso qui sotto (lo daranno gli operatori nell'app).
 * 2) Esegui una volta la funzione "setup" per creare i fogli.
 * 3) Pubblica come app web: Esegui come "Io", Chi ha accesso "Chiunque".
 */
var CODICE_ACCESSO = 'CAMBIA-QUESTO-CODICE';

var FOGLIO_RIF = 'Rifornimenti';
var FOGLIO_ELE = 'Elenchi';
var INTESTAZIONE = ['id', 'data', 'operatore', 'aereo', 'socio', 'contatore_iniziale', 'contatore_finale', 'galloni_us', 'creato_il'];
var TIPI = { aircraft: 'aereo', operators: 'operatore', members: 'socio' };

/** Da eseguire una sola volta dall'editor: crea i due fogli. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var r = ss.getSheetByName(FOGLIO_RIF) || ss.insertSheet(FOGLIO_RIF);
  if (r.getLastRow() === 0) {
    r.appendRow(INTESTAZIONE);
    r.setFrozenRows(1);
    r.getRange(1, 1, 1, INTESTAZIONE.length).setFontWeight('bold');
  }
  r.getRange('B:B').setNumberFormat('@'); // la data resta testo AAAA-MM-GG
  var e = ss.getSheetByName(FOGLIO_ELE) || ss.insertSheet(FOGLIO_ELE);
  if (e.getLastRow() === 0) {
    e.appendRow(['tipo', 'valore']);
    e.setFrozenRows(1);
    e.getRange(1, 1, 1, 2).setFontWeight('bold');
  }
}

function doGet() {
  return ContentService.createTextOutput('TTake Aerobatic Team - registro rifornimenti: servizio attivo.');
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    if (!req || req.token !== CODICE_ACCESSO) return json_({ ok: false, error: 'auth' });
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { out = handle_(req); } finally { lock.releaseLock(); }
  } catch (err) {
    out = { ok: false, error: 'server: ' + err.message };
  }
  return json_(out);
}

function handle_(req) {
  switch (req.action) {
    case 'ping':
      return { ok: true };
    case 'all':
      return { ok: true, entries: readEntries_(), lists: readLists_() };
    case 'save':
      var row = cleanEntry_(req.entry);
      if (!row) return { ok: false, error: 'invalid' };
      saveRow_(row);
      return { ok: true };
    case 'delete':
      if (typeof req.id !== 'string') return { ok: false, error: 'invalid' };
      deleteRow_(req.id);
      return { ok: true };
    case 'lists':
      writeLists_(req.lists || {});
      return { ok: true };
    default:
      return { ok: false, error: 'invalid' };
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { setup(); sh = ss.getSheetByName(name); }
  return sh;
}

function txt_(v) {
  // niente formule: togliamo =, +, -, @ iniziali
  return String(v == null ? '' : v).replace(/^[=+\-@\s]+/, '').slice(0, 80);
}
function num_(v) {
  if (v == null || v === '') return '';
  var n = Number(v);
  return isFinite(n) ? n : '';
}

function cleanEntry_(x) {
  if (!x || typeof x.id !== 'string' || !/^[A-Za-z0-9_-]{3,40}$/.test(x.id)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x.date))) return null;
  var g = Number(x.gallons);
  if (!(g > 0) || g > 100000) return null;
  return [x.id, x.date, txt_(x.operator), txt_(x.aircraft), txt_(x.member), num_(x.start), num_(x.end), g, Number(x.createdAt) || Date.now()];
}

function findRow_(sh, id) {
  var n = sh.getLastRow();
  if (n < 2) return -1;
  var ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return -1;
}

function saveRow_(row) {
  var sh = sheet_(FOGLIO_RIF);
  var r = findRow_(sh, row[0]);
  if (r > 0) sh.getRange(r, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}

function deleteRow_(id) {
  var sh = sheet_(FOGLIO_RIF);
  var r = findRow_(sh, id);
  if (r > 0) sh.deleteRow(r);
}

function readEntries_() {
  var sh = sheet_(FOGLIO_RIF), n = sh.getLastRow();
  if (n < 2) return [];
  var tz = Session.getScriptTimeZone();
  var vals = sh.getRange(2, 1, n - 1, INTESTAZIONE.length).getValues();
  var out = [];
  vals.forEach(function (v) {
    if (!v[0]) return;
    var d = v[1] instanceof Date ? Utilities.formatDate(v[1], tz, 'yyyy-MM-dd') : String(v[1]);
    out.push({
      id: String(v[0]), date: d, operator: String(v[2]), aircraft: String(v[3]), member: String(v[4]),
      start: v[5] === '' ? null : Number(v[5]), end: v[6] === '' ? null : Number(v[6]),
      gallons: Number(v[7]) || 0, createdAt: Number(v[8]) || 0
    });
  });
  return out;
}

function readLists_() {
  var sh = sheet_(FOGLIO_ELE), n = sh.getLastRow();
  if (n < 2) return null;
  var vals = sh.getRange(2, 1, n - 1, 2).getValues();
  var out = { aircraft: [], operators: [], members: [] };
  vals.forEach(function (v) {
    Object.keys(TIPI).forEach(function (k) {
      if (TIPI[k] === String(v[0]) && v[1] !== '') out[k].push(String(v[1]));
    });
  });
  return out;
}

function writeLists_(lists) {
  var sh = sheet_(FOGLIO_ELE);
  var rows = [];
  Object.keys(TIPI).forEach(function (k) {
    (Array.isArray(lists[k]) ? lists[k] : []).forEach(function (v) {
      var t = txt_(v);
      if (t) rows.push([TIPI[k], t]);
    });
  });
  sh.clearContents();
  sh.getRange(1, 1, 1, 2).setValues([['tipo', 'valore']]);
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
}
