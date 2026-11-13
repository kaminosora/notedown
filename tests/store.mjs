import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../app/src/main/assets/www/js/store.js', import.meta.url), 'utf8');
const initial = {
    version: 1,
    seeded: true,
    prefs: {theme: 'auto'},
    notes: [{id: 'saved-note', title: 'Original', html: '<p>Original</p>', createdAt: 1, updatedAt: 1}]
};
const copy = (value) => JSON.parse(JSON.stringify(value));

function harness({native = false, data = initial, fail = false, throws = false} = {}) {
    const disk = {json: data ? JSON.stringify(data) : '', local: '', fail, throws, nativeWrites: 0, localWrites: 0};
    const errors = [];
    const window = {
        crypto: {randomUUID: (() => { let sequence = 0; return () => `new-${++sequence}`; })()},
        localStorage: {
            getItem() { return native ? disk.local : disk.json; },
            setItem(key, value) {
                disk.localWrites++;
                if (!native && disk.fail) throw new Error('Quota exceeded');
                if (native) disk.local = value;
                else disk.json = value;
            }
        }
    };
    if (native) {
        window.NotedownNative = {
            loadData() { return disk.json; },
            saveData(json) {
                disk.nativeWrites++;
                if (disk.throws) throw new Error('Native IO failure');
                if (disk.fail) return false;
                disk.json = json;
                return true;
            }
        };
    }
    const context = vm.createContext({
        window,
        document: {dispatchEvent(event) { errors.push(event.detail.message); }},
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
    });
    vm.runInContext(source, context, {filename: 'store.js'});
    const store = window.NoteStore;
    store.init();
    return {store, disk, errors, window};
}

for (const native of [false, true]) {
    const mode = native ? 'native' : 'local';
    test(`${mode}: create failure leaves memory and persisted notes unchanged; retry succeeds`, () => {
        const {store, disk, errors} = harness({native, fail: true});
        assert.equal(store.createNote({title: 'Draft', html: '<p>Draft</p>'}), null);
        assert.deepEqual(copy(store.getNotes()), initial.notes);
        assert.deepEqual(JSON.parse(disk.json), initial);
        assert.equal(errors.length, 1);
        disk.fail = false;
        const created = store.createNote({title: 'Draft', html: '<p>Draft</p>'});
        assert.ok(created && created.id);
        assert.equal(store.getNotes().length, 2);
        assert.equal(JSON.parse(disk.json).notes.at(-1).html, '<p>Draft</p>');
    });

    test(`${mode}: failed update and rename keep the original snapshot`, () => {
        const {store, disk} = harness({native, fail: true});
        assert.equal(store.updateContent('saved-note', '<p>Changed</p>'), null);
        assert.equal(store.renameNote('saved-note', 'Changed'), null);
        assert.deepEqual(copy(store.getNote('saved-note')), initial.notes[0]);
        assert.deepEqual(JSON.parse(disk.json), initial);
        disk.fail = false;
        assert.equal(store.updateNote('saved-note', {title: 'Changed', html: '<p>Changed</p>'}).title, 'Changed');
        assert.equal(JSON.parse(disk.json).notes[0].title, 'Changed');
    });

    test(`${mode}: failed delete remains visible and retry deletes durably`, () => {
        const {store, disk} = harness({native, fail: true});
        assert.equal(store.deleteNote('saved-note'), false);
        assert.ok(store.getNote('saved-note'));
        store.init();
        assert.ok(store.getNote('saved-note'));
        disk.fail = false;
        assert.equal(store.deleteNote('saved-note'), true);
        assert.equal(store.getNote('saved-note'), null);
        store.init();
        assert.equal(store.getNotes().length, 0);
        assert.equal(store.deleteNote('missing'), false);
    });

    test(`${mode}: failed first seed does not consume the one-time seed`, () => {
        const {store, disk} = harness({native, data: null, fail: true});
        const content = {title: 'Welcome', html: '<p>Welcome</p>'};
        assert.equal(store.seedIfNeeded(content), null);
        assert.equal(store.getNotes().length, 0);
        disk.fail = false;
        assert.ok(store.seedIfNeeded(content));
        assert.equal(store.getNotes().length, 1);
        assert.equal(store.seedIfNeeded(content), null);
    });

    test(`${mode}: preferences and getter snapshots cannot bypass persistence`, () => {
        const {store, disk} = harness({native, fail: true});
        assert.equal(store.setTheme('dark'), false);
        assert.equal(store.getPrefs().theme, 'auto');
        const notes = store.getNotes();
        notes[0].html = '<p>Mutation</p>';
        store.getNote('saved-note').title = 'Mutation';
        assert.deepEqual(copy(store.getNote('saved-note')), initial.notes[0]);
        disk.fail = false;
        assert.equal(store.setTheme('dark'), true);
        assert.equal(JSON.parse(disk.json).prefs.theme, 'dark');
    });
}

test('native: failure never writes an uncommitted browser backup or reports success', () => {
    const {store, disk, errors} = harness({native: true, throws: true});
    assert.equal(store.createNote({title: 'Uncommitted', html: '<p>Uncommitted</p>'}), null);
    assert.equal(disk.localWrites, 0);
    assert.equal(disk.local, '');
    store.init();
    assert.deepEqual(copy(store.getNotes()), initial.notes);
    assert.equal(errors.length, 1);
});

test('native: truthy non-boolean acknowledgements cannot commit unsaved changes', () => {
    const {store, window, disk} = harness({native: true});
    window.NotedownNative.saveData = () => 'false';
    assert.equal(store.updateNote('saved-note', {title: 'Not saved'}), null);
    assert.deepEqual(copy(store.getNote('saved-note')), initial.notes[0]);
    assert.deepEqual(JSON.parse(disk.json), initial);
});

test('a throwing UI error handler cannot turn a failed save into an exception or mutation', () => {
    const {store} = harness({fail: true});
    store.setSaveErrorHandler(() => { throw new Error('UI reporter failed'); });
    assert.equal(store.createNote({html: '<p>Draft</p>'}), null);
    assert.deepEqual(copy(store.getNotes()), initial.notes);
});
