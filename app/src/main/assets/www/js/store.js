/*
 * Local-first note storage.
 *
 * Android: the WebView bridge writes an AtomicFile in the app's private
 * files directory. Browser: localStorage keeps the same JSON shape for fast
 * UI development. There is no network request and no account.
 */
(function (global) {
    'use strict';

    const STORAGE_KEY = 'notedown.state.v1';
    const SCHEMA_VERSION = 1;
    const THEME_MODES = new Set(['auto', 'light', 'dark']);

    const nativeBridge = (() => {
        try {
            return global.NotedownNative && typeof global.NotedownNative.loadData === 'function'
                ? global.NotedownNative
                : null;
        } catch (error) {
            return null;
        }
    })();

    let state = null;
    let storageMode = nativeBridge ? 'native' : 'local';
    let saveErrorHandler = null;
    let lastLoadWarning = '';

    function freshState() {
        return {
            version: SCHEMA_VERSION,
            seeded: false,
            prefs: {theme: 'auto'},
            notes: []
        };
    }

    function cleanTitle(value) {
        const title = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
        return (title || '未命名笔记').slice(0, 80);
    }

    function cleanDate(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : fallback;
    }

    function normaliseNote(raw) {
        if (!raw || typeof raw !== 'object') {
            return null;
        }
        const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 80) : '';
        if (!id) {
            return null;
        }
        const createdAt = cleanDate(raw.createdAt, Date.now());
        return {
            id,
            title: cleanTitle(raw.title),
            html: typeof raw.html === 'string' ? raw.html : '',
            createdAt,
            updatedAt: cleanDate(raw.updatedAt, createdAt)
        };
    }

    function normaliseState(raw) {
        if (!raw || typeof raw !== 'object' || !Array.isArray(raw.notes)) {
            throw new Error('Invalid notes document');
        }
        const notes = [];
        const seen = new Set();
        for (const item of raw.notes) {
            const note = normaliseNote(item);
            if (note && !seen.has(note.id)) {
                seen.add(note.id);
                notes.push(note);
            }
        }
        const theme = raw.prefs && THEME_MODES.has(raw.prefs.theme) ? raw.prefs.theme : 'auto';
        return {
            version: SCHEMA_VERSION,
            seeded: raw.seeded === true || notes.length > 0,
            prefs: {theme},
            notes
        };
    }

    function readLocal() {
        try {
            return global.localStorage.getItem(STORAGE_KEY) || '';
        } catch (error) {
            return '';
        }
    }

    function writeLocal(json) {
        try {
            global.localStorage.setItem(STORAGE_KEY, json);
            return true;
        } catch (error) {
            return false;
        }
    }

    function readNative() {
        if (!nativeBridge) {
            return '';
        }
        try {
            return nativeBridge.loadData() || '';
        } catch (error) {
            return '';
        }
    }

    function parseDocument(raw, source) {
        if (!raw) {
            return null;
        }
        try {
            return normaliseState(JSON.parse(raw));
        } catch (error) {
            lastLoadWarning = `${source} 中的笔记数据无法解析`;
            return null;
        }
    }

    function load() {
        if (nativeBridge) {
            const nativeData = parseDocument(readNative(), '本地存储');
            if (nativeData) {
                storageMode = 'native';
                return nativeData;
            }
            const localData = parseDocument(readLocal(), '浏览器备份');
            if (localData) {
                storageMode = 'native';
                lastLoadWarning = '已从浏览器备份恢复笔记';
                return localData;
            }
        } else {
            const localData = parseDocument(readLocal(), '浏览器存储');
            if (localData) {
                storageMode = 'local';
                return localData;
            }
        }
        return freshState();
    }

    function notifyError(message) {
        if (typeof saveErrorHandler === 'function') {
            try {
                saveErrorHandler(message);
            } catch (error) {
                // A UI error reporter must not change the transaction result.
            }
        }
        document.dispatchEvent(new CustomEvent('notedown:storage-error', {detail: {message}}));
    }

    function persist(candidate) {
        if (!candidate) {
            return false;
        }
        let json;
        try {
            json = JSON.stringify(candidate);
        } catch (error) {
            notifyError('笔记数据无法序列化');
            return false;
        }

        if (nativeBridge) {
            try {
                const saved = nativeBridge.saveData(json);
                if (saved === true) {
                    return true;
                }
            } catch (error) {
                // Native storage remains authoritative for this session.
            }
            // A browser fallback here would be older than native data on the
            // next launch, falsely suggesting that an edit had been saved.
            notifyError('保存失败，请检查设备存储空间后重试；当前编辑内容仍保留');
            return false;
        }

        if (writeLocal(json)) {
            return true;
        }
        notifyError('保存失败，请检查设备存储空间');
        return false;
    }

    function commit(candidate) {
        if (!persist(candidate)) {
            return false;
        }
        state = candidate;
        return true;
    }

    function makeId() {
        if (global.crypto && typeof global.crypto.randomUUID === 'function') {
            return global.crypto.randomUUID();
        }
        return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }

    function findNote(id) {
        return state.notes.find((note) => note.id === id) || null;
    }

    function init() {
        state = load();
        return state;
    }

    function getNotes() {
        return state.notes.map((note) => Object.assign({}, note));
    }

    function getNote(id) {
        const note = findNote(id);
        return note ? Object.assign({}, note) : null;
    }

    function getPrefs() {
        return Object.assign({}, state.prefs);
    }

    function setTheme(mode) {
        const safe = THEME_MODES.has(mode) ? mode : 'auto';
        if (state.prefs.theme === safe) {
            return true;
        }
        return commit(Object.assign({}, state, {prefs: {theme: safe}}));
    }

    function seedIfNeeded(builder) {
        if (state.seeded || state.notes.length > 0) {
            return null;
        }
        let content;
        try {
            content = typeof builder === 'function' ? builder() : builder;
        } catch (error) {
            return null;
        }
        if (!content || !content.html) {
            return null;
        }
        const note = {
            id: makeId(),
            title: cleanTitle(content.title),
            html: content.html,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        const candidate = Object.assign({}, state, {
            notes: state.notes.concat(note),
            seeded: true
        });
        return commit(candidate) ? Object.assign({}, note) : null;
    }

    function createNote(input) {
        const now = Date.now();
        const note = {
            id: makeId(),
            title: cleanTitle(input && input.title),
            html: input && typeof input.html === 'string' ? input.html : '',
            createdAt: now,
            updatedAt: now
        };
        const candidate = Object.assign({}, state, {
            notes: state.notes.concat(note),
            seeded: true
        });
        return commit(candidate) ? Object.assign({}, note) : null;
    }

    function updateNote(id, patch) {
        const previous = findNote(id);
        if (!previous) {
            return null;
        }
        const note = Object.assign({}, previous);
        if (patch && typeof patch.title === 'string') {
            note.title = cleanTitle(patch.title);
        }
        if (patch && typeof patch.html === 'string') {
            note.html = patch.html;
        }
        note.updatedAt = Date.now();
        const candidate = Object.assign({}, state, {
            notes: state.notes.map((item) => item.id === id ? note : item)
        });
        return commit(candidate) ? Object.assign({}, note) : null;
    }

    function updateContent(id, html) {
        return updateNote(id, {html});
    }

    function renameNote(id, title) {
        return updateNote(id, {title});
    }

    function deleteNote(id) {
        const index = state.notes.findIndex((note) => note.id === id);
        if (index < 0) {
            return false;
        }
        return commit(Object.assign({}, state, {
            notes: state.notes.filter((note) => note.id !== id)
        }));
    }

    function setSaveErrorHandler(handler) {
        saveErrorHandler = typeof handler === 'function' ? handler : null;
    }

    global.NoteStore = {
        STORAGE_KEY,
        init,
        getNotes,
        getNote,
        getPrefs,
        setTheme,
        seedIfNeeded,
        createNote,
        updateNote,
        updateContent,
        renameNote,
        deleteNote,
        setSaveErrorHandler,
        get storageMode() {
            return storageMode;
        },
        get loadWarning() {
            return lastLoadWarning;
        }
    };
})(window);
