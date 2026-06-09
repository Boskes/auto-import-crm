const COLLECTIONS = ['contacts', 'partners', 'vehicles', 'importCases', 'tasks', 'notes', 'documents', 'communications', 'statusHistory'];

export const STATUS_OPTIONS = {
  contacts: ['nieuwe_lead', 'gecontacteerd', 'gekwalificeerd', 'actief_dossier', 'klant', 'niet_gewonnen', 'nazorg'],
  vehicles: ['shortlist', 'te_controleren', 'goedgekeurd', 'afgewezen', 'aangekocht', 'transport', 'geleverd'],
  importCases: ['intake', 'voertuig_zoeken', 'voertuig_gevonden', 'aankoop', 'transport', 'keuring', 'inschrijving', 'aflevering', 'nazorg', 'on_hold', 'geannuleerd'],
  tasks: ['open', 'bezig', 'wacht_op_derde', 'afgerond', 'geannuleerd'],
  documents: ['ontbreekt', 'aangevraagd', 'ontvangen', 'te_controleren', 'goedgekeurd', 'probleem'],
  partners: ['prospect_partner', 'actief', 'voorkeurspartner', 'on_hold', 'afgekeurd']
};

const ID_PREFIX = {
  contacts: 'cnt', partners: 'par', vehicles: 'veh', importCases: 'case', tasks: 'tsk', notes: 'note', documents: 'doc', communications: 'com', statusHistory: 'hist'
};

export function createEmptyData() {
  return {
    schemaVersion: 1,
    contacts: [],
    partners: [],
    vehicles: [],
    importCases: [],
    tasks: [],
    notes: [],
    documents: [],
    communications: [],
    statusHistory: [],
    settings: {
      owner: 'MVP gebruiker',
      lastExportAt: null
    }
  };
}

export function createStore(data = createEmptyData(), persist = null) {
  return { data: normalizeData(data), persist };
}

export function normalizeData(input = {}) {
  const base = createEmptyData();
  const data = { ...base, ...input, settings: { ...base.settings, ...(input.settings || {}) } };
  for (const collection of COLLECTIONS) data[collection] = Array.isArray(data[collection]) ? data[collection] : [];
  return data;
}

export function validateRecord(collection, record) {
  const errors = [];
  if (collection === 'contacts') {
    const hasName = text(record.display_name) || text(record.company_name) || text(record.first_name) || text(record.last_name);
    if (!hasName) errors.push('Naam/bedrijf is verplicht');
    if (!text(record.email) && !text(record.phone)) errors.push('E-mail of telefoon is verplicht');
  }
  if (collection === 'vehicles') {
    if (!text(record.brand)) errors.push('Merk is verplicht');
    if (!text(record.model)) errors.push('Model is verplicht');
  }
  if (collection === 'importCases') {
    if (!text(record.contact_id)) errors.push('Klant/lead is verplicht');
    if (!text(record.title) && !text(record.case_number)) errors.push('Dossiertitel is verplicht');
  }
  if (collection === 'tasks' && !text(record.title)) errors.push('Titel is verplicht');
  if (collection === 'notes' && !text(record.subject) && !text(record.body)) errors.push('Onderwerp of inhoud is verplicht');
  if (collection === 'documents' && !text(record.name)) errors.push('Documentnaam is verplicht');
  if (collection === 'partners' && !text(record.name)) errors.push('Partnernaam is verplicht');
  return errors;
}

export function createRecord(store, collection, values) {
  assertCollection(collection);
  const now = new Date().toISOString();
  const record = withDefaults(collection, {
    ...values,
    id: values.id || makeId(collection, store.data[collection]),
    created_at: values.created_at || now,
    updated_at: now,
    is_archived: values.is_archived ?? false
  });
  const errors = validateRecord(collection, record);
  if (errors.length) throw new Error(errors.join('; '));
  store.data[collection].push(record);
  save(store);
  return record;
}

export function updateRecord(store, collection, id, values) {
  assertCollection(collection);
  const record = findRecord(store, collection, id);
  Object.assign(record, values, { updated_at: new Date().toISOString() });
  if (collection === 'contacts') record.display_name = buildDisplayName(record);
  const errors = validateRecord(collection, record);
  if (errors.length) throw new Error(errors.join('; '));
  save(store);
  return record;
}

export function archiveRecord(store, collection, id) {
  return updateRecord(store, collection, id, { is_archived: true });
}

export function deleteRecord(store, collection, id) {
  assertCollection(collection);
  const before = store.data[collection].length;
  store.data[collection] = store.data[collection].filter(record => record.id !== id);
  if (store.data[collection].length === before) throw new Error(`Record niet gevonden: ${id}`);
  save(store);
}

export function findRecord(store, collection, id) {
  assertCollection(collection);
  const record = store.data[collection].find(item => item.id === id);
  if (!record) throw new Error(`Record niet gevonden: ${id}`);
  return record;
}

export function changeCaseStatus(store, importCaseId, newStatus, reason = '') {
  if (!STATUS_OPTIONS.importCases.includes(newStatus)) throw new Error(`Ongeldige status: ${newStatus}`);
  const dossier = findRecord(store, 'importCases', importCaseId);
  const fromStatus = dossier.status;
  if (fromStatus === newStatus) return dossier;
  dossier.status = newStatus;
  dossier.updated_at = new Date().toISOString();
  createRecord(store, 'statusHistory', {
    import_case_id: importCaseId,
    from_status: fromStatus,
    to_status: newStatus,
    reason,
    changed_at: new Date().toISOString()
  });
  save(store);
  return dossier;
}

export function addNoteWithOptionalTask(store, values) {
  const note = createRecord(store, 'notes', values);
  let task = null;
  if (values.follow_up) {
    task = createRecord(store, 'tasks', {
      title: values.follow_up_title || `Opvolging: ${values.subject || 'notitie'}`,
      status: 'open',
      priority: values.follow_up_priority || 'normaal',
      due_date: values.follow_up_due_date || addDaysIso(2),
      linked_entity_type: values.linked_entity_type,
      linked_entity_id: values.linked_entity_id,
      description: `Aangemaakt vanuit notitie ${note.id}`
    });
  }
  return { note, task };
}

export function getCustomerGraph(store, contactId) {
  const contact = findRecord(store, 'contacts', contactId);
  const importCases = active(store.data.importCases).filter(item => item.contact_id === contactId);
  const caseIds = new Set(importCases.map(item => item.id));
  const vehicles = active(store.data.vehicles).filter(item => item.contact_id === contactId || caseIds.has(item.import_case_id));
  const vehicleIds = new Set(vehicles.map(item => item.id));
  const linked = (record) =>
    (record.linked_entity_type === 'contact' && record.linked_entity_id === contactId) ||
    (['importCase', 'importCases', 'dossier'].includes(record.linked_entity_type) && caseIds.has(record.linked_entity_id)) ||
    (['vehicle', 'vehicles'].includes(record.linked_entity_type) && vehicleIds.has(record.linked_entity_id));
  return {
    contact,
    vehicles,
    importCases,
    tasks: active(store.data.tasks).filter(linked),
    notes: active(store.data.notes).filter(linked),
    documents: active(store.data.documents).filter(linked),
    communications: active(store.data.communications).filter(linked)
  };
}

export function listLinked(store, entityType, entityId, collection) {
  assertCollection(collection);
  return active(store.data[collection]).filter(item => item.linked_entity_type === entityType && item.linked_entity_id === entityId);
}

export function exportData(store) {
  store.data.settings.lastExportAt = new Date().toISOString();
  return JSON.stringify(store.data, null, 2);
}

export function importData(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  return normalizeData(parsed);
}

export function seedDemoData(store) {
  if (store.data.contacts.length > 0) return;

  const partnerDealer = createRecord(store, 'partners', {
    name: 'Autohaus Müller', category: 'duitse_garage', status: 'voorkeurspartner', contact_person: 'Herr Müller', email: 'info@autohaus.example', phone: '+49 221 000000', country: 'DE', city: 'Köln', specialization: 'Premium SUV en plug-in hybride', agreements: 'Foto/video-inspectie binnen 24u, voorschot na akkoord klant.', is_preferred: true
  });
  const partnerTransport = createRecord(store, 'partners', {
    name: 'Lowlands Vehicle Logistics', category: 'transporteur', status: 'actief', contact_person: 'Sofie Janssens', email: 'planning@lowlands.example', country: 'BE', city: 'Antwerpen', specialization: 'DE/BE transport met CMR', agreements: 'Standaard pickup dinsdag en donderdag.'
  });
  const partnerInspection = createRecord(store, 'partners', {
    name: 'TÜV Checkpoint Aachen', category: 'inspectiebedrijf', status: 'actief', contact_person: 'Markus Weber', email: 'aachen@tuv-check.example', country: 'DE', city: 'Aachen', specialization: 'Pre-purchase checks en schadehistoriek'
  });

  const jan = createRecord(store, 'contacts', {
    contact_type: 'lead', status: 'gekwalificeerd', first_name: 'Jan', last_name: 'Peeters', email: 'jan.peeters@example.com', phone: '+32 470 00 00 00', preferred_channel: 'whatsapp', lead_source: 'website', budget_min: 25000, budget_max: 36000, desired_brand: 'BMW', desired_model: 'X3', desired_fuel: 'hybride', desired_transmission: 'automaat', general_notes: 'Zoekt jonge Duitse SUV met snelle levering.'
  });
  const sara = createRecord(store, 'contacts', {
    contact_type: 'klant', status: 'actief_dossier', first_name: 'Sara', last_name: 'De Smet', email: 'sara.desmet@example.com', phone: '+32 486 11 22 33', preferred_channel: 'email', lead_source: 'doorverwijzing', budget_min: 18000, budget_max: 24000, desired_brand: 'Volkswagen', desired_model: 'Golf Variant', desired_fuel: 'benzine', desired_transmission: 'automaat', general_notes: 'Prioriteit: trekhaak en onderhoudshistoriek compleet.'
  });
  const greenFleet = createRecord(store, 'contacts', {
    contact_type: 'bedrijf', status: 'klant', company_name: 'GreenFleet BV', display_name: 'GreenFleet BV', email: 'fleet@greenfleet.example', phone: '+32 3 555 12 12', preferred_channel: 'email', lead_source: 'LinkedIn', budget_min: 70000, budget_max: 95000, desired_brand: 'Mercedes-Benz', desired_model: 'eVito', desired_fuel: 'elektrisch', general_notes: 'Fleetklant wil twee elektrische bestelwagens met laadpaaladvies.'
  });

  const bmw = createRecord(store, 'vehicles', { contact_id: jan.id, seller_partner_id: partnerDealer.id, status: 'shortlist', brand: 'BMW', model: 'X3', version: 'xDrive30e', year: 2022, mileage_km: 42000, fuel_type: 'hybride', transmission: 'automaat', asking_price: 32900, estimated_extra_costs: 2500, location_city: 'Köln', location_country: 'DE', advertisement_url: 'https://example.com/bmw-x3' });
  const golf = createRecord(store, 'vehicles', { contact_id: sara.id, seller_partner_id: partnerDealer.id, status: 'aangekocht', brand: 'Volkswagen', model: 'Golf Variant', version: '1.5 TSI DSG Life', year: 2021, mileage_km: 36500, fuel_type: 'benzine', transmission: 'automaat', asking_price: 21450, estimated_extra_costs: 2100, location_city: 'Aachen', location_country: 'DE', advertisement_url: 'https://example.com/golf-variant' });
  const vito = createRecord(store, 'vehicles', { contact_id: greenFleet.id, seller_partner_id: partnerDealer.id, status: 'transport', brand: 'Mercedes-Benz', model: 'eVito', version: 'Tourer long range', year: 2023, mileage_km: 15500, fuel_type: 'elektrisch', transmission: 'automaat', asking_price: 38900, estimated_extra_costs: 3200, location_city: 'Düsseldorf', location_country: 'DE', advertisement_url: 'https://example.com/evito' });

  const janCase = createRecord(store, 'importCases', { contact_id: jan.id, vehicle_id: bmw.id, seller_partner_id: partnerDealer.id, status: 'voertuig_gevonden', title: 'BMW X3 import voor Jan Peeters', case_number: 'IMP-2026-001', risk_level: 'normaal', target_delivery_date: addDaysIso(21), summary: 'Klant akkoord met shortlist; onderhoudshistoriek en COC nog op te vragen.' });
  const saraCase = createRecord(store, 'importCases', { contact_id: sara.id, vehicle_id: golf.id, seller_partner_id: partnerDealer.id, status: 'aankoop', title: 'VW Golf Variant import voor Sara De Smet', case_number: 'IMP-2026-002', risk_level: 'laag', target_delivery_date: addDaysIso(10), summary: 'Aankoop bevestigd; transport geboekt via Lowlands.' });
  const fleetCase = createRecord(store, 'importCases', { contact_id: greenFleet.id, vehicle_id: vito.id, seller_partner_id: partnerDealer.id, status: 'transport', title: 'Mercedes eVito fleetimport GreenFleet', case_number: 'IMP-2026-003', risk_level: 'hoog', target_delivery_date: addDaysIso(14), summary: 'Keuring gepland; risico op laadinfrastructuur-afstemming en fleetkorting.' });
  updateRecord(store, 'vehicles', bmw.id, { import_case_id: janCase.id });
  updateRecord(store, 'vehicles', golf.id, { import_case_id: saraCase.id });
  updateRecord(store, 'vehicles', vito.id, { import_case_id: fleetCase.id });

  changeCaseStatus(store, saraCase.id, 'transport', 'Aankoop betaald, transporteur ingepland');
  changeCaseStatus(store, fleetCase.id, 'keuring', 'Voertuig aangekomen in België, keuring aangevraagd');

  createRecord(store, 'tasks', { title: 'Vraag onderhoudshistoriek BMW X3 op', status: 'open', priority: 'hoog', due_date: addDaysIso(1), linked_entity_type: 'importCase', linked_entity_id: janCase.id });
  createRecord(store, 'tasks', { title: 'Bel Jan met shortlist en kostenraming', status: 'open', priority: 'normaal', due_date: addDaysIso(0), linked_entity_type: 'contact', linked_entity_id: jan.id });
  createRecord(store, 'tasks', { title: 'Controleer CMR en pickupslot Golf', status: 'bezig', priority: 'hoog', due_date: addDaysIso(2), linked_entity_type: 'importCase', linked_entity_id: saraCase.id });
  createRecord(store, 'tasks', { title: 'COC eVito opladen in dossier', status: 'afgerond', priority: 'normaal', due_date: addDaysIso(-1), linked_entity_type: 'importCase', linked_entity_id: fleetCase.id, description: 'Afgerond tijdens seedscenario zodat taakflow open/afgerond zichtbaar is.' });
  createRecord(store, 'tasks', { title: 'Fleetkorting GreenFleet bevestigen', status: 'wacht_op_derde', priority: 'urgent', due_date: addDaysIso(3), linked_entity_type: 'contact', linked_entity_id: greenFleet.id });

  createRecord(store, 'notes', { subject: 'Intake Jan afgerond', body: 'Budget, model en timing bevestigd.', linked_entity_type: 'contact', linked_entity_id: jan.id });
  createRecord(store, 'notes', { subject: 'Transport Sara geboekt', body: 'Pickup donderdag; verwacht aankomst vrijdag bij keuring.', linked_entity_type: 'importCase', linked_entity_id: saraCase.id });
  createRecord(store, 'notes', { subject: 'Fleet risico', body: 'Afstemmen of laadpaaladvies binnen of buiten MVP-service valt.', linked_entity_type: 'importCase', linked_entity_id: fleetCase.id });

  createRecord(store, 'documents', { document_type: 'coc', name: 'COC-attest BMW X3', status: 'ontbreekt', linked_entity_type: 'importCase', linked_entity_id: janCase.id });
  createRecord(store, 'documents', { document_type: 'aankoopfactuur', name: 'Aankoopfactuur VW Golf', status: 'ontvangen', linked_entity_type: 'importCase', linked_entity_id: saraCase.id, received_at: todayIso() });
  createRecord(store, 'documents', { document_type: 'cmr', name: 'CMR transport VW Golf', status: 'te_controleren', linked_entity_type: 'importCase', linked_entity_id: saraCase.id });
  createRecord(store, 'documents', { document_type: 'keuring', name: 'Keuringsaanvraag eVito', status: 'goedgekeurd', linked_entity_type: 'importCase', linked_entity_id: fleetCase.id, received_at: todayIso() });
}

function withDefaults(collection, record) {
  if (collection === 'contacts') return { country: 'BE', ...record, display_name: buildDisplayName(record) };
  if (collection === 'vehicles') return { status: 'shortlist', purchase_decision: 'te_beslissen', ...record };
  if (collection === 'importCases') return { status: 'intake', risk_level: 'normaal', ...record, case_number: record.case_number || nextCaseNumber(record.id) };
  if (collection === 'tasks') return { status: 'open', priority: 'normaal', ...record };
  if (collection === 'documents') return { status: 'ontbreekt', ...record };
  if (collection === 'partners') return { status: 'actief', country: 'DE', ...record };
  return record;
}

function makeId(collection, existing) {
  const prefix = ID_PREFIX[collection] || 'rec';
  let id;
  do id = `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  while (existing.some(item => item.id === id));
  return id;
}

function nextCaseNumber(id) {
  return `IMP-${new Date().getFullYear()}-${id.slice(-5).toUpperCase()}`;
}

function buildDisplayName(record) {
  return [record.first_name, record.last_name].filter(Boolean).join(' ').trim() || record.company_name || record.display_name || 'Naamloos contact';
}

function text(value) { return String(value ?? '').trim(); }
function active(items) { return items.filter(item => !item.is_archived); }
function addDaysIso(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function assertCollection(collection) { if (!COLLECTIONS.includes(collection)) throw new Error(`Onbekende collectie: ${collection}`); }
function save(store) { if (typeof store.persist === 'function') store.persist(store.data); }
