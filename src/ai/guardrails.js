'use strict';
// 三级护栏（需求书 4.6）：一级输入分类、二级受约束生成(由 pipeline 保证)、三级输出过滤。
// 本模块为纯函数，便于单元测试与红队回归。

const SAFETY = '本内容为基于您授权数据的健康科普与辅助参考，不构成诊断、治疗或用药建议。请以执业医师面诊意见为准；如有紧急症状请立即就医或拨打 120。';

// ========== 一级 · 输入护栏：意图/风险分类 ==========
const EMERGENCY = /(胸痛难忍|剧烈胸痛|大出血|咯血|呕血|昏迷|意识不清|呼吸困难|喘不上气|抽搐|自杀|轻生|120|急救)/;
const MED_CHANGE = /(自行停药|自己停药|停药|自己加量|自行加量|自己减药|自行减药|换药|加量|减量|调整剂量|调剂量)/;
const DIAGNOSE_ASK = /(我是不是得了|我是不是有|我患了什么|帮我确诊|这是什么病|我得的是什么病)/;
const REFUSE_CARE = /(不想去医院|不用去医院|不去看医生|无需就医)/;

// 返回 { risk, category, action, message? }
function classifyInput(text) {
  const t = String(text || '');
  if (EMERGENCY.test(t)) {
    return { risk: true, category: 'emergency', action: 'emergency_guide',
      message: '您描述的情况可能属于紧急症状。请立即就医或拨打 120，不要拖延；本服务无法处理急症。' };
  }
  if (MED_CHANGE.test(t)) {
    return { risk: true, category: 'med_change', action: 'route_to_doctor',
      message: '是否停药、换药、加量或调整剂量属于医疗判断，请勿自行调整。建议将这个问题带给您的主治医生或药师确认。' };
  }
  if (DIAGNOSE_ASK.test(t)) {
    return { risk: true, category: 'diagnosis', action: 'route_to_doctor',
      message: '是否患病属于医生的诊断范畴。我可以帮您解读相关指标并整理"需要向医生确认的问题"，最终诊断请以医生面诊为准。' };
  }
  if (REFUSE_CARE.test(t)) {
    return { risk: true, category: 'refuse_care', action: 'route_to_doctor',
      message: '是否需要就医请听从医生建议。我可以帮您梳理病情，但不能替代医生判断是否就诊。' };
  }
  return { risk: false, category: 'normal', action: 'ok' };
}

// ========== 三级 · 输出护栏：负面清单（命中即改写/拦截） ==========
// 每条：patt 命中的违规表达，safe 替换后的合规表达，type 分类
const NEGATIVE_LIST = [
  { type: '确定性诊断', patt: /(您|你)(确诊|患有|得了|已经是)[^，。；\n]{0,20}(病|症|癌|梗)/g,
    safe: '相关指标存在异常，是否为某种疾病需由医生诊断' },
  { type: '确定性诊断', patt: /(可诊断为|即为|就是)[^，。；\n]{0,16}(病|症)/g, safe: '相关表现需由医生判断' },
  { type: '用药指令', patt: /(可以|建议|应当|需要)?(自行)?(停药|停用|加量|加大剂量|减量|换药|调整剂量)/g,
    safe: '是否调整用药请由医生决定' },
  { type: '否定就医', patt: /(无需就医|不用去医院|不必就诊|不需要看医生)/g, safe: '是否就医请遵医生建议' },
  { type: '影像诊断', patt: /(影像|CT|MRI|超声)[^，。；\n]{0,12}(可见|提示|诊断为)[^，。；\n]{0,16}(占位|肿瘤|癌|梗死)/g,
    safe: '影像的诊断性判断需由放射/临床医生出具' }
];

// 扫描并改写生成文本，返回 { text, hits: [{type, matched}] }
function filterOutput(text) {
  let out = String(text || '');
  const hits = [];
  for (const rule of NEGATIVE_LIST) {
    out = out.replace(rule.patt, (m) => {
      hits.push({ type: rule.type, matched: m });
      return `（${rule.safe}）`;
    });
  }
  return { text: out, hits };
}

// ========== 引用真实性校验（需求书 4.4.1）：cited 中出现的 id 必须属于合法来源集合 ==========
function checkCitations(citedIds, allowedIdSet) {
  const missing = (citedIds || []).filter(id => !allowedIdSet.has(id));
  return { ok: missing.length === 0, missing };
}

// 确保文本以安全声明结尾
function ensureSafety(text) {
  const t = String(text || '').trimEnd();
  if (t.includes('请以执业医师') || t.includes('遵医嘱')) return t;
  return t + '\n\n' + SAFETY;
}

module.exports = {
  SAFETY, classifyInput, filterOutput, checkCitations, ensureSafety, NEGATIVE_LIST
};
