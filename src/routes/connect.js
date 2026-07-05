'use strict';
// 患者端：把 AI 分析结果作为"患者提交材料"提交给医生（医患同屏，不自动进入病历）
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const router = express.Router();

router.use(auth('patient'));

// 我的医生列表（签约/主治）
router.get('/my-doctors', (req, res) => {
  const rows = db.prepare(`
    SELECT d.id,d.name,d.title,d.dept,d.hospital,d.avatar,dp.relation
    FROM doctor_patient dp JOIN doctors d ON d.id=dp.doctor_id
    WHERE dp.patient_id=?`).all(req.user.id);
  res.json(rows);
});

// 一键连通医生：把某份 AI 分析结果推送到医生端（实现"分析结果医患同屏"）
router.post('/connect', (req, res) => {
  const { doctor_id, analysis_id, note } = req.body;
  const pid = req.user.id;
  const d = db.prepare('SELECT * FROM doctors WHERE id=?').get(doctor_id);
  if (!d) return res.status(404).json({ error: '医生不存在' });
  if (analysis_id) {
    const a = db.prepare('SELECT id FROM analyses WHERE id=? AND patient_id=?').get(analysis_id, pid);
    if (!a) return res.status(404).json({ error: '分析结果不存在' });
    db.prepare('UPDATE analyses SET shared_to_doctor=1, doctor_id=? WHERE id=?').run(doctor_id, analysis_id);
  }
  const c = db.prepare('INSERT INTO consults (patient_id,doctor_id,analysis_id,status,patient_note) VALUES (?,?,?,?,?)')
    .run(pid, doctor_id, analysis_id || null, '待接诊', note || '');
  res.json({ ok: true, consult_id: c.lastInsertRowid, doctor: { name: d.name, dept: d.dept, hospital: d.hospital } });
});

// B5：终止某位医生对本人 AI 材料的查看
router.post('/consults/:id/revoke', (req, res) => {
  const pid = req.user.id;
  const c = db.prepare('SELECT * FROM consults WHERE id=? AND patient_id=?').get(req.params.id, pid);
  if (!c) return res.status(404).json({ error: '未找到' });
  db.prepare("UPDATE consults SET status='已终止查看' WHERE id=?").run(c.id);
  if (c.analysis_id) db.prepare('UPDATE analyses SET shared_to_doctor=0 WHERE id=?').run(c.analysis_id);
  db.prepare('INSERT INTO authorization_logs (patient_id,action,data_type,ip) VALUES (?,?,?,?)')
    .run(pid, '终止医生查看提交材料', '医患同屏', 'self');
  res.json({ ok: true });
});

// 我发起的连通/解读记录
router.get('/my-consults', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, d.name doctor_name, d.dept, d.hospital, a.title analysis_title
    FROM consults c JOIN doctors d ON d.id=c.doctor_id
    LEFT JOIN analyses a ON a.id=c.analysis_id
    WHERE c.patient_id=? ORDER BY c.id DESC`).all(req.user.id);
  rows.forEach(r => {
    r.reviews = db.prepare('SELECT * FROM reviews WHERE consult_id=? ORDER BY id').all(r.id);
  });
  res.json(rows);
});

module.exports = router;
