'use strict';
// 字段包裁剪 + 脱敏 + 四维授权闸门（需求书 4.3 / 5.2；整合版第五章）。
const db = require('../db');

class AuthError extends Error {
  constructor(message, detail) { super(message); this.name = 'AuthError'; this.code = 'AUTH_REQUIRED'; this.detail = detail; }
}

// 任务 -> 所需用途（用途维授权，缺失即拒）
const TASK_PURPOSE = {
  report: 'interpret', interpret: 'interpret', second_opinion: 'interpret', chat: 'interpret',
  prep: 'pre_visit', chronic_reminder: 'monitor'
};
// 任务 -> 最小必要数据类型（不是每次都全量调用）
const TASK_TYPES = {
  report: ['outpatient', 'inpatient', 'lab', 'medication', 'imaging', 'physical'],
  interpret: ['lab', 'medication', 'physical'],
  second_opinion: ['outpatient', 'inpatient', 'lab', 'medication', 'imaging'],
  prep: ['outpatient', 'inpatient', 'lab', 'medication', 'imaging'],
  chronic_reminder: ['medication', 'lab', 'outpatient'],
  chat: ['lab', 'medication', 'outpatient']
};

function isActive(g) {
  if (!g || !g.enabled) return false;
  if (!g.expires_at) return true;                 // 长期
  return new Date(g.expires_at).getTime() >= Date.now();
}

function loadGrants(patientId) {
  const rows = db.prepare('SELECT dimension,item_key,enabled,expires_at FROM auth_grants WHERE patient_id=?').all(patientId);
  const by = { type: {}, purpose: {}, object: {} };
  rows.forEach(r => { (by[r.dimension] || (by[r.dimension] = {}))[r.item_key] = r; });
  return by;
}

// 授权闸门：校验用途 + 至少"本人"对象；返回允许的数据类型集合
function gate(patientId, taskType) {
  const grants = loadGrants(patientId);
  const purpose = TASK_PURPOSE[taskType] || 'interpret';
  if (!isActive(grants.purpose[purpose])) {
    throw new AuthError(`未授权用途「${purpose}」，请在授权中心开启后再试`, { dimension: 'purpose', key: purpose });
  }
  if (!isActive(grants.object.self)) {
    throw new AuthError('未授权「本人」访问对象', { dimension: 'object', key: 'self' });
  }
  const required = TASK_TYPES[taskType] || TASK_TYPES.interpret;
  const allowed = required.filter(t => isActive(grants.type[t]));
  const denied = required.filter(t => !isActive(grants.type[t]));
  return { purpose, allowed, denied, grants };
}

const SENSITIVE_SYNC = '2026-07-01';

// 构建最小必要字段包（含 source_id 溯源与数据完整性）
function buildFieldPackage(patientId, taskType) {
  const { purpose, allowed, denied } = gate(patientId, taskType);
  const p = db.prepare('SELECT * FROM patients WHERE id=?').get(patientId);
  const age = p ? (new Date().getFullYear() - new Date(p.birth_date).getFullYear()) : null;

  const sections = {};
  const sourceIndex = {};   // source_id -> 摘要（供引用真实性校验/溯源）
  const add = (sid, summary) => { sourceIndex[sid] = summary; return sid; };

  // 疾病与病史（始终纳入，作为解读背景，不属可选授权类型）
  sections.conditions = db.prepare('SELECT * FROM conditions WHERE patient_id=?').all(patientId)
    .map(c => ({ ...c, source_id: add(`cond_${c.id}`, `${c.name}(${c.category})`) }));

  const want = new Set(allowed);
  if (want.has('outpatient') || want.has('inpatient') || want.has('physical')) {
    const parts = [];
    if (want.has('outpatient')) parts.push("type IN ('门诊','急诊')");
    if (want.has('inpatient')) parts.push("type='住院'");
    if (want.has('physical')) parts.push("type='体检'");
    sections.encounters = db.prepare(`SELECT * FROM encounters WHERE patient_id=? AND (${parts.join(' OR ')}) ORDER BY visit_date DESC`)
      .all(patientId).map(e => ({ ...e, source_id: add(`enc_${e.id}`, `${e.visit_date} ${e.hospital}·${e.dept} ${e.diagnosis}`) }));
  }
  if (want.has('lab')) {
    sections.labs = db.prepare('SELECT * FROM lab_reports WHERE patient_id=? ORDER BY report_date DESC').all(patientId)
      .map(l => ({ ...l, source_id: add(`lab_${l.id}`, `${l.hospital} ${l.report_date} ${l.item_name} ${l.value}${l.unit}`) }));
  }
  if (want.has('imaging')) {
    sections.imaging = db.prepare('SELECT * FROM imaging_reports WHERE patient_id=? ORDER BY report_date DESC').all(patientId)
      .map(i => ({ ...i, source_id: add(`img_${i.id}`, `${i.modality}·${i.body_part} ${i.impression}`) }));
  }
  if (want.has('medication')) {
    sections.medications = db.prepare('SELECT * FROM medications WHERE patient_id=? ORDER BY status, start_date DESC').all(patientId)
      .map(m => ({ ...m, source_id: add(`med_${m.id}`, `${m.name} ${m.dosage} ${m.frequency}`) }));
  }

  // 数据完整性（低完整性触发报告降级提示）
  const missing = [];
  if (denied.length) missing.push('部分数据类型未授权：' + denied.join('、'));
  missing.push('可能缺少外地就诊与自购药记录');
  const completeness = Math.max(0.4, Math.round((allowed.length / (TASK_TYPES[taskType] || TASK_TYPES.interpret).length) * 100) / 100);

  return {
    task_type: taskType,
    purpose,
    patient_ref: pseudonym(patientId),   // 脱敏假名，进模型上下文
    display: { name: p.name, gender: p.gender, age, height: p.height, weight: p.weight, blood_type: p.blood_type },
    sections,
    sourceIndex,
    used_types: allowed,
    denied_types: denied,
    data_quality: { missing, completeness, last_sync: SENSITIVE_SYNC, low: completeness < 0.6 }
  };
}

function pseudonym(patientId) { return 'P' + String(100000 + Number(patientId)); }

// 生成进入 GLM 的上下文文本：脱敏（不含姓名/身份证/手机），每条附 source_id
function toModelContext(pkg) {
  const L = [];
  const d = pkg.display;
  L.push(`【受检者】假名 ${pkg.patient_ref}，${d.gender}，${d.age}岁，身高${d.height}cm，体重${d.weight}kg。`);
  if (pkg.sections.conditions?.length)
    L.push('【疾病与病史】' + pkg.sections.conditions.map(c => `${c.category}·${c.name}(${c.status})[${c.source_id}]`).join('；'));
  if (pkg.sections.encounters?.length) {
    L.push('【就诊记录】');
    pkg.sections.encounters.forEach(e => L.push(`- ${e.visit_date} ${e.hospital}·${e.dept}(${e.type}) 诊断:${e.diagnosis}；处置:${e.summary} [${e.source_id}]`));
  }
  if (pkg.sections.labs?.length) {
    L.push('【检验报告（H偏高/L偏低）】');
    pkg.sections.labs.forEach(l => L.push(`- ${l.report_date} ${l.item_name}: ${l.value}${l.unit}（参考${l.ref_range}）${l.flag !== 'N' ? '[' + l.flag + ']' : ''} [${l.source_id}]`));
  }
  if (pkg.sections.imaging?.length) {
    L.push('【影像报告文本】');
    pkg.sections.imaging.forEach(i => L.push(`- ${i.report_date} ${i.modality}·${i.body_part}: ${i.impression} [${i.source_id}]`));
  }
  if (pkg.sections.medications?.length) {
    L.push('【用药记录】');
    pkg.sections.medications.forEach(m => L.push(`- ${m.name} ${m.dosage} ${m.frequency}（${m.purpose}，${m.status}）[${m.source_id}]`));
  }
  L.push(`【数据完整性】完整度约 ${Math.round(pkg.data_quality.completeness * 100)}%；${pkg.data_quality.missing.join('；')}。`);
  return L.join('\n');
}

module.exports = { AuthError, buildFieldPackage, toModelContext, gate, loadGrants, isActive, TASK_PURPOSE, TASK_TYPES, pseudonym };
