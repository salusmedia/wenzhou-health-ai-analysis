'use strict';
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const aiEngine = require('../ai');
const router = express.Router();

router.use(auth('patient'));

// 统一执行一个 AI 任务并落库（含三版本留痕 + 溯源）
async function runAndSave(req, res, type, title) {
  try {
    const r = await aiEngine.runAnalysis(req.user.id, type);
    const saved = db.prepare(`INSERT INTO analyses (patient_id,type,title,content,score,model,prompt_version,kb_version)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      req.user.id, type, r.data?.title || title,
      JSON.stringify({ ...r.data, narrative: r.narrative }), r.data?.score || null,
      r.model, r.versions.PROMPT_VERSION, r.versions.KB_VERSION);
    aiEngine.writeTrace(req.user.id, saved.lastInsertRowid, type, r.retrievedIds, r.guardrailHits, r.source);
    res.json({ id: saved.lastInsertRowid, ...r });
  } catch (e) {
    if (e.name === 'AuthError') return res.status(403).json({ error: e.message, code: e.code, detail: e.detail });
    res.status(500).json({ error: e.message });
  }
}

router.post('/report', (req, res) => runAndSave(req, res, 'report', '个人健康数据解读报告'));
router.post('/prep', (req, res) => runAndSave(req, res, 'prep', '诊前准备清单'));
// 参考视角（原"第二意见"）——医生确认前的辅助参考
router.post('/second-opinion', (req, res) => runAndSave(req, res, 'second_opinion', '参考视角分析（医生确认前）'));

// AI 健康助理对话
router.post('/chat', async (req, res) => {
  try {
    const { message, session_id } = req.body;
    if (!message) return res.status(400).json({ error: '消息不能为空' });
    const r = await aiEngine.chatWithAssistant(req.user.id, session_id || 'default', message);
    res.json(r);
  } catch (e) {
    if (e.name === 'AuthError') return res.status(403).json({ error: e.message, code: e.code });
    res.status(500).json({ error: e.message });
  }
});

router.get('/chat/history', (req, res) => {
  const sid = req.query.session_id || 'default';
  const rows = db.prepare('SELECT role,content,sources,created_at FROM chat_messages WHERE patient_id=? AND session_id=? ORDER BY id').all(req.user.id, sid);
  res.json(rows.map(r => ({ ...r, sources: r.sources ? JSON.parse(r.sources) : [] })));
});

router.get('/analyses', (req, res) => {
  res.json(db.prepare('SELECT id,type,title,score,model,shared_to_doctor,recalled,created_at FROM analyses WHERE patient_id=? ORDER BY id DESC').all(req.user.id));
});

router.get('/analyses/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM analyses WHERE id=? AND patient_id=?').get(req.params.id, req.user.id);
  if (!a) return res.status(404).json({ error: '未找到' });
  a.content = JSON.parse(a.content);
  res.json(a);
});

// B5：删除某份 AI 报告（撤回粒度：删除报告并终止医生查看）
router.delete('/analyses/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM analyses WHERE id=? AND patient_id=?').get(req.params.id, req.user.id);
  if (!a) return res.status(404).json({ error: '未找到' });
  db.prepare('DELETE FROM analyses WHERE id=?').run(a.id);
  db.prepare("UPDATE consults SET status='已终止查看', analysis_id=NULL WHERE analysis_id=?").run(a.id);
  db.prepare('INSERT INTO authorization_logs (patient_id,action,data_type,ip) VALUES (?,?,?,?)')
    .run(req.user.id, '删除 AI 报告并终止医生查看', a.title, 'self');
  res.json({ ok: true });
});

module.exports = router;
