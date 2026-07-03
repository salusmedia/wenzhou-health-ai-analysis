'use strict';
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { getEnabledTypes } = require('../ai');
const router = express.Router();

router.use(auth('patient'));

// 患者档案主页数据：概览 + 慢病专区 + 时间轴 + 用药一览
router.get('/profile', (req, res) => {
  const pid = req.user.id;
  const p = db.prepare('SELECT * FROM patients WHERE id=?').get(pid);
  const age = new Date().getFullYear() - new Date(p.birth_date).getFullYear();
  const conditions = db.prepare('SELECT * FROM conditions WHERE patient_id=?').all(pid);
  res.json({
    patient: { ...p, age },
    chronic: conditions.filter(c => c.category === '慢病'),
    history: conditions.filter(c => c.category !== '慢病'),
    counts: {
      encounters: db.prepare('SELECT COUNT(*) c FROM encounters WHERE patient_id=?').get(pid).c,
      labs: db.prepare('SELECT COUNT(*) c FROM lab_reports WHERE patient_id=?').get(pid).c,
      imaging: db.prepare('SELECT COUNT(*) c FROM imaging_reports WHERE patient_id=?').get(pid).c,
      medications: db.prepare("SELECT COUNT(*) c FROM medications WHERE patient_id=? AND status='服用中'").get(pid).c
    }
  });
});

// 就医时间轴（跨机构聚合）
router.get('/timeline', (req, res) => {
  const pid = req.user.id;
  const enc = db.prepare('SELECT * FROM encounters WHERE patient_id=? ORDER BY visit_date DESC').all(pid);
  res.json(enc);
});

// 检验报告（可按类别分组）
router.get('/labs', (req, res) => {
  const pid = req.user.id;
  const rows = db.prepare('SELECT * FROM lab_reports WHERE patient_id=? ORDER BY report_date DESC').all(pid);
  res.json(rows);
});

// 影像报告
router.get('/imaging', (req, res) => {
  const pid = req.user.id;
  res.json(db.prepare('SELECT * FROM imaging_reports WHERE patient_id=? ORDER BY report_date DESC').all(pid));
});

// 用药一览
router.get('/medications', (req, res) => {
  const pid = req.user.id;
  res.json(db.prepare('SELECT * FROM medications WHERE patient_id=? ORDER BY status, start_date DESC').all(pid));
});

// 单次就诊详情（含关联检验/影像/用药）
router.get('/encounter/:id', (req, res) => {
  const pid = req.user.id;
  const e = db.prepare('SELECT * FROM encounters WHERE id=? AND patient_id=?').get(req.params.id, pid);
  if (!e) return res.status(404).json({ error: '未找到' });
  e.labs = db.prepare('SELECT * FROM lab_reports WHERE encounter_id=?').all(e.id);
  e.imaging = db.prepare('SELECT * FROM imaging_reports WHERE encounter_id=?').all(e.id);
  e.medications = db.prepare('SELECT * FROM medications WHERE encounter_id=?').all(e.id);
  res.json(e);
});

// 慢病专区：关键指标趋势
router.get('/trends', (req, res) => {
  const pid = req.user.id;
  const items = ['空腹血糖', '糖化血红蛋白(HbA1c)', '低密度脂蛋白(LDL-C)', '总胆固醇(TC)', '甘油三酯(TG)'];
  const out = [];
  items.forEach(name => {
    const s = db.prepare('SELECT * FROM lab_reports WHERE patient_id=? AND item_name=? ORDER BY report_date').all(pid, name);
    if (s.length) out.push({ name, unit: s[0].unit, ref: s[0].ref_range, points: s.map(x => ({ date: x.report_date, value: parseFloat(x.value), flag: x.flag })) });
  });
  res.json(out);
});

module.exports = router;
