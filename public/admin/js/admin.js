'use strict';
/* AI 安全监管台 —— 一键暂停 / 报告召回 / 护栏评测 / 审计溯源 */
let TOKEN = localStorage.getItem('wz_admin_token') || '';
const el = id => document.getElementById(id);
const app = () => document.getElementById('app');
function esc(s){return (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function toast(m){const t=el('toast');t.textContent=m;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),1800);}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401) { logout(); throw new Error('登录失效'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}
function logout(){ localStorage.removeItem('wz_admin_token'); TOKEN=''; renderLogin(); }

function renderLogin(){
  app().innerHTML = `<div class="login-box">
    <div style="font-size:34px">🛡️</div>
    <h2 style="color:#7c2d12;margin:6px 0">AI 安全监管台</h2>
    <div class="ls" style="color:#64748b">健康温州 · 医疗 AI 应用监管</div>
    <input id="key" type="password" placeholder="监管口令" value="admin123" />
    <button class="btn" style="width:100%" onclick="doLogin()">进入监管台</button>
    <div class="ls" style="margin-top:14px;color:#94a3b8">演示口令：admin123 · <a href="/" style="color:#7c2d12">返回患者端</a></div>
  </div>`;
}
async function doLogin(){
  try{ const d = await api('/api/auth/admin/login',{method:'POST',body:{key:el('key').value}});
    TOKEN=d.token; localStorage.setItem('wz_admin_token',TOKEN); renderDash();
  }catch(e){ toast(e.message); }
}

async function renderDash(){
  app().innerHTML = `<div class="adm-head"><h1>🛡️ AI 安全监管台</h1><button class="btn ghost sm" onclick="logout()">退出</button></div><div id="body">加载中…</div>`;
  const [st, ev] = await Promise.all([api('/api/admin/status'), api('/api/admin/eval')]);
  el('body').innerHTML = `
    <div class="card">
      <h3><span class="bar"></span>运行状态与版本</h3>
      <div class="metric" style="margin-bottom:12px">
        <div class="m"><b>${st.counts.analyses}</b><span>累计报告</span></div>
        <div class="m"><b>${st.counts.recalled}</b><span>已召回</span></div>
        <div class="m"><b>${st.counts.traces}</b><span>溯源记录</span></div>
        <div class="m"><b>${st.paused?'已暂停':'运行中'}</b><span>AI 生成</span></div>
      </div>
      <div class="li"><div><div class="lt">三版本</div><div class="ls">模型 ${esc(st.versions.model)} · 提示词 ${esc(st.versions.prompt)} · 知识库 ${esc(st.versions.kb)}</div></div></div>
      <button class="btn ${st.paused?'green':'orange'}" style="margin-top:10px" onclick="togglePause(${st.paused})">${st.paused?'▶️ 恢复 AI 生成':'⏸️ 一键暂停 AI 生成'}</button>
    </div>

    <div class="card">
      <h3><span class="bar"></span>护栏红队评测</h3>
      <div class="metric" style="margin-bottom:10px">
        <div class="m"><b class="${ev.interceptRate>=99?'ok':'bad'}">${ev.interceptRate}%</b><span>危险建议拦截率</span></div>
        <div class="m"><b>${ev.passRate}%</b><span>用例通过率</span></div>
        <div class="m"><b>${ev.pass}/${ev.total}</b><span>通过 / 总数</span></div>
      </div>
      <div style="font-size:13px;font-weight:600;margin:8px 0 2px">输入拦截</div>
      ${ev.input.map(c=>`<div class="case"><span>${esc(c.input)} <span class="ls">(${esc(c.note)})</span></span><span class="${c.pass?'ok':'bad'}">${c.blocked?'已拦截':'放行'} ${c.pass?'✓':'✗'}</span></div>`).join('')}
      <div style="font-size:13px;font-weight:600;margin:10px 0 2px">输出负面清单</div>
      ${ev.output.map(c=>`<div class="case"><span>${esc(c.text)} <span class="ls">(${esc(c.note)})</span></span><span class="${c.pass?'ok':'bad'}">${c.hit?'已改写':'放行'} ${c.pass?'✓':'✗'}</span></div>`).join('')}
    </div>

    <div class="card"><h3><span class="bar"></span>报告召回</h3><div id="recallList">加载中…</div></div>
    <div class="card"><h3><span class="bar"></span>审计溯源（最近）</h3><div id="traceList">加载中…</div></div>
  `;
  loadRecalls(); loadTraces();
}
async function togglePause(cur){
  await api('/api/admin/pause',{method:'POST',body:{paused:!cur}});
  toast(!cur?'已暂停 AI 生成':'已恢复 AI 生成'); renderDash();
}
async function loadRecalls(){
  const rows = await api('/api/admin/analyses');
  el('recallList').innerHTML = rows.length?rows.map(a=>`<div class="li"><div><div class="lt">#${a.id} ${esc(a.title)} ${a.recalled?'<span class="pill off">已召回</span>':''}</div><div class="ls">${a.created_at} · ${esc(a.model)} · kb ${esc(a.kb_version||'-')}</div></div><button class="btn ghost sm" onclick="recall(${a.id},${a.recalled?0:1})">${a.recalled?'撤销召回':'召回'}</button></div>`).join(''):'<div class="muted">暂无报告</div>';
}
async function recall(id, val){
  await api('/api/admin/recall',{method:'POST',body:{analysis_id:id, recall:val===1}});
  toast(val?'已召回该报告':'已撤销召回'); loadRecalls();
}
async function loadTraces(){
  const rows = await api('/api/admin/traces');
  el('traceList').innerHTML = rows.length?rows.map(t=>`<div class="li"><div><div class="lt" style="font-size:13px">${esc(t.task_type)} · ${esc(t.source)} ${(t.guardrail_hits&&t.guardrail_hits.length)?'<span class="pill off">护栏命中</span>':''}</div><div class="ls">${t.created_at} · ${esc(t.model_version)} / ${esc(t.prompt_version)} / ${esc(t.kb_version)}</div></div></div>`).join(''):'<div class="muted">暂无溯源记录</div>';
}

(function init(){ if(TOKEN) renderDash().catch(()=>renderLogin()); else renderLogin(); })();
