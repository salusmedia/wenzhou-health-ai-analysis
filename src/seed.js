'use strict';
const db = require('./db');

const DATA_TYPES = [
  { key: 'outpatient', label: '门诊记录' },
  { key: 'inpatient', label: '住院病历' },
  { key: 'lab', label: '检验报告' },
  { key: 'imaging', label: '影像报告' },
  { key: 'medication', label: '用药记录' },
  { key: 'physical', label: '体检报告' },
  { key: 'wearable', label: '可穿戴设备数据' }
];

function seed() {
  const count = db.prepare('SELECT COUNT(*) c FROM patients').get().c;
  if (count > 0) return; // 已有数据，不重复播种

  const tx = db.transaction(() => {
    // ===== 患者：张明，58岁，高血压+2型糖尿病+高脂血症 =====
    const p = db.prepare(`INSERT INTO patients (open_id,name,id_card,gender,birth_date,phone,avatar,height,weight,blood_type)
      VALUES (@open_id,@name,@id_card,@gender,@birth_date,@phone,@avatar,@height,@weight,@blood_type)`).run({
      open_id: 'demo-patient-001',
      name: '张明',
      id_card: '3303**********1234',
      gender: '男',
      birth_date: '1968-03-12',
      phone: '138****6688',
      avatar: '张',
      height: 172,
      weight: 78,
      blood_type: 'A'
    });
    const pid = p.lastInsertRowid;

    // ===== 医生 =====
    const docStmt = db.prepare(`INSERT INTO doctors (login,password,name,title,dept,hospital,avatar,phone,intro)
      VALUES (@login,@password,@name,@title,@dept,@hospital,@avatar,@phone,@intro)`);
    const d1 = docStmt.run({
      login: 'doctor', password: '123456', name: '陈伟东', title: '主任医师',
      dept: '心血管内科', hospital: '温州医科大学附属第一医院', avatar: '陈', phone: '0577-8806xxxx',
      intro: '从事心血管内科临床工作 25 年，擅长高血压、冠心病及慢病综合管理。'
    }).lastInsertRowid;
    const d2 = docStmt.run({
      login: 'doctor2', password: '123456', name: '林慧', title: '副主任医师',
      dept: '内分泌科', hospital: '温州市中心医院', avatar: '林', phone: '0577-8809xxxx',
      intro: '内分泌代谢病专家，专注糖尿病个体化管理与并发症防治。'
    }).lastInsertRowid;

    // 签约/主治关系
    db.prepare(`INSERT INTO doctor_patient (doctor_id,patient_id,signed,relation) VALUES (?,?,1,?)`).run(d1, pid, '签约家庭医生');
    db.prepare(`INSERT INTO doctor_patient (doctor_id,patient_id,signed,relation) VALUES (?,?,1,?)`).run(d2, pid, '主治医师');

    // ===== 慢病 / 既往史 / 过敏史 =====
    const cond = db.prepare(`INSERT INTO conditions (patient_id,name,category,since,status,note) VALUES (?,?,?,?,?,?)`);
    cond.run(pid, '原发性高血压 2级（高危）', '慢病', '2016', '需关注', '近期血压波动偏高，晨峰明显');
    cond.run(pid, '2型糖尿病', '慢病', '2019', '控制中', '口服药+饮食控制，HbA1c 略高于目标');
    cond.run(pid, '高脂血症（混合型）', '慢病', '2018', '需关注', 'LDL-C 未达标');
    cond.run(pid, '轻度脂肪肝', '既往史', '2021', '稳定', '');
    cond.run(pid, '青霉素过敏', '过敏史', '—', '稳定', '皮试阳性，禁用青霉素类');

    // ===== 就诊记录（跨机构、跨时间）=====
    const enc = db.prepare(`INSERT INTO encounters (patient_id,type,hospital,dept,doctor_name,visit_date,chief_complaint,diagnosis,summary)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    const e1 = enc.run(pid, '门诊', '温州医科大学附属第一医院', '心血管内科', '陈伟东', '2026-06-20',
      '反复头晕、血压升高 2 周', '原发性高血压 2级（高危）', '调整降压方案，加用氨氯地平，建议低盐饮食并监测晨起血压。').lastInsertRowid;
    const e2 = enc.run(pid, '门诊', '温州市中心医院', '内分泌科', '林慧', '2026-05-18',
      '口干、多饮，复查血糖', '2型糖尿病', '二甲双胍继续，加强饮食运动，3个月后复查 HbA1c。').lastInsertRowid;
    const e3 = enc.run(pid, '体检', '温州市人民医院', '健康管理中心', '—', '2026-03-05',
      '年度健康体检', '高脂血症；轻度脂肪肝；颈动脉内膜增厚', '建议控制血脂、复查颈动脉，专科随诊。').lastInsertRowid;
    const e4 = enc.run(pid, '门诊', '温州医科大学附属第二医院', '神经内科', '王磊', '2025-12-11',
      '间断头晕', '后循环缺血待排', '完善头颅 MRI 及颈动脉超声，未见急性病灶。').lastInsertRowid;
    const e5 = enc.run(pid, '住院', '温州医科大学附属第一医院', '心血管内科', '陈伟东', '2024-09-02',
      '胸闷、活动后气促', '高血压性心脏病；心功能 II级', '住院 7 天，冠脉 CTA 未见严重狭窄，调整用药后好转出院。').lastInsertRowid;

    // ===== 检验报告（含趋势数据）=====
    const lab = db.prepare(`INSERT INTO lab_reports (patient_id,encounter_id,hospital,report_date,category,item_name,value,unit,ref_range,flag)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    // 血糖 / 糖化 趋势
    const glucoseSeries = [
      ['2025-03-05', '7.8', 'H'], ['2025-09-10', '8.2', 'H'], ['2026-01-15', '7.5', 'H'], ['2026-05-18', '7.9', 'H']
    ];
    glucoseSeries.forEach(([dt, v, f]) => lab.run(pid, e2, '温州市中心医院', dt, '血糖', '空腹血糖', v, 'mmol/L', '3.9-6.1', f));
    const hba1c = [['2025-03-05', '7.2'], ['2025-09-10', '7.6'], ['2026-05-18', '7.4']];
    hba1c.forEach(([dt, v]) => lab.run(pid, e2, '温州市中心医院', dt, '血糖', '糖化血红蛋白(HbA1c)', v, '%', '4.0-6.0', 'H'));
    // 血脂
    lab.run(pid, e3, '温州市人民医院', '2026-03-05', '血脂', '低密度脂蛋白(LDL-C)', '3.62', 'mmol/L', '<3.37', 'H');
    lab.run(pid, e3, '温州市人民医院', '2026-03-05', '血脂', '总胆固醇(TC)', '5.98', 'mmol/L', '<5.20', 'H');
    lab.run(pid, e3, '温州市人民医院', '2026-03-05', '血脂', '甘油三酯(TG)', '2.31', 'mmol/L', '<1.70', 'H');
    lab.run(pid, e3, '温州市人民医院', '2026-03-05', '血脂', '高密度脂蛋白(HDL-C)', '0.98', 'mmol/L', '>1.04', 'L');
    // 肝肾功
    lab.run(pid, e3, '温州市人民医院', '2026-03-05', '肝功', '谷丙转氨酶(ALT)', '48', 'U/L', '9-50', 'N');
    lab.run(pid, e3, '温州市人民医院', '2026-03-05', '肾功', '肌酐(Cr)', '86', 'μmol/L', '57-97', 'N');
    lab.run(pid, e3, '温州市人民医院', '2026-03-05', '肾功', '尿酸(UA)', '452', 'μmol/L', '208-428', 'H');
    // 血常规
    lab.run(pid, e5, '温州医科大学附属第一医院', '2024-09-02', '血常规', '血红蛋白(Hb)', '141', 'g/L', '130-175', 'N');
    lab.run(pid, e5, '温州医科大学附属第一医院', '2024-09-02', '血常规', '白细胞(WBC)', '6.8', '10^9/L', '3.5-9.5', 'N');
    // 心衰标志物
    lab.run(pid, e5, '温州医科大学附属第一医院', '2024-09-02', '免疫', 'NT-proBNP', '520', 'pg/mL', '<300', 'H');

    // ===== 影像报告 =====
    const img = db.prepare(`INSERT INTO imaging_reports (patient_id,encounter_id,hospital,report_date,modality,body_part,findings,impression)
      VALUES (?,?,?,?,?,?,?,?)`);
    img.run(pid, e4, '温州医科大学附属第二医院', '2025-12-11', 'MRI', '头颅',
      '脑实质内散在少许缺血灶，未见急性梗死或出血。脑室系统无扩大。',
      '双侧额顶叶少许缺血灶，请结合临床。');
    img.run(pid, e3, '温州市人民医院', '2026-03-05', '超声', '颈动脉',
      '双侧颈总动脉内膜中层增厚，右侧可见一处约 2.1mm 混合回声斑块，管腔无明显狭窄。',
      '双侧颈动脉内膜增厚伴右侧斑块形成。');
    img.run(pid, e5, '温州医科大学附属第一医院', '2024-09-02', 'CT', '冠脉CTA',
      '左前降支近段轻度钙化斑块，管腔狭窄约 30%，余冠脉未见明显狭窄。',
      '冠状动脉粥样硬化（轻度），LAD 约 30% 狭窄。');
    img.run(pid, e3, '温州市人民医院', '2026-03-05', '超声', '腹部',
      '肝脏形态饱满，回声增强，符合轻度脂肪肝声像。胆胰脾肾未见明显异常。',
      '轻度脂肪肝。');

    // ===== 用药记录 =====
    const med = db.prepare(`INSERT INTO medications (patient_id,encounter_id,name,spec,dosage,frequency,purpose,start_date,end_date,status)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    med.run(pid, e1, '苯磺酸氨氯地平片', '5mg', '5mg', '每日1次', '降血压', '2026-06-20', null, '服用中');
    med.run(pid, e1, '缬沙坦胶囊', '80mg', '80mg', '每日1次', '降血压', '2024-09-08', null, '服用中');
    med.run(pid, e2, '盐酸二甲双胍片', '0.5g', '0.5g', '每日3次', '降血糖', '2019-06-01', null, '服用中');
    med.run(pid, e3, '阿托伐他汀钙片', '20mg', '20mg', '每晚1次', '调血脂', '2024-09-08', null, '服用中');
    med.run(pid, e5, '阿司匹林肠溶片', '100mg', '100mg', '每日1次', '抗血小板', '2024-09-08', null, '服用中');
    med.run(pid, e5, '氢氯噻嗪片', '25mg', '25mg', '每日1次', '利尿降压', '2024-09-08', '2026-06-20', '已停用');

    // ===== 授权项（默认全部开启）=====
    const authStmt = db.prepare(`INSERT INTO authorizations (patient_id,data_type,enabled) VALUES (?,?,1)`);
    DATA_TYPES.forEach(t => authStmt.run(pid, t.key));
    // 授权日志
    const logStmt = db.prepare(`INSERT INTO authorization_logs (patient_id,action,data_type,ip,created_at) VALUES (?,?,?,?,?)`);
    logStmt.run(pid, '签署协议', '《用户服务协议》《隐私政策》', '112.10.x.x', '2026-02-01 09:12:00');
    DATA_TYPES.forEach((t, i) => logStmt.run(pid, '开启授权', t.label, '112.10.x.x', `2026-02-01 09:12:${(10 + i).toString().padStart(2, '0')}`));

    console.log(`[seed] 已生成演示患者「张明」及其跨机构医疗数据 (patient_id=${pid})`);
  });

  tx();
}

module.exports = { seed, DATA_TYPES };
