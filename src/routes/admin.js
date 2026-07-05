'use strict';
// AI 安全监管台（需求书 4.8/4.9，整合版第六/十章）：护栏评测、一键暂停、报告召回、审计溯源。
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const control = require('../control');
const redteam = require('../ai/redteam');
const V = require('../ai/versions');
const router = express.Router();

router.use(auth('admin'));

// 概览
router.get('/status', (req, res) => {
  res.json({
    paused: control.isPaused(),
    versions: { model: V.MODEL_VERSION, prompt: V.PROMPT_VERSION, kb: V.KB_VERSION },
    counts: {
      analyses: db.prepare('SELECT COUNT(*) c FROM analyses').get().c,
      recalled: db.prepare('SELECT COUNT(*) c FROM analyses WHERE recalled=1').get().c,
      traces: db.prepare('SELECT COUNT(*) c FROM ai_traces').get().c
    }
  });
});

// 一键暂停 / 恢复 AI 生成
router.post('/pause', (req, res) => {
  const paused = !!req.body.paused;
  control.setFlag('ai_paused', paused ? '1' : '0');
  res.json({ ok: true, paused });
});

// 护栏红队评测（危险建议拦截率）
router.get('/eval', (req, res) => {
  res.json(redteam.evaluate());
});

// 报告召回：按单份或按版本
router.get('/analyses', (req, res) => {
  res.json(db.prepare(`SELECT id,patient_id,type,title,model,prompt_version,kb_version,recalled,created_at FROM analyses ORDER BY id DESC LIMIT 50`).all());
});
router.post('/recall', (req, res) => {
  const { analysis_id, kb_version, recall } = req.body;
  const val = recall === false ? 0 : 1;
  if (analysis_id) {
    db.prepare('UPDATE analyses SET recalled=? WHERE id=?').run(val, analysis_id);
    return res.json({ ok: true, scope: 'single', analysis_id, recalled: !!val });
  }
  if (kb_version) {
    const r = db.prepare('UPDATE analyses SET recalled=? WHERE kb_version=?').run(val, kb_version);
    return res.json({ ok: true, scope: 'version', kb_version, changed: r.changes });
  }
  res.status(400).json({ error: '需提供 analysis_id 或 kb_version' });
});

// 审计溯源（最近）
router.get('/traces', (req, res) => {
  res.json(db.prepare('SELECT id,patient_id,analysis_id,task_type,model_version,prompt_version,kb_version,source,guardrail_hits,created_at FROM ai_traces ORDER BY id DESC LIMIT 40').all()
    .map(t => ({ ...t, guardrail_hits: t.guardrail_hits ? JSON.parse(t.guardrail_hits) : [] })));
});

module.exports = router;
