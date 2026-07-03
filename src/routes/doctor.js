'use strict';
// HI 医生端：患者列表、医患同屏查看 AI 分析、解读把关、费用分成
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
  const earnings = db.prepare("SELECT COALESCE(SUM(doctor_share),0) s FROM orders WHERE doctor_id=? AND status IN ('已支付','已结算')").get(did).s;
  res.json({ doctor: d, stats: { pendingConsults, patients, reviews, earnings } });
});

// 待接诊/连通请求（医患同屏入口）
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

// 患者的 AI 分析结果（与患者完全一致 —— 医患同屏核心）
router.get('/consults/:id', (req, res) => {
  const did = req.user.id;
  const c = db.prepare('SELECT * FROM consults WHERE id=? AND doctor_id=?').get(req.params.id, did);
  if (!c) return res.status(404).json({ error: '未找到' });
  const p = db.prepare('SELECT id,name,gender,birth_date,phone,height,weight,blood_type FROM patients WHERE id=?').get(c.patient_id);
  p.age = new Date().getFullYear() - new Date(p.birth_date).getFullYear();
  const analysis = c.analysis_id ? db.prepare('SELECT * FROM analyses WHERE id=?').get(c.analysis_id) : null;
  if (analysis) analysis.content = JSON.parse(analysis.content);
  // 医生可查看患者授权范围内的原始数据摘要
  const conditions = db.prepare('SELECT * FROM conditions WHERE patient_id=?').all(c.patient_id);
  const meds = db.prepare("SELECT * FROM medications WHERE patient_id=? AND status='服用中'").all(c.patient_id);
  const abnormal = db.prepare("SELECT * FROM lab_reports WHERE patient_id=? AND flag!='N' ORDER BY report_date DESC").all(c.patient_id);
  const reviews = db.prepare('SELECT * FROM reviews WHERE consult_id=? ORDER BY id').all(c.id);
  res.json({ consult: c, patient: p, analysis, conditions, meds, abnormal, reviews });
});

// 接诊
router.post('/consults/:id/accept', (req, res) => {
  const did = req.user.id;
  const c = db.prepare('SELECT * FROM consults WHERE id=? AND doctor_id=?').get(req.params.id, did);
  if (!c) return res.status(404).json({ error: '未找到' });
  db.prepare("UPDATE consults SET status='已接诊' WHERE id=?").run(c.id);
  res.json({ ok: true });
});

// 医生解读把关：提交专业意见，触发费用分成结算
router.post('/consults/:id/review', (req, res) => {
  const did = req.user.id;
  const { comment, advice } = req.body;
  const c = db.prepare('SELECT * FROM consults WHERE id=? AND doctor_id=?').get(req.params.id, did);
  if (!c) return res.status(404).json({ error: '未找到' });
  db.prepare('INSERT INTO reviews (consult_id,analysis_id,doctor_id,patient_id,comment,advice) VALUES (?,?,?,?,?,?)')
    .run(c.id, c.analysis_id, did, c.patient_id, comment || '', advice || '');
  db.prepare("UPDATE consults SET status='已解读' WHERE id=?").run(c.id);

  // 结算：为此次解读生成一笔已支付订单并按比例分成给医生
  const SHARE = 0.5; // 医生分成比例（示意，实际由主管部门指导确定）
  const price = 39; // 单次解读服务价（示意）
  db.prepare('INSERT INTO orders (patient_id,product,amount,doctor_id,doctor_share,platform_share,status) VALUES (?,?,?,?,?,?,?)')
    .run(c.patient_id, '单次解读', price, did, +(price * SHARE).toFixed(2), +(price * (1 - SHARE)).toFixed(2), '已支付');
  res.json({ ok: true, settled: { amount: price, doctor_share: +(price * SHARE).toFixed(2), share_ratio: SHARE } });
});

// 我的患者
router.get('/patients', (req, res) => {
  const did = req.user.id;
  const rows = db.prepare(`
    SELECT p.id,p.name,p.gender,p.birth_date,p.phone,dp.relation
    FROM doctor_patient dp JOIN patients p ON p.id=dp.patient_id WHERE dp.doctor_id=?`).all(did);
  rows.forEach(r => { r.age = new Date().getFullYear() - new Date(r.birth_date).getFullYear(); });
  res.json(rows);
});

// 收入与分成明细
router.get('/earnings', (req, res) => {
  const did = req.user.id;
  const orders = db.prepare(`
    SELECT o.*, p.name patient_name FROM orders o JOIN patients p ON p.id=o.patient_id
    WHERE o.doctor_id=? ORDER BY o.id DESC`).all(did);
  const total = orders.reduce((s, o) => s + (o.doctor_share || 0), 0);
  const settled = orders.filter(o => o.status === '已结算').reduce((s, o) => s + o.doctor_share, 0);
  const pending = total - settled;
  res.json({ total: +total.toFixed(2), settled: +settled.toFixed(2), pending: +pending.toFixed(2), orders });
});

module.exports = router;
