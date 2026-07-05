'use strict';
// AI 推理总管线（需求书 4.2）：受理授权 → 字段包/脱敏 → 上下文 → RAG → 输入护栏
// → 结构化生成 → 输出护栏 → 溯源留痕。确定性、可观测、可回放。
const db = require('../db');
const glm = require('../glm');
const kb = require('./knowledge');
const guard = require('./guardrails');
const V = require('./versions');
const { buildFieldPackage, toModelContext, AuthError } = require('./fieldpackage');
const schema = require('./schema');

const SYSTEM_PROMPT = `你是"健康温州"的 AI 健康数据解读助手。职责：把患者授权的诊疗数据整合成通俗、可溯源的健康解读与诊前准备。
硬规则：
1) 只做数据汇总、指标解释、科普与诊前提问；不做诊断、治疗、处方、停换药、复诊周期等个性化结论；
2) 仅依据提供的【字段包】与【知识片段】作答，无依据不臆测，缺失数据要说明；
3) 每条关键结论后标注来源，形如 [lab_12] 或 [kb-lipid-1]；
4) 涉及用药调整、疾病诊断、复诊周期、治疗选择、急症时，改为生成"需向医生确认的问题"，不给操作性结论；
5) 结尾附一句安全提示。语言：简体中文，面向患者本人，温和克制。`;

const TASK_INSTRUCTION = {
  report: '请基于以上数据与知识片段，输出一段面向患者本人的《健康数据解读》综述（300-500字）：总体状况、主要异常之间的关联、最需优先关注的 2-3 件事。每条结论标注来源编号。',
  second_opinion: '请以"医生确认前的参考视角"输出一段横向印证与查漏补缺分析（250-400字），提示可能被忽略的关联或趋势，并给出可与医生讨论的问题。标注来源编号。不得给诊断或用药结论。',
  prep: '请输出"就诊摘要 + 提问清单"：摘要一段，提问清单 5-6 条，直指需要医生判断的关键决策。标注来源编号。'
};

const STRUCT = { report: schema.buildReport, second_opinion: schema.buildSecondOpinion, prep: schema.buildPrep };

function taskTags(pkg) {
  const tags = new Set();
  (pkg.sections.labs || []).forEach(l => { if (/血脂|LDL|胆固醇|甘油/.test(l.item_name)) tags.add('血脂'); if (/血糖|HbA1c/.test(l.item_name)) tags.add('血糖'); if (/尿酸/.test(l.item_name)) tags.add('尿酸'); });
  (pkg.sections.conditions || []).forEach(c => { if (/高血压/.test(c.name)) tags.add('血压'); });
  (pkg.sections.medications || []).forEach(m => { if (/他汀/.test(m.name)) tags.add('他汀'); if (/阿司匹林/.test(m.name)) tags.add('阿司匹林'); });
  return [...tags];
}

// 溯源留痕（三版本 + 护栏命中 + 检索）
function writeTrace(patientId, analysisId, taskType, retrievedIds, hits, source) {
  try {
    db.prepare(`INSERT INTO ai_traces (patient_id,analysis_id,task_type,model_version,prompt_version,kb_version,field_types,retrieved_ids,guardrail_hits,source)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(patientId, analysisId || null, taskType,
      V.MODEL_VERSION, V.PROMPT_VERSION, V.KB_VERSION, JSON.stringify(retrievedIds || []),
      JSON.stringify(retrievedIds || []), JSON.stringify(hits || []), source);
  } catch (e) { console.error('[trace] 写入失败', e.message); }
}

// 任务型分析（report / prep / second_opinion）
async function runAnalysis(patientId, taskType) {
  // step1-3：授权闸门 + 最小必要字段包 + 脱敏上下文（AuthError 冒泡给路由）
  const pkg = buildFieldPackage(patientId, taskType);
  const ctxText = toModelContext(pkg);

  // step4：RAG 检索
  const chunks = kb.retrieveByTags(taskTags(pkg), 6);
  const retrievedIds = chunks.map(c => c.id);
  const knowledgeText = chunks.map(c => `[${c.id}] ${c.source}(${c.version})：${c.text}`).join('\n');

  // step5：结构化生成（确定性骨架，保证可溯源）
  const build = STRUCT[taskType];
  const data = build ? build(pkg) : null;

  let narrative = null, source = glm.hasGLM ? 'glm' : 'builtin', hits = [];
  if (glm.hasGLM && TASK_INSTRUCTION[taskType]) {
    try {
      const raw = await glm.chat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `【字段包】\n${ctxText}\n\n【知识片段】\n${knowledgeText}\n\n【任务】${TASK_INSTRUCTION[taskType]}` }
      ], { temperature: 0.3 });
      // step6：输出护栏（负面清单改写 + 引用真实性 + 安全声明）
      const filtered = guard.filterOutput(raw || '');
      hits = filtered.hits;
      narrative = guard.ensureSafety(stripBadCitations(filtered.text, pkg, kb));
    } catch (e) {
      console.error('[GLM] 调用失败，降级内置引擎:', e.message);
      source = 'builtin-fallback';
    }
  }

  // step8：溯源留痕（analysisId 由路由保存后回填，这里先记 null，路由再补 trace）
  return { source, model: V.MODEL_VERSION, data, narrative, versions: { ...V }, guardrailHits: hits, retrievedIds };
}

// 剥离模型编造的、不在合法来源集合内的引用编号
function stripBadCitations(text, pkg, kbmod) {
  const allowed = new Set([...Object.keys(pkg.sourceIndex), ...kbmod.allSourceIds()]);
  return String(text || '').replace(/\[([a-zA-Z0-9_\-]+)\]/g, (m, id) => (allowed.has(id) ? m : ''));
}

// ========== AI 健康助理对话 ==========
async function chatWithAssistant(patientId, sessionId, userMessage) {
  // step5(输入护栏一级)：高风险/诊疗类拦截 → 转医生确认/就医，不进入自由生成
  const cls = guard.classifyInput(userMessage);
  if (cls.risk) {
    const msg = cls.message + '\n\n' + guard.SAFETY;
    saveChat(patientId, sessionId, userMessage, msg, []);
    writeTrace(patientId, null, 'chat', [], [{ type: '输入拦截', category: cls.category }], 'guardrail');
    return { content: msg, sources: [], source: 'guardrail', blocked: cls.category };
  }

  let pkg;
  try { pkg = buildFieldPackage(patientId, 'chat'); }
  catch (e) {
    if (e instanceof AuthError) { const m = e.message + '\n\n' + guard.SAFETY; saveChat(patientId, sessionId, userMessage, m, []); return { content: m, sources: [], source: 'auth' }; }
    throw e;
  }
  const ctxText = toModelContext(pkg);
  const chunks = kb.retrieve(userMessage, 4);
  const knowledgeText = chunks.map(c => `[${c.id}] ${c.text}`).join('\n');
  const sources = deriveSources(pkg, userMessage);

  const history = db.prepare('SELECT role,content FROM chat_messages WHERE patient_id=? AND session_id=? ORDER BY id DESC LIMIT 6').all(patientId, sessionId).reverse();

  let content, source = glm.hasGLM ? 'glm' : 'builtin', hits = [];
  if (glm.hasGLM) {
    try {
      const raw = await glm.chat([
        { role: 'system', content: SYSTEM_PROMPT + '\n\n【字段包】\n' + ctxText + (knowledgeText ? '\n\n【知识片段】\n' + knowledgeText : '') },
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: userMessage }
      ], { temperature: 0.3 });
      const filtered = guard.filterOutput(raw || '');
      hits = filtered.hits;
      content = guard.ensureSafety(stripBadCitations(filtered.text, pkg, kb));
    } catch (e) { console.error('[GLM chat] 失败降级:', e.message); content = guard.ensureSafety(fallbackChat(pkg, userMessage)); source = 'builtin-fallback'; }
  } else {
    content = guard.ensureSafety(fallbackChat(pkg, userMessage));
  }
  saveChat(patientId, sessionId, userMessage, content, sources);
  writeTrace(patientId, null, 'chat', chunks.map(c => c.id), hits, source);
  return { content, sources, source };
}

function deriveSources(pkg, q) {
  const labs = pkg.sections.labs || [];
  const map = [{ k: /血压|降压/, items: ['血压'] }, { k: /血糖|糖尿|糖化/, items: ['空腹血糖', '糖化血红蛋白(HbA1c)'] }, { k: /血脂|胆固醇|ldl|甘油/i, items: ['低密度脂蛋白(LDL-C)', '总胆固醇(TC)', '甘油三酯(TG)'] }];
  const src = [];
  map.forEach(({ k, items }) => { if (k.test(q)) items.forEach(it => { const l = labs.find(x => x.item_name === it); if (l) src.push(`${l.hospital} ${l.report_date} ${l.item_name} ${l.value}${l.unit}`); }); });
  return src.slice(0, 4);
}

function fallbackChat(pkg, q) {
  const latest = schema.latestByItem(pkg.sections.labs || []);
  if (/血压|降压/.test(q)) return '根据您授权的就诊与用药记录，血压近期偏高并有晨峰，已在使用降压药。建议规律监测晨起与睡前血压并复诊，请勿自行增减药量。是否调整用药请由医生决定。';
  if (/血糖|糖尿|糖化/.test(q)) { const h = latest['糖化血红蛋白(HbA1c)']; return `您最近的糖化血红蛋白约 ${h ? h.value + '%' : '偏高'}，多数成人目标为 <7%（[kb-dm-1]）。建议加强饮食运动并在内分泌科随访评估。`; }
  if (/血脂|胆固醇|ldl|甘油/i.test(q)) { const l = latest['低密度脂蛋白(LDL-C)']; return `您的 LDL-C ${l ? '约 ' + l.value + l.unit : '偏高'}，若属高危人群目标通常更低（[kb-lipid-1]）。是否需要调整降脂方案请与医生确认。`; }
  return '我可以基于您授权的诊疗数据，帮您解读指标、梳理病情、准备就诊问题。例如"我的血压/血糖/血脂怎么样""这次该问医生什么"。';
}

function saveChat(patientId, sessionId, userMsg, aiMsg, sources) {
  db.prepare('INSERT INTO chat_messages (patient_id,session_id,role,content) VALUES (?,?,?,?)').run(patientId, sessionId, 'user', userMsg);
  db.prepare('INSERT INTO chat_messages (patient_id,session_id,role,content,sources) VALUES (?,?,?,?,?)').run(patientId, sessionId, 'assistant', aiMsg, JSON.stringify(sources || []));
}

module.exports = { runAnalysis, chatWithAssistant, writeTrace, SYSTEM_PROMPT };
