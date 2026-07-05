'use strict';
// 演示版 RAG 知识库（需求书 4.4）。生产环境替换为向量库 + 权威指南/药典私有部署，
// 接口（retrieve / referenceRange / interactions）保持不变即可平滑切换。
const { KB_VERSION } = require('./versions');

// 每条知识块带来源、版本、标签，供结论引用与"引用真实性校验"
const CHUNKS = [
  { id: 'kb-htn-1', kb: '临床指南库', tags: ['血压', '高血压', '降压'], source: '《中国高血压防治指南(2018修订版)》', version: '2018',
    text: '多数高血压患者血压应降至 <140/90 mmHg；能耐受者及部分高危患者可进一步降至 <130/80 mmHg。清晨血压监测有助于发现晨峰。' },
  { id: 'kb-dm-1', tags: ['血糖', '糖化', 'HbA1c', '糖尿病'], kb: '临床指南库', source: '《中国2型糖尿病防治指南(2020)》', version: '2020',
    text: '多数非妊娠成人 2 型糖尿病 HbA1c 控制目标为 <7%；空腹血糖一般控制在 4.4–7.0 mmol/L。目标应个体化。' },
  { id: 'kb-lipid-1', tags: ['血脂', 'LDL', '胆固醇', '他汀'], kb: '临床指南库', source: '《中国血脂管理指南(2023)》', version: '2023',
    text: '动脉粥样硬化性心血管病(ASCVD)极高危人群 LDL-C 目标 <1.8 mmol/L 且较基线降幅 >50%；高危人群 <2.6 mmol/L。' },
  { id: 'kb-ua-1', tags: ['尿酸', '痛风'], kb: '临床指南库', source: '《中国高尿酸血症与痛风诊疗指南(2019)》', version: '2019',
    text: '血尿酸持续升高可增加痛风与肾损害风险；无症状高尿酸血症以生活方式干预为主，是否药物治疗需医生评估。' },
  { id: 'kb-int-asa-1', tags: ['阿司匹林', '出血', '相互作用'], kb: '药物相互作用库', source: '药品说明书/药物相互作用数据库', version: '2025',
    text: '长期服用阿司匹林可增加消化道出血风险，与抗凝、非甾体抗炎药合用风险叠加；出现黑便、牙龈出血应就医。' },
  { id: 'kb-int-statin-1', tags: ['他汀', '肝功能', '肌酸激酶'], kb: '药物相互作用库', source: '药品说明书/药物相互作用数据库', version: '2025',
    text: '他汀类药物可能引起转氨酶升高与肌病，建议用药后定期复查肝功能与肌酸激酶(CK)。' },
  { id: 'kb-gloss-1', tags: ['科普', '术语', 'LDL'], kb: '科普库', source: '健康温州科普库', version: '2026',
    text: 'LDL-C（低密度脂蛋白胆固醇）俗称"坏胆固醇"，升高与动脉粥样硬化相关；HDL-C 为"好胆固醇"。' }
];

// 参考范围库（含数值区间，供代码判定越界——不交给模型判断数值）
const REFERENCE = {
  '空腹血糖': { low: 3.9, high: 6.1, unit: 'mmol/L', source: '检验参考范围库', id: 'ref-glu' },
  '糖化血红蛋白(HbA1c)': { low: 4.0, high: 6.0, unit: '%', source: '检验参考范围库', id: 'ref-hba1c' },
  '低密度脂蛋白(LDL-C)': { low: null, high: 3.37, unit: 'mmol/L', source: '检验参考范围库', id: 'ref-ldl' },
  '总胆固醇(TC)': { low: null, high: 5.20, unit: 'mmol/L', source: '检验参考范围库', id: 'ref-tc' },
  '甘油三酯(TG)': { low: null, high: 1.70, unit: 'mmol/L', source: '检验参考范围库', id: 'ref-tg' },
  '高密度脂蛋白(HDL-C)': { low: 1.04, high: null, unit: 'mmol/L', source: '检验参考范围库', id: 'ref-hdl' },
  '尿酸(UA)': { low: 208, high: 428, unit: 'μmol/L', source: '检验参考范围库', id: 'ref-ua' }
};

// 关键词 -> 检索标签（演示用；生产走向量召回 + rerank）
function retrieve(query, limit = 4) {
  const q = String(query || '');
  const scored = CHUNKS.map(c => ({ c, score: c.tags.reduce((s, t) => s + (q.includes(t) ? 1 : 0), 0) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.c);
  return scored;
}

// 按标签集合检索（供任务型管线使用）
function retrieveByTags(tags, limit = 6) {
  const set = new Set(tags);
  return CHUNKS
    .map(c => ({ c, score: c.tags.reduce((s, t) => s + (set.has(t) ? 1 : 0), 0) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.c);
}

function referenceRange(itemName) {
  return REFERENCE[itemName] || null;
}

// 代码判定数值是否越界（H 偏高 / L 偏低 / N 正常），返回带来源的结论
function evaluateValue(itemName, value) {
  const ref = REFERENCE[itemName];
  const v = parseFloat(value);
  if (!ref || Number.isNaN(v)) return null;
  let flag = 'N';
  if (ref.high != null && v > ref.high) flag = 'H';
  if (ref.low != null && v < ref.low) flag = 'L';
  return { item: itemName, value: v, flag, ref, refId: ref.id, refText: rangeText(ref) };
}
function rangeText(ref) {
  if (ref.low != null && ref.high != null) return `${ref.low}-${ref.high}${ref.unit}`;
  if (ref.high != null) return `<${ref.high}${ref.unit}`;
  if (ref.low != null) return `>${ref.low}${ref.unit}`;
  return '';
}

// 药物相互作用/监测提示（演示规则；生产走权威药物相互作用库）
function interactions(medNames) {
  const names = (medNames || []).join(' ');
  const hits = [];
  if (/阿司匹林/.test(names)) hits.push({ chunkId: 'kb-int-asa-1', text: '长期服用阿司匹林，注意黑便、牙龈出血等出血倾向，必要时复查。' });
  if (/他汀/.test(names)) hits.push({ chunkId: 'kb-int-statin-1', text: '服用他汀类，建议每 3–6 个月复查肝功能与肌酸激酶。' });
  return hits;
}

// 全部合法引用 id（供输出护栏做"引用真实性校验"）
function allSourceIds() {
  return new Set([...CHUNKS.map(c => c.id), ...Object.values(REFERENCE).map(r => r.id)]);
}

module.exports = { CHUNKS, REFERENCE, KB_VERSION, retrieve, retrieveByTags, referenceRange, evaluateValue, interactions, allSourceIds };
