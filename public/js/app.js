'use strict';
/* 健康温州 · 个人医疗健康数据分析服务 —— 患者端 */
const API = '';
let TOKEN = localStorage.getItem('wz_patient_token') || '';
let PATIENT = null;
let currentTab = 'records';
const stack = []; // 子页面栈

// ---------- 请求封装 ----------
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const res = await fetch(API + path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401) { logout(); throw new Error('登录失效'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

// ---------- 工具 ----------
const $ = s => document.querySelector(s);
const el = id => document.getElementById(id);
function esc(s){return (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function toast(msg){const t=el('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),1800);}
function sheet(html){const m=el('modalMask');m.innerHTML=`<div class="sheet">${html}</div>`;m.classList.add('show');m.onclick=e=>{if(e.target===m)closeSheet();};}
function closeSheet(){el('modalMask').classList.remove('show');el('modalMask').innerHTML='';}
function loading(text='正在分析…'){return `<div class="loading"><div class="spin"></div>${text}</div>`;}
function flagChip(f){if(f==='H')return '<span class="chip red">偏高</span>';if(f==='L')return '<span class="chip orange">偏低</span>';return '<span class="chip green">正常</span>';}

// ---------- 登录 ----------
async function ensureLogin() {
  if (TOKEN) { try { PATIENT = JSON.parse(localStorage.getItem('wz_patient')||'null'); if(PATIENT) return true; } catch(e){} }
  const d = await api('/api/auth/patient/login', { method: 'POST', body: { open_id: 'demo-patient-001' } });
  TOKEN = d.token; PATIENT = d.patient;
  localStorage.setItem('wz_patient_token', TOKEN);
  localStorage.setItem('wz_patient', JSON.stringify(PATIENT));
  return true;
}
function logout(){localStorage.removeItem('wz_patient_token');localStorage.removeItem('wz_patient');TOKEN='';location.reload();}

// ---------- 导航 ----------
function setTitle(t, back){el('topbarTitle').textContent=t;const b=el('topbarBack');b.classList.toggle('show',!!back);}
el('topbarBack').onclick = () => { if(stack.length){const prev=stack.pop();prev();}else switchTab(currentTab); };

document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>switchTab(t.dataset.tab));
function switchTab(tab){
  currentTab=tab;stack.length=0;
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));
  el('tabbar').style.display='flex';
  ({records:viewRecords,assistant:viewAssistant,reports:viewReports,mine:viewMine}[tab])();
}
function pushView(renderFn){stack.push(()=>renderFn());el('tabbar').style.display='none';}

// ================= 健康档案 =================
async function viewRecords(){
  setTitle('健康温州');
  const s=el('screen');s.innerHTML=loading('加载健康档案…');
  const p=await api('/api/records/profile');
  const P=p.patient;
  s.innerHTML=`
    <div class="hero">
      <div class="row">
        <div><div class="name">${esc(P.name)}</div><div class="sub">${P.gender} · ${P.age}岁 · ${P.height}cm / ${P.weight}kg · ${P.blood_type||'-'}型</div></div>
        <div class="avatar">${esc(P.avatar||P.name[0])}</div>
      </div>
      <div class="stats">
        <div class="stat"><b>${p.counts.encounters}</b><span>就诊记录</span></div>
        <div class="stat"><b>${p.counts.labs}</b><span>检验指标</span></div>
        <div class="stat"><b>${p.counts.imaging}</b><span>影像报告</span></div>
        <div class="stat"><b>${p.counts.medications}</b><span>在服药物</span></div>
      </div>
    </div>

    <div class="grid4" style="margin-bottom:14px">
      <div class="entry" onclick="openTimeline()"><div class="ico">🕒</div><div class="lb">就医时间轴</div></div>
      <div class="entry" onclick="openLabs()"><div class="ico">🧪</div><div class="lb">检验报告</div></div>
      <div class="entry" onclick="openImaging()"><div class="ico">🩻</div><div class="lb">影像报告</div></div>
      <div class="entry" onclick="openMeds()"><div class="ico">💊</div><div class="lb">用药一览</div></div>
    </div>

    <div class="card">
      <h3><span class="bar"></span>慢病专区</h3>
      ${p.chronic.map(c=>`<div class="chronic ${c.status==='控制中'||c.status==='稳定'?'ok':''}">
        <div class="row"><span class="t">${esc(c.name)}</span><span class="chip ${c.status==='需关注'?'orange':'green'}">${c.status}</span></div>
        <div class="muted" style="margin-top:4px">确诊于 ${c.since}${c.note?' · '+esc(c.note):''}</div>
      </div>`).join('')||'<div class="muted">暂无慢病记录</div>'}
      <button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="openTrends()">📈 查看关键指标趋势</button>
    </div>

    <div class="card">
      <h3><span class="bar"></span>既往史 / 过敏史</h3>
      ${p.history.map(h=>`<div class="li"><div><div class="lt">${esc(h.name)}</div><div class="ls">${h.category}${h.note?' · '+esc(h.note):''}</div></div><span class="chip gray">${h.status}</span></div>`).join('')||'<div class="muted">暂无</div>'}
    </div>

    <div class="notice blue">🔒 以上数据来自「温州医疗数据高铁」，仅在您授权范围内聚合展示。可在「我的-数据授权管理」随时调整。</div>
    <div class="brand-foot">健康温州 · AI 智慧健康 · 数据高铁驱动</div>
  `;
}

async function openTimeline(){
  pushView(viewRecords);setTitle('就医时间轴',true);
  const s=el('screen');s.innerHTML=loading();
  const list=await api('/api/records/timeline');
  s.innerHTML=`<div class="card"><h3><span class="bar"></span>跨机构就医时间轴</h3><div class="timeline">${
    list.map(e=>`<div class="tl-item ${e.type==='住院'?'inp':e.type==='体检'?'phy':''}">
      <div class="tl-date">${e.visit_date} · ${e.type}</div>
      <div class="tl-card" onclick="openEncounter(${e.id})">
        <div class="row"><span class="h">${esc(e.hospital)}</span><span class="chip">${esc(e.dept)}</span></div>
        <div class="muted" style="margin-top:3px">主诉：${esc(e.chief_complaint)}</div>
        <div style="margin-top:4px;font-size:13px">诊断：${esc(e.diagnosis)}</div>
      </div></div>`).join('')
  }</div></div>`;
}
async function openEncounter(id){
  pushView(openTimeline);setTitle('就诊详情',true);
  const s=el('screen');s.innerHTML=loading();
  const e=await api('/api/records/encounter/'+id);
  s.innerHTML=`
    <div class="card">
      <h3><span class="bar"></span>${esc(e.hospital)}</h3>
      <div class="kv"><span class="k">就诊类型</span><span>${e.type} · ${esc(e.dept)}</span></div>
      <div class="kv"><span class="k">日期 / 医生</span><span>${e.visit_date} · ${esc(e.doctor_name)}</span></div>
      <div class="kv"><span class="k">主诉</span><span>${esc(e.chief_complaint)}</span></div>
      <div class="kv"><span class="k">诊断</span><span>${esc(e.diagnosis)}</span></div>
      <div style="margin-top:8px" class="muted">处置：${esc(e.summary)}</div>
    </div>
    ${e.labs.length?`<div class="card"><h3><span class="bar"></span>本次检验</h3>${e.labs.map(labRow).join('')}</div>`:''}
    ${e.imaging.length?`<div class="card"><h3><span class="bar"></span>本次影像</h3>${e.imaging.map(imgRow).join('')}</div>`:''}
    ${e.medications.length?`<div class="card"><h3><span class="bar"></span>本次用药</h3>${e.medications.map(medRow).join('')}</div>`:''}
  `;
}
function labRow(l){return `<div class="li"><div><div class="lt">${esc(l.item_name)}</div><div class="ls">${l.category} · ${l.hospital} · ${l.report_date}</div></div><div style="text-align:right"><div style="font-weight:600">${esc(l.value)} ${esc(l.unit)}</div><div class="ls">参考 ${esc(l.ref_range)} ${flagChip(l.flag)}</div></div></div>`;}
function imgRow(i){return `<div class="li"><div><div class="lt">${i.modality} · ${esc(i.body_part)}</div><div class="ls">${i.hospital} · ${i.report_date}</div><div class="ls" style="color:#334155;margin-top:3px">${esc(i.impression)}</div></div></div>`;}
function medRow(m){return `<div class="li"><div><div class="lt">${esc(m.name)} <span class="ls">${esc(m.spec)}</span></div><div class="ls">${m.dosage} · ${m.frequency} · ${m.purpose}</div></div><span class="chip ${m.status==='服用中'?'green':'gray'}">${m.status}</span></div>`;}

async function openLabs(){
  pushView(viewRecords);setTitle('检验报告',true);
  const s=el('screen');s.innerHTML=loading();
  const rows=await api('/api/records/labs');
  const byCat={};rows.forEach(r=>{(byCat[r.category]=byCat[r.category]||[]).push(r);});
  s.innerHTML=Object.entries(byCat).map(([cat,items])=>`<div class="card"><h3><span class="bar"></span>${cat}</h3>${items.map(labRow).join('')}</div>`).join('');
}
async function openImaging(){
  pushView(viewRecords);setTitle('影像报告',true);
  const s=el('screen');s.innerHTML=loading();
  const rows=await api('/api/records/imaging');
  s.innerHTML=`<div class="card"><h3><span class="bar"></span>医学影像报告</h3>${rows.map(i=>`<div class="li"><div style="width:100%"><div class="row"><span class="lt">${i.modality} · ${esc(i.body_part)}</span><span class="chip">${i.report_date}</span></div><div class="ls" style="margin-top:4px">${esc(i.hospital)}</div><div style="font-size:13px;margin-top:6px"><b>影像所见：</b>${esc(i.findings)}</div><div style="font-size:13px;margin-top:4px;color:var(--blue-dark)"><b>诊断意见：</b>${esc(i.impression)}</div></div></div>`).join('')}</div>`;
}
async function openMeds(){
  pushView(viewRecords);setTitle('用药一览',true);
  const s=el('screen');s.innerHTML=loading();
  const rows=await api('/api/records/medications');
  const cur=rows.filter(m=>m.status==='服用中'),old=rows.filter(m=>m.status!=='服用中');
  s.innerHTML=`<div class="card"><h3><span class="bar"></span>当前用药（${cur.length}）</h3>${cur.map(medRow).join('')||'<div class="muted">无</div>'}</div>
    <div class="card"><h3><span class="bar"></span>历史用药</h3>${old.map(medRow).join('')||'<div class="muted">无</div>'}</div>
    <div class="notice">💊 多药共存请关注相互作用，用药调整务必先咨询医生，切勿自行增减。</div>`;
}
async function openTrends(){
  pushView(viewRecords);setTitle('关键指标趋势',true);
  const s=el('screen');s.innerHTML=loading();
  const trends=await api('/api/records/trends');
  s.innerHTML=trends.map(t=>`<div class="card"><h3><span class="bar"></span>${esc(t.name)}</h3><div class="muted" style="margin-bottom:6px">单位 ${t.unit} · 参考 ${t.ref}</div><div class="trend">${sparkline(t.points)}</div><div class="row" style="margin-top:6px">${t.points.map(p=>`<div style="text-align:center;flex:1"><div style="font-weight:600;color:${p.flag&&p.flag!=='N'?'var(--red)':'var(--ink)'}">${p.value}</div><div class="ls">${p.date.slice(2,7)}</div></div>`).join('')}</div></div>`).join('');
}
function sparkline(points){
  if(!points.length)return '';
  const w=300,h=90,pad=8;const vals=points.map(p=>p.value);
  const mn=Math.min(...vals),mx=Math.max(...vals),rng=mx-mn||1;
  const xs=points.map((p,i)=>pad+i*((w-2*pad)/Math.max(1,points.length-1)));
  const ys=points.map(p=>h-pad-((p.value-mn)/rng)*(h-2*pad));
  const path=xs.map((x,i)=>`${i?'L':'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const dots=points.map((p,i)=>`<circle cx="${xs[i].toFixed(1)}" cy="${ys[i].toFixed(1)}" r="4" fill="${p.flag&&p.flag!=='N'?'#cf1322':'#096DD9'}"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}"><path d="${path}" fill="none" stroke="#096DD9" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${dots}</svg>`;
}

// ================= AI 健康助理 =================
let chatHistory=[];
async function viewAssistant(){
  setTitle('AI 健康助理');
  const s=el('screen');
  s.innerHTML=`<div class="chat-wrap">
    <div class="notice blue" style="margin-bottom:8px">💡 我会基于您授权的全市诊疗数据作答，并标注数据来源。仅供参考，请遵医嘱。</div>
    <div class="chat-body" id="chatBody"></div>
    <div class="quick" id="quick">
      ${['我的血压控制得怎么样？','血糖和糖化达标吗？','血脂需要调整用药吗？','这次就诊我该问医生什么？','帮我看看有没有用药风险'].map(q=>`<div class="q" onclick="quickAsk('${q}')">${q}</div>`).join('')}
    </div>
    <div class="chat-input">
      <textarea id="chatInput" rows="1" placeholder="问问我的健康数据…"></textarea>
      <button class="btn sm" style="padding:10px 16px" onclick="sendChat()">发送</button>
    </div>
  </div>`;
  const ta=el('chatInput');ta.oninput=()=>{ta.style.height='auto';ta.style.height=Math.min(80,ta.scrollHeight)+'px';};
  ta.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}};
  const hist=await api('/api/ai/chat/history?session_id=default');
  chatHistory=hist;
  if(!hist.length){pushMsg('ai','您好，我是您的 AI 健康数据解读助手。我可以帮您解读检验指标、梳理病情、准备就诊问题；涉及用药/诊断/复诊等会引导您向医生确认。试试下方的快捷问题吧～',[]);}
  else hist.forEach(m=>pushMsg(m.role==='user'?'me':'ai',m.content,m.sources));
  scrollChat();
}
function pushMsg(who,text,sources){
  const b=el('chatBody');if(!b)return;
  const src=(sources&&sources.length)?`<div class="sources">📎 数据来源：${sources.map(s=>`<span class="s">${esc(s)}</span>`).join('')}</div>`:'';
  b.insertAdjacentHTML('beforeend',`<div class="msg ${who}"><div class="ava">${who==='ai'?'🤖':'我'}</div><div class="bubble">${esc(text)}${src}</div></div>`);
  scrollChat();
}
function scrollChat(){const b=el('chatBody');if(b)b.scrollTop=b.scrollHeight;}
function quickAsk(q){el('chatInput').value=q;sendChat();}
async function sendChat(){
  const ta=el('chatInput');const msg=ta.value.trim();if(!msg)return;
  ta.value='';ta.style.height='auto';
  pushMsg('me',msg,[]);
  const b=el('chatBody');
  b.insertAdjacentHTML('beforeend',`<div class="msg ai" id="typing"><div class="ava">🤖</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>`);scrollChat();
  try{
    const r=await api('/api/ai/chat',{method:'POST',body:{message:msg,session_id:'default'}});
    el('typing')?.remove();
    pushMsg('ai',r.content,r.sources);
  }catch(e){el('typing')?.remove();pushMsg('ai','抱歉，分析暂时不可用：'+e.message,[]);}
}

// ================= 健康报告 =================
async function viewReports(){
  setTitle('AI 诊前准备与数据解读');
  const s=el('screen');
  s.innerHTML=`
    <div class="card">
      <h3><span class="bar"></span>AI 数据解读（只做解读与诊前准备，不做诊疗）</h3>
      <div class="grid4" style="grid-template-columns:1fr 1fr;gap:10px">
        <div class="entry" onclick="genAnalysis('report')"><div class="ico">📊</div><div class="lb">健康数据解读</div></div>
        <div class="entry" onclick="genAnalysis('prep')"><div class="ico">📝</div><div class="lb">诊前准备 <span class="badge-star">★</span></div></div>
        <div class="entry" onclick="genAnalysis('second_opinion')"><div class="ico">🔍</div><div class="lb">参考视角 <span class="ls">医生确认前</span></div></div>
        <div class="entry" onclick="viewReports()"><div class="ico">🕘</div><div class="lb">历史记录</div></div>
      </div>
    </div>
    <div class="card" id="historyCard"><h3><span class="bar"></span>我的分析记录</h3><div id="analysisList">${loading('加载…')}</div></div>
    <div class="notice">⚕️ 所有 AI 分析仅为健康科普与辅助参考，不构成诊断、治疗或用药建议。涉及用药、复诊、治疗选择时只生成"需向医生确认的问题"。请以执业医师面诊意见为准。</div>
  `;
  const list=await api('/api/ai/analyses');
  el('analysisList').innerHTML=list.length?list.map(a=>`<div class="li" onclick="openAnalysis(${a.id})"><div><div class="lt">${esc(a.title)}</div><div class="ls">${a.created_at} · ${esc(a.model)}</div></div><div style="text-align:right">${a.score?`<span class="chip green">${a.score}分</span>`:''}${a.shared_to_doctor?'<span class="chip">已提交医生</span>':''}<div class="ls">查看 ›</div></div></div>`).join(''):'<div class="muted">还没有分析记录，点击上方生成第一份报告。</div>';
}

async function genAnalysis(type){
  const names={report:'健康数据解读报告',prep:'诊前准备清单',second_opinion:'参考视角（医生确认前）'};
  pushView(viewReports);setTitle(names[type],true);
  const s=el('screen');
  s.innerHTML=loading(`AI 正在基于您授权的数据，生成${names[type]}…`);
  try{
    const ep={report:'/api/ai/report',prep:'/api/ai/prep',second_opinion:'/api/ai/second-opinion'}[type];
    const r=await api(ep,{method:'POST'});
    renderAnalysis(r.data,r.narrative,r.model,r.id);
  }catch(e){
    const hint=e.message&&e.message.includes('未授权用途')?`${esc(e.message)}<br><button class="btn" style="margin-top:14px" onclick="openAuth()">前往授权中心</button>`:esc(e.message);
    s.innerHTML=`<div class="empty"><div class="e">⚠️</div>${hint}</div>`;
  }
}
async function openAnalysis(id){
  pushView(viewReports);setTitle('分析详情',true);
  const s=el('screen');s.innerHTML=loading();
  const a=await api('/api/ai/analyses/'+id);
  renderAnalysis(a.content,a.content.narrative,a.model,a.id);
}

function renderAnalysis(data,narrative,model,id){
  const s=el('screen');
  if(!data){s.innerHTML='<div class="empty">暂无内容</div>';return;}
  let html='';
  const narrativeBlock=narrative?`<div class="card"><h3><span class="bar"></span>AI 综述（${esc(model)}）</h3><div style="font-size:14px;line-height:1.7;white-space:pre-wrap">${esc(narrative)}</div></div>`:'';

  if(data.kind==='report'){
    const color=data.score>=85?'#389E0D':data.score>=75?'#096DD9':'#D46B08';
    html=`
    <div class="card" style="text-align:center">
      <div class="score-ring" style="background:conic-gradient(${color} ${data.score*3.6}deg,#eef2f7 0deg)">
        <div style="width:78px;height:78px;border-radius:50%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <b style="font-size:26px;color:${color}">${data.score}</b><span class="ls">综合评分</span></div>
      </div>
      <div class="muted" style="margin-top:10px">${esc(data.title)} · ${esc(model)}</div>
    </div>
    ${narrativeBlock}
    <div class="card"><h3><span class="bar"></span>健康综述</h3><div style="font-size:14px;line-height:1.7">${esc(data.overview)}</div></div>
    <div class="card"><h3><span class="bar"></span>关键发现</h3>${data.keyFindings.map(f=>`<div class="finding"><span class="dot ${f.level}"></span><div><b>${esc(f.title)}</b><div class="muted">${esc(f.text)}</div></div></div>`).join('')}</div>
    ${data.trends&&data.trends.length?`<div class="card"><h3><span class="bar"></span>关键指标趋势</h3>${data.trends.map(t=>`<div style="margin-bottom:10px"><div class="row"><b style="font-size:13px">${esc(t.name)}</b><span class="ls">${t.ref} ${t.unit}</span></div><div class="trend">${sparkline(t.points)}</div></div>`).join('')}</div>`:''}
    <div class="card"><h3><span class="bar"></span>近期就诊摘要</h3>${data.encounterSummary.map(e=>`<div class="li"><div><div class="lt">${esc(e.diagnosis)}</div><div class="ls">${e.date} · ${esc(e.hospital)} · ${esc(e.dept)}</div></div></div>`).join('')}</div>
    <div class="card"><h3><span class="bar"></span>用药管控</h3>${data.medControl.map(m=>`<div class="li"><div class="lt" style="font-weight:400;font-size:13px">💊 ${esc(m)}</div></div>`).join('')}
      ${data.medAlerts.map(a=>`<div class="notice" style="margin-top:8px">⚠️ ${esc(a)}</div>`).join('')}</div>
    <div class="card"><h3><span class="bar"></span>分级随诊建议</h3>${data.advice.map(a=>`<div class="adv"><span class="chip ${a.level==='优先'?'red':a.level==='重要'?'orange':'blue'}">${a.level}</span><div>${esc(a.text)}</div></div>`).join('')}</div>
    `;
  } else if(data.kind==='second_opinion'){
    html=`${narrativeBlock}
    <div class="notice">${esc(data.disclaimer)}</div>
    <div class="card"><h3><span class="bar"></span>横向印证</h3>${data.crossCheck.map(x=>`<div class="adv"><span class="dot warn"></span><div>${esc(x)}</div></div>`).join('')}</div>
    <div class="card"><h3><span class="bar"></span>查漏补缺</h3>${data.gaps.map(x=>`<div class="adv"><span class="dot ok"></span><div>${esc(x)}</div></div>`).join('')}</div>
    <div class="card"><h3><span class="bar"></span>辅助决策 · 可与医生讨论</h3>${data.decisionSupport.map((x,i)=>`<div class="q-item"><div class="num">${i+1}</div><div>${esc(x)}</div></div>`).join('')}</div>`;
  } else if(data.kind==='prep'){
    const v=data.visitSummary;
    html=`${narrativeBlock}
    <div class="card"><h3><span class="bar"></span>就诊摘要（一页纸病情速览）</h3>
      <div class="kv"><span class="k">主诉</span><span style="max-width:65%;text-align:right">${esc(v.chiefComplaint)}</span></div>
      <div style="margin-top:8px"><b style="font-size:13px">既往史</b>${v.pastHistory.map(x=>`<div class="ls">· ${esc(x)}</div>`).join('')}</div>
      <div style="margin-top:8px"><b style="font-size:13px">当前用药</b>${v.currentMeds.map(x=>`<div class="ls">· ${esc(x)}</div>`).join('')}</div>
      <div style="margin-top:8px"><b style="font-size:13px">近期异常指标</b>${v.recentAbnormal.map(x=>`<div class="ls">· ${esc(x)}</div>`).join('')}</div>
      <div style="margin-top:8px"><b style="font-size:13px">关键检查</b>${v.keyImaging.map(x=>`<div class="ls">· ${esc(x)}</div>`).join('')}</div>
    </div>
    <div class="card"><h3><span class="bar"></span>智能提问清单 <span class="badge-star">★ 带进诊室</span></h3>${data.questions.map((q,i)=>`<div class="q-item"><div class="num">${i+1}</div><div>${esc(q)}</div></div>`).join('')}</div>`;
  }
  html+=templateBlock(data,model,id);
  html+=`<div class="notice green">${esc(data.safety||'仅供参考，请遵医嘱。')}</div>
    <div class="btn-row" style="margin:14px 0">
      <button class="btn green" onclick="shareToDoctor(${id})">📤 提交给医生确认（同屏）</button>
      <button class="btn ghost" onclick="deleteReport(${id})">🗑️ 删除报告</button>
    </div>`;
  s.innerHTML=html;
}

// 统一输出模板：数据来源 / 生成时间 / 适用边界 / 下一步（整合版 E1）+ 数据完整性 + 溯源
function templateBlock(data,model,id){
  const t=data.template||{};
  const dq=data.dataQuality||{};
  const low=dq.low?`<div class="notice" style="margin-top:8px">⚠️ 本次数据完整度约 ${Math.round((dq.completeness||0)*100)}%，${esc((dq.missing||[]).join('；'))}。结论可能不完整，仅供参考。</div>`:'';
  const src=(data.sources||[]).slice(0,12).map(sr=>`<div class="ls">· [${esc(sr.id)}] ${esc(sr.summary)}</div>`).join('');
  const more=(data.sources||[]).length>12?`<div class="ls">…共 ${data.sources.length} 条来源</div>`:'';
  return `<div class="card" style="background:#f8fafc">
    <h3><span class="bar"></span>数据来源与边界说明</h3>
    <div class="kv"><span class="k">生成时间</span><span>${esc(t.generatedAt||'-')}</span></div>
    <div class="kv"><span class="k">分析引擎</span><span>${esc(model||'')}</span></div>
    <div class="kv"><span class="k">纳入数据</span><span style="max-width:65%;text-align:right">${(data.usedTypes||[]).join('、')||'-'}</span></div>
    <div style="margin-top:8px;font-size:13px"><b>适用边界：</b>${esc(t.boundary||'仅解读与诊前准备，不做诊疗决策。')}</div>
    <div style="margin-top:4px;font-size:13px"><b>下一步：</b>${esc(t.nextStep||'如涉及诊疗，请提交医生确认或就诊。')}</div>
    ${low}
    <details style="margin-top:8px"><summary class="ls" style="cursor:pointer">📎 展开数据来源（可溯源）</summary>${src}${more}</details>
    <button class="btn ghost sm" style="margin-top:10px" onclick="viewTrace(${id})">🔍 查看全链路溯源（模型/提示词/知识库版本）</button>
  </div>`;
}
async function deleteReport(id){
  if(!confirm('确定删除这份报告？删除后将同时终止已连通医生对该报告的查看。'))return;
  try{await api('/api/ai/analyses/'+id,{method:'DELETE'});toast('已删除报告并终止医生查看');switchTab('reports');}
  catch(e){toast(e.message);}
}
async function viewTrace(id){
  try{
    const t=await api('/api/audit/trace/'+id);
    const hits=(t.guardrail_hits||[]).length?t.guardrail_hits.map(h=>`${h.type||h.category||'命中'}`).join('、'):'无';
    sheet(`<h3>🔍 全链路溯源</h3>
      <div class="kv"><span class="k">模型版本</span><span>${esc(t.versions.model||'-')}</span></div>
      <div class="kv"><span class="k">提示词版本</span><span>${esc(t.versions.prompt||'-')}</span></div>
      <div class="kv"><span class="k">知识库版本</span><span>${esc(t.versions.kb||'-')}</span></div>
      <div class="kv"><span class="k">检索片段</span><span style="max-width:60%;text-align:right">${(t.retrieved_ids||[]).join('、')||'-'}</span></div>
      <div class="kv"><span class="k">护栏命中</span><span>${esc(hits)}</span></div>
      <div style="margin-top:10px"><b class="ls">最近授权/调用</b>${(t.recent_authorizations||[]).map(a=>`<div class="ls">· ${a.created_at} ${esc(a.action)}（${esc(a.data_type)}）</div>`).join('')}</div>
      <button class="btn" style="margin-top:14px" onclick="closeSheet()">关闭</button>`);
  }catch(e){toast(e.message);}
}

async function shareToDoctor(analysisId){
  const docs=await api('/api/connect/my-doctors');
  sheet(`<h3>提交给医生确认</h3><div class="muted" style="margin-bottom:12px">您的 AI 分析将作为"患者提交材料"呈现在医生端（医患同屏），供医生解读把关。它不会自动写入病历，医生引用需手动确认。</div>
    ${docs.map(d=>`<div class="li" onclick="doConnect(${d.id},${analysisId})"><div><div class="lt">${esc(d.name)} · ${esc(d.title)}</div><div class="ls">${esc(d.hospital)} · ${esc(d.dept)} · ${esc(d.relation)}</div></div><span class="chip">连通 ›</span></div>`).join('')}`);
}
async function doConnect(doctorId,analysisId){
  closeSheet();
  const note=prompt('给医生的留言（选填）：','请帮我看看这份 AI 分析，谢谢')||'';
  try{
    const r=await api('/api/connect/connect',{method:'POST',body:{doctor_id:doctorId,analysis_id:analysisId,note}});
    toast(`已提交给 ${r.doctor.name}（作为患者提交材料）`);
  }catch(e){toast(e.message);}
}

// ================= 我的 =================
async function viewMine(){
  setTitle('我的');
  const s=el('screen');
  s.innerHTML=`
    <div class="hero" style="background:linear-gradient(135deg,#334155,#475569)">
      <div class="row"><div><div class="name">${esc(PATIENT.name)}</div><div class="sub">健康温州 · 实名认证用户</div></div><div class="avatar">${esc(PATIENT.avatar||PATIENT.name[0])}</div></div>
    </div>
    <div class="card">
      <div class="li" onclick="openAuth()"><div><div class="lt">🔐 授权与隐私中心</div><div class="ls">四维授权（用途/类型/对象/期限）· 记录留存 · 随时撤回</div></div><span>›</span></div>
      <div class="li" onclick="openMyDoctors()"><div><div class="lt">👨‍⚕️ 我的医生</div><div class="ls">签约/主治医生，提交材料给医生确认</div></div><span>›</span></div>
      <div class="li" onclick="openMyConsults()"><div><div class="lt">💬 医生确认记录</div><div class="ls">医患同屏与医生把关意见</div></div><span>›</span></div>
      <div class="li" onclick="openBilling()"><div><div class="lt">💳 服务与收费</div><div class="ls">基础免费 · 增值自愿 · 公益减免</div></div><span>›</span></div>
    </div>
    <div class="card">
      <div class="li" onclick="openAgreement()"><div class="lt">📃 用户服务协议 / 隐私政策</div><span>›</span></div>
      <div class="li" onclick="openDisclaimer()"><div class="lt">⚕️ 医学免责与安全边界</div><span>›</span></div>
      <div class="li" onclick="location.href='/doctor'"><div class="lt">🩺 切换到 HI 医生端</div><span>›</span></div>
    </div>
    <button class="btn ghost" onclick="logout()">退出登录</button>
    <div class="brand-foot">健康温州 · AI 智慧健康 V1.0<br>数据高铁已让医疗数据"跑起来"，让数据真正"懂患者、为患者所用"</div>
  `;
}

let AUTH_PERIODS=[];
async function openAuth(){
  pushView(viewMine);setTitle('授权与隐私中心',true);
  const s=el('screen');s.innerHTML=loading();
  const d=await api('/api/authorization');
  AUTH_PERIODS=d.periods||[];
  const row=(dim,t,extra='')=>`<div class="li"><div><div class="lt">${esc(t.label)}${t.locked?' <span class="ls">(必选)</span>':''}</div><div class="ls">${t.expires_at?'有效期至 '+t.expires_at:(t.updated_at?'更新于 '+t.updated_at:'')}${extra}</div></div><div class="switch ${t.enabled?'on':''}${t.locked?' locked':''}" onclick="${t.locked?'':`grantAuth('${dim}','${t.key}',this)`}"></div></div>`;
  s.innerHTML=`
    <div class="notice blue">🔒 我的数据我做主。授权分「用途 / 数据类型 / 访问对象 / 期限」四个维度分别管理，所有操作留痕可追溯，可随时撤回。不同用途需分别授权。</div>
    <div class="card"><h3><span class="bar"></span>① 用途授权（按用途分别授权）</h3>
      ${d.purpose.map(t=>row('purpose',t,t.key==='family'||t.key==='export'?' · 后续开放':'')).join('')}
      <div class="ls" style="margin-top:6px">开启用途时可设期限：<select id="periodSel" style="font-size:12px">${AUTH_PERIODS.map(p=>`<option value="${p.key}"${p.key==='long'?' selected':''}>${p.label}</option>`).join('')}</select></div>
    </div>
    <div class="card"><h3><span class="bar"></span>② 数据类型授权（最小必要）</h3>
      ${d.type.map(t=>row('type',t)).join('')}
    </div>
    <div class="card"><h3><span class="bar"></span>③ 访问对象授权</h3>
      ${d.object.map(t=>row('object',t)).join('')}
    </div>
    <button class="btn orange" onclick="revokeAll()">⛔ 一键撤回全部授权</button>
    <div class="card" style="margin-top:14px"><h3><span class="bar"></span>授权记录（可追溯）</h3><div id="authLogs">${loading('加载…')}</div></div>
  `;
  loadAuthLogs();
}
async function loadAuthLogs(){
  const logs=await api('/api/authorization/logs');
  el('authLogs').innerHTML=logs.map(l=>`<div class="li"><div><div class="lt" style="font-size:13px">${esc(l.action)} · ${esc(l.data_type)}</div><div class="ls">${l.created_at} · IP ${esc(l.ip||'-')}</div></div></div>`).join('');
}
async function grantAuth(dimension,key,elm){
  const enabled=!elm.classList.contains('on');
  const period=(dimension==='purpose'&&enabled&&el('periodSel'))?el('periodSel').value:undefined;
  try{await api('/api/authorization/grant',{method:'POST',body:{dimension,item_key:key,enabled,period}});
    elm.classList.toggle('on',enabled);toast(enabled?'已开启授权':'已关闭授权');openAuth();
  }catch(e){toast(e.message);}
}
async function revokeAll(){
  if(!confirm('确定撤回全部数据授权？撤回后 AI 将无法调用您的医疗数据。'))return;
  await api('/api/authorization/revoke-all',{method:'POST'});toast('已撤回全部授权');openAuth();
}

async function openMyDoctors(){
  pushView(viewMine);setTitle('我的医生',true);
  const s=el('screen');s.innerHTML=loading();
  const docs=await api('/api/connect/my-doctors');
  s.innerHTML=`<div class="card"><h3><span class="bar"></span>签约 / 主治医生</h3>${docs.map(d=>`<div class="li"><div class="row" style="gap:10px;width:100%"><div class="avatar" style="background:var(--blue-light);color:var(--blue)">${esc(d.avatar||d.name[0])}</div><div style="flex:1"><div class="lt">${esc(d.name)} · ${esc(d.title)}</div><div class="ls">${esc(d.hospital)} · ${esc(d.dept)}</div></div><span class="chip">${esc(d.relation)}</span></div></div>`).join('')}</div>
  <div class="notice">💡 在任意 AI 分析结果页点击"一键连通医生"，即可把结果同屏推送给医生。</div>`;
}
async function openMyConsults(){
  pushView(viewMine);setTitle('医生解读记录',true);
  const s=el('screen');s.innerHTML=loading();
  const list=await api('/api/connect/my-consults');
  s.innerHTML=list.length?list.map(c=>`<div class="card"><div class="row"><b>${esc(c.doctor_name)} · ${esc(c.dept)}</b><span class="chip ${c.status==='已解读'?'green':'orange'}">${c.status}</span></div>
    <div class="muted" style="margin:4px 0">${esc(c.hospital)} · ${c.created_at}</div>
    ${c.analysis_title?`<div class="ls">📎 ${esc(c.analysis_title)}</div>`:''}
    ${c.patient_note?`<div class="ls">留言：${esc(c.patient_note)}</div>`:''}
    ${c.reviews.map(r=>`<div class="notice green" style="margin-top:8px"><b>医生解读把关：</b>${esc(r.comment)}${r.advice?'<br><b>建议：</b>'+esc(r.advice):''}</div>`).join('')}
  </div>`).join(''):'<div class="empty"><div class="e">💬</div>还没有连通医生的记录</div>';
}
async function openBilling(){
  pushView(viewMine);setTitle('服务与会员',true);
  const s=el('screen');s.innerHTML=loading();
  const {free,products,charity,settlement,note}=await api('/api/billing/products');
  const orders=await api('/api/billing/my-orders');
  s.innerHTML=`
  <div class="card"><h3><span class="bar"></span>基础公共服务（永久免费）</h3>
    ${free.map(f=>`<div class="li"><div><div class="lt">${esc(f.name)}</div><div class="ls">${esc(f.desc)}</div></div><span class="chip green">免费</span></div>`).join('')}
  </div>
  <div class="card"><h3><span class="bar"></span>增值服务（自愿付费 · 分阶段开放）</h3>
    ${products.map(p=>`<div class="li"><div style="flex:1"><div class="lt">${esc(p.name)} <span class="chip">${p.phase}</span></div><div class="ls">${esc(p.desc)}</div></div><div style="text-align:right"><div style="font-weight:700;color:var(--blue)">¥${p.price}</div>${p.locked?'<span class="chip gray">未开放</span>':`<button class="btn sm" onclick="buy('${p.key}')">购买</button>`}</div></div>`).join('')}
    <div class="muted" style="margin-top:10px">${esc(note)}</div>
  </div>
  <div class="card"><h3><span class="bar"></span>公益减免</h3>
    <div class="ls">${esc(charity)}</div>
    <button class="btn ghost sm" style="margin-top:8px" onclick="applyCharity()">申请公益减免</button>
  </div>
  <div class="notice">🏥 ${esc(settlement)}</div>
  <div class="card"><h3><span class="bar"></span>我的订单</h3>${orders.length?orders.map(o=>`<div class="li"><div><div class="lt">${esc(o.product)}</div><div class="ls">${o.created_at}</div></div><div style="text-align:right"><div style="font-weight:600">¥${o.amount}</div><span class="chip green">${o.status}</span></div></div>`).join(''):'<div class="muted">暂无订单</div>'}</div>`;
}
async function buy(product){
  try{await api('/api/billing/order',{method:'POST',body:{product}});toast('购买成功（演示支付）');openBilling();}catch(e){toast(e.message);}
}
async function applyCharity(){
  try{const r=await api('/api/billing/charity-apply',{method:'POST'});toast(r.message);}catch(e){toast(e.message);}
}
function openAgreement(){sheet(`<h3>用户服务协议 / 隐私政策（摘要）</h3>
  <div style="font-size:13px;line-height:1.8;color:#334155">
  <p><b>1. 服务性质</b>：基础健康档案永久免费；AI 数据解读等增值服务自愿付费。本服务提供基于您授权数据的 AI 健康解读，不替代医生诊断。</p>
  <p><b>2. 数据来源与授权</b>：数据来自温州医疗数据高铁，仅在您明示同意并授权的范围内调用，原始数据不出域，遵循最小必要原则，默认不用于模型训练。</p>
  <p><b>3. 四维授权</b>：您可按用途、数据类型、访问对象、期限分别授权，随时开启/关闭/撤回。</p>
  <p><b>4. 数据安全</b>：全链路加密传输、敏感数据加密存储、访问控制与审计留痕，遵守《个人信息保护法》《数据安全法》。</p>
  <p><b>5. 撤回权</b>：您可随时撤回授权，撤回后即停止相应数据调用。</p>
  </div><button class="btn" style="margin-top:14px" onclick="closeSheet()">我已阅读并知晓</button>`);}
function openDisclaimer(){sheet(`<h3>⚕️ 医学免责与安全边界</h3>
  <div class="notice" style="margin-bottom:12px">本服务提供的所有 AI 分析、健康解读与第二意见，均为健康科普与辅助参考，<b>不构成诊断、治疗或用药建议</b>。</div>
  <div style="font-size:13px;line-height:1.8;color:#334155">
  <p>· 本服务只做数据解读与诊前准备，不做诊断、用药与复诊决策。</p>
  <p>· 任何诊疗决策请以执业医师面诊意见为准；如有紧急症状请立即就医或拨打 120。</p>
  <p>· AI 分析均标注数据来源，涉及用药、复诊、治疗选择时只生成"需向医生确认的问题"。</p>
  <p>· "参考视角"是医生确认前的辅助参考，不是诊断结论。最终诊疗决策由医生和患者共同做出。</p>
  </div><button class="btn" style="margin-top:14px" onclick="closeSheet()">我已知晓</button>`);}

// ---------- 启动 ----------
(async function init(){
  try{await ensureLogin();switchTab('records');}
  catch(e){el('screen').innerHTML=`<div class="empty"><div class="e">⚠️</div>初始化失败：${esc(e.message)}<br><button class="btn" style="margin-top:16px" onclick="location.reload()">重试</button></div>`;}
})();
