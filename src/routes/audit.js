'use strict';
// 审计溯源回放（需求书 4.9 / D1）：按分析回放三版本、检索片段、护栏命中与授权/调用链路。
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const router = express.Router();

router.use(auth('patient'));

// 某份 AI 分析的全链路回放
router.get('/trace/:analysisId', (req, res) => {
  const pid = req.user.id;
  const a = db.prepare('SELECT id,type,title,model,prompt_version,kb_version,created_at FROM analyses WHERE id=? AND patient_id=?').get(req.params.analysisId, pid);
  if (!a) return res.status(404).json({ error: '未找到' });
  const t = db.prepare('SELECT * FROM ai_traces WHERE analysis_id=? ORDER BY id DESC LIMIT 1').get(a.id) || {};
  const authLogs = db.prepare('SELECT action,data_type,created_at FROM authorization_logs WHERE patient_id=? ORDER BY id DESC LIMIT 6').all(pid);
  res.json({
    analysis: a,
    versions: { model: t.model_version || a.model, prompt: t.prompt_version || a.prompt_version, kb: t.kb_version || a.kb_version },
    retrieved_ids: t.retrieved_ids ? JSON.parse(t.retrieved_ids) : [],
    guardrail_hits: t.guardrail_hits ? JSON.parse(t.guardrail_hits) : [],
    source: t.source || null,
    recent_authorizations: authLogs
  });
});

// 最近的 AI 溯源记录
router.get('/traces', (req, res) => {
  const rows = db.prepare('SELECT id,analysis_id,task_type,model_version,prompt_version,kb_version,source,created_at FROM ai_traces WHERE patient_id=? ORDER BY id DESC LIMIT 30').all(req.user.id);
  res.json(rows);
});

module.exports = router;
