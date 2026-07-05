'use strict';
// 四维授权（用途 / 数据类型 / 访问对象 / 期限）——整合版第五章
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { DATA_TYPES, PURPOSES, OBJECTS, PERIODS } = require('../seed');
const router = express.Router();

router.use(auth('patient'));

const DIM_LABEL = { type: '数据类型', purpose: '用途', object: '访问对象' };
const CATALOG = { type: DATA_TYPES, purpose: PURPOSES, object: OBJECTS };

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0];
}
function log(pid, action, detail, req) {
  db.prepare('INSERT INTO authorization_logs (patient_id,action,data_type,ip) VALUES (?,?,?,?)')
    .run(pid, action, detail, clientIp(req));
}
function isActive(g) {
  if (!g || !g.enabled) return false;
  if (!g.expires_at) return true;
  return new Date(g.expires_at).getTime() >= Date.now();
}

// 读取四维授权全景
router.get('/', (req, res) => {
  const pid = req.user.id;
  const rows = db.prepare('SELECT dimension,item_key,item_label,enabled,expires_at,updated_at FROM auth_grants WHERE patient_id=?').all(pid);
  const map = {};
  rows.forEach(r => { (map[r.dimension] || (map[r.dimension] = {}))[r.item_key] = r; });
  const build = (dim) => (CATALOG[dim] || []).map(it => {
    const g = (map[dim] || {})[it.key] || {};
    return { key: it.key, label: it.label, locked: !!it.locked,
      enabled: isActive(g), raw_enabled: !!g.enabled, expires_at: g.expires_at || null, updated_at: g.updated_at || null };
  });
  res.json({ purpose: build('purpose'), type: build('type'), object: build('object'), periods: PERIODS });
});

// 切换某一维度的某一项授权（可带期限）
router.post('/grant', (req, res) => {
  const pid = req.user.id;
  const { dimension, item_key, enabled, period } = req.body;
  const cat = CATALOG[dimension];
  if (!cat) return res.status(400).json({ error: '无效的授权维度' });
  const item = cat.find(x => x.key === item_key);
  if (!item) return res.status(400).json({ error: '无效的授权项' });
  if (item.locked && !enabled) return res.status(400).json({ error: '「本人」访问不可关闭' });

  let expires_at = null;
  if (enabled && period) {
    const pd = PERIODS.find(p => p.key === period);
    if (pd && pd.days > 0) expires_at = new Date(Date.now() + pd.days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  }
  db.prepare(`INSERT INTO auth_grants (patient_id,dimension,item_key,item_label,enabled,expires_at,updated_at)
    VALUES (?,?,?,?,?,?,datetime('now','localtime'))
    ON CONFLICT(patient_id,dimension,item_key) DO UPDATE SET enabled=excluded.enabled, expires_at=excluded.expires_at, updated_at=excluded.updated_at`)
    .run(pid, dimension, item_key, item.label, enabled ? 1 : 0, expires_at);
  const periodLabel = expires_at ? `（有效期至 ${expires_at}）` : '';
  log(pid, `${enabled ? '开启' : '关闭'}${DIM_LABEL[dimension]}授权`, `${item.label}${periodLabel}`, req);
  res.json({ ok: true, expires_at });
});

// 授权记录（可追溯）
router.get('/logs', (req, res) => {
  res.json(db.prepare('SELECT * FROM authorization_logs WHERE patient_id=? ORDER BY id DESC LIMIT 100').all(req.user.id));
});

// 一键撤回全部授权（关闭全部用途与数据类型调用；保留本人对象）
router.post('/revoke-all', (req, res) => {
  const pid = req.user.id;
  db.prepare("UPDATE auth_grants SET enabled=0, updated_at=datetime('now','localtime') WHERE patient_id=? AND NOT (dimension='object' AND item_key='self')").run(pid);
  log(pid, '撤回全部授权', '全部用途 / 数据类型 / 非本人对象', req);
  res.json({ ok: true });
});

module.exports = router;
