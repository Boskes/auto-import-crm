import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStore,
  createEmptyData,
  createRecord,
  updateRecord,
  archiveRecord,
  getCustomerGraph,
  changeCaseStatus,
  addNoteWithOptionalTask,
  validateRecord,
  exportData,
  importData,
  seedDemoData
} from '../src/crm-store.mjs';

test('contacts, vehicles, import cases, tasks, notes and documents support CRUD-style lifecycle', () => {
  const store = createStore(createEmptyData());

  const contact = createRecord(store, 'contacts', {
    contact_type: 'lead',
    status: 'nieuwe_lead',
    first_name: 'Jan',
    last_name: 'Peeters',
    email: 'jan@example.com',
    phone: '+324****0000',
    desired_brand: 'BMW',
    desired_model: 'X3'
  });
  const vehicle = createRecord(store, 'vehicles', {
    contact_id: contact.id,
    status: 'shortlist',
    brand: 'BMW',
    model: 'X3',
    year: 2022,
    asking_price: 32900
  });
  const dossier = createRecord(store, 'importCases', {
    contact_id: contact.id,
    vehicle_id: vehicle.id,
    status: 'intake',
    title: 'BMW X3 import voor Jan'
  });
  const task = createRecord(store, 'tasks', {
    title: 'Duitse advertentie controleren',
    status: 'open',
    priority: 'hoog',
    linked_entity_type: 'importCase',
    linked_entity_id: dossier.id
  });
  const note = createRecord(store, 'notes', {
    linked_entity_type: 'importCase',
    linked_entity_id: dossier.id,
    subject: 'Klant wil automaat',
    body: 'Budget bevestigd.'
  });
  const document = createRecord(store, 'documents', {
    linked_entity_type: 'importCase',
    linked_entity_id: dossier.id,
    document_type: 'aankoopfactuur',
    name: 'Conceptfactuur',
    status: 'ontbreekt'
  });

  const updatedTask = updateRecord(store, 'tasks', task.id, { status: 'afgerond' });
  const archivedDocument = archiveRecord(store, 'documents', document.id);

  assert.equal(store.data.contacts.length, 1);
  assert.equal(store.data.vehicles.length, 1);
  assert.equal(store.data.importCases.length, 1);
  assert.equal(store.data.tasks.length, 1);
  assert.equal(store.data.notes.length, 1);
  assert.equal(updatedTask.status, 'afgerond');
  assert.equal(archivedDocument.is_archived, true);
  assert.equal(note.subject, 'Klant wil automaat');
});

test('customer graph exposes customer to vehicles, import dossiers, tasks, notes and documents relationships', () => {
  const store = createStore(createEmptyData());
  const contact = createRecord(store, 'contacts', { contact_type: 'klant', status: 'klant', display_name: 'Garage Demo', email: 'demo@example.com' });
  const vehicle = createRecord(store, 'vehicles', { contact_id: contact.id, status: 'aangekocht', brand: 'Audi', model: 'A4' });
  const dossier = createRecord(store, 'importCases', { contact_id: contact.id, vehicle_id: vehicle.id, status: 'transport', title: 'Audi A4 dossier' });
  createRecord(store, 'tasks', { title: 'Transport boeken', status: 'open', linked_entity_type: 'importCase', linked_entity_id: dossier.id });
  createRecord(store, 'tasks', { title: 'Klant bellen', status: 'open', linked_entity_type: 'contact', linked_entity_id: contact.id });
  createRecord(store, 'notes', { subject: 'Transporteur gebeld', linked_entity_type: 'importCase', linked_entity_id: dossier.id });
  createRecord(store, 'documents', { name: 'COC', status: 'ontbreekt', linked_entity_type: 'importCase', linked_entity_id: dossier.id });

  const graph = getCustomerGraph(store, contact.id);

  assert.equal(graph.contact.id, contact.id);
  assert.deepEqual(graph.vehicles.map(v => v.id), [vehicle.id]);
  assert.deepEqual(graph.importCases.map(c => c.id), [dossier.id]);
  assert.equal(graph.tasks.length, 2);
  assert.equal(graph.notes.length, 1);
  assert.equal(graph.documents.length, 1);
});

test('import dossier status changes are validated and written to status history', () => {
  const store = createStore(createEmptyData());
  const contact = createRecord(store, 'contacts', { contact_type: 'lead', status: 'gekwalificeerd', display_name: 'Jan Peeters', email: 'jan@example.com' });
  const dossier = createRecord(store, 'importCases', { contact_id: contact.id, status: 'intake', title: 'Demo dossier' });

  const changed = changeCaseStatus(store, dossier.id, 'transport', 'Voertuig aangekocht en transport gepland');

  assert.equal(changed.status, 'transport');
  assert.equal(store.data.statusHistory.length, 1);
  assert.equal(store.data.statusHistory[0].from_status, 'intake');
  assert.equal(store.data.statusHistory[0].to_status, 'transport');
  assert.throws(() => changeCaseStatus(store, dossier.id, 'onbekend'), /Ongeldige status/);
});

test('note follow-up can automatically create a linked task', () => {
  const store = createStore(createEmptyData());
  const contact = createRecord(store, 'contacts', { contact_type: 'lead', status: 'nieuwe_lead', display_name: 'Jan Peeters', phone: '+324****0000' });

  const { note, task } = addNoteWithOptionalTask(store, {
    linked_entity_type: 'contact',
    linked_entity_id: contact.id,
    subject: 'Intakegesprek',
    body: 'Klant zoekt hybride SUV.',
    follow_up: true,
    follow_up_title: 'Zoek 3 geschikte voertuigen',
    follow_up_due_date: '2026-06-12'
  });

  assert.equal(note.subject, 'Intakegesprek');
  assert.equal(task.title, 'Zoek 3 geschikte voertuigen');
  assert.equal(task.linked_entity_id, contact.id);
  assert.equal(task.status, 'open');
});

test('validation rejects incomplete required MVP records', () => {
  assert.deepEqual(validateRecord('contacts', { contact_type: 'lead', status: 'nieuwe_lead' }), ['Naam/bedrijf is verplicht', 'E-mail of telefoon is verplicht']);
  assert.deepEqual(validateRecord('vehicles', { status: 'shortlist', brand: 'BMW' }), ['Model is verplicht']);
  assert.deepEqual(validateRecord('tasks', { status: 'open' }), ['Titel is verplicht']);
});

test('JSON export/import roundtrip preserves schema and records', () => {
  const store = createStore(createEmptyData());
  createRecord(store, 'contacts', { contact_type: 'lead', status: 'nieuwe_lead', display_name: 'Jan Peeters', email: 'jan@example.com' });
  const json = exportData(store);
  const imported = importData(json);

  assert.equal(imported.schemaVersion, 1);
  assert.equal(imported.contacts.length, 1);
  assert.equal(imported.contacts[0].display_name, 'Jan Peeters');
});

test('demo seed data contains representative auto-import CRM scenarios', () => {
  const store = createStore(createEmptyData());

  seedDemoData(store);

  assert.equal(store.data.contacts.length, 3);
  assert.equal(store.data.vehicles.length, 3);
  assert.equal(store.data.importCases.length, 3);
  assert.equal(store.data.tasks.length, 5);
  assert.equal(store.data.notes.length, 3);
  assert.equal(store.data.documents.length, 4);
  assert.equal(store.data.partners.length, 3);
  assert.equal(store.data.statusHistory.length, 3);
  assert.equal(store.data.importCases.reduce((sum, item) => sum + item.profit_amount, 0), 42850);
  assert.deepEqual(store.data.importCases.map(item => item.profit_booked_at.slice(0, 7)), ['2026-04', '2026-05', '2026-06']);
  assert.ok(store.data.importCases.some(item => item.status === 'nazorg'));
  assert.ok(store.data.importCases.some(item => item.status === 'aflevering'));
  assert.ok(store.data.importCases.some(item => item.status === 'inschrijving'));
  assert.ok(store.data.tasks.some(item => item.status === 'afgerond'));

  const seededAgainCount = store.data.contacts.length;
  seedDemoData(store);
  assert.equal(store.data.contacts.length, seededAgainCount, 'seeding is idempotent when records already exist');
});
