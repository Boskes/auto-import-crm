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
    updated_at: values.updated_at || now,
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

  const april = '2026-04-18T09:30:00.000Z';
  const may = '2026-05-22T10:15:00.000Z';
  const june = '2026-06-24T14:00:00.000Z';

  const partnerDealer = createRecord(store, 'partners', {
    created_at: '2026-04-02T08:00:00.000Z', updated_at: june, name: 'Autohaus Rhein-Main GmbH', category: 'duitse_garage', status: 'voorkeurspartner', contact_person: 'Klaus Weber', email: 'sales@rhein-main-auto.example', phone: '+49 69 000000', country: 'DE', city: 'Frankfurt', specialization: 'Jonge premiumwagens en plug-in hybrides', agreements: 'Digitale inspectie binnen 24u, documentenpakket voor export inbegrepen.', is_preferred: true
  });
  const partnerTransport = createRecord(store, 'partners', {
    created_at: '2026-04-03T08:00:00.000Z', updated_at: june, name: 'H+K Fahrzeuglogistik', category: 'transporteur', status: 'actief', contact_person: 'Marlies Koch', email: 'planning@hk-logistik.example', country: 'DE', city: 'Dusseldorf', specialization: 'DE/BE transport met CMR en snelle leveringen', agreements: 'Pickup op maandag, woensdag en vrijdag.'
  });
  const partnerInspection = createRecord(store, 'partners', {
    created_at: '2026-04-04T08:00:00.000Z', updated_at: june, name: 'DEKRA Mobility Check Aachen', category: 'inspectiebedrijf', status: 'actief', contact_person: 'Nina Schmitz', email: 'aachen@dekra-check.example', country: 'DE', city: 'Aachen', specialization: 'Pre-purchase checks, batterijrapporten en schadehistoriek'
  });

  const sofie = createRecord(store, 'contacts', {
    created_at: '2026-04-05T12:00:00.000Z', updated_at: april, contact_type: 'klant', status: 'nazorg', first_name: 'Sofie', last_name: 'Van den Broeck', email: 'sofie.vdb@example.com', phone: '+32 472 18 44 20', preferred_channel: 'whatsapp', lead_source: 'website', budget_min: 45000, budget_max: 58000, desired_brand: 'Audi', desired_model: 'Q5 Sportback', desired_fuel: 'hybride', desired_transmission: 'automaat', general_notes: 'April-dossier afgerond met positieve marge en nazorgcheck.'
  });
  const niels = createRecord(store, 'contacts', {
    created_at: '2026-05-06T11:00:00.000Z', updated_at: may, contact_type: 'klant', status: 'nazorg', first_name: 'Niels', last_name: 'Verhoeven', email: 'niels.verhoeven@example.com', phone: '+32 485 61 02 19', preferred_channel: 'email', lead_source: 'doorverwijzing', budget_min: 36000, budget_max: 50000, desired_brand: 'BMW', desired_model: '530e Touring', desired_fuel: 'hybride', desired_transmission: 'automaat', general_notes: 'Mei-dossier afgerond; klant wil later mogelijk tweede gezinswagen.'
  });
  const orion = createRecord(store, 'contacts', {
    created_at: '2026-06-07T09:45:00.000Z', updated_at: june, contact_type: 'bedrijf', status: 'klant', company_name: 'Orion Facility Services BV', display_name: 'Orion Facility Services BV', email: 'fleet@orionfacility.example', phone: '+32 3 555 48 19', preferred_channel: 'email', lead_source: 'LinkedIn', budget_min: 52000, budget_max: 70000, desired_brand: 'Mercedes-Benz', desired_model: 'Vito Tourer', desired_fuel: 'diesel', general_notes: 'Juni-dossier met snelle levering voor directieteam.'
  });

  const audi = createRecord(store, 'vehicles', { created_at: april, updated_at: april, contact_id: sofie.id, seller_partner_id: partnerDealer.id, status: 'geleverd', purchase_decision: 'gekocht', brand: 'Audi', model: 'Q5 Sportback', version: '50 TFSI e quattro S line', year: 2023, mileage_km: 28600, fuel_type: 'hybride', transmission: 'automaat', asking_price: 37600, estimated_extra_costs: 2500, location_city: 'Frankfurt', location_country: 'DE', advertisement_url: 'https://example.com/audi-q5-sportback' });
  const bmw = createRecord(store, 'vehicles', { created_at: may, updated_at: may, contact_id: niels.id, seller_partner_id: partnerDealer.id, status: 'geleverd', purchase_decision: 'gekocht', brand: 'BMW', model: '530e Touring', version: 'M Sport plug-in hybrid', year: 2022, mileage_km: 41200, fuel_type: 'hybride', transmission: 'automaat', asking_price: 32900, estimated_extra_costs: 2450, location_city: 'Mainz', location_country: 'DE', advertisement_url: 'https://example.com/bmw-530e-touring' });
  const vito = createRecord(store, 'vehicles', { created_at: june, updated_at: june, contact_id: orion.id, seller_partner_id: partnerDealer.id, status: 'geleverd', purchase_decision: 'gekocht', brand: 'Mercedes-Benz', model: 'Vito Tourer', version: '119 CDI Pro Extra Long', year: 2023, mileage_km: 22400, fuel_type: 'diesel', transmission: 'automaat', asking_price: 43800, estimated_extra_costs: 3300, location_city: 'Dusseldorf', location_country: 'DE', advertisement_url: 'https://example.com/mercedes-vito-tourer' });

  const audiCase = createRecord(store, 'importCases', { created_at: april, updated_at: april, contact_id: sofie.id, vehicle_id: audi.id, seller_partner_id: partnerDealer.id, status: 'nazorg', title: 'Audi Q5 Sportback import voor Sofie Van den Broeck', case_number: 'IMP-2026-041', risk_level: 'laag', target_delivery_date: '2026-04-19', purchase_price: 37600, sale_price: 54900, total_costs: 2500, service_fee: 3900, profit_amount: 14800, profit_booked_at: '2026-04-22', summary: 'April-dossier afgerond. Winst geboekt na aflevering en betaling eindfactuur.' });
  const bmwCase = createRecord(store, 'importCases', { created_at: may, updated_at: may, contact_id: niels.id, vehicle_id: bmw.id, seller_partner_id: partnerDealer.id, status: 'aflevering', title: 'BMW 530e Touring import voor Niels Verhoeven', case_number: 'IMP-2026-052', risk_level: 'laag', target_delivery_date: '2026-05-24', purchase_price: 32900, sale_price: 47500, total_costs: 2450, service_fee: 3250, profit_amount: 12150, profit_booked_at: '2026-05-28', summary: 'Mei-dossier met snelle doorlooptijd en gerealiseerde marge.' });
  const vitoCase = createRecord(store, 'importCases', { created_at: june, updated_at: june, contact_id: orion.id, vehicle_id: vito.id, seller_partner_id: partnerDealer.id, status: 'inschrijving', title: 'Mercedes Vito Tourer import voor Orion Facility Services', case_number: 'IMP-2026-063', risk_level: 'normaal', target_delivery_date: '2026-06-27', purchase_price: 43800, sale_price: 63000, total_costs: 3300, service_fee: 4500, profit_amount: 15900, profit_booked_at: '2026-06-28', summary: 'Juni-dossier afgerond met zakelijke klant en hoogste marge van de demo-set.' });
  updateRecord(store, 'vehicles', audi.id, { import_case_id: audiCase.id });
  updateRecord(store, 'vehicles', bmw.id, { import_case_id: bmwCase.id });
  updateRecord(store, 'vehicles', vito.id, { import_case_id: vitoCase.id });

  createRecord(store, 'statusHistory', { created_at: april, updated_at: april, import_case_id: audiCase.id, from_status: 'aflevering', to_status: 'nazorg', reason: 'Afgeleverd en eindfactuur betaald', changed_at: '2026-04-22T09:00:00.000Z' });
  createRecord(store, 'statusHistory', { created_at: may, updated_at: may, import_case_id: bmwCase.id, from_status: 'inschrijving', to_status: 'aflevering', reason: 'Inschrijving afgerond en aflevering ingepland', changed_at: '2026-05-27T10:30:00.000Z' });
  createRecord(store, 'statusHistory', { created_at: june, updated_at: june, import_case_id: vitoCase.id, from_status: 'keuring', to_status: 'inschrijving', reason: 'Keuring goedgekeurd en inschrijving verwerkt', changed_at: '2026-06-28T15:45:00.000Z' });

  createRecord(store, 'tasks', { created_at: april, updated_at: april, title: 'Nazorgcheck Audi Q5 afronden', status: 'afgerond', priority: 'normaal', due_date: '2026-04-24', linked_entity_type: 'importCase', linked_entity_id: audiCase.id, description: 'Afgerond tijdens seedscenario zodat taakflow open/afgerond zichtbaar is.' });
  createRecord(store, 'tasks', { created_at: may, updated_at: may, title: 'Eindfactuur BMW 530e controleren', status: 'afgerond', priority: 'hoog', due_date: '2026-05-28', linked_entity_type: 'importCase', linked_entity_id: bmwCase.id });
  createRecord(store, 'tasks', { created_at: june, updated_at: june, title: 'Fleetdocumenten Orion archiveren', status: 'bezig', priority: 'normaal', due_date: '2026-07-02', linked_entity_type: 'importCase', linked_entity_id: vitoCase.id });
  createRecord(store, 'tasks', { created_at: june, updated_at: june, title: 'Review winstoverzicht Q2 voorbereiden', status: 'open', priority: 'hoog', due_date: '2026-07-05', linked_entity_type: 'contact', linked_entity_id: orion.id });
  createRecord(store, 'tasks', { created_at: june, updated_at: june, title: 'Vraag testimonial aan Sofie', status: 'open', priority: 'laag', due_date: '2026-07-08', linked_entity_type: 'contact', linked_entity_id: sofie.id });

  createRecord(store, 'notes', { created_at: april, updated_at: april, subject: 'April winst geboekt', body: 'Audi Q5 Sportback marge bevestigd: EUR 14.800.', linked_entity_type: 'importCase', linked_entity_id: audiCase.id });
  createRecord(store, 'notes', { created_at: may, updated_at: may, subject: 'Mei dossier afgerond', body: 'BMW 530e Touring afgerond met EUR 12.150 winst.', linked_entity_type: 'importCase', linked_entity_id: bmwCase.id });
  createRecord(store, 'notes', { created_at: june, updated_at: june, subject: 'Juni zakelijke levering', body: 'Orion-dossier geboekt met EUR 15.900 winst; totaal laatste drie maanden EUR 42.850.', linked_entity_type: 'importCase', linked_entity_id: vitoCase.id });

  createRecord(store, 'documents', { created_at: april, updated_at: april, document_type: 'aankoopfactuur', name: 'Aankoopfactuur Audi Q5 Sportback', status: 'goedgekeurd', linked_entity_type: 'importCase', linked_entity_id: audiCase.id, received_at: '2026-04-18' });
  createRecord(store, 'documents', { created_at: may, updated_at: may, document_type: 'verkoopfactuur', name: 'Eindfactuur BMW 530e Touring', status: 'goedgekeurd', linked_entity_type: 'importCase', linked_entity_id: bmwCase.id, received_at: '2026-05-28' });
  createRecord(store, 'documents', { created_at: june, updated_at: june, document_type: 'keuring', name: 'Keuringsbewijs Mercedes Vito', status: 'goedgekeurd', linked_entity_type: 'importCase', linked_entity_id: vitoCase.id, received_at: '2026-06-27' });
  createRecord(store, 'documents', { created_at: june, updated_at: june, document_type: 'inschrijving', name: 'Inschrijving Orion Vito Tourer', status: 'ontvangen', linked_entity_type: 'importCase', linked_entity_id: vitoCase.id, received_at: '2026-06-28' });
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
function assertCollection(collection) { if (!COLLECTIONS.includes(collection)) throw new Error(`Onbekende collectie: ${collection}`); }
function save(store) { if (typeof store.persist === 'function') store.persist(store.data); }
