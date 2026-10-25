'use strict';

const SB_URL = 'https://uotyqvijtbsbvenvyxoc.supabase.co';
const SB_KEY = 'sb_publishable_uAF7k_qwYzADd43d-22oxg_6EJRhWBr';
const sb = supabase.createClient(SB_URL, SB_KEY);

const STATUS = { operativa:'Operativa', sin_instalar:'Sin instalar', falta_red:'Falta red', sin_senal:'Sin señal', falla:'Falla', mantenimiento:'Mantenimiento' };
const PRIORITY = { alta:'Alta', media:'Media', baja:'Baja' };
const WSTATUS = { no_iniciado:'No iniciado', en_proceso:'En proceso', completado:'Completado', demorado:'Demorado', cancelado:'Cancelado' };
const COLOR = { operativa:'#16a34a', sin_instalar:'#4b5563', falta_red:'#f2b600', sin_senal:'#e11d2e', falla:'#9b1030', mantenimiento:'#f08a00' };
const SOURCES = { gps:'GPS', mapa:'Clic en el mapa', geocodificada:'Desde la dirección', estimada:'Estimada' };
const MAPCOLOR = COLOR;
const FAULTS = ['falla', 'falta_red', 'sin_senal'];
const CENTER = [-33.09, -61.70];
const TABS = ['dashboard', 'actas', 'works', 'cameras', 'admin', 'archive', 'audit'];
const CAT = { falla:'Falla', novedad:'Novedad', intervencion:'Intervención', observacion:'Observación' };
const CATCOLOR = { falla:'#fa0e4e', novedad:'#1f51ff', intervencion:'#202e51', observacion:'#8d94ad' };
const TURNO = { manana:'Mañana', tarde:'Tarde', noche:'Noche' };
const ICON = {
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg>'
};

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmtDate = (d) => d ? d.split('-').reverse().join('/') : '—';
const orNull = (v) => (v === '' || v == null) ? null : v;
const toNum = (v) => (v === '' || v == null) ? null : Number(v);
const state = { me:null, cams:[], works:[], logs:[], shifts:[], entries:[], events:[], updates:[], kpis:[], users:[], rcpts:[], teams:[], problemTypes:[], contacts:[], contracts:new Map(), people:new Map() };
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
const canTasks = () => state.me?.role === 'admin';
const isTeam = () => state.me?.role === 'cuadrilla';
const statusBadge = (s) => `<span class="badge" style="background:${COLOR[s]}22;color:${COLOR[s]}"><i style="width:8px;height:8px;border-radius:50%;background:${COLOR[s]}"></i>${STATUS[s]}</span>`;

/* ---------- sesión ---------- */
function showLogin(msg) {
  $('#appView').hidden = true; $('#loginView').hidden = false;
  ['#tabs', '#userMenu', '#live', '#dashRefresh'].forEach(s => { $(s).hidden = true; });
  $('#loginMsg').textContent = msg || '';
}
async function enter(user) {
  const { data, error } = await sb.from('people').select('name,role,active,organization,team_id').eq('user_id', user.id).maybeSingle();
  if (error) return fail(error);
  if (!data || !data.active) { await sb.auth.signOut(); return showLogin('Tu usuario todavía no tiene permisos. Pedile acceso a un administrador.'); }
  state.me = { ...data, id: user.id };
  $('#who').textContent = data.name; $('#avatar').textContent = (data.name || '?').trim().charAt(0).toUpperCase();
  ['#tabs', '#userMenu', '#live', '#dashRefresh'].forEach(s => { $(s).hidden = false; });
  $('#loginView').hidden = true; $('#appView').hidden = false;
  const team = data.role === 'cuadrilla'; document.body.classList.toggle('team', team);
  document.querySelector('[data-tab="actas"]').hidden = team; document.querySelector('[data-tab="cameras"]').hidden = team; $('#exportWorks').hidden = team;
  $('#pwdBtn').hidden = data.organization === 'Visitante' || team;
  $('#auditTab').hidden = data.role !== 'admin'; $('#adminTab').hidden = data.role !== 'admin'; $('#archiveTab').hidden = data.role !== 'admin'; $('#verifyAll').hidden = !canCams();
  $('#newCamera').hidden = !canCams(); $('#newWork').hidden = !canTasks();
  showTab('dashboard');
  await loadAll();
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#loginMsg').textContent = '';
  const typed = $('#email').value.trim().toLowerCase(), email = typed.includes('@') ? typed : typed + '@central-monitoreo.local';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: $('#password').value });
  if (error) { $('#loginMsg').textContent = 'Usuario o contraseña incorrectos.'; return; }
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
  const team = isTeam(), none = Promise.resolve({ data: [], error: null });
  const [c, w, l, k, sh, en, up, kp, tm, pt] = await Promise.all([
    team ? sb.from('team_cameras').select('*').order('id') : sb.from('cameras').select('*').order('id'),
    sb.from('work_orders').select('*').order('id', { ascending:false }),
    team ? none : sb.from('logbook').select('*').order('date', { ascending:false }).order('id', { ascending:false }),
    team ? none : sb.from('epe_contracts').select('*'),
    team ? none : sb.from('shifts').select('*').order('shift_date', { ascending:false }).order('id', { ascending:false }).limit(200),
    team ? none : sb.from('shift_entries').select('*').order('occurred_at', { ascending:true }),
    sb.from('work_order_updates').select('*').order('created_at', { ascending:true }),
    sb.from('kpi_snapshots').select('*').order('date', { ascending:true }),
    sb.from('teams').select('*').order('name'),
    sb.from('problem_types').select('*').order('sort')
  ]);
  const err = [c, w, l, k, sh, en, up, kp, tm, pt].find(r => r.error)?.error;
  if (err) { setLive(false); $('#errorBanner').textContent = `No se pudieron cargar los datos: ${err.message}`; $('#errorBanner').hidden = false; return; }
  state.cams = c.data; state.works = w.data; state.logs = l.data; state.shifts = sh.data; state.entries = en.data; state.updates = up.data; state.kpis = kp.data.map(x => ({ ...x, coverage: Number(x.coverage) }));
  state.teams = tm.data; state.problemTypes = pt.data;
  buildEvents();
  state.contracts = team ? new Map(c.data.filter(x => x.contract_number).map(x => [x.epe_contract_id, { supply_number: x.contract_number }])) : new Map(k.data.map(x => [x.id, x]));
  if (state.me.role === 'admin') {
    const p = await sb.from('people').select('user_id,name');
    state.people = new Map((p.data || []).map(x => [x.user_id, x.name]));
  }
  setLive(true);
  fillStatusFilter(); renderCams(); renderWorks(); renderActas();
  try { renderDashboard(); } catch (e) { console.error(e); $('#errorBanner').textContent = `No se pudo dibujar el Inicio: ${e.message}`; $('#errorBanner').hidden = false; }
  if (!$('#tab-audit').hidden) renderAudit();
}
const localDate = (ts) => new Date(ts).toLocaleDateString('en-CA');
const hhmm = (ts) => new Date(ts).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', hour12:false });
function buildEvents() {
  const ev = state.logs.map(l => ({ date: l.date, ts: '', camera_id: l.camera_id, type: l.type, description: l.description, result: l.result }));
  state.entries.forEach(e => (e.camera_ids.length ? e.camera_ids : [null]).forEach(cid =>
    ev.push({ date: localDate(e.occurred_at), ts: e.occurred_at, camera_id: cid, type: CAT[e.category], description: e.description, result: e.action_taken })));
  ev.sort((a, b) => b.date.localeCompare(a.date) || b.ts.localeCompare(a.ts));
  state.events = ev;
}
const lastAction = () => { const m = new Map(); state.events.forEach(x => { if (x.camera_id != null && !m.has(x.camera_id)) m.set(x.camera_id, x); }); return m; };
const camName = (id) => { const c = state.cams.find(x => x.id === id); return c ? `#${c.id} ${c.name}` : `#${id}`; };

/* ---------- secciones ---------- */
function showTab(t) {
  if (isTeam() && ['actas', 'cameras', 'admin', 'archive', 'audit'].includes(t)) t = 'dashboard';
  TABS.forEach(x => { $('#tab-' + x).hidden = x !== t; });
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  closeMenu();
  if (t === 'dashboard') setTimeout(() => bigMap && bigMap.invalidateSize(), 60);
  if (t === 'audit') renderAudit();
  if (t === 'admin') loadAdmin();
  if (t === 'archive') loadArchive();
  window.scrollTo({ top: 0 });
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });
document.addEventListener('click', (e) => { const b = e.target.closest('[data-ficha]'); if (b) openFicha(+b.dataset.ficha); });

/* ---------- inicio ---------- */
const bars = (rows) => {
  const max = Math.max(...rows.map(r => r.value), 1);
  return rows.length ? `<div class="chart-bars">${rows.map(r => `<div class="bar-row"><span title="${esc(r.label)}">${esc(r.label)}</span><span class="bar-track"><i class="bar-fill" style="width:${r.value / max * 100}%;background:${r.color || 'var(--blue)'}"></i></span><strong>${r.value}</strong></div>`).join('')}</div>` : '<p class="hint">Sin datos.</p>';
};
const kpi = (value, label, sub, tone = 'white') => `<div class="kpi k-${tone}"><strong>${esc(value)}</strong><span>${esc(label)}</span><small>${esc(sub)}</small></div>`;

function renderDashboard() {
  const cams = state.cams.filter(c => c.active), n = (f) => cams.filter(f).length, part = (s) => n(c => c.status === s);
  const op = part('operativa'), fault = n(c => FAULTS.includes(c.status)), mant = part('mantenimiento'), sin = part('sin_instalar');
  const cov = cams.length ? Math.round(op / cams.length * 100) : 0;
  const today = new Date().toLocaleDateString('en-CA');
  const pending = state.works.filter(w => !['completado', 'cancelado'].includes(w.status));
  const late = pending.filter(w => w.due_date && w.due_date < today);

  $('#dashKpis').innerHTML = [
    kpi(cams.length, 'Cámaras', 'registradas y activas', 'black'),
    kpi(op, 'Funcionando', `${cov}% de cobertura`, 'blue'),
    kpi(fault, 'Con falla', `Sin red ${part('falta_red')} · Sin señal ${part('sin_senal')} · Falla ${part('falla')}`, fault ? 'magenta' : 'white'),
    kpi(mant, 'En reparación', 'en mantenimiento', 'navy'),
    kpi(sin, 'Sin instalar', 'pendientes de instalación', 'slate'),
    kpi(pending.length, 'Tareas pendientes', `${late.length} vencidas`, late.length ? 'magenta' : 'white')
  ].join('');

  renderBigMap(); renderHistoryChart(); renderRequests(); renderVerify(); $('#dashLog').closest('.card').hidden = isTeam(); $('#heroPct').textContent = cov + '%'; $('#heroSub').textContent = fault ? `${fault} cámara${fault === 1 ? '' : 's'} con falla y ${late.length} tarea${late.length === 1 ? '' : 's'} vencida${late.length === 1 ? '' : 's'}. Todo el estado de la red, en tiempo real.` : 'Todas las cámaras activas están funcionando. Estado de la red en tiempo real.';

  const last = lastAction(), rank = { alta: 0, media: 1, baja: 2 };
  const att = cams.filter(c => FAULTS.includes(c.status) || c.status === 'mantenimiento').sort((a, b) => rank[a.priority] - rank[b.priority] || a.id - b.id);
  $('#dashAttCount').textContent = `${att.length}`;
  $('#dashAtt').innerHTML = att.map(c => { const la = last.get(c.id); return `<button type="button" class="att-item" data-ficha="${c.id}">
    <i class="dot" style="background:${MAPCOLOR[c.status]}"></i>
    <span class="att-main"><strong>#${c.id} ${esc(c.name)}</strong><small>${esc(c.address) || 'Sin dirección'}</small></span>
    <span class="att-side"><b>${STATUS[c.status]}</b><small>Desde ${fmtDate(localDate(c.status_since))}</small></span></button>`; }).join('')
    || '<div class="empty">Todas las cámaras activas están funcionando.</div>';

  const stats = (rows) => `<div class="mini-stats">${rows.map(([v, l]) => `<div><strong>${esc(v)}</strong><span>${esc(l)}</span></div>`).join('')}</div>`;
  const avg = pending.length ? Math.round(pending.reduce((s, w) => s + w.progress, 0) / pending.length) : 0;
  $('#dashStatus').innerHTML = bars(Object.keys(STATUS).map(s => ({ label: STATUS[s], value: part(s), color: COLOR[s] })))
    + stats([[`${n(c => c.ip)}/${cams.length}`, 'Con IP'], [`${n(c => c.lat != null)}/${cams.length}`, 'Ubicadas'], [`${n(c => c.epe_contract_id != null)}/${cams.length}`, 'Con contrato']]);
  $('#dashWorks').innerHTML = bars(Object.keys(WSTATUS).map(s => ({ label: WSTATUS[s], value: state.works.filter(w => w.status === s).length })))
    + stats([[late.length, 'Vencidas'], [`${avg}%`, 'Avance medio'], [state.works.filter(w => w.status === 'completado').length, 'Completadas']]);
  $('#dashLog').innerHTML = state.events.slice(0, 4).map(x => `<article class="event"><time>${fmtDate(x.date)}</time><p><strong>${x.camera_id != null ? esc(camName(x.camera_id)) : 'General'}${x.type ? ' · ' + esc(x.type) : ''}</strong><br>${esc(x.description)}</p></article>`).join('') || '<p class="hint">Sin novedades registradas.</p>';

  const sorted = [...pending].sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  $('#dashWorkCount').textContent = `${sorted.length}`;
  $('#dashWorkBody').innerHTML = sorted.map(w => `<tr><td>${w.id}</td><td><button type="button" class="linkish" data-ficha="${w.camera_id}">${esc(camName(w.camera_id))}</button></td><td>${esc(w.task_type)}</td><td>${WSTATUS[w.status]}</td><td>${w.progress}%</td>
    <td>${fmtDate(w.due_date)}${w.due_date && w.due_date < today ? ' <span class="badge" style="background:#fa0e4e22;color:#fa0e4e">Vencida</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="7">No hay tareas pendientes.</td></tr>';
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
    return `<tr${c.active ? '' : ' style="opacity:.5"'}><td>${c.id}</td><td><button type="button" class="linkish" data-ficha="${c.id}">${esc(c.name)}</button></td><td class="wrap">${esc(c.address) || '—'}</td>
      <td>${statusBadge(c.status)}</td><td>${PRIORITY[c.priority]}</td><td>${esc(c.ip) || '—'}</td><td>${esc(ct?.supply_number) || '—'}</td>
      <td>${c.lat != null ? (c.coords_verified ? '✔ Verificada' : '● Sin verificar') : '—'}</td>
      <td class="wrap">${la ? `${fmtDate(la.date)} · ${esc(la.description).slice(0, 60)}` : '—'}</td>
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
  const logs = state.events.filter(l => l.camera_id === id).slice(0, 8), works = state.works.filter(w => w.camera_id === id);
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
    ${isTeam() ? '' : '<h3 class="sub">Historial de novedades</h3>'}
    <div class="timeline"${isTeam() ? ' hidden' : ''}>${logs.map(l => `<article class="event"><time>${fmtDate(l.date)}</time><p><strong>${esc(l.type || '')}</strong><br>${esc(l.description)}${l.result ? `<br><span class="hint">${esc(l.result)}</span>` : ''}</p></article>`).join('') || '<p class="hint">Sin novedades.</p>'}</div>`;
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
const PRIOCOLOR = { alta:'#fa0e4e', media:'#f5a000', baja:'#8d94ad' };
const prioBadge = (p) => `<span class="badge" style="background:${PRIOCOLOR[p]}22;color:${PRIOCOLOR[p]}">${PRIORITY[p]}</span>`;
const isOpenWork = (w) => !['completado', 'cancelado'].includes(w.status);
const needsVerify = (w) => !!w.team_id && w.status === 'completado' && !w.verified_at;
const isLate = (w) => isOpenWork(w) && w.due_date && w.due_date < localDate(Date.now());
const lateBadge = '<span class="badge" style="background:#fa0e4e22;color:#fa0e4e">Vencida</span>';
const teamName = (id) => state.teams.find(t => t.id === id)?.name || '';
const ptLabel = (code) => state.problemTypes.find(p => p.code === code)?.label || '';
const plazo = (h) => !h ? 'a definir' : h < 48 ? `${h} h` : `${Math.round(h / 24)} días`;
const stateLabel = (w) => needsVerify(w) ? 'Terminada · a verificar' : w.status === 'completado' && w.team_id && w.verified_at ? 'Verificada' : WSTATUS[w.status];
const WFILTERS = { pendientes:['Pendientes', isOpenWork], vencidas:['Vencidas', isLate], curso:['En curso', w => w.status === 'en_proceso'], verificar:['Para verificar', needsVerify], cerradas:['Cerradas', w => !isOpenWork(w)], todas:['Todas', () => true] };
const workFilter = { v:'pendientes' };
const progressBar = (p) => `<div class="progress" title="${p}%"><i style="width:${p}%"></i></div><small>${p}%</small>`;

function renderWorks() {
  $('#workChips').innerHTML = Object.entries(WFILTERS).map(([k, [l, f]]) => `<button type="button" class="chip${workFilter.v === k ? ' on' : ''}" data-wf="${k}" aria-pressed="${workFilter.v === k}">${l} <b>${state.works.filter(f).length}</b></button>`).join('');
  const rows = state.works.filter(WFILTERS[workFilter.v][1]).sort((a, b) => isOpenWork(a) === isOpenWork(b)
    ? (isOpenWork(a) ? (a.due_date || '9999').localeCompare(b.due_date || '9999') || b.id - a.id : b.id - a.id) : (isOpenWork(a) ? -1 : 1));
  $('#workCount').textContent = `${rows.length}`;
  $('#workBody').innerHTML = rows.map(w => `<tr class="clickrow" data-follow="${w.id}"><td>${w.id}</td><td><button type="button" class="linkish" data-ficha="${w.camera_id}">${esc(camName(w.camera_id))}</button></td><td>${esc(w.task_type)}</td>
    <td>${prioBadge(w.priority)}</td><td>${stateLabel(w)}</td><td>${progressBar(w.progress)}</td><td>${esc(w.assignee) || '—'}</td><td>${fmtDate(w.due_date)}${isLate(w) ? ' ' + lateBadge : ''}</td>
    <td class="act"><span class="row-actions"><button class="btn small icon" data-follow="${w.id}" title="Seguimiento" aria-label="Seguimiento de la orden ${w.id}">${ICON.list}</button>${canTasks() ? `<button class="btn small icon" data-work="${w.id}" title="Editar" aria-label="Editar tarea ${w.id}">${ICON.edit}</button>` : ''}</span></td></tr>`).join('')
    || '<tr><td colspan="9">No hay tareas en esta vista.</td></tr>';
}
$('#workChips').addEventListener('click', (e) => { const b = e.target.closest('[data-wf]'); if (b) { workFilter.v = b.dataset.wf; renderWorks(); } });
$('#workBody').addEventListener('click', (e) => {
  if (e.target.closest('[data-ficha]')) return;
  let b = e.target.closest('[data-work]'); if (b) return openWork(state.works.find(w => w.id === +b.dataset.work));
  b = e.target.closest('[data-follow]'); if (b) openFollowup(state.works.find(w => w.id === +b.dataset.follow));
});
$('#newWork').addEventListener('click', () => openWork(null));
const camOptions = (sel) => state.cams.map(c => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>#${c.id} ${esc(c.name)} — ${esc(c.address || '')}</option>`).join('');

function openWork(w, prefill, onSaved) {
  const isNew = !w, ro = !canTasks() ? 'disabled' : '';
  const x = w || { status:'no_iniciado', progress:0, priority:'media', ...(prefill || {}) };
  const body = `<fieldset ${ro}><div class="grid">
    ${isNew ? field('idAuto', 'N° de tarea', '', 'disabled placeholder="Se asigna solo"') : field('id', 'N° de tarea', x.id, 'type="number" readonly')}
    <label>Cámara<select name="camera_id" required>${camOptions(x.camera_id)}</select></label>
    ${field('task_type', 'Tipo de tarea', x.task_type, 'required list="taskTypes"')}
    <datalist id="taskTypes"><option>Instalación</option><option>Servicio Técnico</option><option>Mantenimiento</option><option>Limpieza</option></datalist>
    <label>Prioridad<select name="priority">${options(PRIORITY, x.priority)}</select></label>
    <label>Estado<select name="status">${options(WSTATUS, x.status)}</select></label>
    ${field('progress', 'Avance %', x.progress, 'type="number" min="0" max="100" required')}
    ${field('assignee', 'Responsable', x.assignee)}
    ${field('start_date', 'Fecha de inicio', x.start_date, 'type="date"')}
    ${field('due_date', 'Fecha estimada de fin', x.due_date, 'type="date"')}
    ${field('completed_at', 'Fecha de finalización real', x.completed_at, 'type="date"')}
    ${area('notes', 'Descripción / notas', x.notes, 'wide')}</div></fieldset>`;
  openDialog(isNew ? 'Nueva tarea' : `Editar tarea #${x.id}`, body, canTasks() ? async (fd) => {
    const g = (k) => orNull((fd.get(k) ?? '').toString().trim());
    const p = { camera_id: +fd.get('camera_id'), task_type: g('task_type'), priority: fd.get('priority'), status: fd.get('status'), progress: +fd.get('progress'), assignee: g('assignee'),
      start_date: g('start_date'), due_date: g('due_date'), completed_at: g('completed_at'), notes: g('notes') };
    const r = w ? await sb.from('work_orders').update(p).eq('id', w.id) : await sb.from('work_orders').insert(p).select('id').single();
    if (r.error) throw r.error;
    if (!w && onSaved) await onSaved(r.data.id);
    toast('Tarea guardada'); await loadAll();
  } : null, w && canTasks() ? async () => {
    const r = await sb.from('work_orders').delete().eq('id', w.id); if (r.error) throw r.error; toast('Tarea eliminada'); await loadAll();
  } : null);
}

function openFollowup(w) {
  if (!w) return;
  const admin = canTasks(), team = isTeam(), ups = state.updates.filter(u => u.work_order_id === w.id);
  const canForm = (admin || team) && w.status !== 'cancelado' && !(team && w.status === 'completado');
  const KIND = { avance:'Avance', cierre:'Cierre', reapertura:'Reapertura', verificacion:'Verificación' };
  const kv = (k, v, cls = '') => `<div class="kv ${cls}"><dt>${k}</dt><dd>${v ? esc(v) : '—'}</dd></div>`;
  const tl = ups.map(u => `<article class="event"><time>${new Date(u.created_at).toLocaleDateString('es-AR')}<br>${hhmm(u.created_at)}</time><p><strong>${KIND[u.kind] || u.kind}${u.progress != null ? ` · ${u.progress}%` : ''}</strong> <span class="hint" style="margin:0">— ${esc(u.author_name || '')}</span><br>${esc(u.note)}</p></article>`).join('')
    || '<p class="hint">Todavía no hay avances registrados.</p>';
  const stMap = team ? { en_proceso:'En proceso', completado:'Trabajo terminado' } : WSTATUS;
  const form = canForm ? `<h3 class="sub">Registrar avance</h3><fieldset><div class="grid">
      <label>Estado<select name="status" id="fuStatus">${options(stMap, team ? 'en_proceso' : w.status)}</select></label>
      ${field('progress', 'Avance %', w.progress, 'type="number" min="0" max="100" id="fuProg"')}
      ${team ? field('who', 'Quién hizo el trabajo', '', 'required placeholder="Nombre y apellido"', 'wide') : ''}
      ${area('note', team ? 'Qué se hizo o qué falta' : 'Nota (qué se hizo o qué falta)', '', 'wide')}
      ${team ? '<p class="hint wide" id="fuHint" style="margin:0"></p>' : '<label class="check wide" id="fuCamWrap" hidden><input type="checkbox" name="camok"> Al cerrar la tarea, marcar la cámara como operativa</label>'}</div></fieldset>`
    : (team && w.status === 'completado' ? `<p class="hint" style="margin-top:14px">${w.verified_at ? 'Trabajo verificado por la operadora. ¡Gracias!' : 'Trabajo terminado: la operadora está verificando que la cámara funcione. Si no, la orden se reabre y te llega un aviso.'}</p>` : '');
  const reassign = admin && w.status !== 'cancelado' ? `<h3 class="sub">Equipo a cargo</h3><div class="grid" style="align-items:end"><label>Reasignar a<select id="fuTeam"><option value="">—</option>${state.teams.map(t => `<option value="${t.id}"${w.team_id === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label><div><button type="button" class="btn small" id="fuReassign">Reasignar y avisar al equipo</button></div></div>` : '';
  const body = `<div class="ficha-head">${prioBadge(w.priority)}<span class="count">${esc(stateLabel(w))}</span>${isLate(w) ? lateBadge : ''}</div>
    <dl class="kvgrid">${kv('Cámara', camName(w.camera_id))}${kv('Problema', ptLabel(w.problem_type) || w.task_type)}${kv('Equipo', teamName(w.team_id) || w.assignee)}${kv('Inicio', w.start_date && fmtDate(w.start_date))}${kv('Vence', w.due_date && fmtDate(w.due_date))}${kv('Cierre', w.completed_at && fmtDate(w.completed_at))}${kv('Detalle', w.notes, 'wide')}</dl>
    ${form}${reassign}<h3 class="sub">Seguimiento</h3><div class="timeline">${tl}</div>`;
  openDialog(`Orden #${w.id}`, body, canForm ? async (fd) => {
    const st = fd.get('status'), closing = st === 'completado' && w.status !== 'completado';
    let note = (fd.get('note') || '').toString().trim();
    if (team) { const who = (fd.get('who') || '').toString().trim(); if (!who) throw new Error('Escribí quién hizo el trabajo.'); if (!note) throw new Error('Contá qué se hizo o qué falta.'); note = `${who}: ${note}`; }
    const r = await sb.rpc('register_work_update', { p_work: w.id, p_note: note, p_progress: +fd.get('progress') || 0, p_status: st, p_camera_ok: !team && closing && !!fd.get('camok') });
    if (r.error) throw r.error; toast(closing ? (team ? 'Trabajo terminado: se avisó a la operadora' : 'Tarea cerrada') : 'Avance registrado'); await loadAll();
  } : null, null, () => {
    const s = $('#fuStatus');
    if (s) {
      const sync = () => {
        if ($('#fuCamWrap')) $('#fuCamWrap').hidden = s.value !== 'completado' || w.status === 'completado';
        if (s.value === 'completado') $('#fuProg').value = 100;
        if ($('#fuHint')) $('#fuHint').textContent = s.value === 'completado' ? 'La operadora verificará que la cámara funcione. Si no, la orden se reabre y te llega un nuevo aviso.' : '';
      };
      s.addEventListener('change', sync); sync();
    }
    const rb = $('#fuReassign');
    if (rb) rb.onclick = async () => {
      const t = $('#fuTeam').value; if (!t) return toast('Elegí el equipo.', true);
      if (!confirm(`¿Reasignar la orden #${w.id} a ${teamName(t)}? Se le avisa por mail.`)) return;
      const r = await sb.rpc('reassign_work', { p_work: w.id, p_team: t }); if (r.error) return fail(r.error);
      $('#dlgCancel').click(); toast('Orden reasignada'); await loadAll();
    };
  }, team ? 'Guardar' : 'Registrar');
}

/* ---------- para verificar (operadora y administración) ---------- */
function renderVerify() {
  const staff = ['admin', 'tecnico'].includes(state.me?.role), items = staff ? state.works.filter(needsVerify) : [];
  $('#verifyCard').hidden = !items.length; $('#verifyCount').textContent = `${items.length}`;
  $('#verifyList').innerHTML = items.map(w => {
    const cl = [...state.updates].reverse().find(u => u.work_order_id === w.id && u.kind === 'cierre');
    return `<div class="req verify"><div class="req-main"><div class="req-top"><span class="badge" style="background:#1f51ff22;color:#1f51ff">${esc(teamName(w.team_id))}</span><span class="hint" style="margin:0">Orden #${w.id} · ${esc(w.task_type)}${cl ? ` · terminada el ${fmtDate(localDate(cl.created_at))}` : ''}</span></div>
      <div class="entry-cams">${camChips([w.camera_id])}</div>${cl ? `<p><b>Cierre:</b> ${esc(cl.note)}</p>` : ''}</div>
      <div class="row-actions"><button class="btn small primary" data-vok="${w.id}">Cámara funcionando</button><button class="btn small" data-vbad="${w.id}">Sigue con problemas</button></div></div>`;
  }).join('');
}
document.addEventListener('click', (ev) => {
  const ok = ev.target.closest('[data-vok]'), bad = ev.target.closest('[data-vbad]');
  if (ok) {
    const w = state.works.find(x => x.id === +ok.dataset.vok); if (!w) return;
    openDialog('Confirmar que la cámara funciona', `<p>Orden #${w.id} · ${esc(camName(w.camera_id))}</p><p class="hint">Comprobá en el monitor que la cámara transmite bien. La cámara pasa a "Operativa" y la orden queda verificada.</p>${area('note', 'Comentario (opcional)', '', 'wide')}`, async (fd) => {
      const r = await sb.rpc('verify_work', { p_work: w.id, p_ok: true, p_note: (fd.get('note') || '').toString() }); if (r.error) throw r.error;
      toast('Verificada: la cámara quedó operativa'); await loadAll();
    }, null, null, 'Cámara funcionando');
  }
  if (bad) {
    const w = state.works.find(x => x.id === +bad.dataset.vbad); if (!w) return;
    openDialog('La cámara sigue con problemas', `<p>Orden #${w.id} · ${esc(camName(w.camera_id))}</p><p class="hint">La orden se reabre y el equipo recibe un nuevo aviso.</p>${area('note', '¿Qué sigue fallando?', '', 'wide')}`, async (fd) => {
      const r = await sb.rpc('verify_work', { p_work: w.id, p_ok: false, p_note: (fd.get('note') || '').toString() }); if (r.error) throw r.error;
      toast('Orden reabierta: se avisó al equipo'); await loadAll();
    }, null, null, 'Reabrir la orden');
  }
});

/* ---------- actas de turno ---------- */
const turnoNow = () => { const h = new Date().getHours(); return h >= 6 && h < 14 ? 'manana' : h >= 14 && h < 22 ? 'tarde' : 'noche'; };
const shiftDateNow = () => { const d = new Date(); if (d.getHours() < 6) d.setDate(d.getDate() - 1); return d.toLocaleDateString('en-CA'); };
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const shiftLabel = (s) => `${fmtDate(s.shift_date)} · Turno ${TURNO[s.shift_type]}`;
const entriesOf = (id) => state.entries.filter(e => e.shift_id === id);
const catBadge = (c) => `<span class="badge" style="background:${CATCOLOR[c]}22;color:${CATCOLOR[c]}">${CAT[c]}</span>`;
const camChips = (ids) => ids.length ? ids.map(i => `<button type="button" class="chip small" data-ficha="${i}">${esc(camName(i))}</button>`).join(' ') : '<span class="hint" style="margin:0">Sin cámara asociada</span>';
const entryTs = (shift, time) => {
  let d = shift.shift_date;
  if (shift.shift_type === 'noche' && time < '12:00') { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + 1); d = x.toLocaleDateString('en-CA'); }
  return new Date(`${d}T${time}:00`).toISOString();
};

const reqBadge = (e) => !e.needs_action ? '' : e.handled_at ? `<span class="badge" style="background:#1f51ff22;color:#1f51ff">${esc(e.handled_note || 'Atendida')}</span>` : '<span class="badge" style="background:#f2b60033;color:#8a6500">Solicitud pendiente</span>';
function entryRow(e, edit) {
  return `<div class="entry"><time>${hhmm(e.occurred_at)}</time><div class="entry-main">${catBadge(e.category)} ${reqBadge(e)} <span class="entry-cams">${camChips(e.camera_ids)}</span>
    <p>${esc(e.description)}</p>${e.action_taken ? `<p class="hint" style="margin:0"><b>Acción:</b> ${esc(e.action_taken)}</p>` : ''}</div>
    ${edit ? `<span class="row-actions"><button class="btn small icon" data-editentry="${e.id}" title="Editar" aria-label="Editar novedad">${ICON.edit}</button></span>` : ''}</div>`;
}
function shiftBlock(s) {
  const es = entriesOf(s.id), edit = canWork() && (s.operator_id === state.me.id || state.me.role === 'admin');
  return `<div class="shift"><div class="shift-head"><div><strong>${esc(shiftLabel(s))}</strong>
      <div class="hint" style="margin:2px 0 0">Operador: ${esc(s.operator_name)} · abierto ${hhmm(s.opened_at)} · ${es.length} novedad${es.length === 1 ? '' : 'es'}</div></div>
      <div class="row-actions">${edit ? `<button class="btn" data-addentry="${s.id}">Agregar novedad</button><button class="btn primary" data-closeshift="${s.id}">Cerrar turno</button>` : ''}<button class="btn icon" data-acta="${s.id}" title="Vista previa del acta" aria-label="Vista previa del acta">${ICON.eye}</button></div></div>
    <div class="entries">${es.map(e => entryRow(e, edit)).join('') || '<p class="hint">Todavía no hay novedades en este turno.</p>'}</div></div>`;
}
function renderActas() {
  const open = state.shifts.filter(s => s.status === 'abierta'), mine = open.filter(s => s.operator_id === state.me.id);
  const canOpen = canWork() && !mine.length;
  $('#shiftBody').innerHTML = open.map(shiftBlock).join('')
    + (canOpen ? `<div class="shift-empty">${open.length ? '' : '<p class="hint" style="margin:0 0 12px">No hay ningún turno abierto.</p>'}<button class="btn primary" id="openShiftBtn">Abrir turno</button></div>` : '')
    || '<p class="hint">No hay ningún turno abierto.</p>';
  const q = $('#actaSearch').value.trim().toLowerCase(), t = $('#actaTurno').value;
  const rows = state.shifts.filter(s => (t === 'all' || s.shift_type === t) && (!q || [s.acta_no, s.operator_name, fmtDate(s.shift_date), TURNO[s.shift_type]].join(' ').toLowerCase().includes(q)));
  $('#actaCount').textContent = `${rows.length}`;
  $('#actaBody').innerHTML = rows.map(s => `<tr><td>${s.acta_no ?? '—'}</td><td>${fmtDate(s.shift_date)}</td><td>${TURNO[s.shift_type]}</td><td>${esc(s.operator_name)}</td><td>${entriesOf(s.id).length}</td>
    <td>${s.status === 'abierta' ? '<span class="badge" style="background:#e99a0522;color:#a06400">Abierta</span>' : '<span class="badge" style="background:#1f51ff22;color:#1f51ff">Cerrada</span>'}</td>
    <td class="act"><button class="btn small icon" data-acta="${s.id}" title="Ver acta" aria-label="Ver acta">${ICON.eye}</button></td></tr>`).join('') || '<tr><td colspan="7">Todavía no hay actas.</td></tr>';
}
$('#actaSearch').addEventListener('input', renderActas);
$('#actaTurno').addEventListener('input', renderActas);
$('#tab-actas').addEventListener('click', (e) => {
  const t = (k) => e.target.closest(`[${k}]`); let b;
  if ((b = t('data-addentry'))) openEntry(state.shifts.find(s => s.id === +b.dataset.addentry), null);
  else if ((b = t('data-editentry'))) { const en = state.entries.find(x => x.id === +b.dataset.editentry); openEntry(state.shifts.find(s => s.id === en.shift_id), en); }
  else if ((b = t('data-closeshift'))) openClose(state.shifts.find(s => s.id === +b.dataset.closeshift));
  else if ((b = t('data-acta'))) openActa(+b.dataset.acta);
  else if (e.target.closest('#openShiftBtn')) openShiftDlg();
});

function openShiftDlg() {
  const body = `<fieldset><div class="grid">
    ${field('shift_date', 'Fecha del turno', shiftDateNow(), 'type="date" required')}
    <label>Turno<select name="shift_type">${options(TURNO, turnoNow())}</select></label>
    ${field('operator_name', 'Operador', state.me.name, 'required', 'wide')}</div></fieldset>
    <p class="hint">Se abre el acta del turno. Podés ir sumando novedades y, al terminar, cerrarlo.</p>`;
  openDialog('Abrir turno', body, async (fd) => {
    const r = await sb.from('shifts').insert({ shift_date: fd.get('shift_date'), shift_type: fd.get('shift_type'), operator_name: fd.get('operator_name').toString().trim() });
    if (r.error) throw r.error; toast('Turno abierto'); await loadAll();
  }, null, null, 'Abrir turno');
}

function openEntry(shift, entry) {
  const isNew = !entry, locked = !!(entry && entry.handled_at), hasType = !!(entry && entry.problem_type);
  const e = entry || { category: 'novedad', camera_ids: [], occurred_at: new Date().toISOString() }, sel = new Set(e.camera_ids);
  const list = state.cams.filter(c => c.active).map(c => `<label class="check cam-opt" data-t="${esc([c.id, c.name, c.address].join(' ').toLowerCase())}"><input type="checkbox" name="cams" value="${c.id}"${sel.has(c.id) ? ' checked' : ''}> #${c.id} ${esc(c.name)} <span class="hint" style="margin:0">— ${esc(c.address || '')}</span></label>`).join('');
  const ptOpts = '<option value="">— Solo una novedad: no hay nada que reparar o limpiar —</option>'
    + state.problemTypes.filter(p => p.active).sort((a, b) => a.sort - b.sort).map(p => `<option value="${p.code}"${e.problem_type === p.code ? ' selected' : ''}>${esc(p.label)}</option>`).join('');
  const body = `<fieldset><div class="grid">
    ${field('time', 'Hora', hhmm(e.occurred_at), 'type="time" required')}
    <label>Tipo<select name="category" id="catSel">${options(CAT, e.category)}</select></label>
    <div class="wide"><label>Cámaras involucradas<input type="search" id="camFind" placeholder="Buscar cámara…"></label><div class="checklist" id="camList">${list}</div></div>
    ${area('description', 'Qué pasó', e.description, 'wide')}
    ${area('action_taken', 'Acción tomada', e.action_taken, 'wide')}</div></fieldset>
    <fieldset><legend>¿Hay que enviar a alguien a resolverlo?</legend><div class="grid">
      <label class="wide">Tipo de problema<select name="problem_type" id="ptSel" ${(locked || hasType) ? 'disabled' : ''}>${ptOpts}</select></label>
      <p class="hint wide" id="ptInfo" style="margin:0"></p></div></fieldset>
    ${isNew ? `<fieldset><legend>Estado de las cámaras</legend><div class="grid">
      <label class="check wide"><input type="checkbox" name="chg" id="chgChk"> Cambiar el estado de las cámaras elegidas a:</label>
      <label class="wide"><select name="newstatus" id="stSel">${options(STATUS, 'falta_red')}</select></label></div></fieldset>` : ''}`;
  openDialog(isNew ? 'Agregar novedad' : 'Editar novedad', body, async (fd) => {
    const g = (k) => orNull((fd.get(k) ?? '').toString().trim());
    const cams = fd.getAll('cams').map(Number), desc = g('description'), category = fd.get('category');
    const pt = hasType ? entry.problem_type : (fd.get('problem_type') || null), ptRow = state.problemTypes.find(x => x.code === pt);
    if (!desc) throw new Error('Escribí qué pasó.');
    if (isNew && fd.get('chg') && !cams.length) throw new Error('Elegí al menos una cámara para cambiar su estado.');
    if (isNew && ptRow?.team_id && !cams.length) throw new Error('Elegí la cámara afectada para enviar el pedido al equipo.');
    const p = { occurred_at: entryTs(shift, fd.get('time')), category, description: desc, action_taken: g('action_taken'), camera_ids: cams };
    if (isNew) p.problem_type = pt;
    if (!locked) p.needs_action = category === 'falla' || !!pt;
    if (!isNew) { const r = await sb.from('shift_entries').update(p).eq('id', entry.id); if (r.error) throw r.error; toast('Novedad guardada'); await loadAll(); return; }
    const ins = await sb.from('shift_entries').insert({ shift_id: shift.id, ...p }).select('id').single();
    if (ins.error) throw ins.error;
    const done = [];
    if (ptRow?.team_id) done.push(`pedido enviado a ${teamName(ptRow.team_id)}`); else if (p.needs_action) done.push('solicitud enviada a la administración');
    if (fd.get('chg')) {
      const r = await sb.rpc('report_cameras_status', { p_cams: cams, p_status: fd.get('newstatus') });
      if (r.error) { await loadAll(); throw new Error('La novedad se guardó, pero no se pudo cambiar el estado: ' + r.error.message); }
      done.push('estado actualizado');
    }
    toast('Novedad registrada' + (done.length ? ' · ' + done.join(' · ') : '')); await loadAll();
  }, !isNew && !locked ? async () => { const r = await sb.from('shift_entries').delete().eq('id', entry.id); if (r.error) throw r.error; toast('Novedad eliminada'); await loadAll(); } : null, () => {
    $('#camFind').addEventListener('input', (ev) => { const q = ev.target.value.trim().toLowerCase(); document.querySelectorAll('.cam-opt').forEach(l => { l.hidden = !!q && !l.dataset.t.includes(q); }); });
    const sel2 = $('#ptSel'), info = $('#ptInfo'), cat = $('#catSel'), chg = $('#chgChk'), st = $('#stSel');
    const describe = () => {
      const p = state.problemTypes.find(x => x.code === sel2.value);
      if (!p) info.textContent = hasType ? `Ya derivada: ${ptLabel(entry.problem_type)}.` : 'Solo queda registrado en el acta. Si hay algo para reparar o limpiar, elegí el tipo de problema y el sistema avisa solo.';
      else if (!p.team_id) info.textContent = 'No se deriva sola: la administración decide a quién enviar.';
      else info.innerHTML = `Se envía automáticamente a <b>${esc(teamName(p.team_id))}</b> · prioridad ${PRIORITY[p.priority]} · plazo ${plazo(p.due_hours)}. Se crea una orden por cada cámara elegida.`;
    };
    sel2.addEventListener('change', () => {
      describe(); const p = state.problemTypes.find(x => x.code === sel2.value);
      if (p && cat.value !== 'falla') cat.value = 'falla';
      if (p?.suggested_status && chg) { chg.checked = true; st.value = p.suggested_status; }
    });
    describe();
  });
}

function openClose(shift) {
  const n = entriesOf(shift.id).length;
  openDialog('Cerrar turno', `<p><strong>${esc(shiftLabel(shift))}</strong> · ${n} novedad${n === 1 ? '' : 'es'} registrada${n === 1 ? '' : 's'}.</p>
    <p class="hint">Al cerrar, el acta queda guardada como registro y ya no se puede modificar. Se envía un resumen por mail a los destinatarios.</p>
    ${area('handover', 'Observaciones de entrega al turno siguiente', shift.handover_notes, 'wide')}`, async (fd) => {
    const r = await sb.rpc('close_shift', { p_shift: shift.id, p_handover: (fd.get('handover') || '').toString().trim() });
    if (r.error) throw r.error;
    toast(`Acta N° ${r.data} cerrada`); await loadAll(); setTimeout(() => openActa(shift.id), 250);
  }, null, null, 'Cerrar y guardar acta');
}

function liveSnap(s) {
  const cnt = {}; state.cams.filter(c => c.active).forEach(c => { cnt[c.status] = (cnt[c.status] || 0) + 1; });
  return { acta_no: s.acta_no, shift_date: s.shift_date, shift_type: s.shift_type, operator: s.operator_name, opened_at: s.opened_at, closed_at: s.closed_at, handover_notes: s.handover_notes, cameras: cnt,
    open_tasks: state.works.filter(w => !['completado', 'cancelado'].includes(w.status)).length,
    entries: entriesOf(s.id).map(e => ({ time: hhmm(e.occurred_at), category: e.category, description: e.description, action_taken: e.action_taken, cameras: e.camera_ids.map(i => camName(i).slice(1)), work_orders: e.work_order_ids })) };
}
function actaHtml(a, draft) {
  const cnt = a.cameras || {}, fault = (cnt.falla || 0) + (cnt.falta_red || 0) + (cnt.sin_senal || 0);
  const kv = (k, v) => `<div class="kv"><dt>${k}</dt><dd>${v ? esc(v) : '—'}</dd></div>`;
  const dt = (t) => t ? new Date(t).toLocaleString('es-AR', { hour12: false }) : '—';
  const rows = (a.entries || []).map(e => `<tr><td>${esc(e.time)}</td><td>${esc(CAT[e.category] || e.category)}</td><td>${(e.cameras || []).map(x => esc(x)).join('<br>') || '—'}</td><td class="wrap">${esc(e.description)}</td><td class="wrap">${esc(e.action_taken) || '—'}${(e.work_orders || []).length ? `<br><em>Tarea N° ${e.work_orders.join(', ')}</em>` : ''}</td></tr>`).join('') || '<tr><td colspan="5">Sin novedades registradas en el turno.</td></tr>';
  return `<article class="acta">
    <header class="acta-head"><img src="/assets/logo-san-jose-de-la-esquina.svg" alt="Municipalidad de San José de la Esquina"><div><h2>Acta de turno ${a.acta_no ? 'N° ' + a.acta_no : '(borrador)'}</h2><p>Central de Monitoreo · Municipalidad de San José de la Esquina</p></div></header>
    <dl class="kvgrid">${kv('Fecha', fmtDate(a.shift_date))}${kv('Turno', TURNO[a.shift_type])}${kv('Operador', a.operator)}${kv('Apertura', dt(a.opened_at))}${kv('Cierre', draft ? 'Turno en curso' : dt(a.closed_at))}${kv('Tareas pendientes', String(a.open_tasks ?? '—'))}
      ${kv('Estado de las cámaras', `${cnt.operativa || 0} operativas · ${fault} con falla · ${cnt.mantenimiento || 0} en mantenimiento · ${cnt.sin_instalar || 0} sin instalar`)}</dl>
    <h3 class="sub">Novedades del turno</h3>
    <div class="table-scroll"><table><thead><tr><th>Hora</th><th>Tipo</th><th>Cámaras</th><th>Descripción</th><th>Acción tomada</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h3 class="sub">Observaciones de entrega</h3><p>${esc(a.handover_notes) || '—'}</p>
    <div class="firmas"><div>Operador<br><small>${esc(a.operator)}</small></div><div>Responsable de la Central</div></div>
    <p class="hint">${draft ? 'Borrador: el acta se congela al cerrar el turno.' : 'Registro guardado en el sistema: este contenido no se puede modificar.'}</p></article>`;
}
function printActa(html) {
  const area = $('#printArea'); area.innerHTML = html; document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); area.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done); window.print();
}
function openActa(id) {
  const s = state.shifts.find(x => x.id === id); if (!s) return;
  const draft = s.status === 'abierta', snap = draft ? liveSnap(s) : (s.snapshot || liveSnap(s));
  const body = actaHtml(snap, draft) + `<div class="actions" style="position:static;justify-content:flex-start;margin-top:12px;padding:0"><button type="button" class="btn primary" id="actaPrint">Imprimir / Guardar PDF</button>${state.me.role === 'admin' && !draft ? '<button type="button" class="btn" id="actaReopen">Reabrir acta</button>' : ''}</div>`;
  openDialog('Vista del acta', body, null);
  $('#actaPrint').onclick = () => printActa(actaHtml(snap, draft));
  const ro = $('#actaReopen');
  if (ro) ro.onclick = async () => {
    if (!confirm('¿Reabrir esta acta? Se podrá editar otra vez y se vuelve a congelar al cerrarla.')) return;
    const r = await sb.rpc('reopen_shift', { p_shift: id }); if (r.error) return fail(r.error);
    $('#dlgCancel').click(); toast('Acta reabierta'); await loadAll();
  };
}

/* ---------- diálogo genérico ---------- */
function openDialog(title, body, onSave, onDelete, afterOpen, saveLabel) {
  const form = $('#dlgForm');
  form.innerHTML = `<h2>${esc(title)}</h2><div class="edit-form">${body}</div>
    <p class="form-msg" id="dlgMsg" role="alert"></p>
    <div class="actions"><button type="button" class="btn" id="dlgCancel">${onSave ? 'Cancelar' : 'Cerrar'}</button>
    ${onDelete ? '<button type="button" class="btn danger" id="dlgDelete">Eliminar</button>' : ''}
    ${onSave ? `<button type="submit" class="btn primary">${esc(saveLabel || 'Guardar')}</button>` : ''}</div>`;
  const dlg = $('#dlg'), msg = $('#dlgMsg');
  const dispose = () => { if (miniMap) { miniMap.remove(); miniMap = null; miniMarker = null; } };
  const close = () => { dispose(); dlg.close(); };
  $('#dlgCancel').onclick = close;
  if (onDelete) $('#dlgDelete').onclick = async () => { if (!confirm('¿Eliminar definitivamente? Queda registrado en el historial de cambios.')) return; try { await onDelete(); close(); } catch (e) { msg.textContent = e.message; } };
  const human = (m = '') => /row-level security.*work_orders|work_orders.*row-level/.test(m) ? 'Solo la administración puede crear o modificar tareas.' : /team_contacts_team_id_email/.test(m) ? 'Ese correo ya está cargado en el equipo.' : /alert_recipients_email/.test(m) ? 'Ese correo ya está cargado.' : /shifts_shift_date/.test(m) ? 'Ya existe un acta para esa fecha y turno.' : /type inet/.test(m) ? 'La IP no es válida (ejemplo: 192.168.1.35).' : /duplicate key.*ip/.test(m) ? 'Esa IP ya está asignada a otra cámara.' : /epe_contract/.test(m) && /duplicate/.test(m) ? 'Ese contrato EPE ya está asignado a otra cámara.' : /duplicate key/.test(m) ? 'Ya existe un registro con ese número.' : m;
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
    const col = MAPCOLOR[c.status];
    L.circleMarker([c.lat, c.lng], { radius: 9, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1 }).addTo(bigLayer)
      .bindPopup(`<strong>#${c.id} ${esc(c.name)}</strong><br>${esc(c.address || '')}<br>${STATUS[c.status]}<br><button type="button" class="btn small" data-ficha="${c.id}" style="margin-top:8px">Ver ficha</button>`);
    if (c.azimuth_deg != null && c.fov_deg && c.range_m) L.polygon(cone(c), { color: col, weight: 1, fillOpacity: .15 }).addTo(bigLayer);
  });
  const cnt = (s) => located.filter(c => c.status === s).length, none = active.length - located.length;
  $('#mapChips').innerHTML = Object.keys(STATUS).filter(s => cnt(s)).map(s => `<button type="button" class="chip${mapFilter.has(s) ? ' on' : ''}" data-status="${s}" aria-pressed="${mapFilter.has(s)}"><i style="background:${MAPCOLOR[s]}"></i>${STATUS[s]} <b>${cnt(s)}</b></button>`).join('')
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

/* ---------- solicitudes de intervención ---------- */
function renderRequests() {
  const pend = state.entries.filter(e => e.needs_action && !e.handled_at).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  $('#reqCard').hidden = !pend.length; $('#reqCount').textContent = `${pend.length}`;
  $('#reqList').innerHTML = pend.map(e => { const s = state.shifts.find(x => x.id === e.shift_id);
    return `<div class="req"><div class="req-main"><div class="req-top">${catBadge(e.category)}<span class="hint" style="margin:0">${fmtDate(localDate(e.occurred_at))} ${hhmm(e.occurred_at)} · ${esc(s?.operator_name || '')}</span></div>
      <div class="entry-cams">${camChips(e.camera_ids)}</div><p>${esc(e.description)}</p>${e.action_taken ? `<p class="hint" style="margin:4px 0 0"><b>Acción del operador:</b> ${esc(e.action_taken)}</p>` : ''}</div>
      ${canTasks() ? `<div class="row-actions"><button class="btn small primary" data-reqtask="${e.id}">Crear tarea</button><button class="btn small" data-reqdone="${e.id}">Marcar atendida</button></div>` : ''}</div>`; }).join('');
}
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-reqtask]'), d = ev.target.closest('[data-reqdone]');
  if (t) {
    const e = state.entries.find(x => x.id === +t.dataset.reqtask); if (!e) return;
    openWork(null, { camera_id: e.camera_ids[0], task_type: 'Servicio Técnico', priority: e.category === 'falla' ? 'alta' : 'media', notes: e.description }, async (taskId) => {
      if (e.camera_ids.length <= 1) { const r = await sb.rpc('resolve_request', { p_entry: e.id, p_task: taskId, p_note: null }); if (r.error) throw r.error; }
      else toast('Tarea creada. Cuando termines con todas las cámaras, marcá la solicitud como atendida.');
    });
  }
  if (d) {
    const e = state.entries.find(x => x.id === +d.dataset.reqdone); if (!e) return;
    openDialog('Marcar solicitud como atendida', `<p>${esc(e.description)}</p>${area('note', 'Qué se resolvió (opcional)', '', 'wide')}`, async (fd) => {
      const r = await sb.rpc('resolve_request', { p_entry: e.id, p_task: null, p_note: (fd.get('note') || '').toString() }); if (r.error) throw r.error;
      toast('Solicitud atendida'); await loadAll();
    }, null, null, 'Marcar atendida');
  }
});

/* ---------- evolución de cobertura ---------- */
function renderHistoryChart() {
  const d = state.kpis, el = $('#dashHistory');
  if (!d.length) { el.innerHTML = '<p class="hint">Todavía no hay registros.</p>'; return; }
  const W = 480, H = 240, p = 38, x = (i) => d.length === 1 ? W / 2 : p + 22 + i * (W - p * 2 - 44) / (d.length - 1), y = (v) => H - p - (Math.max(0, Math.min(100, v)) / 100) * (H - p * 2);
  const pts = d.map((v, i) => `${x(i)},${y(v.coverage)}`).join(' ');
  el.innerHTML = `<svg class="line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución de la cobertura">
    ${[0, 50, 100].map(g => `<line x1="${p}" x2="${W - p}" y1="${y(g)}" y2="${y(g)}" stroke="var(--grid)"/><text x="${p - 6}" y="${y(g) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${g}%</text>`).join('')}
    <polyline points="${pts}" fill="none" stroke="var(--blue)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${d.map((v, i) => `<circle cx="${x(i)}" cy="${y(v.coverage)}" r="5" fill="var(--blue)"><title>${esc(v.week_label || '')}: ${v.coverage}%</title></circle>
      <text x="${x(i)}" y="${y(v.coverage) - 10}" text-anchor="middle" font-size="11" font-weight="800" fill="var(--text)">${v.coverage}%</text>
      <text x="${x(i)}" y="${H - 12}" text-anchor="middle" font-size="10" fill="var(--muted)">${fmtDate(v.date).slice(0, 5)}</text>`).join('')}</svg>`;
}

/* ---------- exportar a planilla (CSV) ---------- */
function downloadCsv(name, rows) {
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+@\t]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const csv = '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name}-${localDate(Date.now())}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('Archivo descargado');
}
$('#exportCams').addEventListener('click', () => downloadCsv('camaras', [
  ['ID', 'Nombre', 'Modelo', 'Tipo', 'Dirección', 'Zona', 'Estado', 'Estado desde', 'Prioridad', 'IP', 'MAC', 'N° serie', 'Contrato EPE', 'Enlace', 'Energía', 'Latitud', 'Longitud', 'Ubicación verificada', 'Última revisión', 'Función', 'Observaciones', 'Activa'],
  ...state.cams.map(c => [c.id, c.name, c.model, c.camera_type, c.address, c.zone, STATUS[c.status], fmtDate(localDate(c.status_since)), PRIORITY[c.priority], c.ip, c.mac, c.serial, state.contracts.get(c.epe_contract_id)?.supply_number, c.link_type, c.power_source, c.lat, c.lng, c.coords_verified ? 'Sí' : 'No', fmtDate(c.last_review_at), c.function, c.notes, c.active ? 'Sí' : 'No'])]));
$('#exportWorks').addEventListener('click', () => downloadCsv('tareas', [
  ['N°', 'Cámara', 'Tarea', 'Prioridad', 'Estado', 'Avance %', 'Responsable', 'Inicio', 'Vence', 'Cierre real', 'Notas'],
  ...state.works.map(w => [w.id, camName(w.camera_id), w.task_type, PRIORITY[w.priority], WSTATUS[w.status], w.progress, w.assignee, fmtDate(w.start_date), fmtDate(w.due_date), fmtDate(w.completed_at), w.notes])]));
$('#exportActas').addEventListener('click', () => downloadCsv('actas', [
  ['Acta N°', 'Fecha', 'Turno', 'Operador', 'Estado', 'Hora', 'Tipo', 'Cámaras', 'Descripción', 'Acción tomada', 'Observaciones de entrega'],
  ...state.shifts.flatMap(s => { const es = entriesOf(s.id); const base = [s.acta_no ?? '', fmtDate(s.shift_date), TURNO[s.shift_type], s.operator_name, s.status === 'abierta' ? 'Abierta' : 'Cerrada'];
    return es.length ? es.map(e => [...base, hhmm(e.occurred_at), CAT[e.category], e.camera_ids.map(i => camName(i)).join(' | '), e.description, e.action_taken, s.handover_notes]) : [[...base, '', '', '', '', '', s.handover_notes]]; })]));

/* ---------- usuarios y avisos ---------- */
const ROLE = { admin:'Administrador', tecnico:'Operador', lector:'Solo lectura', cuadrilla:'Cuadrilla' };
async function callUsers(body) {
  const r = await sb.functions.invoke('admin-users', { body });
  if (r.error) { let m = r.error.message; try { const j = await r.error.context.json(); m = j.error || m; } catch (e) {} throw new Error(m); }
  if (r.data?.error) throw new Error(r.data.error);
  return r.data;
}
async function loadAdmin() {
  const [u, r, tc] = await Promise.allSettled([callUsers({ action: 'list' }), sb.from('alert_recipients').select('*').order('id'), sb.from('team_contacts').select('*').order('team_id').order('id')]);
  state.contacts = tc.status === 'fulfilled' && !tc.value.error ? tc.value.data : []; renderTeams();
  if (u.status === 'fulfilled') state.users = u.value.users; else { state.users = []; $('#userBody').innerHTML = `<tr><td colspan="6">No se pudo cargar la lista: ${esc(u.reason.message)}</td></tr>`; }
  state.rcpts = r.status === 'fulfilled' && !r.value.error ? r.value.data : [];
  if (u.status === 'fulfilled') renderUsers(); renderRcpts();
}
function renderUsers() {
  $('#userBody').innerHTML = state.users.map(u => `<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td><td>${ROLE[u.role]}</td>
    <td>${u.active ? '<span class="badge" style="background:#1f51ff22;color:#1f51ff">Activo</span>' : '<span class="badge" style="background:#767c8a22;color:#767c8a">Desactivado</span>'}</td>
    <td>${u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString('es-AR', { hour12: false }) : 'Nunca'}</td>
    <td class="act"><span class="row-actions"><button class="btn small" data-uedit="${u.user_id}">Editar</button><button class="btn small" data-ureset="${u.user_id}">Nueva clave</button></span></td></tr>`).join('') || '<tr><td colspan="6">Sin usuarios.</td></tr>';
}
function renderRcpts() {
  $('#rcptBody').innerHTML = state.rcpts.map(r => `<tr><td>${esc(r.email)}</td><td>${esc(r.name) || '—'}</td>
    <td><button class="btn small" data-rtoggle="${r.id}">${r.active ? 'Activo — pausar' : 'Pausado — activar'}</button></td>
    <td><button class="btn small" data-ractas="${r.id}" title="Cierre de actas y solicitudes de intervención">${r.receives_actas ? 'Los recibe — desactivar' : 'No los recibe — activar'}</button></td>
    <td class="act"><button class="btn small danger" data-rdel="${r.id}">Quitar</button></td></tr>`).join('') || '<tr><td colspan="5">Todavía no hay destinatarios: no se enviará ningún aviso.</td></tr>';
}
$('#newUser').addEventListener('click', () => openDialog('Nuevo usuario', `<fieldset><div class="grid">
    ${field('name', 'Nombre y apellido', '', 'required')}${field('email', 'Correo', '', 'type="email" required')}
    <label>Rol<select name="role">${options({ admin: ROLE.admin, tecnico: ROLE.tecnico, lector: ROLE.lector }, 'tecnico')}</select></label>${field('organization', 'Organización', 'Municipalidad')}</div></fieldset>
    <p class="hint"><b>Operador:</b> carga actas y tareas. <b>Solo lectura:</b> ve todo sin modificar. <b>Administrador:</b> todo.<br>Se genera una contraseña temporal y se envía por mail a la persona, que debe cambiarla al ingresar.</p>`, async (fd) => {
  await callUsers({ action: 'create', name: fd.get('name').toString().trim(), email: fd.get('email').toString().trim(), role: fd.get('role'), organization: fd.get('organization').toString().trim() });
  toast('Usuario creado y acceso enviado por mail'); await loadAdmin();
}, null, null, 'Crear y enviar acceso'));
$('#userBody').addEventListener('click', async (e) => {
  const ed = e.target.closest('[data-uedit]'), rs = e.target.closest('[data-ureset]');
  if (ed) { const u = state.users.find(x => x.user_id === ed.dataset.uedit);
    openDialog(`Editar a ${u.name}`, `<fieldset><div class="grid">${field('name', 'Nombre', u.name, 'required')}<label>Rol<select name="role">${options(ROLE, u.role)}</select></label>
      <label class="check wide"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Puede ingresar al panel</label></div></fieldset><p class="hint">${esc(u.email)}</p>`, async (fd) => {
      await callUsers({ action: 'update', user_id: u.user_id, name: fd.get('name').toString().trim(), role: fd.get('role'), active: fd.get('active') === 'on' });
      toast('Usuario actualizado'); await loadAdmin(); }); }
  if (rs) { const u = state.users.find(x => x.user_id === rs.dataset.ureset);
    if (!confirm(`¿Generar una contraseña nueva para ${u.name} y enviarla a ${u.email}?`)) return;
    try { await callUsers({ action: 'reset', user_id: u.user_id }); toast('Contraseña nueva enviada por mail'); } catch (err) { fail(err); } }
});
$('#newRcpt').addEventListener('click', () => openDialog('Agregar destinatario', `<fieldset><div class="grid">${field('email', 'Correo', '', 'type="email" required')}${field('name', 'Nombre (opcional)', '')}</div></fieldset>`, async (fd) => {
  const r = await sb.from('alert_recipients').insert({ email: fd.get('email').toString().trim(), name: orNull(fd.get('name').toString().trim()) });
  if (r.error) throw r.error; toast('Destinatario agregado'); await loadAdmin();
}));
$('#rcptBody').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-rtoggle]'), d = e.target.closest('[data-rdel]'), a = e.target.closest('[data-ractas]');
  if (a) { const r0 = state.rcpts.find(x => x.id === +a.dataset.ractas); const r = await sb.from('alert_recipients').update({ receives_actas: !r0.receives_actas }).eq('id', r0.id); if (r.error) return fail(r.error); toast(r0.receives_actas ? `${r0.name || r0.email} dejó de recibir avisos de actas` : `${r0.name || r0.email} vuelve a recibir avisos de actas`); await loadAdmin(); }
  if (t) { const r0 = state.rcpts.find(x => x.id === +t.dataset.rtoggle); const r = await sb.from('alert_recipients').update({ active: !r0.active }).eq('id', r0.id); if (r.error) return fail(r.error); await loadAdmin(); }
  if (d) { const r0 = state.rcpts.find(x => x.id === +d.dataset.rdel); if (!confirm(`¿Quitar a ${r0.email} de los avisos?`)) return; const r = await sb.from('alert_recipients').delete().eq('id', r0.id); if (r.error) return fail(r.error); toast('Destinatario quitado'); await loadAdmin(); }
});
$('#adminTab').addEventListener('click', () => showTab('admin'));
document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) showTab(b.dataset.go); });

/* ---------- protocolo de trabajo ---------- */
function protocoloHtml() {
  const rows = state.problemTypes.filter(p => p.active).sort((a, b) => a.sort - b.sort).map(p => `<tr><td>${esc(p.label)}</td><td>${p.team_id ? esc(teamName(p.team_id)) : 'La administración decide'}</td><td>${p.team_id ? PRIORITY[p.priority] : '—'}</td><td>${p.team_id ? plazo(p.due_hours) : '—'}</td></tr>`).join('');
  return `<article class="acta proto"><header class="acta-head"><img src="/assets/logo-san-jose-de-la-esquina.svg" alt="Municipalidad de San José de la Esquina"><div><h2>Protocolo de atención de fallas</h2><p>Central de Monitoreo · Municipalidad de San José de la Esquina</p></div></header>
    <h3 class="sub">¿A quién se envía cada problema?</h3>
    <div class="table-scroll"><table><thead><tr><th>Problema</th><th>Se envía a</th><th>Prioridad</th><th>Plazo</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h3 class="sub">Cómo se trabaja</h3>
    <ol class="steps">
      <li><b>Detección.</b> La operadora ve el problema en el monitor.</li>
      <li><b>Registro.</b> Lo anota en el acta con "Agregar novedad": elige las cámaras y el tipo de problema.</li>
      <li><b>Envío automático.</b> El sistema crea la orden y avisa por mail al equipo que corresponde, con prioridad y fecha límite.</li>
      <li><b>Atención.</b> La cuadrilla entra al panel, va a "Mantenimiento", registra los avances (quién hizo el trabajo y qué se hizo) y, al terminar, toca "Trabajo terminado".</li>
      <li><b>Verificación.</b> La operadora comprueba en el monitor: "Cámara funcionando" cierra la orden y deja la cámara operativa; "Sigue con problemas" reabre la orden y vuelve a avisar al equipo.</li>
      <li><b>Plazos.</b> Si se vence el plazo, el equipo y la administración reciben un recordatorio.</li>
      <li><b>Otros casos.</b> Si el problema no figura en la lista ("Otro / no sé"), la administración decide a quién enviarlo.</li>
    </ol></article>`;
}
$('#protoBtn').addEventListener('click', () => {
  closeMenu();
  openDialog('Protocolo de trabajo', protocoloHtml() + '<div class="actions" style="position:static;justify-content:flex-start;margin-top:12px;padding:0"><button type="button" class="btn primary" id="protoPrint">Imprimir / Guardar PDF</button></div>', null);
  $('#protoPrint').onclick = () => printActa(protocoloHtml());
});

/* ---------- equipos de trabajo (correos que reciben las órdenes) ---------- */
function renderTeams() {
  $('#teamBody').innerHTML = state.contacts.map(c => `<tr><td>${esc(teamName(c.team_id))}</td><td>${esc(c.email)}</td><td>${esc(c.name) || '—'}</td><td class="act"><button class="btn small danger" data-tdel="${c.id}">Quitar</button></td></tr>`).join('')
    || '<tr><td colspan="4">Todavía no hay correos cargados: los equipos ven sus órdenes al entrar al panel, pero no reciben aviso por mail.</td></tr>';
}
$('#newTeamContact').addEventListener('click', () => openDialog('Agregar correo a un equipo', `<fieldset><div class="grid"><label>Equipo<select name="team_id">${state.teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>${field('email', 'Correo', '', 'type="email" required')}${field('name', 'Nombre (opcional)', '')}</div></fieldset><p class="hint">Este correo recibe un aviso cada vez que se asigna, se reabre o vence una orden de su equipo.</p>`, async (fd) => {
  const r = await sb.from('team_contacts').insert({ team_id: fd.get('team_id'), email: fd.get('email').toString().trim().toLowerCase(), name: orNull(fd.get('name').toString().trim()) });
  if (r.error) throw r.error; toast('Correo agregado'); await loadAdmin();
}));
$('#teamBody').addEventListener('click', async (e) => {
  const d = e.target.closest('[data-tdel]'); if (!d) return;
  if (!confirm('¿Quitar este correo del equipo?')) return;
  const r = await sb.from('team_contacts').delete().eq('id', +d.dataset.tdel); if (r.error) return fail(r.error);
  toast('Correo quitado'); await loadAdmin();
});

/* ---------- modo pantalla ---------- */
let kiosk = false, kioskTimer = null;
const kioskTick = () => { const t = new Date().toLocaleString('es-AR', { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false }); $('#kioskClock').textContent = t.charAt(0).toUpperCase() + t.slice(1); };
function setKiosk(on) {
  kiosk = on; document.body.classList.toggle('kiosk', on); $('#kioskBar').hidden = !on;
  clearInterval(kioskTimer);
  if (on) { showTab('dashboard'); kioskTick(); kioskTimer = setInterval(kioskTick, 15000); if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); }
  else if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  setTimeout(() => { if (bigMap) { bigMap.invalidateSize(); mapFitted = false; renderBigMap(true); } }, 350);
}
$('#kioskBtn').addEventListener('click', () => { closeMenu(); setKiosk(true); });
$('#kioskExit').addEventListener('click', () => setKiosk(false));
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && kiosk) setKiosk(false); });

/* ---------- archivo histórico ---------- */
const ARCH_SOURCE = { logbook: 'Novedad', work_orders: 'Tarea', shifts: 'Acta' };
const ARCH_LABEL = { date: 'Fecha', camara: 'Cámara', technician: 'Técnico', type: 'Tipo', description: 'Descripción', result: 'Resultado', next_action: 'Próxima acción',
  task_type: 'Tarea', status: 'Estado', progress: 'Avance %', assignee: 'Responsable', start_date: 'Inicio', due_date: 'Vence', completed_at: 'Cierre', notes: 'Notas',
  acta_no: 'Acta N°', shift_date: 'Fecha', shift_type: 'Turno', operator: 'Operador', opened_at: 'Apertura', closed_at: 'Cierre', handover_notes: 'Observaciones de entrega' };
const archSummary = (r) => {
  const d = r.data || {};
  if (r.source_table === 'logbook') return `${fmtDate(d.date)} · ${d.camara || 'Sin cámara'} · ${d.type || ''}: ${d.description || ''}`;
  if (r.source_table === 'work_orders') return `Tarea #${d.id} · ${d.camara || ''} · ${d.task_type || ''} (${WSTATUS[d.status] || d.status || ''})`;
  if (r.source_table === 'shifts') return `Acta N° ${d.acta_no ?? '—'} · ${fmtDate(d.shift_date)} · turno ${TURNO[d.shift_type] || ''} · ${d.operator || ''}`;
  return JSON.stringify(d).slice(0, 120);
};
async function loadArchive() {
  const r = await sb.from('archive_records').select('*').order('archived_at', { ascending: false }).order('id', { ascending: true });
  if (r.error) { $('#archBody').innerHTML = `<tr><td colspan="4">No se pudo cargar el archivo: ${esc(r.error.message)}</td></tr>`; return; }
  state.archive = r.data; renderArchive();
}
function renderArchive() {
  const q = $('#archSearch').value.trim().toLowerCase(), s = $('#archSource').value, all = state.archive || [];
  const rows = all.filter(r => (s === 'all' || r.source_table === s) && (!q || (archSummary(r) + ' ' + JSON.stringify(r.data)).toLowerCase().includes(q)));
  $('#archCount').textContent = `${rows.length} de ${all.length}`;
  $('#archBody').innerHTML = rows.map(r => `<tr class="clickrow" data-arch="${r.id}"><td><span class="badge" style="background:#1f51ff22;color:#1f51ff">${ARCH_SOURCE[r.source_table] || esc(r.source_table)}</span></td>
    <td class="wrap">${esc(archSummary(r))}</td><td>${fmtDate(localDate(r.archived_at))}</td>
    <td class="act"><button class="btn small icon" data-arch="${r.id}" title="Ver detalle" aria-label="Ver detalle">${ICON.eye}</button></td></tr>`).join('') || '<tr><td colspan="4">No hay registros para esa búsqueda.</td></tr>';
}
$('#archSearch').addEventListener('input', renderArchive);
$('#archSource').addEventListener('input', renderArchive);
$('#archiveTab').addEventListener('click', () => showTab('archive'));
$('#archBody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-arch]'); if (!b) return;
  const r = (state.archive || []).find(x => x.id === +b.dataset.arch); if (!r) return;
  const d = r.data || {}, fmtVal = (k, v) => /date|_at$/.test(k) && v ? (String(v).length > 10 ? new Date(v).toLocaleString('es-AR', { hour12: false }) : fmtDate(v)) : k === 'shift_type' ? (TURNO[v] || v) : k === 'status' ? (WSTATUS[v] || v) : v;
  const kv = Object.keys(ARCH_LABEL).filter(k => d[k] != null && d[k] !== '' && typeof d[k] !== 'object')
    .map(k => `<div class="kv ${/description|notes|handover|next_action/.test(k) ? 'wide' : ''}"><dt>${ARCH_LABEL[k]}</dt><dd>${esc(fmtVal(k, d[k]))}</dd></div>`).join('');
  const entries = Array.isArray(d.entries) && d.entries.length ? `<h3 class="sub">Novedades del acta</h3>${d.entries.map(en => `<p style="margin:6px 0"><strong>${esc(en.time)} · ${esc(CAT[en.category] || en.category)}</strong> — ${esc((en.cameras || []).join(', ') || 'sin cámara')}<br>${esc(en.description)}${en.action_taken ? `<br><span class="hint" style="margin:0">Acción: ${esc(en.action_taken)}</span>` : ''}</p>`).join('')}` : '';
  openDialog('Detalle del registro archivado', `<p class="hint">${esc(r.reason || '')}</p><dl class="kvgrid">${kv}</dl>${entries}`, null);
});


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
