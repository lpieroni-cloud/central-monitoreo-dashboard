'use strict';

const SB_URL = 'https://uotyqvijtbsbvenvyxoc.supabase.co/rest/v1/';
const SB_KEY = 'sb_publishable_uAF7k_qwYzADd43d-22oxg_6EJRhWBr';
const state = { cameras:[], works:[], log:[], history:[] };
const $ = (s) => document.querySelector(s);
const clean = (v) => String(v ?? '').replace(/\s+/g,' ').trim();
const fold = (v) => clean(v).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const esc = (v) => clean(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const CAMERA_GROUP = { operativa:'Operativa', sin_instalar:'Sin instalar', mantenimiento:'Mantenimiento', falta_red:'Con problema', sin_senal:'Con problema', falla:'Con problema' };
const WORK_GROUP = { completado:'Completado', en_proceso:'En proceso', demorado:'Demorado', cancelado:'Cancelado', no_iniciado:'No iniciado' };
const PRIORITY = { alta:'Alta', media:'Media', baja:'Baja' };

function parseDate(s){const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?new Date(+m[1],+m[2]-1,+m[3]):null;}
function dateText(d){return d?d.toLocaleDateString('es-AR'):'—';}
const cameraGroup = (status) => CAMERA_GROUP[status] || 'Sin estado';
const workGroup = (status) => WORK_GROUP[status] || 'No iniciado';
function badge(value,type='status'){
  const v=type==='camera'?cameraGroup(value):type==='work'?workGroup(value):clean(value);
  const f=fold(v); const cls=(f==='operativa'||f==='completado')?'good':(f.includes('problema')||f.includes('demor')||f.includes('venc'))?'bad':(f.includes('mantenimiento')||f.includes('proceso')||f.includes('alta'))?'warn':'neutral';
  return `<span class="badge ${cls}">${esc(v)}</span>`;
}

async function getView(name, order){
  const res=await fetch(`${SB_URL}${name}?select=*&order=${order}`,{headers:{apikey:SB_KEY},cache:'no-store'});
  if(!res.ok) throw new Error(`La base de datos respondió ${res.status}`);
  return res.json();
}
async function load(){
  $('#status').textContent='Actualizando…'; $('#refreshBtn').disabled=true; $('#errorBanner').hidden=true;
  try{
    const [c,w,l,h]=await Promise.all([getView('public_cameras','id.asc'),getView('public_work_orders','due_date.asc.nullslast'),getView('public_logbook','date.desc,id.desc'),getView('public_kpi','date.asc')]);
    state.cameras=c.map(x=>({id:x.id,name:x.name,model:x.model,location:x.address,status:x.status,review:parseDate(x.last_review_at),notes:x.notes,priority:PRIORITY[x.priority]||'Sin prioridad'}));
    state.works=w.map(x=>({id:x.id,cam:x.camera_id,type:x.task_type,start:parseDate(x.start_date),due:parseDate(x.due_date),status:x.status,progress:Number(x.progress)||0,owner:x.assignee,notes:x.notes}));
    state.log=l.map(x=>({date:parseDate(x.date),cam:x.camera_id,tech:x.technician,type:x.type,description:x.description,result:x.result,next:x.next_action})).filter(x=>x.description);
    state.history=h.map(x=>({week:x.week_label,date:parseDate(x.date),coverage:Number(x.coverage)})).filter(x=>x.date&&Number.isFinite(x.coverage));
    populateFilters(); render(); $('#status').textContent='Datos en vivo'; $('#lastUpdated').textContent=new Date().toLocaleString('es-AR');
  }catch(err){console.error(err);$('#status').textContent='Error al actualizar';$('#errorBanner').textContent=`No se pudieron cargar los datos: ${err.message}. Intentá de nuevo en unos minutos.`;$('#errorBanner').hidden=false;}
  finally{$('#refreshBtn').disabled=false;}
}

function populateFilters(){
  const fill=(selector,values,all)=>{const el=$(selector),current=el.value;el.innerHTML=`<option value="all">${all}</option>`+[...new Set(values)].sort().map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');el.value=[...el.options].some(o=>o.value===current)?current:'all';};
  fill('#statusFilter',state.cameras.map(c=>cameraGroup(c.status)),'Todos'); fill('#priorityFilter',state.cameras.map(c=>c.priority),'Todas');
}
function filteredCameras(){
  const q=fold($('#searchFilter').value),s=$('#statusFilter').value,p=$('#priorityFilter').value;
  return state.cameras.filter(c=>(s==='all'||cameraGroup(c.status)===s)&&(p==='all'||c.priority===p)&&(!q||fold([c.id,c.name,c.model,c.location,c.notes].join(' ')).includes(q)));
}
function counts(items,key){const m=new Map();items.forEach(x=>{const k=key(x);m.set(k,(m.get(k)||0)+1);});return [...m].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value);}
function kpi(value,label,sub,tone='white'){return `<div class="kpi k-${tone}"><strong>${esc(value)}</strong><span>${esc(label)}</span><small>${esc(sub)}</small></div>`;}

function render(){
  const cams=filteredCameras(),groups=counts(cams,c=>cameraGroup(c.status)),get=n=>groups.find(x=>x.label===n)?.value||0;
  const active=state.works.filter(w=>workGroup(w.status)!=='Completado'&&workGroup(w.status)!=='Cancelado');
  const complete=state.works.filter(w=>workGroup(w.status)==='Completado').length;
  const coverage=cams.length?Math.round(get('Operativa')/cams.length*100):0;
  $('#kpiGrid').innerHTML=[kpi(cams.length,'Cámaras registradas','inventario filtrado','black'),kpi(get('Operativa'),'Operativas',`${coverage}% de cobertura`,'blue'),kpi(get('Sin instalar'),'Sin instalar','pendientes de despliegue','slate'),kpi(get('Con problema')+get('Mantenimiento'),'Requieren atención','problema o mantenimiento',(get('Con problema')+get('Mantenimiento'))?'magenta':'white'),kpi(state.works.length,'Trabajos registrados',`${complete} completados`,'white'),kpi(active.length,'Trabajos pendientes',`${overdue(active)} vencidos`,'navy')].join('');
  $('#heroPct').textContent=(state.cameras.length?Math.round(state.cameras.filter(c=>cameraGroup(c.status)==='Operativa').length/state.cameras.length*100):0)+'%'; renderBars('#cameraStatusChart',groups); renderBars('#workStatusChart',counts(state.works,w=>workGroup(w.status))); renderBars('#priorityChart',counts(cams,c=>c.priority)); renderHistory(); renderCameras(cams); renderWorks(active); renderLog();
}
function overdue(works){const today=new Date();today.setHours(0,0,0,0);return works.filter(w=>w.due&&w.due<today).length;}
function renderBars(selector,data){
  const el=$(selector); if(!data.length){el.innerHTML='<p class="hint">Sin datos.</p>';return;} const max=Math.max(...data.map(x=>x.value),1);
  el.innerHTML=`<div class="chart-bars">${data.map(x=>`<div class="bar-row"><span title="${esc(x.label)}">${esc(x.label)}</span><span class="bar-track"><i class="bar-fill" style="width:${x.value/max*100}%"></i></span><strong>${x.value}</strong></div>`).join('')}</div>`;
}
function renderHistory(){
  const el=$('#historyChart'),d=[...state.history].sort((a,b)=>a.date-b.date); if(!d.length){el.innerHTML='<p class="hint">Sin registros históricos válidos.</p>';return;}
  const W=560,H=210,p=32,x=i=>d.length===1?W/2:p+i*(W-p*2)/(d.length-1),y=v=>H-p-(Math.max(0,Math.min(100,v))/100)*(H-p*2);
  const pts=d.map((v,i)=>`${x(i)},${y(v.coverage)}`).join(' ');
  el.innerHTML=`<svg class="line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución de cobertura"><line x1="${p}" x2="${W-p}" y1="${H-p}" y2="${H-p}" stroke="var(--grid)"/><line x1="${p}" x2="${W-p}" y1="${p}" y2="${p}" stroke="var(--grid)"/><polyline points="${pts}" fill="none" stroke="var(--blue)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${d.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v.coverage)}" r="5" fill="var(--blue)"><title>${esc(v.week)}: ${v.coverage}%</title></circle><text x="${x(i)}" y="${H-7}" text-anchor="middle" font-size="10" fill="var(--muted)">${String(v.date.getDate()).padStart(2,'0')}/${String(v.date.getMonth()+1).padStart(2,'0')}</text><text x="${x(i)}" y="${y(v.coverage)-10}" text-anchor="middle" font-size="11" font-weight="800" fill="var(--text)">${v.coverage}%</text>`).join('')}</svg>`;
}
function renderCameras(cams){
  $('#cameraCount').textContent=`${cams.length} de ${state.cameras.length}`;
  $('#camerasBody').innerHTML=cams.map(c=>`<tr><td>${esc(c.id)}</td><td><strong>${esc(c.name)}</strong></td><td>${esc(c.model)||'—'}</td><td>${esc(c.location)||'—'}</td><td>${badge(c.status,'camera')}</td><td>${badge(c.priority)}</td><td>${dateText(c.review)}</td><td class="wrap">${esc(c.notes)||'—'}</td></tr>`).join('')||'<tr><td colspan="8">No hay cámaras para estos filtros.</td></tr>';
}
function dueText(w,now){
  if(!w.due) return '—';
  const days=Math.round((w.due-now)/86400000);
  return days<0?badge('Vencido'):days===0?'Vence hoy':`En ${days} día${days===1?'':'s'}`;
}
function renderWorks(works){
  const now=new Date();now.setHours(0,0,0,0); const sorted=[...works].sort((a,b)=>(a.due?.getTime()||Infinity)-(b.due?.getTime()||Infinity)); $('#workCount').textContent=`${sorted.length} pendientes`;
  $('#worksBody').innerHTML=sorted.map(w=>`<tr><td>${esc(w.id)}</td><td>#${esc(w.cam)}</td><td>${esc(w.type)}</td><td>${badge(w.status,'work')}</td><td><div class="progress" title="${w.progress}%"><i style="width:${Math.max(0,Math.min(100,w.progress))}%"></i></div><small>${w.progress}%</small></td><td>${esc(w.owner)||'—'}</td><td>${dateText(w.due)}</td><td>${dueText(w,now)}</td></tr>`).join('')||'<tr><td colspan="8">No hay trabajos pendientes.</td></tr>';
}
function renderLog(){
  const items=[...state.log].sort((a,b)=>(b.date?.getTime()||0)-(a.date?.getTime()||0)).slice(0,8);
  $('#activityList').innerHTML=items.map(x=>`<article class="event"><time>${dateText(x.date)}</time><p><strong>Cámara #${esc(x.cam)} · ${esc(x.type)}</strong><br>${esc(x.description)}<br><span class="hint">${esc(x.result)}${x.next?` · Próxima acción: ${esc(x.next)}`:''}</span></p></article>`).join('')||'<p class="hint">No hay intervenciones registradas.</p>';
}

['#searchFilter','#statusFilter','#priorityFilter'].forEach(s=>$(s).addEventListener(s==='#searchFilter'?'input':'change',render));
$('#clearFilters').addEventListener('click',()=>{$('#searchFilter').value='';$('#statusFilter').value='all';$('#priorityFilter').value='all';render();});
$('#refreshBtn').addEventListener('click',load);
$('#themeToggle').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme==='dark';if(dark)delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme='dark';try{localStorage.setItem('monitor-theme',dark?'light':'dark');}catch(e){}});
try{if(localStorage.getItem('monitor-theme')==='dark')document.documentElement.dataset.theme='dark';}catch(e){}
load();
