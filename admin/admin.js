'use strict';

const SB_URL = 'https://uotyqvijtbsbvenvyxoc.supabase.co';
const SB_KEY = 'sb_publishable_uAF7k_qwYzADd43d-22oxg_6EJRhWBr';
const sb = supabase.createClient(SB_URL, SB_KEY);

const STATUS = { operativa:'Operativa', sin_instalar:'Sin instalar', falta_red:'Falta red', sin_senal:'Sin señal', falla:'Falla', mantenimiento:'Mantenimiento' };
const PRIORITY = { alta:'Alta', media:'Media', baja:'Baja' };
const WSTATUS = { no_iniciado:'No iniciado', en_proceso:'En proceso', completado:'Completado', demorado:'Demorado', cancelado:'Cancelado' };
const COLOR = { operativa:'#159467', sin_instalar:'#767c8a', falta_red:'#e99a05', sin_senal:'#ff1f4e', falla:'#ff1f4e', mantenimiento:'#e66b35' };
const SOURCES = { gps:'GPS', mapa:'Clic en el mapa', geocodificada:'Desde la dirección', estimada:'Estimada' };
const CENTER = [-33.09, -61.70];

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmtDate = (d) => d ? d.split('-').reverse().join('/') : '—';
const orNull = (v) => (v === '' || v == null) ? null : v;
const toNum = (v) => (v === '' || v == null) ? null : Number(v);
const state = { me:null, cams:[], works:[], logs:[], contracts:new Map(), people:new Map() };
let bigMap = null, bigLayer = null, miniMap = null, miniMarker = null;

function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, err ? 6000 : 2500);
}
const fail = (e) => { console.error(e); toast(e.message || String(e), true); };
const options = (map, sel, blank) => (blank ? '<option value="">—</option>' : '') + Object.entries(map).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
const canCams = () => state.me?.role === 'admin';
const canWork = () => ['admin', 'tecnico'].includes(state.me?.role);

/* ---------- sesión ---------- */
function showLogin(msg) {
  $('#appView').hidden = true; $('#loginView').hidden = false; $('#logoutBtn').hidden = true; $('#who').hidden = true;
  $('#loginMsg').textContent = msg || '';
}
async function enter(user) {
  const { data, error } = await sb.from('people').select('name,role,active').eq('user_id', user.id).maybeSingle();
  if (error) return fail(error);
  if (!data || !data.active) { await sb.auth.signOut(); return showLogin('Tu usuario todavía no tiene permisos. Pedile acceso a un administrador.'); }
  state.me = { ...data, id: user.id };
  $('#who').textContent = `${data.name} · ${data.role}`; $('#who').hidden = false; $('#logoutBtn').hidden = false;
  $('#pwdBtn').hidden = false;
  $('#loginView').hidden = true; $('#appView').hidden = false;
  $('#auditTab').hidden = data.role !== 'admin';
  $('#newCamera').hidden = !canCams(); $('#newWork').hidden = !canWork(); $('#newLog').hidden = !canWork();
  await loadAll();
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#loginMsg').textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
  if (error) { $('#loginMsg').textContent = 'Correo o contraseña incorrectos.'; return; }
  $('#password').value = ''; await enter(data.user);
});
$('#logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); state.me = null; $('#pwdBtn').hidden = true; showLogin(); });
$('#pwdBtn').addEventListener('click', () => {
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

/* ---------- datos ---------- */
async function loadAll() {
  $('#errorBanner').hidden = true;
  const [c, w, l, k] = await Promise.all([
    sb.from('cameras').select('*').order('id'),
    sb.from('work_orders').select('*').order('id', { ascending:false }),
    sb.from('logbook').select('*').order('date', { ascending:false }).order('id', { ascending:false }),
    sb.from('epe_contracts').select('*')
  ]);
  const err = [c, w, l, k].find(r => r.error)?.error;
  if (err) { $('#errorBanner').textContent = `No se pudieron cargar los datos: ${err.message}`; $('#errorBanner').hidden = false; return; }
  state.cams = c.data; state.works = w.data; state.logs = l.data;
  state.contracts = new Map(k.data.map(x => [x.id, x]));
  if (state.me.role === 'admin') {
    const p = await sb.from('people').select('user_id,name');
    state.people = new Map((p.data || []).map(x => [x.user_id, x.name]));
  }
  fillStatusFilter(); renderCams(); renderWorks(); renderLogs();
  if (!$('#tab-map').hidden) renderBigMap();
  if (!$('#tab-audit').hidden) renderAudit();
}
const lastAction = () => { const m = new Map(); state.logs.forEach(x => { if (x.camera_id != null && !m.has(x.camera_id)) m.set(x.camera_id, x); }); return m; };
const camName = (id) => { const c = state.cams.find(x => x.id === id); return c ? `#${c.id} ${c.name}` : `#${id}`; };

/* ---------- pestañas ---------- */
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('active', x === b));
  ['cameras', 'works', 'log', 'map', 'audit'].forEach(t => { $('#tab-' + t).hidden = t !== b.dataset.tab; });
  if (b.dataset.tab === 'map') renderBigMap();
  if (b.dataset.tab === 'audit') renderAudit();
});

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
    return `<tr${c.active ? '' : ' style="opacity:.5"'}><td>${c.id}</td><td><strong>${esc(c.name)}</strong></td><td>${esc(c.address) || '—'}</td>
      <td><span class="badge" style="background:${COLOR[c.status]}22;color:${COLOR[c.status]}">${STATUS[c.status]}</span></td>
      <td>${PRIORITY[c.priority]}</td><td>${esc(c.ip) || '—'}</td><td>${esc(ct?.supply_number) || '—'}</td>
      <td>${c.lat != null ? (c.coords_verified ? '✔ verificada' : '● sin verificar') : '—'}</td>
      <td>${la ? `${fmtDate(la.date)} · ${esc(la.description).slice(0, 40)}` : '—'}</td>
      <td><button class="btn small" data-cam="${c.id}">${canCams() ? 'Editar' : 'Ver'}</button></td></tr>`;
  }).join('') || '<tr><td colspan="10">Sin resultados.</td></tr>';
}
['#camSearch', '#camStatus'].forEach(s => $(s).addEventListener('input', renderCams));
$('#camBody').addEventListener('click', (e) => { const b = e.target.closest('[data-cam]'); if (b) openCamera(state.cams.find(c => c.id === +b.dataset.cam)); });
$('#newCamera').addEventListener('click', () => openCamera(null));

const field = (name, label, val, attrs = '', cls = '') => `<label class="${cls}">${label}<input name="${name}" value="${esc(val ?? '')}" ${attrs}></label>`;
const area = (name, label, val, cls = '') => `<label class="${cls}">${label}<textarea name="${name}">${esc(val ?? '')}</textarea></label>`;

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
      <div class="wide actions" style="justify-content:flex-start"><button type="button" class="btn small" id="geocodeBtn">Buscar dirección en el mapa</button><span class="hint" style="margin:0">Hacé clic en el mapa o arrastrá el punto para ubicar la cámara.</span></div>
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

/* ---------- trabajos ---------- */
function renderWorks() {
  $('#workCount').textContent = `${state.works.length}`;
  $('#workBody').innerHTML = state.works.map(w => `<tr><td>${w.id}</td><td>${esc(camName(w.camera_id))}</td><td>${esc(w.task_type)}</td><td>${WSTATUS[w.status]}</td>
    <td>${w.progress}%</td><td>${esc(w.assignee) || '—'}</td><td>${fmtDate(w.due_date)}</td><td class="wrap">${esc(w.notes) || '—'}</td>
    <td><button class="btn small" data-work="${w.id}">${canWork() ? 'Editar' : 'Ver'}</button></td></tr>`).join('') || '<tr><td colspan="9">No hay trabajos cargados.</td></tr>';
}
$('#workBody').addEventListener('click', (e) => { const b = e.target.closest('[data-work]'); if (b) openWork(state.works.find(w => w.id === +b.dataset.work)); });
$('#newWork').addEventListener('click', () => openWork(null));
const camOptions = (sel) => state.cams.map(c => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>#${c.id} ${esc(c.name)} — ${esc(c.address || '')}</option>`).join('');

function openWork(w) {
  const isNew = !w, ro = !canWork() ? 'disabled' : '';
  const x = w || { id: Math.max(0, ...state.works.map(k => k.id)) + 1, status:'no_iniciado', progress:0 };
  const body = `<fieldset ${ro}><div class="grid">
    ${field('id', 'N° de trabajo', x.id, `type="number" required ${isNew ? '' : 'readonly'}`)}
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
  openDialog(isNew ? 'Nuevo trabajo' : `Trabajo #${x.id}`, body, canWork() ? async (fd) => {
    const g = (k) => orNull((fd.get(k) ?? '').toString().trim());
    const p = { camera_id: +fd.get('camera_id'), task_type: g('task_type'), status: fd.get('status'), progress: +fd.get('progress'), assignee: g('assignee'),
      start_date: g('start_date'), due_date: g('due_date'), completed_at: g('completed_at'), notes: g('notes') };
    const r = w ? await sb.from('work_orders').update(p).eq('id', w.id) : await sb.from('work_orders').insert({ id: +fd.get('id'), ...p });
    if (r.error) throw r.error; toast('Trabajo guardado'); await loadAll();
  } : null, w && canWork() ? async () => {
    const r = await sb.from('work_orders').delete().eq('id', w.id); if (r.error) throw r.error; toast('Trabajo eliminado'); await loadAll();
  } : null);
}

/* ---------- última acción / bitácora ---------- */
function renderLogs() {
  $('#logCount').textContent = `${state.logs.length}`;
  $('#logBody').innerHTML = state.logs.map(l => `<tr><td>${fmtDate(l.date)}</td><td>${l.camera_id != null ? esc(camName(l.camera_id)) : '—'}</td><td>${esc(l.technician) || '—'}</td><td>${esc(l.type) || '—'}</td>
    <td class="wrap">${esc(l.description)}</td><td>${esc(l.result) || '—'}</td><td class="wrap">${esc(l.next_action) || '—'}</td>
    <td><button class="btn small" data-log="${l.id}">${canWork() ? 'Editar' : 'Ver'}</button></td></tr>`).join('') || '<tr><td colspan="8">Sin registros.</td></tr>';
}
$('#logBody').addEventListener('click', (e) => { const b = e.target.closest('[data-log]'); if (b) openLog(state.logs.find(l => l.id === +b.dataset.log)); });
$('#newLog').addEventListener('click', () => openLog(null));

function openLog(l) {
  const isNew = !l, ro = !canWork() ? 'disabled' : '';
  const x = l || { date: new Date().toISOString().slice(0, 10), technician: state.me.name };
  const body = `<fieldset ${ro}><div class="grid">
    ${field('date', 'Fecha', x.date, 'type="date" required')}
    <label>Cámara<select name="camera_id"><option value="">—</option>${camOptions(x.camera_id)}</select></label>
    ${field('technician', 'Responsable / técnico', x.technician)}
    ${field('type', 'Tipo', x.type, 'list="logTypes"')}
    <datalist id="logTypes"><option>Instalación</option><option>Servicio Técnico</option><option>Mantenimiento</option><option>Relevamiento</option></datalist>
    ${area('description', 'Qué se hizo', x.description, 'wide')}
    ${field('result', 'Resultado', x.result)}
    ${field('next_action', 'Próxima acción', x.next_action)}</div></fieldset>`;
  openDialog(isNew ? 'Registrar acción' : 'Acción registrada', body, canWork() ? async (fd) => {
    const g = (k) => orNull((fd.get(k) ?? '').toString().trim());
    const p = { date: g('date'), camera_id: toNum(g('camera_id')), technician: g('technician'), type: g('type'), description: g('description'), result: g('result'), next_action: g('next_action') };
    if (!p.description) throw new Error('Escribí qué se hizo.');
    const r = l ? await sb.from('logbook').update(p).eq('id', l.id) : await sb.from('logbook').insert(p);
    if (r.error) throw r.error; toast('Acción guardada'); await loadAll();
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
  const close = () => { if (miniMap) { miniMap.remove(); miniMap = null; miniMarker = null; } dlg.close(); };
  $('#dlgCancel').onclick = close;
  if (onDelete) $('#dlgDelete').onclick = async () => { if (!confirm('¿Eliminar definitivamente? Queda registrado en el historial de cambios.')) return; try { await onDelete(); close(); } catch (e) { msg.textContent = e.message; } };
  const human = (m = '') => /type inet/.test(m) ? 'La IP no es válida (ejemplo: 192.168.1.35).' : /duplicate key.*ip/.test(m) ? 'Esa IP ya está asignada a otra cámara.' : /epe_contract/.test(m) && /duplicate/.test(m) ? 'Ese contrato EPE ya está asignado a otra cámara.' : /duplicate key/.test(m) ? 'Ya existe un registro con ese número.' : m;
  form.onsubmit = async (e) => { e.preventDefault(); msg.textContent = ''; try { await onSave(new FormData(form)); close(); } catch (err) { msg.textContent = human(err.message || String(err)); } };
  dlg.oncancel = () => { if (miniMap) { miniMap.remove(); miniMap = null; miniMarker = null; } };
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
function renderBigMap() {
  if (!bigMap) bigMap = baseMap('bigMap');
  if (bigLayer) bigLayer.remove();
  bigLayer = L.layerGroup().addTo(bigMap);
  const located = state.cams.filter(c => c.lat != null && c.active);
  $('#mapCount').textContent = `${located.length} de ${state.cams.filter(c => c.active).length} cámaras ubicadas`;
  located.forEach(c => {
    const col = COLOR[c.status];
    L.circleMarker([c.lat, c.lng], { radius: 8, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1 }).addTo(bigLayer)
      .bindPopup(`<strong>#${c.id} ${esc(c.name)}</strong><br>${esc(c.address || '')}<br>${STATUS[c.status]}${c.coords_verified ? '' : '<br><em>ubicación sin verificar</em>'}`);
    if (c.azimuth_deg != null && c.fov_deg && c.range_m) L.polygon(cone(c), { color: col, weight: 1, fillOpacity: .15 }).addTo(bigLayer);
  });
  setTimeout(() => { bigMap.invalidateSize(); if (located.length) bigMap.fitBounds(L.latLngBounds(located.map(c => [c.lat, c.lng])).pad(.2), { maxZoom: 17 }); }, 100);
}

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
