'use strict';
// AI 层门面：对外保持 runAnalysis / chatWithAssistant / getEnabledTypes 稳定签名，
// 内部委托给 src/ai/ 下的确定性管线（八步 + 三级护栏 + RAG + 溯源）。
const db = require('./db');
const pipeline = require('./ai/pipeline');
const { SAFETY } = require('./ai/guardrails');

// 兼容旧调用：返回已启用的数据类型 map（读四维授权的 type 维）
function getEnabledTypes(patientId) {
  const rows = db.prepare("SELECT item_key, enabled FROM auth_grants WHERE patient_id=? AND dimension='type'").all(patientId);
  const map = {};
  rows.forEach(r => (map[r.item_key] = !!r.enabled));
  return map;
}

module.exports = {
  runAnalysis: pipeline.runAnalysis,
  chatWithAssistant: pipeline.chatWithAssistant,
  writeTrace: pipeline.writeTrace,
  getEnabledTypes,
  SAFETY
};
