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

module.exports = router;
