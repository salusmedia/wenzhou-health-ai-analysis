'use strict';
// 系统级运维开关（需求书 4.9 / D2）：一键暂停 AI 生成、报告版本召回。
const db = require('./db');

function getFlag(key, def) {
  const r = db.prepare('SELECT value FROM system_flags WHERE key=?').get(key);
  return r ? r.value : def;
}
function setFlag(key, value) {
  db.prepare(`INSERT INTO system_flags (key,value,updated_at) VALUES (?,?,datetime('now','localtime'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(key, String(value));
}
function isPaused() { return getFlag('ai_paused', '0') === '1'; }

module.exports = { getFlag, setFlag, isPaused };
