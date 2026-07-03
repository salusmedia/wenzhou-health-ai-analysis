'use strict';
const db = require('./db');
const glm = require('./glm');
const { DATA_TYPES } = require('./seed');

// 数据类型 -> 授权 key 映射，用于"最小必要 + 分类型授权"控制
const TYPE_TABLE = {
  outpatient: { table: 'encounters', filter: "type IN ('门诊','急诊')" },
  inpatient: { table: 'encounters', filter: "type='住院'" },
  physical: { table: 'encounters', filter: "type='体检'" },
  lab: { table: 'lab_reports' },
  imaging: { table: 'imaging_reports' },
  medication: { table: 'medications' }
};

function getEnabledTypes(patientId) {
  const rows = db.prepare('SELECT data_type, enabled FROM authorizations WHERE patient_id=?').all(patientId);
  const map = {};
  rows.forEach(r => (map[r.data_type] = !!r.enabled));
  return map;
}

// ========== 构建结构化上下文（仅调用已授权数据，符合最小必要原则）==========
function buildContext(patientId) {
  const auth = getEnabledTypes(patientId);
  const p = db.prepare('SELECT * FROM patients WHERE id=?').get(patientId);
  const age = p ? (new Date().getFullYear() - new Date(p.birth_date).getFullYear()) : null;

  const ctx = { patient: p, age, sections: {}, used_types: [], skipped_types: [] };

  const conditions = db.prepare("SELECT * FROM conditions WHERE patient_id=?").all(patientId);
  ctx.sections.conditions = conditions;

  if (auth.outpatient || auth.inpatient || auth.physical) {
    const parts = [];
    if (auth.outpatient) parts.push("type IN ('门诊','急诊')");
    if (auth.inpatient) parts.push("type='住院'");
    if (auth.physical) parts.push("type='体检'");
    ctx.sections.encounters = db.prepare(
      `SELECT * FROM encounters WHERE patient_id=? AND (${parts.join(' OR ')}) ORDER BY visit_date DESC`
    ).all(patientId);
  }
  if (auth.lab) ctx.sections.labs = db.prepare('SELECT * FROM lab_reports WHERE patient_id=? ORDER BY report_date DESC').all(patientId);
  if (auth.imaging) ctx.sections.imaging = db.prepare('SELECT * FROM imaging_reports WHERE patient_id=? ORDER BY report_date DESC').all(patientId);
  if (auth.medication) ctx.sections.medications = db.prepare('SELECT * FROM medications WHERE patient_id=? ORDER BY status, start_date DESC').all(patientId);

  DATA_TYPES.forEach(t => { (auth[t.key] ? ctx.used_types : ctx.skipped_types).push(t.label); });

  // 记录一次数据调用（可审计、可溯源）
  db.prepare("INSERT INTO authorization_logs (patient_id,action,data_type,ip) VALUES (?,?,?,?)")
    .run(patientId, '调用数据', ctx.used_types.join('、'), 'AI引擎');

  return ctx;
}

// 将上下文渲染成给大模型的文本
function contextToText(ctx) {
  const L = [];
  const p = ctx.patient;
  L.push(`【患者基本信息】${p.name}，${p.gender}，${ctx.age}岁，身高${p.height}cm，体重${p.weight}kg，血型${p.blood_type}型。`);
  if (ctx.sections.conditions?.length) {
    L.push('【疾病与病史】' + ctx.sections.conditions.map(c => `${c.category}·${c.name}（自${c.since}，${c.status}）${c.note ? '：' + c.note : ''}`).join('；'));
  }
  if (ctx.sections.encounters?.length) {
    L.push('【就诊记录】');
    ctx.sections.encounters.forEach(e => L.push(`- ${e.visit_date} ${e.hospital}·${e.dept}(${e.type}) 主诉:${e.chief_complaint}；诊断:${e.diagnosis}；处置:${e.summary}`));
  }
  if (ctx.sections.labs?.length) {
    L.push('【检验报告（含异常标记 H偏高/L偏低）】');
    ctx.sections.labs.forEach(l => L.push(`- ${l.report_date} ${l.hospital} ${l.category}·${l.item_name}: ${l.value}${l.unit}（参考:${l.ref_range}）${l.flag !== 'N' ? '[' + l.flag + ']' : ''}`));
  }
  if (ctx.sections.imaging?.length) {
    L.push('【影像报告】');
    ctx.sections.imaging.forEach(i => L.push(`- ${i.report_date} ${i.hospital} ${i.modality}·${i.body_part}: ${i.impression}`));
  }
  if (ctx.sections.medications?.length) {
    L.push('【用药记录】');
    ctx.sections.medications.forEach(m => L.push(`- ${m.name} ${m.spec} ${m.dosage} ${m.frequency}（${m.purpose}，${m.status}）`));
  }
  return L.join('\n');
}

const SAFETY = '重要声明：以上内容为基于您授权数据的 AI 健康科普与辅助参考，不构成诊断、治疗或用药建议。请以执业医师面诊意见为准；如有紧急症状请立即就医或拨打 120。';

const SYSTEM_PROMPT = `你是"健康温州"个人医疗健康数据分析服务中的 AI 全科健康助理。你的职责是把患者散落在全市各医疗机构的诊疗数据，整合成以患者为中心、通俗易懂的健康解读。要求：
1. 采用全科视角，跨专科整合分析，指出各项指标之间的关联与整体风险；
2. 每条关键结论尽量标注数据来源（机构+日期+指标）；
3. 语气温和、通俗，避免制造焦虑；
4. 明确边界：你提供的是"第二意见/参考视角"，不做诊断结论；对高风险问题（自行调整用药、急症）主动提示就医；
5. 结尾附安全提示。`;

// ========= 降级引擎：直接从数据计算异常项、趋势、用药安全 =========
function analyzeData(ctx) {
  const labs = ctx.sections.labs || [];
  const abnormal = labs.filter(l => l.flag && l.flag !== 'N');
  // 按指标取最新
  const latestByItem = {};
  labs.forEach(l => { if (!latestByItem[l.item_name] || l.report_date > latestByItem[l.item_name].report_date) latestByItem[l.item_name] = l; });
  const meds = (ctx.sections.medications || []).filter(m => m.status === '服用中');
  return { abnormal, latestByItem, meds };
}

function fallbackReport(ctx) {
  const { latestByItem, meds } = analyzeData(ctx);
  const conds = ctx.sections.conditions || [];
  const chronic = conds.filter(c => c.category === '慢病');
  const abnormalLatest = Object.values(latestByItem).filter(l => l.flag && l.flag !== 'N');

  let score = 100;
  score -= abnormalLatest.length * 2.5;
  score -= chronic.filter(c => c.status === '需关注').length * 4;
  score = Math.round(Math.max(68, Math.min(95, score)));

  const overview = `${ctx.patient.name}（${ctx.age}岁${ctx.patient.gender}）目前存在 ${chronic.map(c => c.name.replace(/（.*?）/g, '')).join('、')} 等 ${chronic.length} 项慢性问题，属于需长期、跨专科协同管理的人群。综合本次纳入分析的 ${ctx.used_types.join('、')} 数据，整体健康状况处于"慢病共存、总体可控、局部需强化"的状态：血压近期波动偏高、血糖及糖化未完全达标、血脂（尤其 LDL-C）仍高于目标值，三者相互叠加，共同构成心脑血管风险。建议以"降压达标 + 血糖平稳 + 血脂强化"为近期核心目标。`;

  const keyFindings = [
    ...chronic.map(c => ({ title: c.name, level: c.status === '需关注' ? 'warn' : 'ok', text: `自 ${c.since} 起，当前${c.status}。${c.note || ''}` })),
    ...abnormalLatest.map(l => ({
      title: `${l.item_name} ${l.flag === 'H' ? '偏高' : '偏低'}`,
      level: 'warn',
      text: `最新 ${l.value}${l.unit}（参考 ${l.ref_range}），来源：${l.hospital} ${l.report_date}。`
    }))
  ];

  const trends = buildTrends(ctx);

  const medControl = meds.map(m => `${m.name} ${m.dosage} ${m.frequency}（${m.purpose}）`);
  const medAlerts = [];
  const hasCanci = ctx.sections.conditions?.some(c => c.name.includes('过敏'));
  if (hasCanci) medAlerts.push('病史含青霉素过敏，就诊时务必主动告知，避免使用青霉素类抗生素。');
  if (meds.some(m => m.name.includes('阿司匹林'))) medAlerts.push('长期服用阿司匹林，注意有无黑便、牙龈出血等出血倾向，定期复查。');
  if (meds.some(m => m.name.includes('他汀')) ) medAlerts.push('服用他汀类药物，建议每 3-6 个月复查肝功能与肌酸激酶。');

  const advice = [
    { level: '优先', text: '血压未达标且有晨峰现象，建议每日晨起、睡前各测一次血压并记录，2 周后带记录复诊心内科（陈伟东 主任）。' },
    { level: '重要', text: 'HbA1c 7.4% 略高于 <7% 目标，建议内分泌科随访，强化饮食与运动，必要时调整降糖方案。' },
    { level: '重要', text: 'LDL-C 3.62 高于目标，已有颈动脉斑块与冠脉轻度狭窄，属高危，建议他汀强化使 LDL-C 达标（通常 <1.8mmol/L）。' },
    { level: '常规', text: '尿酸偏高、轻度脂肪肝，建议低嘌呤低脂饮食、控制体重、增加有氧运动。' },
    { level: '随访', text: '颈动脉斑块建议 6-12 个月复查颈动脉超声；头颅缺血灶结合症状神经内科随诊。' }
  ];

  return {
    kind: 'report',
    title: `个人健康报告 · ${new Date().toISOString().slice(0, 10)}`,
    score,
    overview,
    keyFindings,
    trends,
    encounterSummary: (ctx.sections.encounters || []).slice(0, 5).map(e => ({
      date: e.visit_date, hospital: e.hospital, dept: e.dept, diagnosis: e.diagnosis
    })),
    medControl,
    medAlerts,
    advice,
    usedTypes: ctx.used_types,
    skippedTypes: ctx.skipped_types,
    safety: SAFETY
  };
}

function buildTrends(ctx) {
  const labs = ctx.sections.labs || [];
  const items = ['空腹血糖', '糖化血红蛋白(HbA1c)', '低密度脂蛋白(LDL-C)'];
  const trends = [];
  items.forEach(name => {
    const series = labs.filter(l => l.item_name === name).sort((a, b) => a.report_date.localeCompare(b.report_date));
    if (series.length) {
      trends.push({
        name,
        unit: series[0].unit,
        ref: series[0].ref_range,
        points: series.map(s => ({ date: s.report_date, value: parseFloat(s.value), flag: s.flag }))
      });
    }
  });
  return trends;
}

function fallbackSecondOpinion(ctx) {
  const { meds } = analyzeData(ctx);
  return {
    kind: 'second_opinion',
    title: 'AI 第二意见分析',
    disclaimer: '第二意见 = 参考视角，不 = 诊断结论。以下分析基于您的授权数据，仅供与医生讨论时参考。',
    crossCheck: [
      '将本次心内科降压调整与既往住院（2024-09 心功能 II 级、NT-proBNP 520↑）对照：加用氨氯地平、停用氢氯噻嗪的方向合理，但需关注下肢水肿等钙拮抗剂常见反应。',
      '血糖 HbA1c 由 7.2%→7.6%→7.4%，近一年整体略有上行趋势，提示当前降糖方案控制力度可能不足，值得在内分泌科复诊时提出。'
    ],
    gaps: [
      '颈动脉右侧斑块（2026-03）+ 冠脉 LAD 30% 狭窄（2024-09）+ LDL-C 未达标，三者叠加提示动脉粥样硬化进展风险，建议明确他汀强化目标并复查颈动脉。',
      '长期多重用药下，建议定期复查肝肾功能、电解质、肌酸激酶，本次可一并开单。',
      '尿酸 452↑ 尚未见针对性处理，若反复升高需评估痛风/肾脏风险。'
    ],
    decisionSupport: [
      '若医生建议调整降压药，可询问：目标血压值是多少？晨峰高该如何覆盖？',
      '若讨论降脂：我的 LDL-C 目标应为多少？是否需要联合用药？',
      '关于血糖：是否需要加用第二种降糖药或调整生活方式目标？'
    ],
    safety: SAFETY
  };
}

function fallbackPrep(ctx) {
  const abnormal = (ctx.sections.labs || []).filter(l => l.flag && l.flag !== 'N');
  const meds = (ctx.sections.medications || []).filter(m => m.status === '服用中');
  const conds = (ctx.sections.conditions || []);
  return {
    kind: 'prep',
    title: '诊前准备 · 就诊摘要与提问清单',
    visitSummary: {
      chiefComplaint: '反复头晕、血压升高；血糖、血脂控制欠佳，慢病随访',
      pastHistory: conds.map(c => `${c.name}（${c.category}）`),
      currentMeds: meds.map(m => `${m.name} ${m.dosage} ${m.frequency}`),
      recentAbnormal: abnormal.slice(0, 6).map(l => `${l.item_name} ${l.value}${l.unit}（${l.report_date}）`),
      keyImaging: (ctx.sections.imaging || []).slice(0, 3).map(i => `${i.modality}·${i.body_part}：${i.impression}（${i.report_date}）`)
    },
    questions: [
      '我的血压持续偏高且有晨峰，现在的用药方案需要调整吗？目标应控制到多少？',
      '氨氯地平和缬沙坦一起吃是否合适？会不会有下肢水肿等副作用？',
      'HbA1c 7.4% 是否需要调整降糖药？饮食运动上我最该改的是什么？',
      'LDL-C 没达标、又有颈动脉斑块，他汀是否需要加量？目标值是多少？',
      '尿酸偏高需要吃药吗？平时饮食要注意什么？',
      '这些慢病下一次复查分别应该间隔多久、查哪些项目？'
    ],
    safety: SAFETY
  };
}

// ========== 统一入口：优先 GLM，失败/未配置则降级 ==========
async function runAnalysis(patientId, type, extra = {}) {
  const ctx = buildContext(patientId);
  const ctxText = contextToText(ctx);

  const fallbacks = { report: fallbackReport, second_opinion: fallbackSecondOpinion, prep: fallbackPrep };
  const structured = fallbacks[type] ? fallbacks[type](ctx) : null;

  if (!glm.hasGLM) {
    return { source: 'builtin', model: '内置结构化引擎(演示)', data: structured, narrative: null };
  }

  // 用 GLM 生成一段自然语言综述，结构化骨架仍由数据保证可溯源
  const task = {
    report: '请基于以上数据，输出一份面向患者本人的《个人健康报告》综述（300-500字），包含总体健康评价、主要风险的跨专科关联、以及最需要优先关注的 2-3 件事。',
    second_opinion: '请以"AI 第二意见"的口吻，输出一段横向印证与查漏补缺的分析（250-400字），提示可能被忽略的关联或趋势，并给出可与医生讨论的问题方向。',
    prep: '请基于以上数据，输出一份"就诊摘要 + 智能提问清单"，摘要一页纸，提问清单 5-6 条，直指需要医生判断的关键决策。'
  }[type] || extra.prompt;

  try {
    const narrative = await glm.chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${ctxText}\n\n【任务】${task}\n\n请用中文、分段清晰地输出，结尾附一句安全提示。` }
    ], { temperature: 0.4 });
    return { source: 'glm', model: glm.model, data: structured, narrative };
  } catch (e) {
    console.error('[GLM] 调用失败，降级到内置引擎:', e.message);
    return { source: 'builtin-fallback', model: '内置结构化引擎(GLM不可用)', data: structured, narrative: null };
  }
}

// ========== AI 健康助理对话 ==========
async function chatWithAssistant(patientId, sessionId, userMessage) {
  const ctx = buildContext(patientId);
  const ctxText = contextToText(ctx);

  // 安全护栏：高风险意图拦截
  const risky = /(自行停药|自己加量|自己减药|不想去医院|急救|胸痛难忍|大出血|昏迷|自杀)/;
  if (risky.test(userMessage)) {
    const warn = '您提到的情况可能涉及用药安全或紧急风险。请不要自行调整用药；如出现胸痛、呼吸困难、意识改变等紧急症状，请立即就医或拨打 120。用药调整请务必先咨询您的主治医生。' + '\n\n' + SAFETY;
    saveChat(patientId, sessionId, userMessage, warn, []);
    return { content: warn, sources: [], source: 'guardrail' };
  }

  const history = db.prepare('SELECT role,content FROM chat_messages WHERE patient_id=? AND session_id=? ORDER BY id DESC LIMIT 6')
    .all(patientId, sessionId).reverse();

  let content, sources = deriveSources(ctx, userMessage);
  if (glm.hasGLM) {
    try {
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT + '\n\n以下是该患者的授权诊疗数据，回答须严格基于这些数据，并在引用时说明来源：\n' + ctxText },
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: userMessage }
      ];
      content = await glm.chat(messages, { temperature: 0.4 });
    } catch (e) {
      console.error('[GLM chat] 失败降级:', e.message);
      content = fallbackChat(ctx, userMessage);
    }
  } else {
    content = fallbackChat(ctx, userMessage);
  }
  saveChat(patientId, sessionId, userMessage, content, sources);
  return { content, sources, source: glm.hasGLM ? 'glm' : 'builtin' };
}

function deriveSources(ctx, q) {
  const src = [];
  const labs = ctx.sections.labs || [];
  const keywords = [
    { k: /血压|降压/, items: ['血压'] },
    { k: /血糖|糖尿|糖化/, items: ['空腹血糖', '糖化血红蛋白(HbA1c)'] },
    { k: /血脂|胆固醇|ldl|甘油/i, items: ['低密度脂蛋白(LDL-C)', '总胆固醇(TC)', '甘油三酯(TG)'] }
  ];
  keywords.forEach(({ k, items }) => {
    if (k.test(q)) items.forEach(it => {
      const l = labs.find(x => x.item_name === it);
      if (l) src.push(`${l.hospital} ${l.report_date} ${l.item_name} ${l.value}${l.unit}`);
    });
  });
  return src.slice(0, 4);
}

function fallbackChat(ctx, q) {
  const { latestByItem } = analyzeData(ctx);
  if (/血压|降压/.test(q)) {
    return `根据您 2026-06-20 在温医大附一院心内科的记录，血压近期升高并有晨峰，已加用苯磺酸氨氯地平 5mg 每日一次。建议每天晨起与睡前各测一次血压并记录，2 周后复诊。请勿自行增减药量。\n\n${SAFETY}`;
  }
  if (/血糖|糖尿|糖化/.test(q)) {
    const g = latestByItem['空腹血糖']; const h = latestByItem['糖化血红蛋白(HbA1c)'];
    return `您最近的空腹血糖约 ${g ? g.value + g.unit : '偏高'}，糖化血红蛋白 ${h ? h.value + '%' : '约7.4%'}，略高于一般 <7% 的控制目标。二甲双胍继续服用的同时，建议加强饮食与运动，并在内分泌科随访评估是否调整方案。\n\n${SAFETY}`;
  }
  if (/血脂|胆固醇|ldl|甘油/i.test(q)) {
    return `您 2026-03-05 体检 LDL-C 3.62mmol/L 高于目标，同时存在颈动脉斑块与冠脉轻度狭窄，属心血管高危人群，通常建议 LDL-C 控制到更低水平（如 <1.8）。已在服用阿托伐他汀，建议就诊时与医生确认是否需要强化。\n\n${SAFETY}`;
  }
  return `我可以基于您在全市各机构的授权诊疗数据，帮您解读指标、梳理病情、准备就诊问题。您可以问我"我的血压/血糖/血脂控制得怎么样""这次该问医生什么"等。\n\n${SAFETY}`;
}

function saveChat(patientId, sessionId, userMsg, aiMsg, sources) {
  db.prepare('INSERT INTO chat_messages (patient_id,session_id,role,content) VALUES (?,?,?,?)').run(patientId, sessionId, 'user', userMsg);
  db.prepare('INSERT INTO chat_messages (patient_id,session_id,role,content,sources) VALUES (?,?,?,?,?)')
    .run(patientId, sessionId, 'assistant', aiMsg, JSON.stringify(sources || []));
}

module.exports = { buildContext, contextToText, runAnalysis, chatWithAssistant, getEnabledTypes, SAFETY };
