'use strict';
const express = require('express');
const db = require('../db');
const { sign } = require('../middleware/auth');
const router = express.Router();

// 患者端：模拟微信一键登录（演示环境直接登录演示患者张明）
router.post('/patient/login', (req, res) => {
  const openId = req.body.open_id || 'demo-patient-001';
  let p = db.prepare('SELECT * FROM patients WHERE open_id=?').get(openId);
  if (!p) p = db.prepare('SELECT * FROM patients LIMIT 1').get();
  if (!p) return res.status(404).json({ error: '暂无患者数据' });
  const token = sign({ role: 'patient', id: p.id, name: p.name });
  res.json({ token, patient: { id: p.id, name: p.name, avatar: p.avatar } });
});

// 医生端：账号密码登录
router.post('/doctor/login', (req, res) => {
  const { login, password } = req.body;
  const d = db.prepare('SELECT * FROM doctors WHERE login=?').get(login);
  if (!d || d.password !== password) return res.status(401).json({ error: '账号或密码错误' });
  const token = sign({ role: 'doctor', id: d.id, name: d.name });
  res.json({ token, doctor: { id: d.id, name: d.name, title: d.title, dept: d.dept, hospital: d.hospital, avatar: d.avatar } });
});

// 监管台：口令登录（演示口令，可用环境变量 ADMIN_KEY 覆盖）
router.post('/admin/login', (req, res) => {
  const key = (req.body.key || '').trim();
  const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';
  if (key !== ADMIN_KEY) return res.status(401).json({ error: '监管口令错误' });
  res.json({ token: sign({ role: 'admin', id: 0, name: '监管员' }) });
});

module.exports = router;
