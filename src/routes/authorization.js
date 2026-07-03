'use strict';
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { DATA_TYPES } = require('../seed');
const router = express.Router();

router.use(auth('patient'));

// 获取授权状态（分类型开关）
router.get('/', (req, res) => {
  const pid = req.user.id;
  const rows = db.prepare('SELECT data_type, enabled, updated_at FROM authorizations WHERE patient_id=?').all(pid);
  const map = {};
  rows.forEach(r => (map[r.data_type] = r));
  const list = DATA_TYPES.map(t => ({
    key: t.key, label: t.label,
    enabled: map[t.key] ? !!map[t.key].enabled : false,
    updated_at: map[t.key]?.updated_at
  }));
  res.json(list);
});

// 切换某类型授权（我的数据我做主：可开启/关闭，全程留痕）
router.post('/toggle', (req, res) => {
  const pid = req.user.id;
  const { data_type, enabled } = req.body;
  const t = DATA_TYPES.find(x => x.key === data_type);
  if (!t) return res.status(400).json({ error: '无效的数据类型' });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0];
  db.prepare(`INSERT INTO authorizations (patient_id,data_type,enabled,updated_at)
    VALUES (?,?,?,datetime('now','localtime'))
    ON CONFLICT(patient_id,data_type) DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at`)
    .run(pid, data_type, enabled ? 1 : 0);
  db.prepare('INSERT INTO authorization_logs (patient_id,action,data_type,ip) VALUES (?,?,?,?)')
    .run(pid, enabled ? '开启授权' : '关闭授权', t.label, ip);
  res.json({ ok: true });
});

// 授权记录（可追溯）
router.get('/logs', (req, res) => {
  const pid = req.user.id;
  res.json(db.prepare('SELECT * FROM authorization_logs WHERE patient_id=? ORDER BY id DESC LIMIT 100').all(pid));
});

// 一键撤回全部授权
router.post('/revoke-all', (req, res) => {
  const pid = req.user.id;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0];
  DATA_TYPES.forEach(t => {
    db.prepare(`INSERT INTO authorizations (patient_id,data_type,enabled,updated_at)
      VALUES (?,?,0,datetime('now','localtime'))
      ON CONFLICT(patient_id,data_type) DO UPDATE SET enabled=0, updated_at=datetime('now','localtime')`).run(pid, t.key);
  });
  db.prepare('INSERT INTO authorization_logs (patient_id,action,data_type,ip) VALUES (?,?,?,?)')
    .run(pid, '撤回全部授权', '全部数据类型', ip);
  res.json({ ok: true });
});

module.exports = router;
