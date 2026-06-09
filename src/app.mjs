import {
  STATUS_OPTIONS,
  createEmptyData,
  createStore,
  createRecord,
  updateRecord,
  archiveRecord,
  deleteRecord,
  findRecord,
  changeCaseStatus,
  addNoteWithOptionalTask,
  getCustomerGraph,
  listLinked,
  exportData,
  importData,
  seedDemoData
} from './crm-store.mjs';

const STORAGE_KEY = 'autoImportCrmMvpData.v1';
const NAV = [
  ['dashboard', 'Dashboard'], ['contacts', 'Klanten & leads'], ['importCases', 'Importdossiers'],
  ['vehicles', 'Voertuigen'], ['tasks', 'Taken'], ['documents', 'Documenten'],
  ['notes', 'Notities'], ['partners', 'Partners'], ['backup', 'Import/export']
];
const COLLECTION_LABELS = { contacts: 'klant/lead', partners: 'partner', vehicles: 'voertuig', importCases: 'importdossier', tasks: 'taak', notes: 'notitie', documents: 'document' };
const state = { view: 'dashboard', detail: null, search: '', edit: null, tab: 'overview' };
const store = createStore(loadData(), data => localStorage.setItem(STORAGE_KEY, JSON.stringify(data)));

const view = document.querySelector('#view');
const nav = document.querySelector('#nav');
const dialog = document.querySelector('#recordDialog');
const form = document.querySelector('#recordForm');
const fields = document.querySelector('#formFields');
const dialogTitle = document.querySelector('#dialogTitle');

init();

function init() {
  renderNav();
  bindShell();
  routeFromHash();
  window.addEventListener('hashchange', routeFromHash);
  render();
}

function bindShell() {
  document.querySelector('#globalSearch').addEventListener('input', e => { state.search = e.target.value.toLowerCase(); render(); });
  document.querySelector('#quickNew').addEventListener('click', () => openCreate(defaultCollectionForView()));
  document.querySelector('#seedBtn').addEventListener('click', () => { seedDemoData(store); render(); toast('Demo data staat klaar.'); });
  document.querySelector('#exportBtn').addEventListener('click', downloadBackup);
  document.querySelector('#importFile').addEventListener('change', importBackup);
  document.querySelector('#menuBtn').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
  form.addEventListener('submit', submitForm);
}

function loadData() {
  try { return importData(localStorage.getItem(STORAGE_KEY) || JSON.stringify(createEmptyData())); }
  catch { return createEmptyData(); }
}

function routeFromHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  state.view = parts[0] || 'dashboard';
  state.detail = parts[1] || null;
  state.tab = parts[2] || 'overview';
  render();
}

function go(viewName, detail = null, tab = 'overview') {
  const parts = detail ? [viewName, detail, tab] : [viewName];
  location.hash = '/' + parts.filter(Boolean).join('/');
}

function renderNav() {
  nav.innerHTML = NAV.map(([key, label]) => `<button data-nav="${key}">${label}<span class="badge-count">${navCount(key)}</span></button>`).join('');
  nav.querySelectorAll('button').forEach(button => button.addEventListener('click', () => { document.querySelector('.sidebar').classList.remove('open'); go(button.dataset.nav); }));
}

function render() {
  renderNav();
  nav.querySelectorAll('button').forEach(button => button.classList.toggle('active', button.dataset.nav === state.view));
  if (state.view === 'dashboard') return renderDashboard();
  if (state.view === 'backup') return renderBackup();
  if (state.detail) return renderDetail(state.view, state.detail);
  return renderList(state.view);
}

function renderDashboard() {
  const openTasks = active('tasks').filter(t => !['afgerond', 'geannuleerd'].includes(t.status));
  const overdue = openTasks.filter(t => t.due_date && t.due_date < today());
  const blockedCases = active('importCases').filter(d => ['on_hold', 'geannuleerd'].includes(d.status) || d.risk_level === 'hoog');
  const docIssues = active('documents').filter(d => ['ontbreekt', 'te_controleren', 'probleem'].includes(d.status));
  view.innerHTML = `
    <div class="page-header"><div><h1>Dashboard</h1><p>Dagelijkse cockpit voor leads, dossiers, taken en ontbrekende documenten.</p></div><button data-new="contacts">+ Nieuwe lead</button></div>
    <section class="kpis">
      ${kpi(active('importCases').length, 'Actieve dossiers')}
      ${kpi(openTasks.length, 'Open taken')}
      ${kpi(overdue.length, 'Achterstallig')}
      ${kpi(blockedCases.length, 'Risico/blokkade')}
      ${kpi(docIssues.length, 'Documentissues')}
    </section>
    <section class="grid-2">
      <div class="panel"><h2>Vandaag opvolgen</h2>${cards(openTasks.sort(byDueDate).slice(0, 8), taskCard)}</div>
      <div class="panel"><h2>Dossiers per status</h2>${statusSummary()}</div>
      <div class="panel"><h2>Risico's / blokkades</h2>${cards(blockedCases, dossierCard)}</div>
      <div class="panel"><h2>Recente notities</h2>${cards(active('notes').sort(byUpdated).slice(0, 5), noteCard)}</div>
    </section>`;
  bindCommonActions();
}

function renderList(collection) {
  if (!COLLECTION_LABELS[collection]) return renderDashboard();
  const rows = active(collection).filter(row => matchesSearch(collection, row));
  view.innerHTML = `
    <div class="page-header"><div><h1>${titleFor(collection)}</h1><p>${descriptionFor(collection)}</p></div><button data-new="${collection}">+ Nieuwe ${COLLECTION_LABELS[collection]}</button></div>
    <div class="toolbar"><input data-local-search type="search" placeholder="Filter deze lijst..." value="${esc(state.search)}"><select data-status-filter><option value="">Alle statussen</option>${statusOptions(collection).map(s => `<option value="${s}">${s}</option>`).join('')}</select></div>
    <div class="table-wrap"><table><thead>${tableHead(collection)}</thead><tbody>${rows.map(row => tableRow(collection, row)).join('') || `<tr><td colspan="8" class="empty">Nog geen records. Maak je eerste ${COLLECTION_LABELS[collection]} aan.</td></tr>`}</tbody></table></div>`;
  document.querySelector('[data-local-search]').addEventListener('input', e => { state.search = e.target.value.toLowerCase(); document.querySelector('#globalSearch').value = state.search; render(); });
  document.querySelector('[data-status-filter]').addEventListener('change', e => { state.search = e.target.value; render(); });
  bindCommonActions();
}

function renderDetail(collection, id) {
  let record;
  try { record = findRecord(store, collection, id); } catch { go(collection); return; }
  const label = displayValue(collection, record);
  view.innerHTML = `
    <div class="page-header"><div><button class="ghost small" data-go="${collection}">← Terug</button><h1 class="detail-title">${esc(label)} ${statusBadge(record.status)}</h1><p>${titleFor(collection)} detail met gekoppelde objecten.</p></div><div class="actions"><button data-edit="${collection}:${record.id}">Bewerken</button><button data-quick-task="${collection}:${record.id}">Taak</button><button data-quick-note="${collection}:${record.id}">Notitie</button><button data-quick-doc="${collection}:${record.id}">Document</button></div></div>
    <div class="detail-layout">
      <section class="panel">
        <div class="tabs">${['overview','tasks','notes','documents','status'].map(tab => `<button data-tab="${tab}" class="${state.tab === tab ? 'active' : ''}">${tabLabel(tab)}</button>`).join('')}</div>
        <div>${detailTab(collection, record)}</div>
      </section>
      <aside class="panel"><h3>Relaties</h3>${relationPanel(collection, record)}</aside>
    </div>`;
  bindCommonActions();
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => go(collection, id, b.dataset.tab)));
}

function detailTab(collection, record) {
  if (state.tab === 'tasks') return linkedTable(collection, record, 'tasks');
  if (state.tab === 'notes') return linkedTable(collection, record, 'notes');
  if (state.tab === 'documents') return linkedTable(collection, record, 'documents');
  if (state.tab === 'status') return collection === 'importCases' ? statusFlow(record) : '<p class="muted">Statushistoriek is vooral voor importdossiers voorzien.</p>';
  return `<dl class="def-list">${Object.entries(record).filter(([k]) => !['is_archived'].includes(k)).map(([k,v]) => `<dt>${esc(k)}</dt><dd>${formatValue(k, v)}</dd>`).join('')}</dl>`;
}

function linkedTable(collection, record, linkedCollection) {
  const entityType = entityTypeFor(collection);
  let items = listLinked(store, entityType, record.id, linkedCollection);
  if (collection === 'contacts') items = getCustomerGraph(store, record.id)[linkedCollection] || items;
  if (collection === 'importCases') items = active(linkedCollection).filter(item => item.linked_entity_id === record.id || (linkedCollection === 'tasks' && item.import_case_id === record.id));
  return `<div class="actions" style="margin-bottom:.75rem"><button data-new-linked="${linkedCollection}:${entityType}:${record.id}">+ ${COLLECTION_LABELS[linkedCollection]}</button></div>${cards(items, item => genericLinkedCard(linkedCollection, item))}`;
}

function relationPanel(collection, record) {
  const links = [];
  if (record.contact_id) links.push(linkTo('contacts', record.contact_id, 'Klant'));
  if (record.vehicle_id) links.push(linkTo('vehicles', record.vehicle_id, 'Voertuig'));
  if (record.import_case_id) links.push(linkTo('importCases', record.import_case_id, 'Dossier'));
  if (record.seller_partner_id) links.push(linkTo('partners', record.seller_partner_id, 'Verkoper'));
  if (collection === 'contacts') {
    const graph = getCustomerGraph(store, record.id);
    links.push(`<strong>${graph.vehicles.length}</strong> voertuig(en)`, `<strong>${graph.importCases.length}</strong> dossier(s)`, `<strong>${graph.tasks.length}</strong> taak/taken`);
  }
  if (collection === 'importCases') {
    links.push(`<hr>`, `<strong>${listLinked(store, 'importCase', record.id, 'tasks').length}</strong> taken`, `<strong>${listLinked(store, 'importCase', record.id, 'documents').length}</strong> documenten`);
  }
  return links.length ? `<div class="cards">${links.map(x => `<div class="card">${x}</div>`).join('')}</div>` : '<p class="muted">Geen gekoppelde records.</p>';
}

function statusFlow(dossier) {
  const history = active('statusHistory').filter(h => h.import_case_id === dossier.id).sort(byUpdated);
  return `<div class="toolbar"><select id="caseStatusSelect">${STATUS_OPTIONS.importCases.map(s => `<option value="${s}" ${s === dossier.status ? 'selected' : ''}>${s}</option>`).join('')}</select><input id="caseStatusReason" placeholder="Reden/opmerking"><button id="caseStatusBtn">Status wijzigen</button></div>${cards(history, h => `<div class="card"><strong>${esc(h.from_status)} → ${esc(h.to_status)}</strong><p>${esc(h.reason || '')}</p><small class="muted">${dateTime(h.changed_at || h.created_at)}</small></div>`)} `;
}

function renderBackup() {
  view.innerHTML = `<div class="page-header"><div><h1>Import/export</h1><p>Maak een JSON-backup of herstel een eerdere lokale CRM-dataset.</p></div><button id="backupNow">JSON export</button></div><section class="panel"><h2>Huidige dataset</h2><dl class="def-list">${Object.keys(COLLECTION_LABELS).map(c => `<dt>${titleFor(c)}</dt><dd>${active(c).length} actief</dd>`).join('')}<dt>Laatste export</dt><dd>${dateTime(store.data.settings.lastExportAt) || 'Nog geen export'}</dd></dl><p class="muted">MVP-keuze: documenten worden als metadata/link bewaard, niet als bestanden.</p></section>`;
  document.querySelector('#backupNow').addEventListener('click', downloadBackup);
}

function bindCommonActions() {
  document.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => openCreate(b.dataset.new)));
  document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { const [c,id] = b.dataset.edit.split(':'); openEdit(c,id); }));
  document.querySelectorAll('[data-archive]').forEach(b => b.addEventListener('click', () => { const [c,id] = b.dataset.archive.split(':'); if (confirm('Archiveren?')) { archiveRecord(store,c,id); render(); } }));
  document.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => { const [c,id] = b.dataset.delete.split(':'); if (confirm('Definitief verwijderen?')) { deleteRecord(store,c,id); render(); } }));
  document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { const [c,id] = b.dataset.open.split(':'); go(c,id); }));
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  document.querySelectorAll('[data-quick-task]').forEach(b => b.addEventListener('click', () => quickLinked(b.dataset.quickTask, 'tasks')));
  document.querySelectorAll('[data-quick-note]').forEach(b => b.addEventListener('click', () => quickLinked(b.dataset.quickNote, 'notes')));
  document.querySelectorAll('[data-quick-doc]').forEach(b => b.addEventListener('click', () => quickLinked(b.dataset.quickDoc, 'documents')));
  document.querySelectorAll('[data-new-linked]').forEach(b => b.addEventListener('click', () => { const [c,t,id] = b.dataset.newLinked.split(':'); openCreate(c, { linked_entity_type: t, linked_entity_id: id }); }));
  const caseBtn = document.querySelector('#caseStatusBtn');
  if (caseBtn) caseBtn.addEventListener('click', () => { changeCaseStatus(store, state.detail, document.querySelector('#caseStatusSelect').value, document.querySelector('#caseStatusReason').value); render(); });
}

function openCreate(collection, defaults = {}) { state.edit = { collection, id: null, defaults }; openForm(); }
function openEdit(collection, id) { state.edit = { collection, id, defaults: {} }; openForm(); }
function quickLinked(source, collection) { const [sourceCollection, id] = source.split(':'); openCreate(collection, { linked_entity_type: entityTypeFor(sourceCollection), linked_entity_id: id }); }

function openForm() {
  const { collection, id, defaults } = state.edit;
  const record = id ? findRecord(store, collection, id) : defaults;
  dialogTitle.textContent = `${id ? 'Bewerk' : 'Nieuwe'} ${COLLECTION_LABELS[collection]}`;
  fields.innerHTML = formSchema(collection).map(field => renderField(field, record)).join('');
  dialog.showModal();
}

function submitForm(event) {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') return dialog.close();
  const { collection, id } = state.edit;
  const values = Object.fromEntries(new FormData(form).entries());
  Object.keys(values).forEach(k => { if (values[k] === '') delete values[k]; else if (['budget_min','budget_max','year','mileage_km','asking_price','estimated_extra_costs'].includes(k)) values[k] = Number(values[k]); });
  try {
    if (collection === 'notes' && values.follow_up === 'on') addNoteWithOptionalTask(store, { ...values, follow_up: true });
    else if (id) updateRecord(store, collection, id, values);
    else createRecord(store, collection, values);
    dialog.close(); render();
  } catch (error) { toast(error.message, true); }
}

function formSchema(collection) {
  const contacts = [['contact_type','Type','select',['lead','prospect','klant','oud_klant','bedrijf']],['status','Status','select',STATUS_OPTIONS.contacts],['first_name','Voornaam'],['last_name','Achternaam'],['company_name','Bedrijf'],['email','E-mail','email'],['phone','Telefoon'],['preferred_channel','Voorkeurskanaal','select',['phone','email','whatsapp','sms','none']],['lead_source','Leadbron'],['budget_min','Budget min','number'],['budget_max','Budget max','number'],['desired_brand','Gewenst merk'],['desired_model','Gewenst model'],['general_notes','Algemene notities','textarea']];
  const vehicles = [['status','Status','select',STATUS_OPTIONS.vehicles],['contact_id','Klant','selectRef','contacts'],['import_case_id','Dossier','selectRef','importCases'],['seller_partner_id','Verkoper/partner','selectRef','partners'],['brand','Merk'],['model','Model'],['version','Uitvoering'],['year','Bouwjaar','number'],['mileage_km','Km-stand','number'],['fuel_type','Brandstof'],['transmission','Transmissie','select',['manueel','automaat']],['asking_price','Vraagprijs','number'],['estimated_extra_costs','Extra kosten','number'],['location_city','Locatie stad'],['advertisement_url','Advertentielink','url'],['notes_summary','Samenvatting','textarea']];
  const importCases = [['status','Status','select',STATUS_OPTIONS.importCases],['contact_id','Klant','selectRef','contacts'],['vehicle_id','Voertuig','selectRef','vehicles'],['seller_partner_id','Verkoper/partner','selectRef','partners'],['title','Titel'],['case_number','Dossiernummer'],['risk_level','Risico','select',['laag','normaal','hoog']],['target_delivery_date','Geplande aflevering','date'],['summary','Samenvatting','textarea']];
  const tasks = [['title','Titel'],['status','Status','select',STATUS_OPTIONS.tasks],['priority','Prioriteit','select',['laag','normaal','hoog','urgent']],['due_date','Deadline','date'],['linked_entity_type','Gekoppeld type','select',['contact','vehicle','importCase','partner']],['linked_entity_id','Gekoppeld ID'],['description','Beschrijving','textarea']];
  const notes = [['subject','Onderwerp'],['body','Inhoud','textarea'],['linked_entity_type','Gekoppeld type','select',['contact','vehicle','importCase','partner']],['linked_entity_id','Gekoppeld ID'],['follow_up','Maak opvolgtaak','checkbox'],['follow_up_title','Titel opvolgtaak'],['follow_up_due_date','Deadline opvolgtaak','date']];
  const documents = [['document_type','Documenttype'],['name','Naam'],['status','Status','select',STATUS_OPTIONS.documents],['linked_entity_type','Gekoppeld type','select',['contact','vehicle','importCase','partner']],['linked_entity_id','Gekoppeld ID'],['url_or_path','Link/pad'],['received_at','Ontvangen op','date'],['notes','Opmerking','textarea']];
  const partners = [['name','Naam'],['category','Categorie','select',['duitse_garage','dealer','transporteur','inspectiebedrijf','keuring','administratie','andere']],['status','Status','select',STATUS_OPTIONS.partners],['contact_person','Contactpersoon'],['email','E-mail','email'],['phone','Telefoon'],['website','Website','url'],['city','Stad'],['country','Land'],['specialization','Specialisatie'],['agreements','Afspraken','textarea']];
  return ({ contacts, vehicles, importCases, tasks, notes, documents, partners })[collection] || [];
}

function renderField([name, label, type = 'text', options], record) {
  const value = record[name] ?? '';
  const full = ['textarea','checkbox'].includes(type) || name.includes('notes') || name === 'description' || name === 'body' || name === 'summary' ? 'field-full' : '';
  if (type === 'textarea') return `<label class="${full}">${label}<textarea name="${name}">${esc(value)}</textarea></label>`;
  if (type === 'checkbox') return `<label class="${full}"><span><input style="width:auto" type="checkbox" name="${name}" ${value ? 'checked' : ''}> ${label}</span></label>`;
  if (type === 'select') return `<label class="${full}">${label}<select name="${name}"><option value=""></option>${options.map(o => `<option value="${o}" ${o === value ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
  if (type === 'selectRef') return `<label class="${full}">${label}<select name="${name}"><option value=""></option>${active(options).map(o => `<option value="${o.id}" ${o.id === value ? 'selected' : ''}>${esc(displayValue(options, o))}</option>`).join('')}</select></label>`;
  return `<label class="${full}">${label}<input name="${name}" type="${type}" value="${esc(value)}"></label>`;
}

function tableHead(c) { return `<tr>${columns(c).map(x => `<th>${x[1]}</th>`).join('')}<th>Acties</th></tr>`; }
function tableRow(c, r) { return `<tr>${columns(c).map(([k]) => `<td>${cell(c,k,r)}</td>`).join('')}<td><div class="actions"><button class="small" data-open="${c}:${r.id}">Bekijk</button><button class="small ghost" data-edit="${c}:${r.id}">Bewerk</button><button class="small danger" data-archive="${c}:${r.id}">Archiveer</button></div></td></tr>`; }
function columns(c) { return ({ contacts:[['display_name','Naam'],['status','Status'],['email','E-mail'],['phone','Telefoon'],['desired_brand','Wens']], vehicles:[['brand','Merk'],['model','Model'],['status','Status'],['year','Jaar'],['asking_price','Prijs']], importCases:[['case_number','Nr'],['title','Titel'],['status','Status'],['contact_id','Klant'],['vehicle_id','Voertuig']], tasks:[['title','Titel'],['status','Status'],['priority','Prio'],['due_date','Deadline'],['linked_entity_type','Koppeling']], documents:[['name','Naam'],['document_type','Type'],['status','Status'],['linked_entity_type','Koppeling']], notes:[['subject','Onderwerp'],['linked_entity_type','Koppeling'],['updated_at','Datum']], partners:[['name','Naam'],['category','Categorie'],['status','Status'],['city','Stad'],['country','Land']] })[c] || []; }
function cell(c,k,r) { if (k === 'status') return statusBadge(r[k]); if (k.endsWith('_id')) return linkedName(k, r[k]); if (k.includes('price')) return euro(r[k]); if (k.includes('_at')) return dateTime(r[k]); return esc(r[k] ?? ''); }
function linkedName(k, id) { if (!id) return ''; const map = { contact_id:'contacts', vehicle_id:'vehicles', import_case_id:'importCases', seller_partner_id:'partners' }; try { const c = map[k]; return c ? `<button class="ghost small" data-open="${c}:${id}">${esc(displayValue(c, findRecord(store,c,id)))}</button>` : esc(id); } catch { return esc(id); } }

function kpi(n, label) { return `<div class="kpi"><strong>${n}</strong><span>${label}</span></div>`; }
function cards(items, renderer) { return items.length ? `<div class="cards">${items.map(renderer).join('')}</div>` : '<div class="empty">Geen items.</div>'; }
function taskCard(t) { return `<div class="card"><div class="card-title"><strong>${esc(t.title)}</strong>${statusBadge(t.status)}</div><p class="muted">${esc(t.priority || '')} · deadline ${esc(t.due_date || 'geen')}</p><div class="actions"><button class="small" data-open="tasks:${t.id}">Open</button><button class="small ghost" data-edit="tasks:${t.id}">Bewerk</button></div></div>`; }
function dossierCard(d) { return `<div class="card"><div class="card-title"><strong>${esc(d.case_number || d.title)}</strong>${statusBadge(d.status)}</div><p>${esc(d.title || '')}</p><button class="small" data-open="importCases:${d.id}">Open dossier</button></div>`; }
function noteCard(n) { return `<div class="card"><strong>${esc(n.subject || 'Notitie')}</strong><p>${esc(n.body || '')}</p><small class="muted">${dateTime(n.updated_at)}</small></div>`; }
function genericLinkedCard(c, r) { return `<div class="card"><div class="card-title"><strong>${esc(displayValue(c,r))}</strong>${statusBadge(r.status)}</div><div class="actions"><button class="small" data-open="${c}:${r.id}">Open</button><button class="small ghost" data-edit="${c}:${r.id}">Bewerk</button></div></div>`; }
function statusSummary() { return STATUS_OPTIONS.importCases.map(s => `<div class="card"><span class="status ${s}">${s}</span> <strong>${active('importCases').filter(d => d.status === s).length}</strong></div>`).join(''); }

function downloadBackup() { const blob = new Blob([exportData(store)], { type:'application/json' }); const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `auto-import-crm-backup-${today()}.json` }); a.click(); URL.revokeObjectURL(a.href); render(); }
async function importBackup(e) { const file = e.target.files[0]; if (!file) return; try { store.data = importData(await file.text()); localStorage.setItem(STORAGE_KEY, JSON.stringify(store.data)); render(); toast('Backup geïmporteerd.'); } catch (err) { toast('Import mislukt: ' + err.message, true); } }

function toast(message, isError = false) {
  let box = document.querySelector('#toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    document.body.appendChild(box);
  }
  box.textContent = message;
  box.className = isError ? 'toast error' : 'toast';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.remove(), 2800);
}

function navCount(key) { if (key === 'dashboard' || key === 'backup') return ''; if (key === 'tasks') return active('tasks').filter(t => !['afgerond','geannuleerd'].includes(t.status)).length; return active(key).length; }
function defaultCollectionForView() { return COLLECTION_LABELS[state.view] ? state.view : 'contacts'; }
function active(c) { return store.data[c].filter(x => !x.is_archived); }
function matchesSearch(c,r) { const q = state.search; return !q || JSON.stringify(r).toLowerCase().includes(q); }
function titleFor(c) { return ({ contacts:'Klanten & leads', vehicles:'Voertuigen', importCases:'Importdossiers', tasks:'Taken', documents:'Documenten', notes:'Notities', partners:'Partners' })[c] || c; }
function descriptionFor(c) { return ({ contacts:'Beheer leads, klanten, wensen en opvolging.', vehicles:'Shortlist, aankoopkandidaten en gekoppelde voertuigen.', importCases:'Centrale case file van importtraject tot aflevering.', tasks:'Alle reminders en operationele opvolging.', documents:'Documentmetadata en ontbrekende stukken.', notes:'Communicatie- en notitiehistoriek.', partners:'Duitse garages, transporteurs en andere partners.' })[c] || ''; }
function displayValue(c,r) { if (!r) return ''; if (c === 'contacts') return r.display_name || [r.first_name,r.last_name].filter(Boolean).join(' ') || r.company_name || r.email; if (c === 'vehicles') return [r.brand,r.model,r.version].filter(Boolean).join(' '); if (c === 'importCases') return r.case_number || r.title; if (c === 'tasks') return r.title; if (c === 'documents') return r.name; if (c === 'notes') return r.subject || r.body; if (c === 'partners') return r.name; return r.id; }
function entityTypeFor(c) { return ({ contacts:'contact', vehicles:'vehicle', importCases:'importCase', partners:'partner', tasks:'task', documents:'document', notes:'note' })[c] || c; }
function statusOptions(c) { return STATUS_OPTIONS[c] || []; }
function statusBadge(s) { return s ? `<span class="status ${esc(s)}">${esc(s)}</span>` : ''; }
function tabLabel(t) { return ({ overview:'Overzicht', tasks:'Taken', notes:'Notities', documents:'Documenten', status:'Statusflow' })[t] || t; }
function linkTo(c,id,label) { try { const r = findRecord(store,c,id); return `<span class="muted">${label}</span><br><button class="ghost small" data-open="${c}:${id}">${esc(displayValue(c,r))}</button>`; } catch { return ''; } }
function formatValue(k,v) { if (v == null || v === '') return '<span class="muted">—</span>'; if (k.endsWith('_id')) return linkedName(k,v); if (k.includes('price') || k.includes('budget')) return euro(v); if (k.includes('_at') || k.includes('date')) return dateTime(v); if (String(v).startsWith('http')) return `<a href="${esc(v)}" target="_blank" rel="noreferrer">${esc(v)}</a>`; return esc(v); }
function esc(v) { return String(v ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }
function euro(v) { return v ? new Intl.NumberFormat('nl-BE', { style:'currency', currency:'EUR' }).format(v) : ''; }
function dateTime(v) { return v ? new Date(v).toLocaleString('nl-BE') : ''; }
function today() { return new Date().toISOString().slice(0,10); }
function byDueDate(a,b) { return String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')); }
function byUpdated(a,b) { return String(b.updated_at || '').localeCompare(String(a.updated_at || '')); }
