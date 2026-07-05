'use strict';
// 结构化输出骨架（需求书 4.5）：由数据 + 知识库确定性生成，保证可溯源、数值由代码判定。
// GLM 负责在此骨架上生成自然语言综述；骨架本身不依赖模型，故降级时同样可用。
const kb = require('./knowledge');
const { SAFETY } = require('./guardrails');

function latestByItem(labs) {
  const map = {};
  (labs || []).forEach(l => { if (!map[l.item_name] || l.report_date > map[l.item_name].report_date) map[l.item_name] = l; });
  return map;
}

// 用代码判定异常（不交给模型）
function abnormalFindings(labs) {
  const latest = latestByItem(labs);
  const out = [];
  Object.values(latest).forEach(l => {
    const ev = kb.evaluateValue(l.item_name, l.value);
    const flag = ev ? ev.flag : l.flag;
    if (flag && flag !== 'N') {
      out.push({
        item: l.item_name, value: l.value, unit: l.unit, flag,
        refText: ev ? ev.refText : l.ref_range,
        sources: [l.source_id, ...(ev ? [ev.refId] : [])]
      });
    }
  });
  return out;
}

const ITEM_GUIDE_TAG = {
  '低密度脂蛋白(LDL-C)': '血脂', '总胆固醇(TC)': '血脂', '甘油三酯(TG)': '血脂',
  '空腹血糖': '血糖', '糖化血红蛋白(HbA1c)': '血糖', '尿酸(UA)': '尿酸'
};

function guideAdvice(finding) {
  const tag = ITEM_GUIDE_TAG[finding.item];
  const chunk = tag ? kb.retrieveByTags([tag], 1)[0] : null;
  return chunk
    ? { level: '重要', text: `${finding.item} ${finding.flag === 'H' ? '偏高' : '偏低'}（最新 ${finding.value}${finding.unit}，参考 ${finding.refText}）。${chunk.text}`, sources: [...finding.sources, chunk.id] }
    : { level: '常规', text: `${finding.item} ${finding.flag === 'H' ? '偏高' : '偏低'}（${finding.value}${finding.unit}，参考 ${finding.refText}），建议就诊时与医生确认。`, sources: finding.sources };
}

function buildReport(pkg) {
  const labs = pkg.sections.labs || [];
  const conds = pkg.sections.conditions || [];
  const chronic = conds.filter(c => c.category === '慢病');
  const abn = abnormalFindings(labs);
  const meds = (pkg.sections.medications || []).filter(m => m.status === '服用中');

  let score = 100 - abn.length * 2.5 - chronic.filter(c => c.status === '需关注').length * 4;
  score = Math.round(Math.max(68, Math.min(95, score)));
  if (pkg.data_quality.low) score = Math.min(score, 80);

  const overview = `受检者（${pkg.display.age}岁${pkg.display.gender}）纳入分析的数据类型为 ${pkg.used_types.length} 类，识别到 ${chronic.length} 项慢性问题与 ${abn.length} 项当前异常指标。以下为按数据整理的整体解读，供您了解自身状况并作为诊前准备，具体判断请以医生为准。`;

  const keyFindings = [
    ...chronic.map(c => ({ title: c.name, level: c.status === '需关注' ? 'warn' : 'ok', text: `自 ${c.since} 起，当前${c.status}。${c.note || ''}`, sources: [c.source_id] })),
    ...abn.map(f => ({ title: `${f.item} ${f.flag === 'H' ? '偏高' : '偏低'}`, level: 'warn', text: `最新 ${f.value}${f.unit}（参考 ${f.refText}）。`, sources: f.sources }))
  ];

  const medAlerts = kb.interactions(meds.map(m => m.name));
  const advice = abn.map(guideAdvice);
  if (chronic.some(c => /高血压/.test(c.name))) {
    const g = kb.retrieveByTags(['血压'], 1)[0];
    if (g) advice.unshift({ level: '优先', text: `血压管理：${g.text} 建议规律监测晨起血压并复诊。`, sources: [g.id] });
  }

  return withCommon(pkg, {
    kind: 'report',
    title: `个人健康数据解读报告 · ${new Date().toISOString().slice(0, 10)}`,
    score, overview, keyFindings,
    trends: buildTrends(labs),
    encounterSummary: (pkg.sections.encounters || []).slice(0, 5).map(e => ({ date: e.visit_date, hospital: e.hospital, dept: e.dept, diagnosis: e.diagnosis, source: e.source_id })),
    medControl: meds.map(m => `${m.name} ${m.dosage} ${m.frequency}（${m.purpose}）`),
    medAlerts: medAlerts.map(a => a.text),
    advice
  });
}

function buildPrep(pkg) {
  const abn = abnormalFindings(pkg.sections.labs || []);
  const meds = (pkg.sections.medications || []).filter(m => m.status === '服用中');
  const conds = pkg.sections.conditions || [];
  const questions = [];
  if (conds.some(c => /高血压/.test(c.name))) questions.push('我的血压目标应控制到多少？当前用药需要调整吗？');
  if (abn.some(f => /血糖|HbA1c/.test(f.item))) questions.push('我的血糖/糖化是否达标？生活方式上最该改的是什么？');
  if (abn.some(f => /LDL|胆固醇|甘油/.test(f.item))) questions.push('我的血脂未达标，他汀是否需要调整？目标值是多少？');
  if (meds.length >= 3) questions.push('我目前多种药物同服，是否存在相互作用或需要复查的项目？');
  questions.push('这些慢病下一次复查分别间隔多久、查哪些项目？');

  return withCommon(pkg, {
    kind: 'prep',
    title: '诊前准备 · 就诊摘要与提问清单',
    visitSummary: {
      chiefComplaint: '慢病随访：血压 / 血糖 / 血脂控制与用药复核',
      pastHistory: conds.map(c => `${c.name}（${c.category}）`),
      currentMeds: meds.map(m => `${m.name} ${m.dosage} ${m.frequency}`),
      recentAbnormal: abn.slice(0, 6).map(f => `${f.item} ${f.value}${f.unit}`),
      keyImaging: (pkg.sections.imaging || []).slice(0, 3).map(i => `${i.modality}·${i.body_part}：${i.impression}`)
    },
    questions
  });
}

function buildSecondOpinion(pkg) {
  const abn = abnormalFindings(pkg.sections.labs || []);
  const img = pkg.sections.imaging || [];
  const crossCheck = [], gaps = [], decisionSupport = [];
  abn.forEach(f => {
    const tag = ITEM_GUIDE_TAG[f.item];
    const chunk = tag ? kb.retrieveByTags([tag], 1)[0] : null;
    if (chunk) gaps.push({ text: `${f.item} 当前 ${f.value}${f.unit}（参考 ${f.refText}）未达标。参考：${chunk.text}`, sources: [...f.sources, chunk.id] });
  });
  if (img.some(i => /斑块|狭窄|增厚/.test(i.impression))) {
    const c = kb.retrieveByTags(['血脂'], 1)[0];
    crossCheck.push({ text: '影像提示动脉粥样硬化相关表现，结合血脂未达标，建议明确降脂目标并复查。', sources: c ? [c.id] : [] });
  }
  decisionSupport.push('若讨论降脂：我的 LDL-C 目标应为多少？是否需要联合用药？');
  decisionSupport.push('若讨论血压/血糖：目标值与复查频率分别是多少？');

  return withCommon(pkg, {
    kind: 'second_opinion',
    title: '参考视角分析（医生确认前）',
    disclaimer: '这是"医生确认前的参考视角"，不是诊断结论。以下分析基于您的授权数据，供与医生讨论时参考。',
    crossCheck: crossCheck.map(x => x.text),
    gaps: gaps.map(x => x.text),
    decisionSupport
  });
}

function buildTrends(labs) {
  const items = ['空腹血糖', '糖化血红蛋白(HbA1c)', '低密度脂蛋白(LDL-C)'];
  const trends = [];
  items.forEach(name => {
    const series = (labs || []).filter(l => l.item_name === name).sort((a, b) => a.report_date.localeCompare(b.report_date));
    if (series.length) trends.push({ name, unit: series[0].unit, ref: series[0].ref_range, points: series.map(s => ({ date: s.report_date, value: parseFloat(s.value), flag: s.flag })) });
  });
  return trends;
}

// 统一附加：数据来源清单、生成时间、适用边界、下一步、安全声明（整合版 E1 输出模板）
function withCommon(pkg, obj) {
  const sourceList = Object.entries(pkg.sourceIndex).map(([id, summary]) => ({ id, summary }));
  return {
    ...obj,
    template: {
      generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      boundary: '本服务只做数据解读与诊前准备，不做诊断、用药与复诊决策。',
      nextStep: '如涉及用药、复诊或治疗选择，请提交「医生确认」或前往就诊。'
    },
    usedTypes: pkg.used_types,
    dataQuality: pkg.data_quality,
    sources: sourceList,
    safety: SAFETY
  };
}

module.exports = { buildReport, buildPrep, buildSecondOpinion, abnormalFindings, latestByItem };
