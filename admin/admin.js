'use strict';

const SB_URL = 'https://uotyqvijtbsbvenvyxoc.supabase.co';
const SB_KEY = 'sb_publishable_uAF7k_qwYzADd43d-22oxg_6EJRhWBr';
const sb = supabase.createClient(SB_URL, SB_KEY);

const STATUS = { operativa:'Operativa', sin_instalar:'Sin instalar', falta_red:'Falta red', sin_senal:'Sin señal', falla:'Falla', mantenimiento:'Mantenimiento' };
const PRIORITY = { alta:'Alta', media:'Media', baja:'Baja' };
const WSTATUS = { no_iniciado:'No iniciado', en_proceso:'En proceso', completado:'Completado', demorado:'Demorado', cancelado:'Cancelado' };
const COLOR = { operativa:'#159467', sin_instalar:'#767c8a', falta_red:'#e99a05', sin_senal:'#ff1f4e', falla:'#ff1f4e', mantenimiento:'#e66b35' };
const SOURCES = { gps:'GPS', mapa:'Clic en el mapa', geocodificada:'Desde la dirección', estimada:'Estimada' };
const FAULTS = ['falla', 'falta_red', 'sin_senal'];
const CENTER = [-33.09, -61.70];
const TABS = ['dashboard', 'log', 'works', 'cameras', 'audit'];
const ICON = {
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg>'
};

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmtDate = (d) => d ? d.split('-').reverse().join('/') : '—';
const orNull = (v) => (v === '' || v == null) ? null : v;
const toNum = (v) => (v === '' || v == null) ? null : Number(v);
const state = { me:null, cams:[], works:[], logs:[], contracts:new Map(), people:new Map() };
const mapFilter = new Set();
let bigMap = null, bigLayer = null, miniMap = null, miniMarker = null, mapFitted = false;

function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, err ? 6000 : 2500);
}
const fail = (e) => { console.error(e); toast(e.message || String(e), true); };
const options = (map, sel, blank) => (blank ? '<option value="">—</option>' : '') + Object.entries(map).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
const canCams = () => state.me?.role === 'admin';
const canWork = () => ['admin', 'tecnico'].includes(state.me?.role);
const statusBadge = (s) => `<span class="badge" style="background:${COLOR[s]}22;color:${COLOR[s]}"><i style="width:8px;height:8px;border-radius:50%;background:${COLOR[s]}"></i>${STATUS[s]}</span>`;

/* ---------- sesión ---------- */
function showLogin(msg) {
  $('#appView').hidden = true; $('#loginView').hidden = false;
  ['#tabs', '#userMenu', '#live', '#dashRefresh'].forEach(s => { $(s).hidden = true; });
  $('#loginMsg').textContent = msg || '';
}
async function enter(user) {
  const { data, error } = await sb.from('people').select('name,role,active').eq('user_id', user.id).maybeSingle();
  if (error) return fail(error);
  if (!data || !data.active) { await sb.auth.signOut(); return showLogin('Tu usuario todavía no tiene permisos. Pedile acceso a un administrador.'); }
  state.me = { ...data, id: user.id };
  $('#who').textContent = data.name; $('#avatar').textContent = (data.name || '?').trim().charAt(0).toUpperCase();
  ['#tabs', '#userMenu', '#live', '#dashRefresh'].forEach(s => { $(s).hidden = false; });
  $('#loginView').hidden = true; $('#appView').hidden = false;
  $('#auditTab').hidden = data.role !== 'admin'; $('#verifyAll').hidden = !canCams();
  $('#newCamera').hidden = !canCams(); $('#newWork').hidden = !canWork(); $('#newLog').hidden = !canWork();
  showTab('dashboard');
  await loadAll();
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#loginMsg').textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
  if (error) { $('#loginMsg').textContent = 'Correo o contraseña incorrectos.'; return; }
  $('#password').value = ''; await enter(data.user);
});
$('#logoutBtn').addEventListener('click', async () => { closeMenu(); await sb.auth.signOut(); state.me = null; showLogin(); });
$('#pwdBtn').addEventListener('click', () => {
  closeMenu();
  const pw = (n, l) => `<label>${l}<input type="password" name="${n}" autocomplete="new-password" minlength="12" required></label>`;
  openDialog('Cambiar contraseña', `<p class="hint">Usá 12 caracteres o más. Combiná letras, números y símbolos, y no la reutilices en otros sitios.</p>${pw('p1', 'Nueva contraseña')}${pw('p2', 'Repetir contraseña')}`, async (fd) => {
    const a = fd.get('p1'), b = fd.get('p2');
    if (a !== b) throw new Error('Las contraseñas no coinciden.');
    if (a.length < 12) throw new Error('Tiene que tener al menos 12 caracteres.');
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) throw error;
    toast('Contraseña actualizada');
  });
});

/* menú de usuario */
function closeMenu() { $('#menu').hidden = true; $('#userBtn').setAttribute('aria-expanded', 'false'); }
$('#userBtn').addEventListener('click', (e) => { e.stopPropagation(); const open = $('#menu').hidden; $('#menu').hidden = !open; $('#userBtn').setAttribute('aria-expanded', String(open)); });
document.addEventListener('click', (e) => { if (!e.target.closest('#userMenu')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
$('#auditTab').addEventListener('click', () => showTab('audit'));
$('#verifyAll').addEventListener('click', async () => {
  closeMenu();
  const n = state.cams.filter(c => c.lat != null && !c.coords_verified).length;
  if (!n) return toast('Todas las ubicaciones cargadas ya están verificadas.');
  if (!confirm(`Se van a marcar como verificadas ${n} cámaras que tienen ubicación. ¿Confirmás que ya las comprobaste en el lugar?`)) return;
  const { error } = await sb.from('cameras').update({ coords_verified: true }).not('lat', 'is', null).not('lng', 'is', null).eq('coords_verified', false);
  if (error) return fail(error);
  toast(`${n} ubicaciones verificadas`); await loadAll();
});

/* ---------- datos ---------- */
function setLive(ok) {
  const el = $('#live'); el.classList.toggle('off', !ok);
  $('#liveText').textContent = ok ? `En vivo · ${new Date().toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', hour12:false })}` : 'Sin conexión';
  el.title = ok ? `Última actualización: ${new Date().toLocaleString('es-AR')}` : 'No se pudieron actualizar los datos';
}
async function loadAll() {
  $('#errorBanner').hidden = true;
  const [c, w, l, k] = await Promise.all([
    sb.from('cameras').select('*').order('id'),
    sb.from('work_orders').select('*').order('id', { ascending:false }),
    sb.from('logbook').select('*').order('date', { ascending:false }).order('id', { ascending:false }),
    sb.from('epe_contracts').select('*')
  ]);
  const err = [c, w, l, k].find(r => r.error)?.error;
  if (err) { setLive(false); $('#errorBanner').textContent = `No se pudieron cargar los datos: ${err.message}`; $('#errorBanner').hidden = false; return; }
  state.cams = c.data; state.works = w.data; state.logs = l.data;
  state.contracts = new Map(k.data.map(x => [x.id, x]));
  if (state.me.role === 'admin') {
    const p = await sb.from('people').select('user_id,name');
    state.people = new Map((p.data || []).map(x => [x.user_id, x.name]));
  }
  setLive(true);
  fillStatusFilter(); renderCams(); renderWorks(); renderLogs();
  try { renderDashboard(); } catch (e) { console.error(e); $('#errorBanner').textContent = `No se pudo dibujar el Inicio: ${e.message}`; $('#errorBanner').hidden = false; }
  if (!$('#tab-audit').hidden) renderAudit();
}
const lastAction = () => { const m = new Map(); state.logs.forEach(x => { if (x.camera_id != null && !m.has(x.camera_id)) m.set(x.camera_id, x); }); return m; };
const camName = (id) => { const c = state.cams.find(x => x.id === id); return c ? `#${c.id} ${c.name}` : `#${id}`; };

/* ---------- secciones ---------- */
function showTab(t) {
  TABS.forEach(x => { $('#tab-' + x).hidden = x !== t; });
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  closeMenu();
  if (t === 'dashboard') setTimeout(() => bigMap && bigMap.invalidateSize(), 60);
  if (t === 'audit') renderAudit();
  window.scrollTo({ top: 0 });
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });
document.addEventListener('click', (e) => { const b = e.target.closest('[data-ficha]'); if (b) openFicha(+b.dataset.ficha); });

/* ---------- inicio ---------- */
const bars = (rows) => {
  const max = Math.max(...rows.map(r => r.value), 1);
  return rows.length ? `<div class="chart-bars">${rows.map(r => `<div class="bar-row"><span title="${esc(r.label)}">${esc(r.label)}</span><span class="bar-track"><i class="bar-fill" style="width:${r.value / max * 100}%;background:${r.color || 'var(--blue)'}"></i></span><strong>${r.value}</strong></div>`).join('')}</div>` : '<p class="hint">Sin datos.</p>';
};
const kpi = (value, label, sub, color) => `<div class="kpi"${color ? ` style="--c:${color}"` : ''}><strong>${esc(value)}</strong><span>${esc(label)}</span><small>${esc(sub)}</small></div>`;

function renderDashboard() {
  const cams = state.cams.filter(c => c.active), n = (f) => cams.filter(f).length, part = (s) => n(c => c.status === s);
  const op = part('operativa'), fault = n(c => FAULTS.includes(c.status)), mant = part('mantenimiento'), sin = part('sin_instalar');
  const cov = cams.length ? Math.round(op / cams.length * 100) : 0;
  const today = new Date().toLocaleDateString('en-CA');
  const pending = state.works.filter(w => !['completado', 'cancelado'].includes(w.status));
  const late = pending.filter(w => w.due_date && w.due_date < today);

  $('#dashKpis').innerHTML = [
    kpi(cams.length, 'Cámaras', 'registradas y activas'),
    kpi(op, 'Funcionando', `${cov}% de cobertura`, COLOR.operativa),
    kpi(fault, 'Con falla', `Sin red ${part('falta_red')} · Sin señal ${part('sin_senal')} · Falla ${part('falla')}`, fault ? COLOR.sin_senal : COLOR.operativa),
    kpi(mant, 'En reparación', 'en mantenimiento', COLOR.mantenimiento),
    kpi(sin, 'Sin instalar', 'pendientes de instalación', COLOR.sin_instalar),
    kpi(pending.length, 'Tareas pendientes', `${late.length} vencidas`, late.length ? COLOR.sin_senal : 'var(--blue)')
  ].join('');

  renderBigMap();

  const last = lastAction(), rank = { alta: 0, media: 1, baja: 2 };
  const att = cams.filter(c => FAULTS.includes(c.status) || c.status === 'mantenimiento').sort((a, b) => rank[a.priority] - rank[b.priority] || a.id - b.id);
  $('#dashAttCount').textContent = `${att.length}`;
  $('#dashAtt').innerHTML = att.map(c => { const la = last.get(c.id); return `<button type="button" class="att-item" data-ficha="${c.id}">
    <i class="dot" style="background:${COLOR[c.status]}"></i>
    <span class="att-main"><strong>#${c.id} ${esc(c.name)}</strong><small>${esc(c.address) || 'Sin dirección'}</small></span>
    <span class="att-side"><b style="color:${COLOR[c.status]}">${STATUS[c.status]}</b><small>${la ? `Novedad ${fmtDate(la.date)}` : 'Sin novedades'}</small></span></button>`; }).join('')
    || '<div class="empty">Todas las cámaras activas están funcionando.</div>';

  const stats = (rows) => `<div class="mini-stats">${rows.map(([v, l]) => `<div><strong>${esc(v)}</strong><span>${esc(l)}</span></div>`).join('')}</div>`;
  const avg = pending.length ? Math.round(pending.reduce((s, w) => s + w.progress, 0) / pending.length) : 0;
  $('#dashStatus').innerHTML = bars(Object.keys(STATUS).map(s => ({ label: STATUS[s], value: part(s), color: COLOR[s] })))
    + stats([[`${n(c => c.ip)}/${cams.length}`, 'Con IP'], [`${n(c => c.lat != null)}/${cams.length}`, 'Ubicadas'], [`${n(c => c.epe_contract_id != null)}/${cams.length}`, 'Con contrato']]);
  $('#dashWorks').innerHTML = bars(Object.keys(WSTATUS).map(s => ({ label: WSTATUS[s], value: state.works.filter(w => w.status === s).length })))
    + stats([[late.length, 'Vencidas'], [`${avg}%`, 'Avance medio'], [state.works.filter(w => w.status === 'completado').length, 'Completadas']]);
  $('#dashLog').innerHTML = state.logs.slice(0, 4).map(x => `<article class="event"><time>${fmtDate(x.date)}</time><p><strong>${x.camera_id != null ? esc(camName(x.camera_id)) : 'General'}${x.type ? ' · ' + esc(x.type) : ''}</strong><br>${esc(x.description)}</p></article>`).join('') || '<p class="hint">Sin novedades registradas.</p>';

  const sorted = [...pending].sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  $('#dashWorkCount').textContent = `${sorted.length}`;
  $('#dashWorkBody').innerHTML = sorted.map(w => `<tr><td>${w.id}</td><td><button type="button" class="linkish" data-ficha="${w.camera_id}">${esc(camName(w.camera_id))}</button></td><td>${esc(w.task_type)}</td><td>${WSTATUS[w.status]}</td><td>${w.progress}%</td><td>${esc(w.assignee) || '—'}</td>
    <td>${fmtDate(w.due_date)}${w.due_date && w.due_date < today ? ' <span class="badge" style="background:#ff1f4e22;color:#ff1f4e">Vencida</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="7">No hay tareas pendientes.</td></tr>';
}
$('#dashRefresh').addEventListener('click', () => loadAll().then(() => toast('Datos actualizados')));
setInterval(() => { if (state.me && !$('#tab-dashboard').hidden && !$('#dlg').open) loadAll(); }, 60000);

/* ---------- cámaras ---------- */
function fillStatusFilter() {
  const el = $('#camStatus'), cur = el.value;
  el.innerHTML = '<option value="all">Todos</option>' + options(STATUS, cur === 'all' ? '' : cur);
  el.value = cur || 'all';
}
function renderCams() {
  const q = $('#camSearch').value.trim().toLowerCase(), st = $('#camStatus').value, last = lastAction();
  const rows = state.cams.filter(c => (st === 'all' || c.status === st) &&
    (!q || [c.id, c.name, c.address, c.ip, c.zone].join(' ').toLowerCase().includes(q)));
  $('#camCount').textContent = `${rows.length} de ${state.cams.length}`;
  $('#camBody').innerHTML = rows.map(c => {
    const la = last.get(c.id), ct = state.contracts.get(c.epe_contract_id);
    return `<tr${c.active ? '' : ' style="opacity:.5"'}><td>${c.id}</td><td><button type="button" class="linkish" data-ficha="${c.id}">${esc(c.name)}</button></td><td>${esc(c.address) || '—'}</td>
      <td>${statusBadge(c.status)}</td><td>${PRIORITY[c.priority]}</td><td>${esc(c.ip) || '—'}</td><td>${esc(ct?.supply_number) || '—'}</td>
      <td>${c.lat != null ? (c.coords_verified ? '✔ Verificada' : '● Sin verificar') : '—'}</td>
      <td>${la ? `${fmtDate(la.date)} · ${esc(la.description).slice(0, 40)}` : '—'}</td>
      <td class="act"><span class="row-actions"><button class="btn small icon" data-ficha="${c.id}" title="Ver ficha" aria-label="Ver ficha de ${esc(c.name)}">${ICON.eye}</button>${canCams() ? `<button class="btn small icon" data-cam="${c.id}" title="Editar" aria-label="Editar ${esc(c.name)}">${ICON.edit}</button>` : ''}</span></td></tr>`;
  }).join('') || '<tr><td colspan="10">Sin resultados.</td></tr>';

  const act = state.cams.filter(c => c.active), cn = (f) => act.filter(f).length;
  $('#camQualityHint').textContent = `Sobre ${act.length} cámaras activas`;
  $('#camQuality').innerHTML = bars([
    { label: 'Con IP', value: cn(c => c.ip) }, { label: 'Con contrato EPE', value: cn(c => c.epe_contract_id != null) },
    { label: 'Con ubicación', value: cn(c => c.lat != null) }, { label: 'Ubicación verificada', value: cn(c => c.lat != null && c.coords_verified) },
    { label: 'Con función', value: cn(c => c.function) }]);
  $('#camPriority').innerHTML = bars(Object.keys(PRIORITY).map(p => ({ label: `${PRIORITY[p]} (${cn(c => c.priority === p && c.status === 'operativa')} operativas)`, value: cn(c => c.priority === p) })).filter(r => r.value));
}
['#camSearch', '#camStatus'].forEach(s => $(s).addEventListener('input', renderCams));
$('#camBody').addEventListener('click', (e) => { const b = e.target.closest('[data-cam]'); if (b) openCamera(state.cams.find(c => c.id === +b.dataset.cam)); });
$('#newCamera').addEventListener('click', () => openCamera(null));

const field = (name, label, val, attrs = '', cls = '') => `<label class="${cls}">${label}<input name="${name}" value="${esc(val ?? '')}" ${attrs}></label>`;
const area = (name, label, val, cls = '') => `<label class="${cls}">${label}<textarea name="${name}">${esc(val ?? '')}</textarea></label>`;

/* ficha de cámara (solo lectura) */
function openFicha(id) {
  const c = state.cams.find(x => x.id === id); if (!c) return;
  const ct = state.contracts.get(c.epe_contract_id);
  const kv = (k, v, cls = '') => `<div class="kv ${cls}"><dt>${k}</dt><dd>${v ? esc(v) : '—'}</dd></div>`;
  const place = c.lat != null ? `<a href="https://www.google.com/maps?q=${c.lat},${c.lng}" target="_blank" rel="noopener">Abrir en Google Maps</a> · ${c.coords_verified ? 'verificada' : 'sin verificar'}` : 'Sin ubicar';
  const logs = state.logs.filter(l => l.camera_id === id).slice(0, 8), works = state.works.filter(w => w.camera_id === id);
  const body = `<div class="ficha-head">${statusBadge(c.status)}<span class="count">Prioridad ${PRIORITY[c.priority]}</span><span class="grow"></span>${canCams() ? '<button type="button" class="btn small" id="fichaEdit">Editar datos</button>' : ''}</div>
    <dl class="kvgrid">
      ${kv('Dirección', c.address)}${kv('Zona', c.zone)}${kv('Modelo', c.model)}${kv('Tipo', c.camera_type)}
      ${kv('IP', c.ip)}${kv('MAC', c.mac)}${kv('N° de serie', c.serial)}${kv('Contrato EPE', ct?.supply_number)}
      ${kv('Enlace', c.link_type)}${kv('Energía', c.power_source)}${kv('Instalada', c.installed_at && fmtDate(c.installed_at))}${kv('Última revisión', c.last_review_at && fmtDate(c.last_review_at))}
      ${kv('Función', c.function, 'wide')}
      <div class="kv wide"><dt>Ubicación</dt><dd>${place}</dd></div>
      ${kv('Observaciones', c.notes, 'wide')}
    </dl>
    <h3 class="sub">Tareas de mantenimiento (${works.length})</h3>
    ${works.map(w => `<p style="margin:4px 0"><strong>#${w.id} ${esc(w.task_type)}</strong> · ${WSTATUS[w.status]} · ${w.progress}% · vence ${fmtDate(w.due_date)}</p>`).join('') || '<p class="hint">Sin tareas.</p>'}
    <h3 class="sub">Historial de novedades</h3>
    <div class="timeline">${logs.map(l => `<article class="event"><time>${fmtDate(l.date)}</time><p><strong>${esc(l.type || '')}</strong><br>${esc(l.description)}${l.result ? `<br><span class="hint">${esc(l.result)}</span>` : ''}</p></article>`).join('') || '<p class="hint">Sin novedades.</p>'}</div>`;
  openDialog(`Cámara #${c.id} — ${c.name}`, body, null);
  const edit = $('#fichaEdit'); if (edit) edit.onclick = () => { $('#dlgCancel').click(); openCamera(c); };
}

function openCamera(cam) {
  const isNew = !cam, ro = !canCams() ? 'disabled' : '';
  const c = cam || { id: Math.max(0, ...state.cams.map(x => x.id)) + 1, status:'sin_instalar', priority:'media', active:true, coords_verified:false };
  const supply = state.contracts.get(c.epe_contract_id)?.supply_number || '';
  const body = `
    <fieldset ${ro}><legend>Identificación</legend><div class="grid">
      ${field('id', 'N° de cámara', c.id, `type="number" min="1" required ${isNew ? '' : 'readonly'}`)}
      ${field('name', 'Nombre', c.name, 'required')}
      ${field('model', 'Modelo', c.model)}
      ${field('camera_type', 'Tipo (Domo, Bullet, LPR…)', c.camera_type)}
      <label>Estado<select name="status">${options(STATUS, c.status)}</select></label>
      <label>Prioridad<select name="priority">${options(PRIORITY, c.priority)}</select></label>
      ${area('function', 'Función (qué vigila / para qué)', c.function, 'wide')}
      <label class="check wide"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Cámara activa (desmarcar para darla de baja del sitio público)</label>
    </div></fieldset>
    <fieldset ${ro}><legend>Red y contrato</legend><div class="grid">
      ${field('ip', 'IP', c.ip, 'placeholder="192.168.1.x"')}
      ${field('mac', 'MAC', c.mac)}
      ${field('serial', 'N° de serie', c.serial)}
      ${field('supply', 'Contrato EPE (N° suministro)', supply)}
      ${field('link_type', 'Tipo de enlace (fibra, radio…)', c.link_type)}
      ${field('power_source', 'Energía', c.power_source)}
      ${area('network_notes', 'Notas de red (switch, VLAN…)', c.network_notes, 'wide')}
    </div></fieldset>
    <fieldset ${ro}><legend>Ubicación</legend><div class="grid">
      ${field('address', 'Dirección / esquina', c.address, '', 'wide')}
      ${field('zone', 'Zona / barrio', c.zone)}
      ${field('lat', 'Latitud', c.lat, 'type="number" step="any"')}
      ${field('lng', 'Longitud', c.lng, 'type="number" step="any"')}
      <label>Origen coordenada<select name="coords_source">${options(SOURCES, c.coords_source, true)}</select></label>
      <label class="check"><input type="checkbox" name="coords_verified" ${c.coords_verified ? 'checked' : ''}> Ubicación verificada</label>
      <div class="wide actions" style="justify-content:flex-start;position:static;margin:0;padding:0"><button type="button" class="btn small" id="geocodeBtn">Buscar dirección en el mapa</button><span class="hint" style="margin:0">Hacé clic en el mapa o arrastrá el punto para ubicar la cámara.</span></div>
      <div class="wide"><div id="miniMap" class="map mini"></div></div>
      ${field('azimuth_deg', 'Orientación (0=Norte, °)', c.azimuth_deg, 'type="number" min="0" max="359"')}
      ${field('fov_deg', 'Ángulo de visión (°)', c.fov_deg, 'type="number" min="1" max="360"')}
      ${field('range_m', 'Alcance (m)', c.range_m, 'type="number" min="1"')}
      ${field('mount_height_m', 'Altura de montaje (m)', c.mount_height_m, 'type="number" step="0.1"')}
      ${field('mount_type', 'Soporte (poste, edificio…)', c.mount_type)}
      ${field('photo_url', 'Enlace a foto', c.photo_url)}
    </div></fieldset>
    <fieldset ${ro}><legend>Seguimiento</legend><div class="grid">
      ${field('installed_at', 'Fecha de instalación', c.installed_at, 'type="date"')}
      ${field('last_review_at', 'Última revisión', c.last_review_at, 'type="date"')}
      ${area('notes', 'Observaciones (visibles en el sitio público; no poner IPs)', c.notes, 'wide')}
    </div></fieldset>`;
  openDialog(isNew ? 'Nueva cámara' : `Cámara #${c.id} — ${c.name}`, body, canCams() ? (fd) => saveCamera(fd, cam) : null, null, () => initMiniMap(c));
}

async function saveCamera(fd, cam) {
  const g = (k) => orNull((fd.get(k) ?? '').toString().trim());
  const p = {
    name: g('name'), model: g('model'), camera_type: g('camera_type'), function: g('function'), address: g('address'), zone: g('zone'),
    status: fd.get('status'), priority: fd.get('priority'), ip: g('ip'), mac: g('mac'), serial: g('serial'), network_notes: g('network_notes'),
    link_type: g('link_type'), power_source: g('power_source'), mount_type: g('mount_type'), photo_url: g('photo_url'), notes: g('notes'),
    lat: toNum(g('lat')), lng: toNum(g('lng')), azimuth_deg: toNum(g('azimuth_deg')), fov_deg: toNum(g('fov_deg')), range_m: toNum(g('range_m')),
    mount_height_m: toNum(g('mount_height_m')), installed_at: g('installed_at'), last_review_at: g('last_review_at'),
    coords_source: g('coords_source'), coords_verified: fd.get('coords_verified') === 'on', active: fd.get('active') === 'on'
  };
  if ((p.lat == null) !== (p.lng == null)) throw new Error('Completá latitud y longitud, o dejá ambas vacías.');
  const supply = g('supply'), prev = cam?.epe_contract_id ?? null;
  if (supply) {
    if (prev) { const r = await sb.from('epe_contracts').update({ supply_number: supply }).eq('id', prev); if (r.error) throw r.error; p.epe_contract_id = prev; }
    else { const r = await sb.from('epe_contracts').insert({ supply_number: supply }).select('id').single(); if (r.error) throw r.error; p.epe_contract_id = r.data.id; }
  } else p.epe_contract_id = null;
  const res = cam ? await sb.from('cameras').update(p).eq('id', cam.id) : await sb.from('cameras').insert({ id: +fd.get('id'), ...p });
  if (res.error) throw res.error;
  if (!supply && prev) await sb.from('epe_contracts').delete().eq('id', prev);
  toast('Cámara guardada'); await loadAll();
}

/* ---------- tareas de mantenimiento ---------- */
function renderWorks() {
  const today = new Date().toLocaleDateString('en-CA');
  $('#workCount').textContent = `${state.works.length}`;
  $('#workBody').innerHTML = state.works.map(w => `<tr><td>${w.id}</td><td><button type="button" class="linkish" data-ficha="${w.camera_id}">${esc(camName(w.camera_id))}</button></td><td>${esc(w.task_type)}</td><td>${WSTATUS[w.status]}</td>
    <td>${w.progress}%</td><td>${esc(w.assignee) || '—'}</td><td>${fmtDate(w.due_date)}${!['completado', 'cancelado'].includes(w.status) && w.due_date && w.due_date < today ? ' <span class="badge" style="background:#ff1f4e22;color:#ff1f4e">Vencida</span>' : ''}</td><td class="wrap">${esc(w.notes) || '—'}</td>
    <td class="act"><button class="btn small icon" data-work="${w.id}" title="${canWork() ? 'Editar' : 'Ver'}" aria-label="${canWork() ? 'Editar' : 'Ver'} tarea ${w.id}">${canWork() ? ICON.edit : ICON.eye}</button></td></tr>`).join('') || '<tr><td colspan="9">No hay tareas cargadas.</td></tr>';
}
$('#workBody').addEventListener('click', (e) => { const b = e.target.closest('[data-work]'); if (b) openWork(state.works.find(w => w.id === +b.dataset.work)); });
$('#newWork').addEventListener('click', () => openWork(null));
const camOptions = (sel) => state.cams.map(c => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>#${c.id} ${esc(c.name)} — ${esc(c.address || '')}</option>`).join('');

function openWork(w) {
  const isNew = !w, ro = !canWork() ? 'disabled' : '';
  const x = w || { id: Math.max(0, ...state.works.map(k => k.id)) + 1, status:'no_iniciado', progress:0 };
  const body = `<fieldset ${ro}><div class="grid">
    ${field('id', 'N° de tarea', x.id, `type="number" required ${isNew ? '' : 'readonly'}`)}
    <label>Cámara<select name="camera_id" required>${camOptions(x.camera_id)}</select></label>
    ${field('task_type', 'Tipo de tarea', x.task_type, 'required list="taskTypes"')}
    <datalist id="taskTypes"><option>Instalación</option><option>Servicio Técnico</option><option>Mantenimiento</option></datalist>
    <label>Estado<select name="status">${options(WSTATUS, x.status)}</select></label>
    ${field('progress', 'Avance %', x.progress, 'type="number" min="0" max="100" required')}
    ${field('assignee', 'Responsable', x.assignee)}
    ${field('start_date', 'Fecha de inicio', x.start_date, 'type="date"')}
    ${field('due_date', 'Fecha estimada de fin', x.due_date, 'type="date"')}
    ${field('completed_at', 'Fecha de finalización real', x.completed_at, 'type="date"')}
    ${area('notes', 'Notas', x.notes, 'wide')}</div></fieldset>`;
  openDialog(isNew ? 'Nueva tarea' : `Tarea #${x.id}`, body, canWork() ? async (fd) => {
    const g = (k) => orNull((fd.get(k) ?? '').toString().trim());
    const p = { camera_id: +fd.get('camera_id'), task_type: g('task_type'), status: fd.get('status'), progress: +fd.get('progress'), assignee: g('assignee'),
      start_date: g('start_date'), due_date: g('due_date'), completed_at: g('completed_at'), notes: g('notes') };
    const r = w ? await sb.from('work_orders').update(p).eq('id', w.id) : await sb.from('work_orders').insert({ id: +fd.get('id'), ...p });
    if (r.error) throw r.error; toast('Tarea guardada'); await loadAll();
  } : null, w && canWork() ? async () => {
    const r = await sb.from('work_orders').delete().eq('id', w.id); if (r.error) throw r.error; toast('Tarea eliminada'); await loadAll();
  } : null);
}

/* ---------- novedades ---------- */
function renderLogs() {
  $('#logCount').textContent = `${state.logs.length}`;
  $('#logBody').innerHTML = state.logs.map(l => `<tr><td>${fmtDate(l.date)}</td><td>${l.camera_id != null ? `<button type="button" class="linkish" data-ficha="${l.camera_id}">${esc(camName(l.camera_id))}</button>` : '—'}</td><td>${esc(l.technician) || '—'}</td><td>${esc(l.type) || '—'}</td>
    <td class="wrap">${esc(l.description)}</td><td>${esc(l.result) || '—'}</td><td class="wrap">${esc(l.next_action) || '—'}</td>
    <td class="act"><button class="btn small icon" data-log="${l.id}" title="${canWork() ? 'Editar' : 'Ver'}" aria-label="${canWork() ? 'Editar' : 'Ver'} novedad">${canWork() ? ICON.edit : ICON.eye}</button></td></tr>`).join('') || '<tr><td colspan="8">Sin novedades.</td></tr>';
}
$('#logBody').addEventListener('click', (e) => { const b = e.target.closest('[data-log]'); if (b) openLog(state.logs.find(l => l.id === +b.dataset.log)); });
$('#newLog').addEventListener('click', () => openLog(null));

function openLog(l) {
  const isNew = !l, ro = !canWork() ? 'disabled' : '';
  const x = l || { date: new Date().toLocaleDateString('en-CA'), technician: state.me.name };
  const body = `<fieldset ${ro}><div class="grid">
    ${field('date', 'Fecha', x.date, 'type="date" required')}
    <label>Cámara<select name="camera_id"><option value="">—</option>${camOptions(x.camera_id)}</select></label>
    ${field('technician', 'Responsable / técnico', x.technician)}
    ${field('type', 'Tipo', x.type, 'list="logTypes"')}
    <datalist id="logTypes"><option>Instalación</option><option>Servicio Técnico</option><option>Mantenimiento</option><option>Relevamiento</option></datalist>
    ${area('description', 'Qué se hizo', x.description, 'wide')}
    ${field('result', 'Resultado', x.result)}
    ${field('next_action', 'Próxima acción', x.next_action)}</div></fieldset>`;
  openDialog(isNew ? 'Registrar novedad' : 'Novedad registrada', body, canWork() ? async (fd) => {
    const g = (k) => orNull((fd.get(k) ?? '').toString().trim());
    const p = { date: g('date'), camera_id: toNum(g('camera_id')), technician: g('technician'), type: g('type'), description: g('description'), result: g('result'), next_action: g('next_action') };
    if (!p.description) throw new Error('Escribí qué se hizo.');
    const r = l ? await sb.from('logbook').update(p).eq('id', l.id) : await sb.from('logbook').insert(p);
    if (r.error) throw r.error; toast('Novedad guardada'); await loadAll();
  } : null, l && canWork() ? async () => {
    const r = await sb.from('logbook').delete().eq('id', l.id); if (r.error) throw r.error; toast('Registro eliminado'); await loadAll();
  } : null);
}

/* ---------- diálogo genérico ---------- */
function openDialog(title, body, onSave, onDelete, afterOpen) {
  const form = $('#dlgForm');
  form.innerHTML = `<h2>${esc(title)}</h2><div class="edit-form">${body}</div>
    <p class="form-msg" id="dlgMsg" role="alert"></p>
    <div class="actions"><button type="button" class="btn" id="dlgCancel">${onSave ? 'Cancelar' : 'Cerrar'}</button>
    ${onDelete ? '<button type="button" class="btn danger" id="dlgDelete">Eliminar</button>' : ''}
    ${onSave ? '<button type="submit" class="btn primary">Guardar</button>' : ''}</div>`;
  const dlg = $('#dlg'), msg = $('#dlgMsg');
  const dispose = () => { if (miniMap) { miniMap.remove(); miniMap = null; miniMarker = null; } };
  const close = () => { dispose(); dlg.close(); };
  $('#dlgCancel').onclick = close;
  if (onDelete) $('#dlgDelete').onclick = async () => { if (!confirm('¿Eliminar definitivamente? Queda registrado en el historial de cambios.')) return; try { await onDelete(); close(); } catch (e) { msg.textContent = e.message; } };
  const human = (m = '') => /type inet/.test(m) ? 'La IP no es válida (ejemplo: 192.168.1.35).' : /duplicate key.*ip/.test(m) ? 'Esa IP ya está asignada a otra cámara.' : /epe_contract/.test(m) && /duplicate/.test(m) ? 'Ese contrato EPE ya está asignado a otra cámara.' : /duplicate key/.test(m) ? 'Ya existe un registro con ese número.' : m;
  form.onsubmit = async (e) => { e.preventDefault(); msg.textContent = ''; try { await onSave(new FormData(form)); close(); } catch (err) { msg.textContent = human(err.message || String(err)); } };
  dlg.oncancel = dispose;
  dlg.showModal();
  if (afterOpen) afterOpen();
}

/* ---------- mapas ---------- */
function baseMap(el) {
  const m = L.map(el, { center: CENTER, zoom: 15 });
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri' });
  osm.addTo(m); L.control.layers({ 'Calles': osm, 'Satélite': sat }).addTo(m);
  return m;
}
function initMiniMap(c) {
  if (miniMap) miniMap.remove();
  miniMap = baseMap('miniMap');
  const form = $('#dlgForm'), editable = canCams();
  const put = (lat, lng, src) => {
    form.elements.lat.value = lat.toFixed(6); form.elements.lng.value = lng.toFixed(6);
    if (src) form.elements.coords_source.value = src;
    form.elements.coords_verified.checked = false;
    if (!miniMarker) {
      miniMarker = L.marker([lat, lng], { draggable: editable }).addTo(miniMap);
      miniMarker.on('dragend', () => { const p = miniMarker.getLatLng(); put(p.lat, p.lng, 'mapa'); });
    } else miniMarker.setLatLng([lat, lng]);
  };
  if (c.lat != null && c.lng != null) {
    miniMarker = L.marker([c.lat, c.lng], { draggable: editable }).addTo(miniMap);
    miniMarker.on('dragend', () => { const p = miniMarker.getLatLng(); put(p.lat, p.lng, 'mapa'); });
    miniMap.setView([c.lat, c.lng], 18);
  }
  if (editable) {
    miniMap.on('click', (e) => put(e.latlng.lat, e.latlng.lng, 'mapa'));
    $('#geocodeBtn').onclick = async () => {
      const addr = form.elements.address.value.trim(); if (!addr) return toast('Primero cargá la dirección.', true);
      try {
        const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&q=' + encodeURIComponent(addr.replace(/\sy\s/i, ' & ') + ', San José de la Esquina, Santa Fe'));
        const d = await r.json();
        if (!d.length) return toast('No encontré esa dirección. Marcala con un clic en el mapa.', true);
        put(+d[0].lat, +d[0].lon, 'geocodificada'); miniMap.setView([+d[0].lat, +d[0].lon], 18);
        toast('Ubicación aproximada: ajustala con el punto y marcala como verificada.');
      } catch (e) { fail(e); }
    };
  } else $('#geocodeBtn').hidden = true;
  setTimeout(() => miniMap && miniMap.invalidateSize(), 150);
}
function cone(c) {
  const R = 111320, pts = [[c.lat, c.lng]], a0 = c.azimuth_deg - c.fov_deg / 2, n = 12;
  for (let i = 0; i <= n; i++) {
    const b = (a0 + c.fov_deg * i / n) * Math.PI / 180;
    pts.push([c.lat + c.range_m * Math.cos(b) / R, c.lng + c.range_m * Math.sin(b) / (R * Math.cos(c.lat * Math.PI / 180))]);
  }
  return pts;
}
function renderBigMap(fit = !mapFitted) {
  if (!bigMap) bigMap = baseMap('bigMap');
  if (bigLayer) bigLayer.remove();
  bigLayer = L.layerGroup().addTo(bigMap);
  const active = state.cams.filter(c => c.active), located = active.filter(c => c.lat != null);
  const shown = located.filter(c => !mapFilter.size || mapFilter.has(c.status));
  $('#mapCount').textContent = `${located.length} de ${active.length} cámaras ubicadas`;
  shown.forEach(c => {
    const col = COLOR[c.status];
    L.circleMarker([c.lat, c.lng], { radius: 9, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1 }).addTo(bigLayer)
      .bindPopup(`<strong>#${c.id} ${esc(c.name)}</strong><br>${esc(c.address || '')}<br>${STATUS[c.status]}<br><button type="button" class="btn small" data-ficha="${c.id}" style="margin-top:8px">Ver ficha</button>`);
    if (c.azimuth_deg != null && c.fov_deg && c.range_m) L.polygon(cone(c), { color: col, weight: 1, fillOpacity: .15 }).addTo(bigLayer);
  });
  const cnt = (s) => located.filter(c => c.status === s).length, none = active.length - located.length;
  $('#mapChips').innerHTML = Object.keys(STATUS).filter(s => cnt(s)).map(s => `<button type="button" class="chip${mapFilter.has(s) ? ' on' : ''}" data-status="${s}" aria-pressed="${mapFilter.has(s)}"><i style="background:${COLOR[s]}"></i>${STATUS[s]} <b>${cnt(s)}</b></button>`).join('')
    + (none ? `<span class="chip" style="cursor:default"><i style="background:var(--muted)"></i>Sin ubicar <b>${none}</b></span>` : '');
  if (fit && shown.length) { mapFitted = true; setTimeout(() => { bigMap.invalidateSize(); bigMap.fitBounds(L.latLngBounds(shown.map(c => [c.lat, c.lng])).pad(.15), { maxZoom: 17 }); }, 100); }
}
$('#mapChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-status]'); if (!b) return;
  const s = b.dataset.status; if (mapFilter.has(s)) mapFilter.delete(s); else mapFilter.add(s);
  renderBigMap(true);
});

/* ---------- historial ---------- */
async function renderAudit() {
  const { data, error } = await sb.from('audit_log').select('*').order('at', { ascending:false }).limit(150);
  if (error) return fail(error);
  const skip = new Set(['updated_at', 'geom']);
  const diff = (r) => {
    if (r.action === 'INSERT') return '<b>Alta</b>';
    if (r.action === 'DELETE') return '<b>Baja</b>';
    const ch = Object.keys(r.new_data || {}).filter(k => !skip.has(k) && JSON.stringify(r.new_data[k]) !== JSON.stringify(r.old_data?.[k]));
    return ch.slice(0, 6).map(k => `<b>${esc(k)}</b>: ${esc(r.old_data?.[k] ?? '∅')} → ${esc(r.new_data[k] ?? '∅')}`).join('<br>') || '—';
  };
  $('#auditBody').innerHTML = data.map(r => `<tr><td>${new Date(r.at).toLocaleString('es-AR')}</td><td>${esc(r.table_name)}</td><td>${esc(r.row_id)}</td>
    <td>${esc(r.action)}</td><td>${esc(state.people.get(r.user_id) || (r.user_id ? r.user_id.slice(0, 8) : 'sistema'))}</td><td class="diff">${diff(r)}</td></tr>`).join('') || '<tr><td colspan="6">Sin cambios registrados.</td></tr>';
}

/* ---------- tema e inicio ---------- */
$('#themeToggle').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark';
  if (dark) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = 'dark';
  try { localStorage.setItem('monitor-theme', dark ? 'light' : 'dark'); } catch (e) {}
});
try { if (localStorage.getItem('monitor-theme') === 'dark') document.documentElement.dataset.theme = 'dark'; } catch (e) {}

(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) await enter(session.user); else showLogin();
})();
