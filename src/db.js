'use strict';
// 轻量 SQLite 数据层：基于 sql.js（WebAssembly，纯 JS，无需本地编译，Railway 部署零依赖问题）
// 对外暴露与 better-sqlite3 兼容的 prepare().run/get/all、exec、pragma、transaction 接口。
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'health.sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT, open_id TEXT UNIQUE, name TEXT NOT NULL, id_card TEXT,
  gender TEXT, birth_date TEXT, phone TEXT, avatar TEXT, height REAL, weight REAL, blood_type TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT UNIQUE, password TEXT, name TEXT NOT NULL, title TEXT,
  dept TEXT, hospital TEXT, avatar TEXT, phone TEXT, intro TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS doctor_patient (
  id INTEGER PRIMARY KEY AUTOINCREMENT, doctor_id INTEGER, patient_id INTEGER, signed INTEGER DEFAULT 1,
  relation TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS encounters (
  id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER, type TEXT, hospital TEXT, dept TEXT,
  doctor_name TEXT, visit_date TEXT, chief_complaint TEXT, diagnosis TEXT, summary TEXT);
CREATE TABLE IF NOT EXISTS lab_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER, encounter_id INTEGER, hospital TEXT,
  report_date TEXT, category TEXT, item_name TEXT, value TEXT, unit TEXT, ref_range TEXT, flag TEXT);
CREATE TABLE IF NOT EXISTS imaging_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER, encounter_id INTEGER, hospital TEXT,
  report_date TEXT, modality TEXT, body_part TEXT, findings TEXT, impression TEXT);
CREATE TABLE IF NOT EXISTS medications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER, encounter_id INTEGER, name TEXT, spec TEXT,
  dosage TEXT, frequency TEXT, purpose TEXT, start_date TEXT, end_date TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER, name TEXT, category TEXT, since TEXT, status TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS authorizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER, data_type TEXT, enabled INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now','localtime')), UNIQUE(patient_id, data_type));
CREATE TABLE IF NOT EXISTS authorization_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER, action TEXT, data_type TEXT, ip TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER, type TEXT, title TEXT, content TEXT, score INTEGER,
  model TEXT, shared_to_doctor INTEGER DEFAULT 0, doctor_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER, session_id TEXT, role TEXT, content TEXT,
  sources TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS consults (
  id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER, doctor_id INTEGER, analysis_id INTEGER,
  status TEXT, patient_note TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, consult_id INTEGER, analysis_id INTEGER, doctor_id INTEGER,
  patient_id INTEGER, comment TEXT, advice TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER, product TEXT, amount REAL, doctor_id INTEGER,
  doctor_share REAL, platform_share REAL, status TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));
`;

let SQL = null;      // sql.js 模块
let database = null; // Database 实例
let saveTimer = null;

function persist() {
  // 防抖持久化到磁盘
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DB_FILE, Buffer.from(database.export())); }
    catch (e) { console.error('[db] 持久化失败:', e.message); }
  }, 300);
}

// 判断是否为"命名参数"绑定对象（形如 {name: val}），否则视为位置参数数组
function normalizeParams(args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const obj = args[0]; const bind = {};
    for (const k of Object.keys(obj)) bind['@' + k] = obj[k];
    return bind;
  }
  return args.length ? args : [];
}

function makeStatement(sql) {
  return {
    run(...args) {
      const stmt = database.prepare(sql);
      try { stmt.bind(normalizeParams(args)); stmt.step(); }
      finally { stmt.free(); }
      const idRow = database.exec('SELECT last_insert_rowid() AS id');
      const lastInsertRowid = idRow.length ? idRow[0].values[0][0] : 0;
      persist();
      return { lastInsertRowid, changes: database.getRowsModified() };
    },
    get(...args) {
      const stmt = database.prepare(sql);
      let row;
      try { stmt.bind(normalizeParams(args)); row = stmt.step() ? stmt.getAsObject() : undefined; }
      finally { stmt.free(); }
      return row;
    },
    all(...args) {
      const stmt = database.prepare(sql);
      const out = [];
      try { stmt.bind(normalizeParams(args)); while (stmt.step()) out.push(stmt.getAsObject()); }
      finally { stmt.free(); }
      return out;
    }
  };
}

const db = {
  prepare(sql) { return makeStatement(sql); },
  exec(sql) { database.run(sql); persist(); return db; },
  pragma() { /* no-op（sql.js 内存库无需 WAL）*/ },
  transaction(fn) {
    return (...args) => {
      database.run('BEGIN');
      try { const r = fn(...args); database.run('COMMIT'); persist(); return r; }
      catch (e) { try { database.run('ROLLBACK'); } catch (_) {} throw e; }
    };
  },
  async init() {
    if (database) return db;
    SQL = await initSqlJs();
    if (fs.existsSync(DB_FILE)) {
      database = new SQL.Database(fs.readFileSync(DB_FILE));
    } else {
      database = new SQL.Database();
    }
    database.run(SCHEMA);
    persist();
    return db;
  }
};

module.exports = db;
