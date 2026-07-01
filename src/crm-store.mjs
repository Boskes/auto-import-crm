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
  if (store.data.contacts.length > 0 && !isDemoDataset(store.data)) return;
  if (store.data.contacts.length > 0) store.data = createEmptyData();

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
  const sakura = createRecord(store, 'contacts', {
    created_at: '2026-06-10T08:20:00.000Z', updated_at: june, contact_type: 'bedrijf', status: 'actief_dossier', company_name: 'Sakura Mobility KK', display_name: 'Sakura Mobility KK', email: 'imports@sakura-mobility.example', phone: '+81 3 0000 1234', preferred_channel: 'email', lead_source: 'internationale_partner', budget_min: 85000, budget_max: 110000, desired_brand: 'Porsche', desired_model: '911 Carrera', desired_fuel: 'benzine', desired_transmission: 'automaat', general_notes: 'Exportdossier Duitsland naar Japan met RoRo verscheping via Bremerhaven.'
  });
  const dragon = createRecord(store, 'contacts', {
    created_at: '2026-06-12T09:10:00.000Z', updated_at: june, contact_type: 'bedrijf', status: 'actief_dossier', company_name: 'Dragon Auto Trading Ltd', display_name: 'Dragon Auto Trading Ltd', email: 'ops@dragon-auto.example', phone: '+86 21 0000 7788', preferred_channel: 'email', lead_source: 'beurscontact', budget_min: 65000, budget_max: 90000, desired_brand: 'Mercedes-Benz', desired_model: 'GLE 350 de', desired_fuel: 'hybride', desired_transmission: 'automaat', general_notes: 'Exportdossier Duitsland naar China met extra compliancecontrole op emissie- en batterijdocumenten.'
  });
  const southernCross = createRecord(store, 'contacts', {
    created_at: '2026-06-14T13:00:00.000Z', updated_at: june, contact_type: 'bedrijf', status: 'actief_dossier', company_name: 'Southern Cross Imports Pty Ltd', display_name: 'Southern Cross Imports Pty Ltd', email: 'logistics@southerncrossimports.example', phone: '+61 2 0000 9911', preferred_channel: 'email', lead_source: 'LinkedIn', budget_min: 70000, budget_max: 95000, desired_brand: 'Volkswagen', desired_model: 'California Ocean', desired_fuel: 'diesel', desired_transmission: 'automaat', general_notes: 'Exportdossier Duitsland naar Australie met quarantaine- en reinigingscontrole.'
  });
  const lena = createRecord(store, 'contacts', {
    created_at: '2026-06-16T10:25:00.000Z', updated_at: june, contact_type: 'klant', status: 'nazorg', first_name: 'Lena', last_name: 'Jacobs', email: 'lena.jacobs@example.com', phone: '+32 476 21 84 09', preferred_channel: 'whatsapp', lead_source: 'website', budget_min: 42000, budget_max: 54000, desired_brand: 'Volvo', desired_model: 'XC60', desired_fuel: 'hybride', desired_transmission: 'automaat', general_notes: 'Extra demovoertuig met realistische marge binnen de winstbandbreedte.'
  });
  const kroon = createRecord(store, 'contacts', {
    created_at: '2026-06-18T15:40:00.000Z', updated_at: june, contact_type: 'bedrijf', status: 'klant', company_name: 'Bakkerij De Kroon BV', display_name: 'Bakkerij De Kroon BV', email: 'fleet@dekroon.example', phone: '+32 14 555 881', preferred_channel: 'email', lead_source: 'doorverwijzing', budget_min: 32000, budget_max: 45000, desired_brand: 'Ford', desired_model: 'Transit Custom', desired_fuel: 'diesel', desired_transmission: 'automaat', general_notes: 'Extra bedrijfswagenimport met winst binnen de gevraagde bandbreedte.'
  });

  const audi = createRecord(store, 'vehicles', { created_at: april, updated_at: april, contact_id: sofie.id, seller_partner_id: partnerDealer.id, status: 'geleverd', purchase_decision: 'gekocht', brand: 'Audi', model: 'Q5 Sportback', version: '50 TFSI e quattro S line', year: 2023, mileage_km: 28600, fuel_type: 'hybride', transmission: 'automaat', asking_price: 37600, estimated_extra_costs: 2500, location_city: 'Frankfurt', location_country: 'DE', advertisement_url: 'https://example.com/audi-q5-sportback' });
  const bmw = createRecord(store, 'vehicles', { created_at: may, updated_at: may, contact_id: niels.id, seller_partner_id: partnerDealer.id, status: 'geleverd', purchase_decision: 'gekocht', brand: 'BMW', model: '530e Touring', version: 'M Sport plug-in hybrid', year: 2022, mileage_km: 41200, fuel_type: 'hybride', transmission: 'automaat', asking_price: 32900, estimated_extra_costs: 2450, location_city: 'Mainz', location_country: 'DE', advertisement_url: 'https://example.com/bmw-530e-touring' });
  const vito = createRecord(store, 'vehicles', { created_at: june, updated_at: june, contact_id: orion.id, seller_partner_id: partnerDealer.id, status: 'geleverd', purchase_decision: 'gekocht', brand: 'Mercedes-Benz', model: 'Vito Tourer', version: '119 CDI Pro Extra Long', year: 2023, mileage_km: 22400, fuel_type: 'diesel', transmission: 'automaat', asking_price: 43800, estimated_extra_costs: 3300, location_city: 'Dusseldorf', location_country: 'DE', advertisement_url: 'https://example.com/mercedes-vito-tourer' });
  const porsche = createRecord(store, 'vehicles', { created_at: june, updated_at: june, contact_id: sakura.id, seller_partner_id: partnerDealer.id, status: 'transport', purchase_decision: 'gekocht', brand: 'Porsche', model: '911 Carrera', version: '992 PDK', year: 2021, mileage_km: 31800, fuel_type: 'benzine', transmission: 'automaat', asking_price: 82500, estimated_extra_costs: 7200, location_city: 'Stuttgart', location_country: 'DE', advertisement_url: 'https://example.com/porsche-911-japan' });
  const gle = createRecord(store, 'vehicles', { created_at: june, updated_at: june, contact_id: dragon.id, seller_partner_id: partnerDealer.id, status: 'transport', purchase_decision: 'gekocht', brand: 'Mercedes-Benz', model: 'GLE 350 de', version: '4MATIC AMG Line', year: 2022, mileage_km: 38400, fuel_type: 'hybride', transmission: 'automaat', asking_price: 61200, estimated_extra_costs: 6600, location_city: 'Munich', location_country: 'DE', advertisement_url: 'https://example.com/gle-china' });
  const california = createRecord(store, 'vehicles', { created_at: june, updated_at: june, contact_id: southernCross.id, seller_partner_id: partnerDealer.id, status: 'te_controleren', purchase_decision: 'gekocht', brand: 'Volkswagen', model: 'California Ocean', version: '2.0 TDI 4Motion', year: 2021, mileage_km: 44700, fuel_type: 'diesel', transmission: 'automaat', asking_price: 54800, estimated_extra_costs: 8900, location_city: 'Hamburg', location_country: 'DE', advertisement_url: 'https://example.com/california-australia' });
  const volvo = createRecord(store, 'vehicles', { created_at: june, updated_at: june, contact_id: lena.id, seller_partner_id: partnerDealer.id, status: 'geleverd', purchase_decision: 'gekocht', brand: 'Volvo', model: 'XC60', version: 'T8 Recharge Inscription', year: 2022, mileage_km: 36100, fuel_type: 'hybride', transmission: 'automaat', asking_price: 40200, estimated_extra_costs: 2900, location_city: 'Bonn', location_country: 'DE', advertisement_url: 'https://example.com/volvo-xc60-belgium' });
  const transit = createRecord(store, 'vehicles', { created_at: june, updated_at: june, contact_id: kroon.id, seller_partner_id: partnerDealer.id, status: 'geleverd', purchase_decision: 'gekocht', brand: 'Ford', model: 'Transit Custom', version: '2.0 EcoBlue Limited L2', year: 2022, mileage_km: 52800, fuel_type: 'diesel', transmission: 'automaat', asking_price: 31400, estimated_extra_costs: 2700, location_city: 'Bremen', location_country: 'DE', advertisement_url: 'https://example.com/ford-transit-belgium' });

  const audiCase = createRecord(store, 'importCases', { created_at: april, updated_at: april, contact_id: sofie.id, vehicle_id: audi.id, seller_partner_id: partnerDealer.id, status: 'nazorg', title: 'Audi Q5 Sportback import Duitsland naar Belgie', case_number: 'IMP-2026-041', risk_level: 'laag', target_delivery_date: '2026-04-19', origin_country: 'DE', destination_country: 'BE', destination_port: 'Antwerpen', export_route: 'Frankfurt -> Antwerpen', purchase_price: 37600, sale_price: 47700, total_costs: 2500, service_fee: 3400, profit_amount: 7600, profit_booked_at: '2026-04-22', projected_profit_amount: 7600, summary: 'April-dossier afgerond. Winst per voertuig binnen de demo-bandbreedte.' });
  const bmwCase = createRecord(store, 'importCases', { created_at: may, updated_at: may, contact_id: niels.id, vehicle_id: bmw.id, seller_partner_id: partnerDealer.id, status: 'aflevering', title: 'BMW 530e Touring import Duitsland naar Belgie', case_number: 'IMP-2026-052', risk_level: 'laag', target_delivery_date: '2026-05-24', origin_country: 'DE', destination_country: 'BE', destination_port: 'Antwerpen', export_route: 'Mainz -> Antwerpen', purchase_price: 32900, sale_price: 42550, total_costs: 2450, service_fee: 3200, profit_amount: 7200, profit_booked_at: '2026-05-28', projected_profit_amount: 7200, summary: 'Mei-dossier met snelle doorlooptijd en winst binnen de gevraagde marge.' });
  const vitoCase = createRecord(store, 'importCases', { created_at: june, updated_at: june, contact_id: orion.id, vehicle_id: vito.id, seller_partner_id: partnerDealer.id, status: 'inschrijving', title: 'Mercedes Vito Tourer import Duitsland naar Belgie', case_number: 'IMP-2026-063', risk_level: 'normaal', target_delivery_date: '2026-06-27', origin_country: 'DE', destination_country: 'BE', destination_port: 'Antwerpen', export_route: 'Dusseldorf -> Antwerpen', purchase_price: 43800, sale_price: 54000, total_costs: 3300, service_fee: 3500, profit_amount: 6900, profit_booked_at: '2026-06-28', projected_profit_amount: 6900, summary: 'Juni-dossier afgerond met zakelijke klant en winst binnen de bandbreedte.' });
  const japanCase = createRecord(store, 'importCases', { created_at: june, updated_at: june, contact_id: sakura.id, vehicle_id: porsche.id, seller_partner_id: partnerDealer.id, status: 'transport', title: 'Porsche 911 export Duitsland naar Japan', case_number: 'EXP-2026-JP1', risk_level: 'normaal', target_delivery_date: '2026-08-14', origin_country: 'DE', destination_country: 'JP', destination_port: 'Yokohama', export_route: 'Stuttgart -> Bremerhaven -> Yokohama', purchase_price: 82500, sale_price: 96500, total_costs: 7200, service_fee: 3600, profit_amount: 6800, profit_booked_at: '2026-06-30', projected_profit_amount: 6800, compliance_notes: 'Japan: exportcertificaat, vertaalde eigendomspapieren en JEVIC-inspectie voorbereiden.', summary: 'Internationaal exportdossier van Duitsland naar Japan. Voertuig staat gepland voor RoRo verscheping naar Yokohama.' });
  const chinaCase = createRecord(store, 'importCases', { created_at: june, updated_at: june, contact_id: dragon.id, vehicle_id: gle.id, seller_partner_id: partnerDealer.id, status: 'transport', title: 'Mercedes GLE export Duitsland naar China', case_number: 'EXP-2026-CN1', risk_level: 'hoog', target_delivery_date: '2026-08-28', origin_country: 'DE', destination_country: 'CN', destination_port: 'Shanghai', export_route: 'Munich -> Hamburg -> Shanghai', purchase_price: 61200, sale_price: 74300, total_costs: 6600, service_fee: 3400, profit_amount: 6500, profit_booked_at: '2026-06-30', projected_profit_amount: 6500, compliance_notes: 'China: CCC-documentatie, emissieklasse, batterijrapport en douane HS-code vooraf valideren.', summary: 'Exportdossier van Duitsland naar China met extra compliancecontrole voor Shanghai.' });
  const australiaCase = createRecord(store, 'importCases', { created_at: june, updated_at: june, contact_id: southernCross.id, vehicle_id: california.id, seller_partner_id: partnerDealer.id, status: 'keuring', title: 'VW California export Duitsland naar Australie', case_number: 'EXP-2026-AU1', risk_level: 'hoog', target_delivery_date: '2026-09-10', origin_country: 'DE', destination_country: 'AU', destination_port: 'Melbourne', export_route: 'Hamburg -> Melbourne', purchase_price: 54800, sale_price: 70100, total_costs: 8900, service_fee: 3600, profit_amount: 6400, profit_booked_at: '2026-06-30', projected_profit_amount: 6400, compliance_notes: 'Australie: biosecurity reiniging, asbestos-vrij verklaring en import approval opvolgen.', summary: 'Exportdossier van Duitsland naar Australie met focus op quarantaine- en biosecurity-eisen.' });
  const volvoCase = createRecord(store, 'importCases', { created_at: june, updated_at: june, contact_id: lena.id, vehicle_id: volvo.id, seller_partner_id: partnerDealer.id, status: 'nazorg', title: 'Volvo XC60 import Duitsland naar Belgie', case_number: 'IMP-2026-064', risk_level: 'laag', target_delivery_date: '2026-06-25', origin_country: 'DE', destination_country: 'BE', destination_port: 'Antwerpen', export_route: 'Bonn -> Antwerpen', purchase_price: 40200, sale_price: 49400, total_costs: 2900, service_fee: 3100, profit_amount: 6300, profit_booked_at: '2026-06-29', projected_profit_amount: 6300, summary: 'Extra demovoertuig om de winstspreiding realistischer te maken.' });
  const transitCase = createRecord(store, 'importCases', { created_at: june, updated_at: june, contact_id: kroon.id, vehicle_id: transit.id, seller_partner_id: partnerDealer.id, status: 'aflevering', title: 'Ford Transit Custom import Duitsland naar Belgie', case_number: 'IMP-2026-065', risk_level: 'normaal', target_delivery_date: '2026-06-30', origin_country: 'DE', destination_country: 'BE', destination_port: 'Antwerpen', export_route: 'Bremen -> Antwerpen', purchase_price: 31400, sale_price: 40250, total_costs: 2700, service_fee: 3000, profit_amount: 6150, profit_booked_at: '2026-06-30', projected_profit_amount: 6150, summary: 'Extra bedrijfswagenimport met winst binnen de gevraagde bandbreedte.' });
  updateRecord(store, 'vehicles', audi.id, { import_case_id: audiCase.id });
  updateRecord(store, 'vehicles', bmw.id, { import_case_id: bmwCase.id });
  updateRecord(store, 'vehicles', vito.id, { import_case_id: vitoCase.id });
  updateRecord(store, 'vehicles', porsche.id, { import_case_id: japanCase.id });
  updateRecord(store, 'vehicles', gle.id, { import_case_id: chinaCase.id });
  updateRecord(store, 'vehicles', california.id, { import_case_id: australiaCase.id });
  updateRecord(store, 'vehicles', volvo.id, { import_case_id: volvoCase.id });
  updateRecord(store, 'vehicles', transit.id, { import_case_id: transitCase.id });

  createRecord(store, 'statusHistory', { created_at: april, updated_at: april, import_case_id: audiCase.id, from_status: 'aflevering', to_status: 'nazorg', reason: 'Afgeleverd en eindfactuur betaald', changed_at: '2026-04-22T09:00:00.000Z' });
  createRecord(store, 'statusHistory', { created_at: may, updated_at: may, import_case_id: bmwCase.id, from_status: 'inschrijving', to_status: 'aflevering', reason: 'Inschrijving afgerond en aflevering ingepland', changed_at: '2026-05-27T10:30:00.000Z' });
  createRecord(store, 'statusHistory', { created_at: june, updated_at: june, import_case_id: vitoCase.id, from_status: 'keuring', to_status: 'inschrijving', reason: 'Keuring goedgekeurd en inschrijving verwerkt', changed_at: '2026-06-28T15:45:00.000Z' });
  createRecord(store, 'statusHistory', { created_at: june, updated_at: june, import_case_id: japanCase.id, from_status: 'aankoop', to_status: 'transport', reason: 'Transport naar Bremerhaven bevestigd voor verscheping naar Yokohama', changed_at: '2026-06-30T10:00:00.000Z' });
  createRecord(store, 'statusHistory', { created_at: june, updated_at: june, import_case_id: chinaCase.id, from_status: 'aankoop', to_status: 'transport', reason: 'Containerbooking naar Shanghai bevestigd', changed_at: '2026-06-30T11:30:00.000Z' });
  createRecord(store, 'statusHistory', { created_at: june, updated_at: june, import_case_id: australiaCase.id, from_status: 'transport', to_status: 'keuring', reason: 'Biosecurity reiniging en inspectie ingepland voor Australie', changed_at: '2026-06-30T13:15:00.000Z' });
  createRecord(store, 'statusHistory', { created_at: june, updated_at: june, import_case_id: volvoCase.id, from_status: 'aflevering', to_status: 'nazorg', reason: 'Afgeleverd en betaling bevestigd', changed_at: '2026-06-29T16:00:00.000Z' });
  createRecord(store, 'statusHistory', { created_at: june, updated_at: june, import_case_id: transitCase.id, from_status: 'inschrijving', to_status: 'aflevering', reason: 'Bedrijfswagen klaargezet voor aflevering', changed_at: '2026-06-30T17:20:00.000Z' });

  createRecord(store, 'tasks', { created_at: april, updated_at: april, title: 'Nazorgcheck Audi Q5 afronden', status: 'afgerond', priority: 'normaal', due_date: '2026-04-24', linked_entity_type: 'importCase', linked_entity_id: audiCase.id, description: 'Afgerond tijdens seedscenario zodat taakflow open/afgerond zichtbaar is.' });
  createRecord(store, 'tasks', { created_at: may, updated_at: may, title: 'Eindfactuur BMW 530e controleren', status: 'afgerond', priority: 'hoog', due_date: '2026-05-28', linked_entity_type: 'importCase', linked_entity_id: bmwCase.id });
  createRecord(store, 'tasks', { created_at: june, updated_at: june, title: 'Fleetdocumenten Orion archiveren', status: 'bezig', priority: 'normaal', due_date: '2026-07-02', linked_entity_type: 'importCase', linked_entity_id: vitoCase.id });
  createRecord(store, 'tasks', { created_at: june, updated_at: june, title: 'Review winstoverzicht Q2 voorbereiden', status: 'open', priority: 'hoog', due_date: '2026-07-05', linked_entity_type: 'contact', linked_entity_id: orion.id });
  createRecord(store, 'tasks', { created_at: june, updated_at: june, title: 'Vraag testimonial aan Sofie', status: 'open', priority: 'laag', due_date: '2026-07-08', linked_entity_type: 'contact', linked_entity_id: sofie.id });
  createRecord(store, 'tasks', { created_at: june, updated_at: june, title: 'JEVIC-inspectie Porsche voor Japan bevestigen', status: 'open', priority: 'hoog', due_date: '2026-07-04', linked_entity_type: 'importCase', linked_entity_id: japanCase.id });
  createRecord(store, 'tasks', { created_at: june, updated_at: june, title: 'CCC- en batterijdocumenten GLE voor China valideren', status: 'wacht_op_derde', priority: 'urgent', due_date: '2026-07-06', linked_entity_type: 'importCase', linked_entity_id: chinaCase.id });
  createRecord(store, 'tasks', { created_at: june, updated_at: june, title: 'Biosecurity reiniging VW California boeken', status: 'bezig', priority: 'hoog', due_date: '2026-07-09', linked_entity_type: 'importCase', linked_entity_id: australiaCase.id });
  createRecord(store, 'tasks', { created_at: june, updated_at: june, title: 'Nazorg Volvo XC60 plannen', status: 'open', priority: 'normaal', due_date: '2026-07-10', linked_entity_type: 'importCase', linked_entity_id: volvoCase.id });
  createRecord(store, 'tasks', { created_at: june, updated_at: june, title: 'Transit aflevering met klant bevestigen', status: 'bezig', priority: 'normaal', due_date: '2026-07-03', linked_entity_type: 'importCase', linked_entity_id: transitCase.id });

  createRecord(store, 'notes', { created_at: april, updated_at: april, subject: 'April winst geboekt', body: 'Audi Q5 Sportback marge bevestigd: EUR 14.800.', linked_entity_type: 'importCase', linked_entity_id: audiCase.id });
  createRecord(store, 'notes', { created_at: may, updated_at: may, subject: 'Mei dossier afgerond', body: 'BMW 530e Touring afgerond met EUR 12.150 winst.', linked_entity_type: 'importCase', linked_entity_id: bmwCase.id });
  createRecord(store, 'notes', { created_at: june, updated_at: june, subject: 'Juni zakelijke levering', body: 'Orion-dossier geboekt met EUR 6.900 winst; totaal laatste drie maanden EUR 53.850.', linked_entity_type: 'importCase', linked_entity_id: vitoCase.id });
  createRecord(store, 'notes', { created_at: june, updated_at: june, subject: 'Japan export toegevoegd', body: 'Porsche 911 vanuit Duitsland naar Yokohama met EUR 6.800 winst geboekt.', linked_entity_type: 'importCase', linked_entity_id: japanCase.id });
  createRecord(store, 'notes', { created_at: june, updated_at: june, subject: 'China export toegevoegd', body: 'Mercedes GLE vanuit Duitsland naar Shanghai met EUR 6.500 winst geboekt.', linked_entity_type: 'importCase', linked_entity_id: chinaCase.id });
  createRecord(store, 'notes', { created_at: june, updated_at: june, subject: 'Australie export toegevoegd', body: 'VW California vanuit Duitsland naar Melbourne met EUR 6.400 winst geboekt.', linked_entity_type: 'importCase', linked_entity_id: australiaCase.id });
  createRecord(store, 'notes', { created_at: june, updated_at: june, subject: 'Extra Volvo marge', body: 'Volvo XC60 vanuit Duitsland naar Belgie met EUR 6.300 winst geboekt.', linked_entity_type: 'importCase', linked_entity_id: volvoCase.id });
  createRecord(store, 'notes', { created_at: june, updated_at: june, subject: 'Extra Transit marge', body: 'Ford Transit Custom vanuit Duitsland naar Belgie met EUR 6.150 winst geboekt.', linked_entity_type: 'importCase', linked_entity_id: transitCase.id });

  createRecord(store, 'documents', { created_at: april, updated_at: april, document_type: 'aankoopfactuur', name: 'Aankoopfactuur Audi Q5 Sportback', status: 'goedgekeurd', linked_entity_type: 'importCase', linked_entity_id: audiCase.id, received_at: '2026-04-18' });
  createRecord(store, 'documents', { created_at: may, updated_at: may, document_type: 'verkoopfactuur', name: 'Eindfactuur BMW 530e Touring', status: 'goedgekeurd', linked_entity_type: 'importCase', linked_entity_id: bmwCase.id, received_at: '2026-05-28' });
  createRecord(store, 'documents', { created_at: june, updated_at: june, document_type: 'keuring', name: 'Keuringsbewijs Mercedes Vito', status: 'goedgekeurd', linked_entity_type: 'importCase', linked_entity_id: vitoCase.id, received_at: '2026-06-27' });
  createRecord(store, 'documents', { created_at: june, updated_at: june, document_type: 'inschrijving', name: 'Inschrijving Orion Vito Tourer', status: 'ontvangen', linked_entity_type: 'importCase', linked_entity_id: vitoCase.id, received_at: '2026-06-28' });
  createRecord(store, 'documents', { created_at: june, updated_at: june, document_type: 'exportcertificaat', name: 'Exportcertificaat Porsche 911 Japan', status: 'te_controleren', linked_entity_type: 'importCase', linked_entity_id: japanCase.id, received_at: '2026-06-30' });
  createRecord(store, 'documents', { created_at: june, updated_at: june, document_type: 'douane', name: 'China CCC en douanevoorbereiding Mercedes GLE', status: 'aangevraagd', linked_entity_type: 'importCase', linked_entity_id: chinaCase.id, received_at: '2026-06-30' });
  createRecord(store, 'documents', { created_at: june, updated_at: june, document_type: 'biosecurity', name: 'Australie biosecurity checklist VW California', status: 'te_controleren', linked_entity_type: 'importCase', linked_entity_id: australiaCase.id, received_at: '2026-06-30' });
  createRecord(store, 'documents', { created_at: june, updated_at: june, document_type: 'verkoopfactuur', name: 'Eindfactuur Volvo XC60', status: 'goedgekeurd', linked_entity_type: 'importCase', linked_entity_id: volvoCase.id, received_at: '2026-06-29' });
  createRecord(store, 'documents', { created_at: june, updated_at: june, document_type: 'verkoopfactuur', name: 'Eindfactuur Ford Transit Custom', status: 'goedgekeurd', linked_entity_type: 'importCase', linked_entity_id: transitCase.id, received_at: '2026-06-30' });
  store.data.settings.demoDataVersion = '2026-q2-international-profit-53850';
  save(store);
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
function isDemoDataset(data) {
  if (data.settings?.demoDataVersion) return true;
  const demoNames = new Set(['Jan Peeters', 'Sara De Smet', 'GreenFleet BV', 'Sofie Van den Broeck', 'Niels Verhoeven', 'Orion Facility Services BV', 'Sakura Mobility KK', 'Dragon Auto Trading Ltd', 'Southern Cross Imports Pty Ltd']);
  const knownDemoContact = (data.contacts || []).some(contact => demoNames.has(contact.display_name || contact.company_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ')));
  const allIdsLookDemo = COLLECTIONS.flatMap(collection => data[collection] || []).every(record => String(record.id || '').includes('_demo_'));
  return knownDemoContact || allIdsLookDemo;
}
function addDaysIso(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
function assertCollection(collection) { if (!COLLECTIONS.includes(collection)) throw new Error(`Onbekende collectie: ${collection}`); }
function save(store) { if (typeof store.persist === 'function') store.persist(store.data); }
