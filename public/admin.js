const GAMES=[
  {id:'reflejos',  name:'Reflejos',     lowerIsBetter:true,  unit:'ms'},
  {id:'memoria',   name:'Memoria',      lowerIsBetter:true,  unit:'s'},
  {id:'serpiente', name:'Serpiente',    lowerIsBetter:false, unit:''},
  {id:'apilar',    name:'Apilar',       lowerIsBetter:false, unit:''},
  {id:'centro',    name:'Centro',       lowerIsBetter:false, unit:'%'},
  {id:'doodle',    name:'Doodle',       lowerIsBetter:false, unit:''},
  {id:'naves',     name:'Naves',        lowerIsBetter:false, unit:'s'},
  {id:'zigzag',    name:'Zigzag',       lowerIsBetter:false, unit:'s'},
  {id:'simon',     name:'Secuencia',    lowerIsBetter:false, unit:''},
];

let adminKey = sessionStorage.getItem('rifa_admin_key')||'';
let socket=null;
// snapshot de la lista guardada — solo se sobreescribe si el textarea está vacío
let savedUserList='';

const $=id=>document.getElementById(id);
GAMES.forEach(g=>{ const o=document.createElement('option'); o.value=g.id; o.textContent=g.name; $('todayGameSelect').appendChild(o); });

function fmtScore(score,g){
  if(score==null) return '—';
  if(!g) return String(score);
  if(g.id==='naves'||g.id==='zigzag'||g.id==='memoria') return typeof score==='number'&&score%1!==0 ? score.toFixed(1)+'s' : score+'s';
  if(g.unit==='ms') return score+' ms';
  if(g.unit==='%') return typeof score==='number' ? score.toFixed(2)+'%' : score+'%';
  return String(score);
}

async function api(method,path,body){
  const res=await fetch(path+'?key='+encodeURIComponent(adminKey),{
    method, headers:{'Content-Type':'application/json'},
    body: body?JSON.stringify(body):undefined
  });
  if(!res.ok) throw new Error((await res.json()).error||'Error');
  return res.json();
}

async function tryLogin(){
  try{
    const data=await api('GET','/api/admin/state');
    sessionStorage.setItem('rifa_admin_key',adminKey);
    $('screenLogin').classList.add('hidden');
    $('screenAdmin').classList.remove('hidden');
    renderState(data);
    connectSocket();
  }catch{ $('loginMsg').textContent='Llave incorrecta o servidor no disponible.'; }
}
$('loginBtn').addEventListener('click',()=>{ adminKey=$('adminKey').value.trim(); tryLogin(); });
$('adminKey').addEventListener('keydown',e=>{ if(e.key==='Enter') $('loginBtn').click(); });
if(adminKey) tryLogin();

function connectSocket(){
  socket=io();
  socket.on('state',s=>{ renderState({...s, today:{...s.today, leaderboard: s.today?.leaderboard||[]}}); });
  socket.on('connect',()=>{ $('liveStatus').textContent='Conectado en vivo'; });
  socket.on('disconnect',()=>{ $('liveStatus').textContent='Sin conexión — reconectando...'; });
}

function renderState(state){
  // ── Lista de nombres: solo actualizar si el campo está vacío o igual al guardado
  const ni=$('namesInput');
  const currentServer=state.users.join('\n');
  if(document.activeElement!==ni && (ni.value==='' || ni.value===savedUserList)){
    ni.value=currentServer;
    savedUserList=currentServer;
  }

  // ── Ruleta
  const wi=$('wheelNamesInput');
  if(document.activeElement!==wi && wi.value==='')
    wi.value=(state.wheel?.names||[]).join('\n');

  // ── Reto del día
  const gs=$('todayGameSelect');
  if(document.activeElement!==gs && state.today?.gameId)
    gs.value=state.today.gameId;

  // ── Botón inicio
  const sb=$('startBtn');
  sb.textContent=state.started?'✔ Juego iniciado':'Iniciar juego';
  sb.disabled=state.started;

  // ── Label de juego activo
  const g=GAMES.find(x=>x.id===state.today?.gameId);
  $('liveGameLabel').textContent=g?`Reto: ${g.name}`:'Sin reto definido';

  renderUsers(state);
  renderLeaderboard(state);
}

function renderUsers(state){
  const results=state.today?.results||{};
  const g=GAMES.find(x=>x.id===state.today?.gameId);
  const allNames=[...new Set([...state.users, ...Object.keys(state.claims||{})])];
  $('connCount').textContent=allNames.length?`(${Object.keys(state.claims||{}).length}/${allNames.length})`:'' ;
  $('userRows').innerHTML=allNames.map(name=>{
    const claimed=!!(state.claims&&state.claims[name]);
    const att=results[name]||[];
    const b=att.length?(g?.lowerIsBetter?Math.min(...att.map(a=>a.score)):Math.max(...att.map(a=>a.score))):null;
    return `<div class="user-row">
      <span><span class="${claimed?'dot-on':'dot-off'}"></span><b>${name}</b></span>
      <span style="display:flex;gap:8px;align-items:center;">
        <span style="font-family:monospace;font-size:12px;color:var(--accent);">${fmtScore(b,g)}</span>
        <span style="color:var(--muted);font-size:11px;">${att.length}/2</span>
        ${claimed?`<button class="ghost-btn" data-name="${name}" style="padding:2px 8px;font-size:11px;" onclick="releaseUser('${name}')">Liberar</button>`:''}
      </span>
    </div>`;
  }).join('')||'<p class="muted" style="font-size:12px;">Sin jugadores aún.</p>';
}

function renderLeaderboard(state){
  const lb=state.today?.leaderboard||[];
  const g=GAMES.find(x=>x.id===state.today?.gameId);
  const el=$('liveResults');
  if(!lb.length){
    el.innerHTML='<p class="muted" style="font-size:13px;">Nadie ha jugado todavía.</p>';
    return;
  }
  el.innerHTML=lb.map((e,i)=>{
    const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}`;
    return `<div class="rank-row top${i+1<=3?i+1:''}">
      <span style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;width:24px;">${medal}</span>
        <span class="pname">${e.name}</span>
      </span>
      <span style="display:flex;align-items:center;gap:10px;">
        <span class="score">${fmtScore(e.best,g)}</span>
        <span style="color:var(--muted);font-size:11px;">${e.attempts}/2</span>
        <button class="ghost-btn" style="padding:2px 7px;font-size:11px;"
                onclick="resetAttempts('${e.name}')">Reset</button>
      </span>
    </div>`;
  }).join('');
}

// ── Botones de acción ──
async function releaseUser(name){
  if(!confirm(`¿Liberar a "${name}"?`)) return;
  await api('POST',`/api/admin/release/${encodeURIComponent(name)}`);
}
async function resetAttempts(name){
  if(!confirm(`¿Borrar intentos de "${name}"?`)) return;
  await api('POST',`/api/admin/today/release/${encodeURIComponent(name)}`);
}

$('saveNamesBtn').addEventListener('click',async()=>{
  const names=$('namesInput').value.split('\n').map(s=>s.trim()).filter(Boolean);
  if(!confirm(names.length?`Guardar ${names.length} nombre(s)?`:'¿Limpiar la lista? Los jugadores podrán escribir su nombre libremente.')) return;
  const d=await api('POST','/api/admin/users',{names});
  savedUserList=names.join('\n');
  renderState(d.state);
});

$('setTodayBtn').addEventListener('click',async()=>{
  const gameId=$('todayGameSelect').value;
  const g=GAMES.find(x=>x.id===gameId);
  if(!confirm(`Fijar "${g.name}" como reto de hoy?`)) return;
  try{ const d=await api('POST','/api/admin/today',{gameId}); $('todayMsg').textContent=`Reto: ${g.name}`; renderState(d.state); }
  catch(e){ $('todayMsg').textContent='Error: '+e.message; }
});

$('startBtn').addEventListener('click',async()=>{
  if(!confirm('¿Iniciar el juego?')) return;
  const d=await api('POST','/api/admin/start'); renderState(d.state);
});

$('resetBtn').addEventListener('click',async()=>{
  if(!confirm('¿Reiniciar el día? Los reclamos se borran, la lista de nombres se mantiene.')) return;
  const d=await api('POST','/api/admin/reset',{keepUsers:true}); renderState(d.state);
});

$('saveWheelBtn').addEventListener('click',async()=>{
  const names=$('wheelNamesInput').value.split('\n').map(s=>s.trim()).filter(Boolean);
  if(!names.length){ alert('Escribe al menos un nombre.'); return; }
  if(names.length>40){ alert('Máximo 40 nombres.'); return; }
  try{ await api('POST','/api/admin/wheel/names',{names}); $('wheelMsg').textContent=`${names.length} nombre(s) guardados.`; }
  catch(e){ $('wheelMsg').textContent='Error: '+e.message; }
});

$('spinBtn').addEventListener('click',async()=>{
  if(!confirm('¿Girar la ruleta ahora?')) return;
  try{ await api('POST','/api/admin/wheel/spin'); $('wheelMsg').textContent='Girando...'; }
  catch(e){ $('wheelMsg').textContent='Error: '+e.message; }
});

$('openTestBtn').addEventListener('click',()=>{
  window.open(`juego.html?admin=${encodeURIComponent(adminKey)}`,'_blank');
});
