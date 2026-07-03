'use strict';
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const aiEngine = require('../ai');
const router = express.Router();

router.use(auth('patient'));

// 生成个人健康报告
router.post('/report', async (req, res) => {
  try {
    const r = await aiEngine.runAnalysis(req.user.id, 'report');
    const saved = db.prepare('INSERT INTO analyses (patient_id,type,title,content,score,model) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, 'report', r.data?.title || '个人健康报告', JSON.stringify({ ...r.data, narrative: r.narrative }), r.data?.score || null, r.model);
    res.json({ id: saved.lastInsertRowid, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 生成 AI 第二意见
router.post('/second-opinion', async (req, res) => {
  try {
    const r = await aiEngine.runAnalysis(req.user.id, 'second_opinion');
    const saved = db.prepare('INSERT INTO analyses (patient_id,type,title,content,model) VALUES (?,?,?,?,?)')
      .run(req.user.id, 'second_opinion', 'AI 第二意见分析', JSON.stringify({ ...r.data, narrative: r.narrative }), r.model);
    res.json({ id: saved.lastInsertRowid, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 生成诊前准备（就诊摘要 + 提问清单）
router.post('/prep', async (req, res) => {
  try {
    const r = await aiEngine.runAnalysis(req.user.id, 'prep');
    const saved = db.prepare('INSERT INTO analyses (patient_id,type,title,content,model) VALUES (?,?,?,?,?)')
      .run(req.user.id, 'prep', '诊前准备清单', JSON.stringify({ ...r.data, narrative: r.narrative }), r.model);
    res.json({ id: saved.lastInsertRowid, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// AI 健康助理对话
router.post('/chat', async (req, res) => {
  try {
    const { message, session_id } = req.body;
    if (!message) return res.status(400).json({ error: '消息不能为空' });
    const sid = session_id || 'default';
    const r = await aiEngine.chatWithAssistant(req.user.id, sid, message);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 历史会话
router.get('/chat/history', (req, res) => {
  const sid = req.query.session_id || 'default';
  const rows = db.prepare('SELECT role,content,sources,created_at FROM chat_messages WHERE patient_id=? AND session_id=? ORDER BY id')
    .all(req.user.id, sid);
  res.json(rows.map(r => ({ ...r, sources: r.sources ? JSON.parse(r.sources) : [] })));
});

// 我的分析记录列表
router.get('/analyses', (req, res) => {
  const rows = db.prepare('SELECT id,type,title,score,model,shared_to_doctor,created_at FROM analyses WHERE patient_id=? ORDER BY id DESC').all(req.user.id);
  res.json(rows);
});

// 单条分析详情
router.get('/analyses/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM analyses WHERE id=? AND patient_id=?').get(req.params.id, req.user.id);
  if (!a) return res.status(404).json({ error: '未找到' });
  a.content = JSON.parse(a.content);
  res.json(a);
});

module.exports = router;
