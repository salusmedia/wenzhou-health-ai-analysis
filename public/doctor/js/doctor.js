'use strict';
/* HI 医生端 —— AI 云医院医护端：患者提交材料查看、解读把关、机构统一结算的服务绩效 */
let TOKEN = localStorage.getItem('wz_doctor_token') || '';
let DOCTOR = null;
let currentTab = 'home';
const stack = [];

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401) { logout(); throw new Error('登录失效'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}
const el = id => document.getElementById(id);
function esc(s){return (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function toast(msg){const t=el('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),1800);}
function loading(t='加载中…'){return `<div class="loading"><div class="spin"></div>${t}</div>`;}
function flagChip(f){if(f==='H')return '<span class="chip red">偏高</span>';if(f==='L')return '<span class="chip orange">偏低</span>';return '<span class="chip green">正常</span>';}
function setTitle(t,back){el('topbarTitle').textContent=t;el('topbarBack').classList.toggle('show',!!back);}
el('topbarBack').onclick=()=>{if(stack.length){stack.pop()();}else switchTab(currentTab);};
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>switchTab(t.dataset.tab));
function switchTab(tab){currentTab=tab;stack.length=0;document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));el('tabbar').style.display='flex';({home:viewHome,consults:viewConsults,patients:viewPatients,earnings:viewPerformance}[tab])();}
function pushView(fn){stack.push(fn);el('tabbar').style.display='none';}
function logout(){localStorage.removeItem('wz_doctor_token');localStorage.removeItem('wz_doctor');TOKEN='';DOCTOR=null;renderLogin();}

// ---------- 登录 ----------
function renderLogin(){
  el('tabbar').style.display='none';setTitle('HI 医生');
  el('screen').innerHTML=`<div class="login-wrap">
    <div class="logo">🩺</div><h2>HI 医生</h2><div class="sub">AI 云医院 · 医护端</div>
    <div class="field"><label>账号</label><input id="login" value="doctor" autocomplete="off"/></div>
    <div class="field"><label>密码</label><input id="pwd" type="password" value="123456"/></div>
    <button class="btn" onclick="doLogin()">登 录</button>
    <div class="muted" style="margin-top:14px">演示账号：doctor / doctor2，密码 123456</div>
    <div class="muted" style="margin-top:20px"><a href="/" style="color:#0f766e">← 返回健康温州（患者端）</a></div>
  </div>`;
}
async function doLogin(){
  try{
    const d=await api('/api/auth/doctor/login',{method:'POST',body:{login:el('login').value.trim(),password:el('pwd').value}});
    TOKEN=d.token;DOCTOR=d.doctor;localStorage.setItem('wz_doctor_token',TOKEN);localStorage.setItem('wz_doctor',JSON.stringify(DOCTOR));
    switchTab('home');
  }catch(e){toast(e.message);}
}

// ---------- 工作台 ----------
async function viewHome(){
  setTitle('工作台');el('tabbar').style.display='flex';
  const s=el('screen');s.innerHTML=loading();
  const d=await api('/api/doctor/dashboard');
  const doc=d.doctor;
  s.innerHTML=`
    <div class="hero">
      <div class="row"><div><div class="name">${esc(doc.name)} · ${esc(doc.title)}</div><div class="sub">${esc(doc.hospital)} · ${esc(doc.dept)}</div></div><div class="avatar">${esc(doc.avatar||doc.name[0])}</div></div>
    </div>
    <div class="stat-grid" style="margin-bottom:14px">
      <div class="stat-box"><b>${d.stats.pendingConsults}</b><span>待接诊 / 待解读</span></div>
      <div class="stat-box"><b>${d.stats.patients}</b><span>我的患者</span></div>
      <div class="stat-box"><b>${d.stats.reviews}</b><span>累计解读</span></div>
      <div class="stat-box"><b>${d.stats.points}</b><span>服务绩效点（机构结算）</span></div>
    </div>
    <div class="card">
      <h3><span class="bar"></span>服务闭环</h3>
      <div style="font-size:13.5px;line-height:1.9;color:#334155">
        <div>① <b>AI 初步解读</b>：患者先由 AI 完成健康数据整体解读与诊前准备</div>
        <div>② <b>患者提交材料</b>：患者把 AI 分析结果作为材料提交到您的医护端</div>
        <div>③ <b>分析结果医患同屏</b>：您看到与患者一致的分析（不自动进入病历）</div>
        <div>④ <b>解读把关 + 服务绩效</b>：您给出专业意见，服务量由机构统一结算为绩效/劳务补偿</div>
      </div>
    </div>
    <button class="btn" onclick="switchTab('consults')">🩺 查看待接诊与医患同屏</button>
    <div class="notice green" style="margin-top:14px">${esc(doc.intro||'')}</div>
    <div class="brand-foot">HI 医生 · 覆盖温州全体医护人员 · 医患同屏消除信息差</div>
  `;
}

// ---------- 接诊 / 医患同屏 ----------
async function viewConsults(){
  setTitle('接诊 / 医患同屏');el('tabbar').style.display='flex';
  const s=el('screen');s.innerHTML=loading();
  const list=await api('/api/doctor/consults');
  s.innerHTML=list.length?list.map(c=>`
    <div class="card" onclick="openConsult(${c.id})" style="cursor:pointer">
      <div class="row">
        <div class="row" style="gap:10px"><div class="pat-badge">${esc(c.patient_name[0])}</div>
          <div><div style="font-weight:600">${esc(c.patient_name)} · ${c.gender} · ${c.age}岁</div>
          <div class="ls">${c.analysis_title?'📎 '+esc(c.analysis_title):'（未附分析）'}</div></div>
        </div>
        <span class="chip ${c.status==='待接诊'?'orange':c.status==='已解读'?'green':''}">${c.status}</span>
      </div>
      ${c.patient_note?`<div class="ls" style="margin-top:8px">💬 患者留言：${esc(c.patient_note)}</div>`:''}
      <div class="ls" style="margin-top:6px">${c.created_at}</div>
    </div>`).join(''):'<div class="empty"><div class="e">🩺</div>暂无患者连通请求</div>';
}

async function openConsult(id){
  pushView(viewConsults);setTitle('医患同屏 · 解读',true);
  const s=el('screen');s.innerHTML=loading('加载患者 AI 分析结果…');
  const d=await api('/api/doctor/consults/'+id);
  const p=d.patient,a=d.analysis;
  let analysisHtml='';
  if(a){
    const c=a.content;
    analysisHtml=`<div class="samescreen">
      <div class="same-screen-badge">🖥️ 医患同屏 · 患者提交的 AI 材料（不自动进入病历）</div>
      <h3 style="margin:8px 0 6px">${esc(a.title)}</h3>
      ${c.narrative?`<div style="font-size:13.5px;line-height:1.7;white-space:pre-wrap">${esc(c.narrative)}</div>`:''}
      ${renderAnalysisBody(c)}
      <div class="muted" style="margin-top:8px">分析引擎：${esc(a.model)}</div>
    </div>`;
  }
  s.innerHTML=`
    <div class="card">
      <div class="row"><div class="row" style="gap:10px"><div class="pat-badge">${esc(p.name[0])}</div>
        <div><div style="font-weight:700;font-size:16px">${esc(p.name)}</div><div class="ls">${p.gender} · ${p.age}岁 · ${p.height}cm/${p.weight}kg · ${p.blood_type||'-'}型</div></div></div>
        <a href="tel:${p.phone}" class="chip">📞 联系</a>
      </div>
    </div>
    <div class="card"><h3><span class="bar"></span>疾病与病史</h3>${d.conditions.map(x=>`<div class="li"><div><div class="lt">${esc(x.name)}</div><div class="ls">${x.category} · 自${x.since}</div></div><span class="chip ${x.status==='需关注'?'orange':'green'}">${x.status}</span></div>`).join('')}</div>
    <div class="card"><h3><span class="bar"></span>当前用药</h3>${d.meds.map(m=>`<div class="li"><div class="lt" style="font-weight:400;font-size:13px">💊 ${esc(m.name)} ${esc(m.dosage)} ${esc(m.frequency)}（${esc(m.purpose)}）</div></div>`).join('')}</div>
    <div class="card"><h3><span class="bar"></span>异常检验（授权范围内）</h3>${d.abnormal.slice(0,10).map(l=>`<div class="li"><div><div class="lt">${esc(l.item_name)}</div><div class="ls">${l.hospital} · ${l.report_date}</div></div><div style="text-align:right"><b>${esc(l.value)}${esc(l.unit)}</b> ${flagChip(l.flag)}</div></div>`).join('')}</div>
    ${analysisHtml}
    ${d.reviews.length?`<div class="card"><h3><span class="bar"></span>历史解读意见</h3>${d.reviews.map(r=>`<div class="notice green" style="margin-bottom:8px"><b>解读：</b>${esc(r.comment)}${r.advice?'<br><b>建议：</b>'+esc(r.advice):''}<div class="ls" style="margin-top:4px">${r.created_at}</div></div>`).join('')}</div>`:''}
    <div class="card review-box"><h3><span class="bar"></span>解读把关 · 专业意见</h3>
      <textarea id="rvComment" placeholder="对 AI 关键结论的解读、确认或修正…"></textarea>
      <textarea id="rvAdvice" placeholder="给患者的随访 / 用药 / 复查建议…" style="min-height:56px"></textarea>
      <div class="btn-row">
        ${d.consult.status==='待接诊'?`<button class="btn ghost" onclick="acceptConsult(${id})">接诊</button>`:''}
        <button class="btn" onclick="submitReview(${id})">提交解读把关</button>
        <button class="btn ghost" onclick="citeIntoRecord(${id})">✍️ 手动确认引用进病历</button>
      </div>
      <div class="muted" style="margin-top:8px">解读服务量由所属机构统一结算为绩效/劳务补偿，与药品、检查、处方、转诊及患者付费金额均无关。AI 内容不会自动进入病历，需您手动确认引用。</div>
    </div>
  `;
}

function renderAnalysisBody(c){
  if(c.kind==='report'){
    return `<div style="font-size:13px;margin-top:8px"><b>综合评分：</b>${c.score} · <b>综述：</b>${esc((c.overview||'').slice(0,120))}…</div>
      <div style="margin-top:6px"><b style="font-size:13px">分级建议：</b>${(c.advice||[]).map(a=>`<div class="ls">· [${a.level}] ${esc(a.text)}</div>`).join('')}</div>`;
  }
  if(c.kind==='second_opinion'){
    return `<div style="font-size:13px;margin-top:8px"><b>横向印证：</b>${(c.crossCheck||[]).map(x=>`<div class="ls">· ${esc(x)}</div>`).join('')}<b>查漏补缺：</b>${(c.gaps||[]).map(x=>`<div class="ls">· ${esc(x)}</div>`).join('')}</div>`;
  }
  if(c.kind==='prep'){
    return `<div style="font-size:13px;margin-top:8px"><b>提问清单：</b>${(c.questions||[]).map(x=>`<div class="ls">· ${esc(x)}</div>`).join('')}</div>`;
  }
  return '';
}

async function acceptConsult(id){try{await api('/api/doctor/consults/'+id+'/accept',{method:'POST'});toast('已接诊');}catch(e){toast(e.message);}}
async function submitReview(id){
  const comment=el('rvComment').value.trim(),advice=el('rvAdvice').value.trim();
  if(!comment){toast('请填写解读意见');return;}
  try{
    const r=await api('/api/doctor/consults/'+id+'/review',{method:'POST',body:{comment,advice}});
    toast(`解读已提交，记 ${r.service.points} 个服务绩效点（机构统一结算）`);
    setTimeout(()=>{stack.pop();viewConsults();},900);
  }catch(e){toast(e.message);}
}
async function citeIntoRecord(id){
  if(!confirm('确认将本次 AI 解读作为参考手动引用进正式医疗意见？系统将保留 AI 来源、版本与确认记录。'))return;
  try{const r=await api('/api/doctor/consults/'+id+'/cite',{method:'POST'});toast(r.message);}
  catch(e){toast(e.message);}
}

// ---------- 我的患者 ----------
async function viewPatients(){
  setTitle('我的患者');el('tabbar').style.display='flex';
  const s=el('screen');s.innerHTML=loading();
  const list=await api('/api/doctor/patients');
  s.innerHTML=`<div class="card"><h3><span class="bar"></span>签约 / 主治患者（${list.length}）</h3>${list.map(p=>`<div class="li"><div class="row" style="gap:10px;width:100%"><div class="pat-badge">${esc(p.name[0])}</div><div style="flex:1"><div class="lt">${esc(p.name)} · ${p.gender} · ${p.age}岁</div><div class="ls">${esc(p.relation)} · ${esc(p.phone)}</div></div><a href="tel:${p.phone}" class="chip">📞</a></div></div>`).join('')}</div>
  <div class="notice green">HI 医生直连拓展医患连接与随访服务的新场景，患者带着结构化 AI 摘要就诊，沟通效率显著提升。</div>`;
}

// ---------- 服务绩效（机构统一结算，取代个人分成）----------
async function viewPerformance(){
  setTitle('服务绩效 · 机构结算');el('tabbar').style.display='flex';
  const s=el('screen');s.innerHTML=loading();
  const d=await api('/api/doctor/performance');
  s.innerHTML=`
    <div class="stat-grid" style="margin-bottom:14px">
      <div class="stat-box"><b>${d.totalPoints}</b><span>累计服务绩效点</span></div>
      <div class="stat-box"><b>${d.pendingPoints}</b><span>待机构结算</span></div>
    </div>
    <div class="card"><h3><span class="bar"></span>服务绩效明细</h3>${d.logs.length?d.logs.map(o=>`<div class="li"><div><div class="lt">${esc(o.service_type)} · ${esc(o.patient_name)}</div><div class="ls">${o.created_at} · 结算机构：${esc(o.settle_org)}</div></div><div style="text-align:right"><b style="color:#0f766e">+${o.workload_points} 点</b><div class="ls">${esc(o.status)}</div></div></div>`).join(''):'<div class="muted">暂无服务绩效记录。为患者提交解读把关后将记录服务量。</div>'}</div>
    <div class="notice">💡 ${esc(d.note)}</div>
  `;
}

// ---------- 启动 ----------
(function init(){
  if(TOKEN){try{DOCTOR=JSON.parse(localStorage.getItem('wz_doctor')||'null');}catch(e){}
    if(DOCTOR){switchTab('home');return;}}
  renderLogin();
})();
