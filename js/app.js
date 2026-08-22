'use strict';

const BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ7MaaihiDPem8QW7PEywjw2OAwXBQS3TJDNLzZXGRiWawU0XR1TVK9oe8mVrXmlw/pub?output=csv&gid=';
const SHEETS = { cameras:'1988961508', works:'585065282', log:'1024327547', history:'1553361675' };
const state = { cameras:[], works:[], log:[], history:[], quality:[] };
const $ = (s) => document.querySelector(s);
const clean = (v) => String(v ?? '').replace(/\s+/g,' ').trim();
const fold = (v) => clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const esc = (v) => clean(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const redactIP = (v) => clean(v).replace(/\b(\d{1,3}\.){3}\d{1,3}\b/g, '[IP oculta]');

function parseCSV(text){
  const rows=[]; let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){ if(c==='"'){ if(text[i+1]==='"'){field+='"';i++;}else quoted=false; } else field+=c; }
    else if(c==='"') quoted=true;
    else if(c===','){row.push(field);field='';}
    else if(c==='\n'){row.push(field);rows.push(row);row=[];field='';}
    else if(c!=='\r') field+=c;
  }
  if(field||row.length){row.push(field);rows.push(row);} return rows;
}

function table(rows, firstHeader){
  const at=rows.findIndex(r=>fold(r[0])===fold(firstHeader));
  if(at<0) throw new Error(`No se encontró la tabla ${firstHeader}`);
  const headers=rows[at].map(fold); const out=[];
  for(const r of rows.slice(at+1)){
    if(!clean(r[0]) || fold(r[0]).startsWith('total:')) continue;
    const obj={}; headers.forEach((h,i)=>{if(h)obj[h]=clean(r[i]);}); out.push(obj);
  }
  return out;
}

function parseDate(raw, context){
  const s=clean(raw).replace(/-/g,'/'); if(!s) return null;
  const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if(!m){state.quality.push(`Fecha no reconocida en ${context}: ${s}`);return null;}
  const [d,mo,y]=[+m[1],+m[2],+m[3]]; const date=new Date(y,mo-1,d);
  if(y<2000||y>2100||date.getDate()!==d||date.getMonth()!==mo-1){state.quality.push(`Fecha inválida en ${context}: ${s}`);return null;}
  return date;
}
function pct(v){const n=Number(clean(v).replace('%','').replace(',','.'));return Number.isFinite(n)?n:null;}
function dateText(d){return d?d.toLocaleDateString('es-AR'):'—';}

function cameraGroup(status){
  const s=fold(status);
  if(s==='ok'||s==='instalada') return 'Operativa';
  if(s.includes('sin instalar')) return 'Sin instalar';
  if(s.includes('mantenimiento')) return 'Mantenimiento';
  if(s.includes('falta red')||s.includes('sin senal')||s.includes('falla')||s.includes('problema')) return 'Con problema';
  return clean(status)||'Sin estado';
}
function workGroup(status){
  const s=fold(status); if(s.includes('complet'))return 'Completado'; if(s.includes('proceso'))return 'En proceso';
  if(s.includes('demor'))return 'Demorado'; if(s.includes('cancel'))return 'Cancelado'; return 'No iniciado';
}
function badge(value,type='status'){
  const v=type==='camera'?cameraGroup(value):type==='work'?workGroup(value):clean(value);
  const f=fold(v); const cls=(f==='operativa'||f==='completado')?'good':(f.includes('problema')||f.includes('demor')||f.includes('venc'))?'bad':(f.includes('mantenimiento')||f.includes('proceso')||f.includes('alta'))?'warn':'neutral';
  return `<span class="badge ${cls}">${esc(v)}</span>`;
}

async function getSheet(gid){
  const res=await fetch(`${BASE}${gid}&_cb=${Date.now()}`,{cache:'no-store'});
  if(!res.ok) throw new Error(`Google Sheets respondió ${res.status}`); return parseCSV(await res.text());
}
async function load(){
  $('#status').textContent='Actualizando…'; $('#refreshBtn').disabled=true; $('#errorBanner').hidden=true; state.quality=[];
  try{
    const [c,w,l,h]=await Promise.all(Object.values(SHEETS).map(getSheet));
    state.cameras=table(c,'ID').map(x=>({id:x.id,name:x.nombre,model:x.modelo,location:x.localizacion,status:x.estado,review:parseDate(x['ult. revision'],`cámara ${x.id}`),notes:redactIP(x.observaciones),priority:x.prioridad||'Sin prioridad'}));
    state.works=table(w,'N°').map(x=>({id:x['n°'],cam:x['cam id'],type:x['tipo de tarea'],start:parseDate(x['fecha inicio'],`trabajo ${x['n°']}`),due:parseDate(x['fecha fin est.'],`trabajo ${x['n°']}`),status:x.estado,progress:pct(x['avance %'])??0,owner:x.responsable,notes:redactIP(x['notas / observaciones']),remaining:x['dias restantes']}));
    state.log=table(l,'FECHA').map(x=>({date:parseDate(x.fecha,'bitácora'),cam:x['cam id'],tech:x.tecnico,type:x.tipo,description:redactIP(x['descripcion detallada']),result:redactIP(x['resultado / estado final']),next:redactIP(x['proxima accion'])})).filter(x=>x.description);
    state.history=table(h,'SEMANA').map(x=>({week:x.semana,date:parseDate(x['fecha registro'],x.semana),coverage:pct(x['% cobertura'])})).filter(x=>x.date&&x.coverage!==null);
    populateFilters(); render(); $('#status').textContent='Datos en vivo'; $('#lastUpdated').textContent=new Date().toLocaleString('es-AR');
  }catch(err){console.error(err);$('#status').textContent='Error al actualizar';$('#errorBanner').textContent=`No se pudieron cargar los datos: ${err.message}. Verificá que la planilla siga publicada.`;$('#errorBanner').hidden=false;}
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
function kpi(value,label,sub){return `<div class="kpi"><strong>${esc(value)}</strong><span>${esc(label)}</span><small>${esc(sub)}</small></div>`;}

function render(){
  const cams=filteredCameras(),groups=counts(cams,c=>cameraGroup(c.status)),get=n=>groups.find(x=>x.label===n)?.value||0;
  const active=state.works.filter(w=>workGroup(w.status)!=='Completado'&&workGroup(w.status)!=='Cancelado');
  const complete=state.works.filter(w=>workGroup(w.status)==='Completado').length;
  const coverage=cams.length?Math.round(get('Operativa')/cams.length*100):0;
  $('#kpiGrid').innerHTML=[kpi(cams.length,'Cámaras registradas','inventario filtrado'),kpi(get('Operativa'),'Operativas',`${coverage}% de cobertura`),kpi(get('Sin instalar'),'Sin instalar','pendientes de despliegue'),kpi(get('Con problema')+get('Mantenimiento'),'Requieren atención','problema o mantenimiento'),kpi(state.works.length,'Trabajos registrados',`${complete} completados`),kpi(active.length,'Trabajos pendientes',`${overdue(active)} vencidos`)].join('');
  renderBars('#cameraStatusChart',groups); renderBars('#workStatusChart',counts(state.works,w=>workGroup(w.status))); renderBars('#priorityChart',counts(cams,c=>c.priority)); renderHistory(); renderCameras(cams); renderWorks(active); renderLog();
  const unique=[...new Set(state.quality)]; $('#qualityBanner').hidden=!unique.length; $('#qualityBanner').textContent=unique.length?`Calidad de datos: se ignoraron ${unique.length} fecha(s) inválida(s). Revisá la planilla de origen.`:'';
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
  el.innerHTML=`<svg class="line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución de cobertura"><line x1="${p}" x2="${W-p}" y1="${H-p}" y2="${H-p}" stroke="var(--grid)"/><line x1="${p}" x2="${W-p}" y1="${p}" y2="${p}" stroke="var(--grid)"/><polyline points="${pts}" fill="none" stroke="var(--blue)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${d.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v.coverage)}" r="5" fill="var(--blue)"><title>${esc(v.week)}: ${v.coverage}%</title></circle><text x="${x(i)}" y="${H-7}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(v.week)}</text><text x="${x(i)}" y="${y(v.coverage)-10}" text-anchor="middle" font-size="11" font-weight="800" fill="var(--text)">${v.coverage}%</text>`).join('')}</svg>`;
}
function renderCameras(cams){
  $('#cameraCount').textContent=`${cams.length} de ${state.cameras.length}`;
  $('#camerasBody').innerHTML=cams.map(c=>`<tr><td>${esc(c.id)}</td><td><strong>${esc(c.name)}</strong></td><td>${esc(c.model)||'—'}</td><td>${esc(c.location)||'—'}</td><td>${badge(c.status,'camera')}</td><td>${badge(c.priority)}</td><td>${dateText(c.review)}</td><td class="wrap">${esc(c.notes)||'—'}</td></tr>`).join('')||'<tr><td colspan="8">No hay cámaras para estos filtros.</td></tr>';
}
function renderWorks(works){
  const now=new Date();now.setHours(0,0,0,0); const sorted=[...works].sort((a,b)=>(a.due?.getTime()||Infinity)-(b.due?.getTime()||Infinity)); $('#workCount').textContent=`${sorted.length} pendientes`;
  $('#worksBody').innerHTML=sorted.map(w=>{const late=w.due&&w.due<now;return `<tr><td>${esc(w.id)}</td><td>#${esc(w.cam)}</td><td>${esc(w.type)}</td><td>${badge(w.status,'work')}</td><td><div class="progress" title="${w.progress}%"><i style="width:${Math.max(0,Math.min(100,w.progress))}%"></i></div><small>${w.progress}%</small></td><td>${esc(w.owner)||'—'}</td><td>${dateText(w.due)}</td><td>${late?badge('Vencido'):esc(w.remaining)||'—'}</td></tr>`;}).join('')||'<tr><td colspan="8">No hay trabajos pendientes.</td></tr>';
}
function renderLog(){
  const items=[...state.log].sort((a,b)=>(b.date?.getTime()||0)-(a.date?.getTime()||0)).slice(0,8);
  $('#activityList').innerHTML=items.map(x=>`<article class="event"><time>${dateText(x.date)}</time><p><strong>Cámara #${esc(x.cam)} · ${esc(x.type)}</strong><br>${esc(x.description)}<br><span class="hint">${esc(x.result)}${x.next?` · Próxima acción: ${esc(x.next)}`:''}</span></p></article>`).join('')||'<p class="hint">No hay intervenciones registradas.</p>';
}

['#searchFilter','#statusFilter','#priorityFilter'].forEach(s=>$(s).addEventListener(s==='#searchFilter'?'input':'change',render));
$('#clearFilters').addEventListener('click',()=>{$('#searchFilter').value='';$('#statusFilter').value='all';$('#priorityFilter').value='all';render();});
$('#refreshBtn').addEventListener('click',load);
$('#themeToggle').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme==='dark';if(dark)delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme='dark';localStorage.setItem('monitor-theme',dark?'light':'dark');});
if(localStorage.getItem('monitor-theme')==='dark')document.documentElement.dataset.theme='dark';
load();
