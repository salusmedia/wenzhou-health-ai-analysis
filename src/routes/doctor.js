'use strict';
// HI 医生端（整合版第七章）：患者提交材料查看、解读把关、机构统一结算的服务绩效（非个人返佣）。
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const router = express.Router();

router.use(auth('doctor'));

// 医生工作台概览
router.get('/dashboard', (req, res) => {
  const did = req.user.id;
  const d = db.prepare('SELECT id,name,title,dept,hospital,avatar,intro FROM doctors WHERE id=?').get(did);
  const pendingConsults = db.prepare("SELECT COUNT(*) c FROM consults WHERE doctor_id=? AND status IN ('待接诊','已接诊')").get(did).c;
  const patients = db.prepare('SELECT COUNT(*) c FROM doctor_patient WHERE doctor_id=?').get(did).c;
  const reviews = db.prepare('SELECT COUNT(*) c FROM reviews WHERE doctor_id=?').get(did).c;
  const points = db.prepare("SELECT COALESCE(SUM(workload_points),0) s FROM doctor_service_logs WHERE doctor_id=?").get(did).s;
  res.json({ doctor: d, stats: { pendingConsults, patients, reviews, points } });
});

// 患者提交的连通请求（医患同屏入口）
router.get('/consults', (req, res) => {
  const did = req.user.id;
  const rows = db.prepare(`
    SELECT c.*, p.name patient_name, p.gender, p.birth_date, a.title analysis_title
    FROM consults c JOIN patients p ON p.id=c.patient_id
    LEFT JOIN analyses a ON a.id=c.analysis_id
    WHERE c.doctor_id=? ORDER BY c.id DESC`).all(did);
  rows.forEach(r => { r.age = new Date().getFullYear() - new Date(r.birth_date).getFullYear(); });
  res.json(rows);
});

// 患者提交的 AI 分析结果（作为患者提交材料查看——不自动进入病历）
router.get('/consults/:id', (req, res) => {
  const did = req.user.id;
  const c = db.prepare('SELECT * FROM consults WHERE id=? AND doctor_id=?').get(req.params.id, did);
  if (!c) return res.status(404).json({ error: '未找到' });
  const p = db.prepare('SELECT id,name,gender,birth_date,phone,height,weight,blood_type FROM patients WHERE id=?').get(c.patient_id);
  p.age = new Date().getFullYear() - new Date(p.birth_date).getFullYear();
  const analysis = c.analysis_id ? db.prepare('SELECT * FROM analyses WHERE id=?').get(c.analysis_id) : null;
  if (analysis) analysis.content = JSON.parse(analysis.content);
  const conditions = db.prepare('SELECT * FROM conditions WHERE patient_id=?').all(c.patient_id);
  const meds = db.prepare("SELECT * FROM medications WHERE patient_id=? AND status='服用中'").all(c.patient_id);
  const abnormal = db.prepare("SELECT * FROM lab_reports WHERE patient_id=? AND flag!='N' ORDER BY report_date DESC").all(c.patient_id);
  const reviews = db.prepare('SELECT * FROM reviews WHERE consult_id=? ORDER BY id').all(c.id);
  res.json({ consult: c, patient: p, analysis, conditions, meds, abnormal, reviews });
});

router.post('/consults/:id/accept', (req, res) => {
  const did = req.user.id;
  const c = db.prepare('SELECT * FROM consults WHERE id=? AND doctor_id=?').get(req.params.id, did);
  if (!c) return res.status(404).json({ error: '未找到' });
  db.prepare("UPDATE consults SET status='已接诊' WHERE id=?").run(c.id);
  res.json({ ok: true });
});

// 解读把关：提交专业意见 → 记录服务绩效（机构统一结算，非个人返佣、不与金额挂钩）
router.post('/consults/:id/review', (req, res) => {
  const did = req.user.id;
  const { comment, advice } = req.body;
  const c = db.prepare('SELECT * FROM consults WHERE id=? AND doctor_id=?').get(req.params.id, did);
  if (!c) return res.status(404).json({ error: '未找到' });
  const doc = db.prepare('SELECT hospital FROM doctors WHERE id=?').get(did);
  db.prepare('INSERT INTO reviews (consult_id,analysis_id,doctor_id,patient_id,comment,advice,cited_into_record) VALUES (?,?,?,?,?,?,0)')
    .run(c.id, c.analysis_id, did, c.patient_id, comment || '', advice || '');
  db.prepare("UPDATE consults SET status='已解读' WHERE id=?").run(c.id);
  // 机构统一结算的服务绩效：记 1 个服务量点，由机构按绩效/劳务规则结算
  db.prepare('INSERT INTO doctor_service_logs (doctor_id,patient_id,consult_id,service_type,workload_points,settle_org,status) VALUES (?,?,?,?,?,?,?)')
    .run(did, c.patient_id, c.id, '报告解读把关', 1, doc?.hospital || '所属医疗机构', '待机构结算');
  res.json({ ok: true, service: { type: '报告解读把关', points: 1, settle: '由机构统一结算为绩效/劳务补偿，与金额无关' } });
});

// 医生手动确认将 AI 内容引用进正式医疗意见（不自动进病历——整合版 A4/第七章）
router.post('/consults/:id/cite', (req, res) => {
  const did = req.user.id;
  const c = db.prepare('SELECT * FROM consults WHERE id=? AND doctor_id=?').get(req.params.id, did);
  if (!c) return res.status(404).json({ error: '未找到' });
  const r = db.prepare('SELECT * FROM reviews WHERE consult_id=? ORDER BY id DESC LIMIT 1').get(c.id);
  if (!r) return res.status(400).json({ error: '请先提交解读意见再引用' });
  db.prepare('UPDATE reviews SET cited_into_record=1 WHERE id=?').run(r.id);
  res.json({ ok: true, message: '已手动确认引用（保留 AI 来源、版本与确认记录）' });
});

router.get('/patients', (req, res) => {
  const did = req.user.id;
  const rows = db.prepare(`
    SELECT p.id,p.name,p.gender,p.birth_date,p.phone,dp.relation
    FROM doctor_patient dp JOIN patients p ON p.id=dp.patient_id WHERE dp.doctor_id=?`).all(did);
  rows.forEach(r => { r.age = new Date().getFullYear() - new Date(r.birth_date).getFullYear(); });
  res.json(rows);
});

// 服务绩效（取代"分成明细"）：机构统一结算，按服务量点数，不与金额挂钩
router.get('/performance', (req, res) => {
  const did = req.user.id;
  const logs = db.prepare(`
    SELECT s.*, p.name patient_name FROM doctor_service_logs s JOIN patients p ON p.id=s.patient_id
    WHERE s.doctor_id=? ORDER BY s.id DESC`).all(did);
  const totalPoints = logs.reduce((a, l) => a + (l.workload_points || 0), 0);
  const pendingPoints = logs.filter(l => l.status === '待机构结算').reduce((a, l) => a + l.workload_points, 0);
  res.json({ totalPoints, pendingPoints, logs, note: '收益由医疗机构按绩效/劳务规则统一结算，与药品、检查、处方、转诊、复诊量及患者付费金额均无关。' });
});

module.exports = router;
