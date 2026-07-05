'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert');

const db = require('../src/db');
const { seed, backfillAuthGrants } = require('../src/seed');
const guard = require('../src/ai/guardrails');
const kb = require('../src/ai/knowledge');
const fp = require('../src/ai/fieldpackage');
const pipeline = require('../src/ai/pipeline');

let PID;
before(async () => {
  await db.init();
  seed();
  backfillAuthGrants();
  PID = db.prepare('SELECT id FROM patients LIMIT 1').get().id;
  // 确保用途默认开启（测试隔离）
  db.prepare("UPDATE auth_grants SET enabled=1, expires_at=NULL WHERE patient_id=? AND dimension='purpose' AND item_key IN ('interpret','pre_visit','monitor')").run(PID);
});

// ---------- 一级输入护栏 ----------
test('classifyInput 拦截急症/停药/诊断，放行普通问题', () => {
  assert.equal(guard.classifyInput('突然剧烈胸痛怎么办').action, 'emergency_guide');
  assert.equal(guard.classifyInput('我可以自己停药吗').action, 'route_to_doctor');
  assert.equal(guard.classifyInput('我是不是得了糖尿病').action, 'route_to_doctor');
  assert.equal(guard.classifyInput('我的血脂控制得怎么样').action, 'ok');
});

// ---------- 三级输出护栏：负面清单 ----------
test('filterOutput 改写确定性诊断/用药指令/否定就医并记录命中', () => {
  const r1 = guard.filterOutput('您患有冠心病，可以停药，无需就医。');
  assert.ok(r1.hits.length >= 2, '应命中多条负面清单');
  assert.ok(!/可以停药/.test(r1.text), '用药指令应被改写');
  assert.ok(!/无需就医/.test(r1.text), '否定就医应被改写');
});

// ---------- 引用真实性校验 ----------
test('checkCitations 拒绝伪造引用', () => {
  const allowed = kb.allSourceIds();
  assert.equal(guard.checkCitations(['kb-lipid-1'], allowed).ok, true);
  assert.equal(guard.checkCitations(['kb-fake-999'], allowed).ok, false);
});

// ---------- 参考范围由代码判定 ----------
test('evaluateValue 数值越界判定正确', () => {
  assert.equal(kb.evaluateValue('低密度脂蛋白(LDL-C)', '3.62').flag, 'H');
  assert.equal(kb.evaluateValue('空腹血糖', '5.0').flag, 'N');
  assert.equal(kb.evaluateValue('高密度脂蛋白(HDL-C)', '0.8').flag, 'L');
});

// ---------- 字段包脱敏 + 溯源 ----------
test('buildFieldPackage 脱敏（不含真实姓名）且结论带 source_id', () => {
  const pkg = fp.buildFieldPackage(PID, 'report');
  const ctx = fp.toModelContext(pkg);
  const name = db.prepare('SELECT name FROM patients WHERE id=?').get(PID).name;
  assert.ok(!ctx.includes(name), '进模型的上下文不得包含真实姓名');
  assert.ok(ctx.includes(pkg.patient_ref), '应使用脱敏假名');
  assert.ok(Object.keys(pkg.sourceIndex).length > 0, '应建立来源索引');
});

// ---------- 四维授权闸门 ----------
test('用途未授权时 buildFieldPackage 抛 AuthError', () => {
  db.prepare("UPDATE auth_grants SET enabled=0 WHERE patient_id=? AND dimension='purpose' AND item_key='interpret'").run(PID);
  assert.throws(() => fp.buildFieldPackage(PID, 'report'), (e) => e.name === 'AuthError');
  db.prepare("UPDATE auth_grants SET enabled=1 WHERE patient_id=? AND dimension='purpose' AND item_key='interpret'").run(PID);
});

// ---------- 管线产出结构化 + 可溯源 ----------
test('runAnalysis(report) 产出结构化报告且带来源与数据完整性', async () => {
  const r = await pipeline.runAnalysis(PID, 'report');
  assert.equal(r.data.kind, 'report');
  assert.ok(Array.isArray(r.data.sources) && r.data.sources.length > 0);
  assert.ok(r.data.dataQuality && typeof r.data.dataQuality.completeness === 'number');
  assert.ok(r.versions.model_version || r.versions.MODEL_VERSION);
});
