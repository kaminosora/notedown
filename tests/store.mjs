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

function harness({native = false, data = initial, raw = null, local = '', fail = false, throws = false} = {}) {
    const json = raw === null ? (data ? JSON.stringify(data) : '') : raw;
    const disk = {json, local, fail, throws, nativeWrites: 0, localWrites: 0};
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

    test(`${mode}: display scale persists only after a successful save and survives reload`, () => {
        const {store, disk} = harness({native, fail: true});
        assert.equal(store.getPrefs().displayScale, 100);
        assert.equal(store.setDisplayScale(80), false);
        assert.equal(store.getPrefs().displayScale, 100);
        assert.deepEqual(JSON.parse(disk.json), initial);
        disk.fail = false;
        assert.equal(store.setDisplayScale('80'), true);
        assert.equal(store.getPrefs().displayScale, 80);
        assert.equal(JSON.parse(disk.json).prefs.displayScale, 80);
        store.getPrefs().displayScale = 150;
        assert.equal(store.getPrefs().displayScale, 80, 'Preference getters cannot mutate stored state');
        store.init();
        assert.equal(store.getPrefs().displayScale, 80);
    });

    test(`${mode}: theme and display scale changes never overwrite each other`, () => {
        const {store, disk} = harness({native});
        assert.equal(store.setDisplayScale(125), true);
        assert.equal(store.setTheme('dark'), true);
        assert.deepEqual(copy(store.getPrefs()), {theme: 'dark', displayScale: 125});
        assert.equal(store.setDisplayScale(85), true);
        assert.deepEqual(JSON.parse(disk.json).prefs, {theme: 'dark', displayScale: 85});
        disk.fail = true;
        assert.equal(store.setTheme('light'), false);
        assert.equal(store.setDisplayScale(60), false);
        assert.deepEqual(copy(store.getPrefs()), {theme: 'dark', displayScale: 85});
        assert.deepEqual(JSON.parse(disk.json).prefs, {theme: 'dark', displayScale: 85});
    });
}

test('display scale defaults safely for old documents and malformed preferences', () => {
    for (const value of [undefined, null, '', ' ', '125%', 'invalid', true, false, {}, [], [80]]) {
        const data = {...initial, prefs: {theme: 'light', displayScale: value}};
        const {store} = harness({data});
        assert.deepEqual(copy(store.getPrefs()), {theme: 'light', displayScale: 100});
    }
    for (const data of [null, ...[null, undefined, 0, false, [], 'invalid'].map(prefs => ({...initial, prefs}))]) {
        assert.equal(harness({data}).store.getPrefs().displayScale, 100);
    }
});

test('display scale clamps finite values and rounds to five-point steps on load and update', () => {
    for (const [value, expected] of [[0, 60], [-500, 60], [60, 60], [62.4, 60], [62.5, 65],
        ['82', 80], [' 125 ', 125], [148, 150], [500, 150]]) {
        const {store, disk} = harness({data: {...initial, prefs: {theme: 'auto', displayScale: value}}});
        assert.equal(store.getPrefs().displayScale, expected);
        assert.equal(store.setDisplayScale(expected === 100 ? 80 : 100), true);
        assert.equal(store.setDisplayScale(value), true);
        assert.equal(JSON.parse(disk.json).prefs.displayScale, expected);
    }
    const {store} = harness();
    for (const invalid of [NaN, Infinity, -Infinity, undefined, null, false, {}, 'not a number', '']) {
        assert.equal(store.setDisplayScale(80), true);
        assert.equal(store.setDisplayScale(invalid), true);
        assert.equal(store.getPrefs().displayScale, 100);
    }
});

test('native: display scale changes cannot bypass the unreadable-document write lock', () => {
    const broken = '{"notes":';
    const {store, disk} = harness({native: true, raw: broken});
    assert.equal(store.setDisplayScale(80), false);
    assert.equal(store.getPrefs().displayScale, 100);
    assert.equal(disk.nativeWrites, 0);
    assert.equal(disk.json, broken);
    assert.ok(store.getLoadError());
    assert.equal(store.restore({...initial, prefs: {theme: 'dark', displayScale: 85}}), true);
    assert.deepEqual(copy(store.getPrefs()), {theme: 'dark', displayScale: 85});
    assert.equal(store.setDisplayScale(75), true);
    assert.deepEqual(JSON.parse(disk.json).prefs, {theme: 'dark', displayScale: 75});
});

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

test('native: an unreadable document blocks writes and is left untouched', () => {
    const broken = '{"version":1,"notes":[';
    const {store, disk, errors} = harness({native: true, raw: broken});
    assert.equal(store.getNotes().length, 0);
    assert.ok(store.getLoadError());
    assert.equal(store.getLoadError().source, '本地存储');
    assert.equal(disk.json, broken);
    assert.equal(store.createNote({title: 'Draft', html: '<p>Draft</p>'}), null);
    assert.equal(disk.json, broken);
    assert.ok(errors.some((message) => message.includes('已暂停保存')));
});

test('native: recovery is offered instead of silently using a stale browser copy', () => {
    const stale = JSON.stringify({
        version: 1,
        prefs: {theme: 'auto'},
        notes: [{id: 'stale', title: 'Stale', html: '<p>Stale</p>', createdAt: 1, updatedAt: 1}]
    });
    const {store} = harness({native: true, raw: 'not json', local: stale});
    assert.equal(store.getNotes().length, 0);
    assert.ok(store.getLoadError());
});

test('native: restoring a backup replaces the damaged document and unblocks writes', () => {
    const {store, disk} = harness({native: true, raw: 'broken'});
    assert.equal(store.restore(JSON.stringify(initial)), true);
    assert.equal(store.getLoadError(), null);
    assert.deepEqual(copy(store.getNotes()), initial.notes);
    const created = store.createNote({title: 'After recovery', html: '<p>After</p>'});
    assert.ok(created && created.id);
    assert.equal(JSON.parse(disk.json).notes.length, 2);
});

test('native: an invalid backup is rejected and recovery stays pending', () => {
    const {store, disk} = harness({native: true, raw: 'broken'});
    assert.equal(store.restore('{"notes":'), false);
    assert.ok(store.getLoadError());
    assert.equal(disk.json, 'broken');
    assert.equal(store.createNote({title: 'Blocked', html: '<p>Blocked</p>'}), null);
});

test('native: reset is the only way to discard unreadable data without a backup', () => {
    const {store, disk} = harness({native: true, raw: 'broken'});
    assert.equal(store.reset(), true);
    assert.equal(store.getLoadError(), null);
    assert.equal(store.getNotes().length, 0);
    assert.deepEqual(JSON.parse(disk.json).notes, []);
    assert.ok(store.createNote({title: 'Fresh', html: '<p>Fresh</p>'}));
});

test('native: an empty document still migrates the browser copy', () => {
    const {store} = harness({native: true, data: null, local: JSON.stringify(initial)});
    assert.equal(store.getLoadError(), null);
    assert.deepEqual(copy(store.getNotes()), initial.notes);
    assert.equal(store.loadWarning, '已从浏览器备份恢复笔记');
});

test('browser: an unreadable document starts fresh without a recovery lock', () => {
    const {store} = harness({raw: 'not json'});
    assert.equal(store.getLoadError(), null);
    assert.equal(store.getNotes().length, 0);
    assert.ok(store.loadWarning);
});
