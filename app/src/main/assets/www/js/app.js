(function () {
    'use strict';

    const Parser = window.NoteParser;
    const Store = window.NoteStore;
    const ESC = Parser.escapeHtml;

    const SAMPLE_MARKDOWN = [
        '# 欢迎来到 Notedown',
        '',
        '这是一本把 **Markdown**、<mark>HTML</mark> 和纯文本收进同一页的本地笔记。没有账号，也没有云端，所有内容只留在你的设备上。',
        '',
        '## 先试这三个动作',
        '',
        '- [x] 点按方框勾选，完成项会自动划去',
        '- [ ] 长按任意列表项，拖动排序',
        '- [ ] 把 Markdown / HTML / TXT 文件导入成一篇笔记',
        '',
        '## 靠近边缘，就会自动滚动',
        '',
        '长按列表项后把手指移到屏幕顶部或底部，页面会持续滚动。离边缘越近，速度越快；拖拽时的位移动画也会跟着手指实时重排。',
        '',
        '> 小提示：点右上角的 **S** 进入划线模式，再点任意段落或列表项，就能手动划去或恢复。',
        '',
        '## 计数项也能排序',
        '',
        '1. 长按我，和下面的条目换换位置',
        '2. 第二条：有序列表的编号会自动更新',
        '3. 第三条：松手后顺序立即保存',
        '',
        '## 导入规则',
        '',
        '| 格式 | 支持 |',
        '| --- | --- |',
        '| Markdown | `.md` `.markdown` `.mdown` `.mkd` |',
        '| HTML | `.html` `.htm` `.xhtml` |',
        '| 纯文本 | `.txt` `.text` |',
        '',
        '为了安全，导入的 HTML 会移除脚本、内联样式和事件属性，只保留可阅读的语义内容。你可以选择多个文件，它们会合并到同一篇笔记里。'
    ].join('\n');

    const ICONS = {
        import: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        rename: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14.7 5.3 4 4M4 20l4.3-1 10.4-10.4a2.1 2.1 0 0 0-3-3L5.3 16 4 20Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        edit: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m8.5 8-4 4 4 4m7-8 4 4-4 4M13.7 4.5l-3.4 15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        theme: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.7"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
        trash: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7m-8 0 1 13h8l1-13M10 11v5m4-5v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };

    const app = {
        currentView: 'library',
        currentNoteId: null,
        libraryScrollY: 0,
        themeMode: 'auto',
        strikeMode: false,
        editorMode: null,
        editorNoteId: null,
        editorFormat: 'markdown',
        editorPreviewing: false,
        importTarget: 'library',
        pendingConfirm: null,
        toastTimer: 0,
        lastStorageErrorAt: 0,
        searchIndex: new Map(),
        lastFocused: null,
        booted: false
    };

    const dom = {};

    function cacheDom() {
        const ids = [
            'library-screen', 'note-screen', 'brand-home', 'theme-toggle',
            'import-library', 'new-note', 'import-hero', 'search-input',
            'note-count', 'notes-list', 'library-empty', 'empty-kicker',
            'empty-title', 'empty-copy', 'empty-create', 'empty-import',
            'new-note-fab', 'back-button', 'note-topbar', 'note-topbar-title',
            'strike-button', 'note-menu-button', 'strike-banner', 'strike-done',
            'note-title', 'note-index', 'note-updated', 'note-stats',
            'note-content', 'action-sheet-backdrop', 'action-sheet', 'sheet-title',
            'sheet-actions', 'sheet-cancel', 'confirm-backdrop', 'confirm-dialog',
            'confirm-title', 'confirm-message', 'confirm-cancel', 'confirm-ok',
            'rename-backdrop', 'rename-dialog', 'rename-form', 'rename-input',
            'rename-cancel', 'editor-overlay', 'editor-form', 'editor-cancel',
            'editor-save', 'editor-mode-label', 'editor-title-label',
            'editor-title', 'editor-format-switch', 'editor-format-label',
            'editor-preview-toggle', 'editor-textarea', 'editor-preview',
            'editor-hint', 'file-input', 'toast'
        ];
        for (const id of ids) {
            const key = id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            dom[key] = document.getElementById(id);
        }
        dom.appShell = document.querySelector('.app-shell');
        dom.emptyActions = document.querySelector('.empty-actions');
        dom.themeColor = document.querySelector('meta[name="theme-color"]');
        dom.mediaDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    }

    function nativeBridge() {
        try {
            return window.NotedownNative && typeof window.NotedownNative === 'object'
                ? window.NotedownNative
                : null;
        } catch (error) {
            return null;
        }
    }

    function boot() {
        cacheDom();
        Store.setSaveErrorHandler(handleStorageError);
        Store.init();

        app.themeMode = Store.getPrefs().theme || 'auto';
        applyTheme(app.themeMode, false);

        if (!Store.loadWarning) {
            seedWelcomeNote();
        }

        bindEvents();
        initDrag();
        renderLibrary();
        showLibrary({restoreScroll: false, skipRender: true});
        exposeNativeHooks();
        app.booted = true;

        if (Store.loadWarning) {
            showToast(Store.loadWarning);
        }
        if (dom.mediaDark) {
            const listener = () => {
                if (app.themeMode === 'auto') {
                    applyTheme('auto', false);
                }
            };
            if (typeof dom.mediaDark.addEventListener === 'function') {
                dom.mediaDark.addEventListener('change', listener);
            } else if (typeof dom.mediaDark.addListener === 'function') {
                dom.mediaDark.addListener(listener);
            }
        }
    }

    function seedWelcomeNote() {
        try {
            const seeded = Store.seedIfNeeded(() => ({
                title: '欢迎来到 Notedown',
                html: Parser.markdownToHtml(SAMPLE_MARKDOWN)
            }));
            if (seeded) {
                app.searchIndex.clear();
            }
        } catch (error) {
            console.warn('Could not create sample note', error);
        }
    }

    function exposeNativeHooks() {
        window.Notedown = {
            handleBack: handleBack,
            onNativeFiles: (payload) => {
                if (!app.booted) {
                    return;
                }
                receiveNativeFiles(payload);
            }
        };
    }

    function bindEvents() {
        dom.brandHome.addEventListener('click', () => {
            if (app.currentView === 'library') {
                window.scrollTo({top: 0, behavior: 'smooth'});
            }
        });

        dom.themeToggle.addEventListener('click', cycleTheme);
        for (const button of [dom.importLibrary, dom.importHero, dom.emptyImport]) {
            button.addEventListener('click', () => requestImport('library'));
        }
        for (const button of [dom.newNote, dom.newNoteFab, dom.emptyCreate]) {
            button.addEventListener('click', () => openEditor('create'));
        }

        dom.searchInput.addEventListener('input', renderLibrary);

        dom.notesList.addEventListener('click', (event) => {
            const card = event.target.closest('[data-note-id]');
            if (!card) {
                return;
            }
            openNote(card.getAttribute('data-note-id'));
        });

        dom.backButton.addEventListener('click', handleBack);
        dom.noteMenuButton.addEventListener('click', openActionSheet);
        dom.strikeButton.addEventListener('click', () => setStrikeMode(!app.strikeMode));
        dom.strikeDone.addEventListener('click', () => setStrikeMode(false));

        dom.noteContent.addEventListener('change', onContentChange);
        dom.noteContent.addEventListener('click', onContentClick);

        window.addEventListener('scroll', onWindowScroll, {passive: true});

        dom.actionSheetBackdrop.addEventListener('click', closeActionSheet);
        dom.sheetCancel.addEventListener('click', closeActionSheet);
        dom.sheetActions.addEventListener('click', onSheetActionClick);
        dom.confirmBackdrop.addEventListener('click', closeConfirm);
        dom.confirmCancel.addEventListener('click', closeConfirm);
        dom.confirmOk.addEventListener('click', confirmPendingAction);
        dom.renameBackdrop.addEventListener('click', closeRename);
        dom.renameCancel.addEventListener('click', closeRename);
        dom.renameForm.addEventListener('submit', submitRename);

        dom.editorForm.addEventListener('submit', submitEditor);
        dom.editorCancel.addEventListener('click', () => closeEditor());
        for (const button of dom.editorFormatSwitch.querySelectorAll('[data-format]')) {
            button.addEventListener('click', () => chooseEditorFormat(button.getAttribute('data-format')));
        }
        dom.editorPreviewToggle.addEventListener('click', toggleEditorPreview);
        dom.fileInput.addEventListener('change', onBrowserFilesChosen);
        dom.editorTitle.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                dom.editorTextarea.focus();
            }
        });
        dom.editorTextarea.addEventListener('keydown', onEditorTextareaKeydown);
        dom.editorPreview.addEventListener('click', (event) => {
            if (event.target.closest('a[href]')) {
                event.preventDefault();
            }
        });

        document.addEventListener('keydown', onDocumentKeydown);
    }

    function initDrag() {
        if (!window.NoteDrag) {
            return;
        }
        window.NoteDrag.init(dom.noteContent, {
            onHaptic: nativeHaptic,
            onCommit: () => {
                if (!app.currentNoteId) {
                    return;
                }
                const updated = persistOpenNote();
                if (updated) {
                    refreshNoteMeta(updated);
                }
            }
        });
    }

    /* ---------------- Library ---------------- */

    function sortedNotes() {
        return Store.getNotes().sort((a, b) => b.updatedAt - a.updatedAt);
    }

    function searchTextFor(note) {
        const key = `${note.id}:${note.updatedAt}`;
        if (!app.searchIndex.has(key)) {
            app.searchIndex.set(key, `${note.title} ${Parser.plainText(note.html)}`.toLocaleLowerCase('zh-CN'));
        }
        return app.searchIndex.get(key);
    }

    function renderLibrary() {
        const allNotes = sortedNotes();
        const query = dom.searchInput.value.trim();
        const normalized = query.toLocaleLowerCase('zh-CN');
        const filtered = normalized
            ? allNotes.filter((note) => searchTextFor(note).includes(normalized))
            : allNotes;

        dom.noteCount.textContent = normalized
            ? `${filtered.length} / ${allNotes.length} 篇`
            : `${allNotes.length} 篇`;

        if (filtered.length === 0) {
            dom.notesList.replaceChildren();
            dom.notesList.hidden = true;
            showEmptyState({searching: allNotes.length > 0 && Boolean(normalized)});
            return;
        }

        dom.libraryEmpty.hidden = true;
        dom.notesList.hidden = false;

        const cards = filtered.map((note, index) => {
            const tasks = Parser.countTasks(note.html);
            const excerpt = excerptFor(note);
            const taskPill = tasks.total > 0
                ? `<span class="task-pill${tasks.done === tasks.total ? ' is-complete' : ''}">${tasks.done}/${tasks.total} 待办</span>`
                : '';
            const edited = escapeAttr(formatFullDate(note.updatedAt));
            return `
                <button class="note-card" type="button" data-note-id="${escapeAttr(note.id)}" aria-label="打开笔记：${escapeAttr(note.title)}" style="--i:${Math.min(index, 8)}">
                    <span class="note-card-top">
                        <span class="note-card-date" title="${edited}">${ESC(relativeTime(note.updatedAt))}</span>
                        ${taskPill}
                    </span>
                    <span class="note-card-title">${ESC(note.title)}</span>
                    <span class="note-card-excerpt">${ESC(excerpt)}</span>
                    <span class="note-card-foot">
                        <span>${ESC(formatShortDate(note.updatedAt))}</span>
                        <span class="note-card-open">打开
                            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 10h11m0 0-4-4m4 4-4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </span>
                    </span>
                </button>`;
        });
        dom.notesList.innerHTML = cards.join('');
    }

    function excerptFor(note) {
        let text = Parser.plainText(note.html);
        const title = Parser.collapseWhitespace(note.title);
        if (title && text.startsWith(title)) {
            text = text.slice(title.length).trim();
        }
        return Parser.truncate(text, 112) || '空白笔记';
    }

    function showEmptyState(options) {
        dom.libraryEmpty.hidden = false;
        if (options.searching) {
            dom.emptyKicker.textContent = 'No matches';
            dom.emptyTitle.textContent = '没有找到匹配的笔记';
            dom.emptyCopy.textContent = '换个关键词试试，或清空搜索查看全部笔记。';
            dom.emptyActions.hidden = true;
        } else {
            dom.emptyKicker.textContent = 'A clean page';
            dom.emptyTitle.textContent = '还没有笔记';
            dom.emptyCopy.textContent = '新建一篇，或把已经写好的 Markdown / HTML 文件带进来。';
            dom.emptyActions.hidden = false;
        }
    }

    function clearSearch() {
        if (!dom.searchInput.value) {
            return;
        }
        dom.searchInput.value = '';
    }

    function openNote(id) {
        const note = Store.getNote(id);
        if (!note) {
            showToast('这篇笔记已经不存在');
            renderLibrary();
            return;
        }
        if (app.currentView === 'library') {
            app.libraryScrollY = window.scrollY;
        }
        window.NoteDrag.cancel();
        app.currentNoteId = id;
        app.currentView = 'note';
        setStrikeMode(false, false);
        renderNote(note);
        dom.libraryScreen.hidden = true;
        dom.noteScreen.hidden = false;
        dom.noteTopbar.classList.remove('is-scrolled');
        document.title = `${note.title} · Notedown`;
        window.scrollTo(0, 0);
        requestAnimationFrame(() => {
            dom.noteContent.focus({preventScroll: true});
        });
    }

    function showLibrary(options) {
        const settings = options || {};
        window.NoteDrag.cancel();
        setStrikeMode(false, false);
        dom.noteScreen.hidden = true;
        dom.libraryScreen.hidden = false;
        app.currentView = 'library';
        app.currentNoteId = null;
        document.title = 'Notedown';
        if (!settings.skipRender) {
            renderLibrary();
        }
        if (settings.restoreScroll !== false) {
            requestAnimationFrame(() => {
                window.scrollTo(0, app.libraryScrollY || 0);
            });
        }
    }

    /* ---------------- Note view ---------------- */

    function renderNote(note) {
        dom.noteTitle.textContent = note.title;
        dom.noteTopbarTitle.textContent = note.title;
        dom.noteUpdated.textContent = `最后编辑 ${relativeTime(note.updatedAt)}`;
        dom.noteUpdated.title = formatFullDate(note.updatedAt);
        dom.noteIndex.textContent = noteIndexLabel(note.id);

        dom.noteContent.innerHTML = Parser.sanitizeHtml(note.html);
        hideDuplicateTitle(note.title);
        Parser.enhanceContent(dom.noteContent);
        ensureContentNotEmpty();
        updateNoteStats();
        document.title = `${note.title} · Notedown`;
    }

    function hideDuplicateTitle(title) {
        const wanted = Parser.collapseWhitespace(title);
        if (!wanted) {
            return;
        }
        for (const child of dom.noteContent.children) {
            if (child.hasAttribute('data-file')) {
                continue;
            }
            if (/^H[12]$/.test(child.tagName) && Parser.collapseWhitespace(child.textContent) === wanted) {
                child.classList.add('is-duplicate');
            }
            break;
        }
    }

    function ensureContentNotEmpty() {
        if (dom.noteContent.querySelector('img, hr, table, .nt-file-label, li, p')) {
            return;
        }
        if (Parser.collapseWhitespace(dom.noteContent.textContent)) {
            return;
        }
        const empty = document.createElement('p');
        empty.className = 'note-empty';
        empty.textContent = '这篇笔记还没有内容。打开右上角菜单，可以编辑 HTML 源码。';
        dom.noteContent.replaceChildren(empty);
    }

    function updateNoteStats() {
        const content = dom.noteContent;
        const tasks = content.querySelectorAll('li[data-task="true"]');
        let done = 0;
        for (const task of tasks) {
            if (task.getAttribute('data-checked') === 'true') {
                done += 1;
            }
        }
        const text = content.textContent.replace(/\s+/g, '');
        const parts = [];
        if (tasks.length > 0) {
            parts.push(`待办 ${done}/${tasks.length}`);
        }
        if (text.length > 0) {
            parts.push(`约 ${text.length} 字`);
        }
        dom.noteStats.textContent = parts.join(' · ') || '空白笔记';
    }

    function refreshNoteMeta(note) {
        dom.noteTitle.textContent = note.title;
        dom.noteTopbarTitle.textContent = note.title;
        dom.noteUpdated.textContent = `最后编辑 ${relativeTime(note.updatedAt)}`;
        dom.noteUpdated.title = formatFullDate(note.updatedAt);
        dom.noteIndex.textContent = noteIndexLabel(note.id);
        updateNoteStats();
        document.title = `${note.title} · Notedown`;
    }

    function noteIndexLabel(id) {
        const index = sortedNotes().findIndex((note) => note.id === id);
        const number = index >= 0 ? index + 1 : 1;
        return String(number).padStart(2, '0');
    }

    function persistOpenNote() {
        if (!app.currentNoteId) {
            return null;
        }
        const html = Parser.serializeContent(dom.noteContent);
        const updated = Store.updateContent(app.currentNoteId, html);
        if (updated) {
            app.searchIndex.clear();
        }
        return updated;
    }

    function onContentChange(event) {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || !input.classList.contains('nt-checkbox')) {
            return;
        }
        const task = input.closest('li[data-task="true"]');
        if (!task) {
            return;
        }
        const done = input.checked;
        task.setAttribute('data-checked', done ? 'true' : 'false');
        task.classList.toggle('is-done', done);
        nativeHaptic();
        const updated = persistOpenNote();
        if (updated) {
            refreshNoteMeta(updated);
        }
    }

    function onContentClick(event) {
        const anchor = event.target.closest('a[href]');

        if (app.strikeMode) {
            if (event.target.closest('input, .nt-checkbox')) {
                return;
            }
            if (anchor) {
                event.preventDefault();
                return;
            }
            const block = event.target.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote');
            if (!block || !dom.noteContent.contains(block)) {
                return;
            }
            event.preventDefault();
            const struck = block.getAttribute('data-struck') === 'true';
            if (struck) {
                block.removeAttribute('data-struck');
                block.classList.remove('is-struck');
            } else {
                block.setAttribute('data-struck', 'true');
                block.classList.add('is-struck');
            }
            nativeHaptic();
            const updated = persistOpenNote();
            if (updated) {
                refreshNoteMeta(updated);
            }
            return;
        }

        if (!anchor) {
            return;
        }
        event.preventDefault();
        const href = (anchor.getAttribute('href') || '').trim();
        if (!href) {
            return;
        }
        if (href.startsWith('#')) {
            const id = decodeURIComponent(href.slice(1));
            const target = id ? document.getElementById(id) : null;
            if (target) {
                target.scrollIntoView({block: 'start'});
            }
            return;
        }
        if (!/^(https?:\/\/|mailto:|tel:)/i.test(href)) {
            return;
        }
        const bridge = nativeBridge();
        if (bridge && typeof bridge.openUrl === 'function') {
            bridge.openUrl(href);
        } else {
            window.open(href, '_blank', 'noopener,noreferrer');
        }
    }

    function setStrikeMode(enabled, updateBody) {
        const next = Boolean(enabled);
        if (app.strikeMode === next) {
            if (updateBody !== false) {
                syncStrikeUi();
            }
            return;
        }
        app.strikeMode = next;
        syncStrikeUi();
    }

    function syncStrikeUi() {
        dom.strikeButton.setAttribute('aria-pressed', app.strikeMode ? 'true' : 'false');
        dom.strikeButton.setAttribute('aria-label', app.strikeMode ? '退出划线模式' : '进入划线模式');
        dom.strikeBanner.hidden = !app.strikeMode;
        document.body.classList.toggle('strike-mode', app.strikeMode);
    }

    /* ---------------- Action sheet / dialogs ---------------- */

    function openActionSheet() {
        const note = app.currentNoteId ? Store.getNote(app.currentNoteId) : null;
        if (!note) {
            return;
        }
        dom.sheetTitle.textContent = '笔记操作';
        const actions = [
            {id: 'import', label: '导入文件到这篇笔记', icon: ICONS.import},
            {id: 'rename', label: '重命名笔记', icon: ICONS.rename},
            {id: 'edit', label: '编辑 HTML 源码', icon: ICONS.edit},
            {id: 'theme', label: `切换外观 · ${themeLabel(app.themeMode).replace('外观：', '')}`, icon: ICONS.theme},
            {id: 'delete', label: '删除笔记', icon: ICONS.trash, danger: true}
        ];
        dom.sheetActions.replaceChildren();
        for (const action of actions) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `sheet-action${action.danger ? ' is-danger' : ''}`;
            button.setAttribute('data-action', action.id);
            button.innerHTML = `<span class="action-icon">${action.icon}</span><span class="action-label"></span>`;
            button.querySelector('.action-label').textContent = action.label;
            dom.sheetActions.appendChild(button);
        }
        openLayer(dom.actionSheetBackdrop, dom.actionSheet, dom.sheetActions.querySelector('button'));
    }

    function closeActionSheet() {
        hideLayer(dom.actionSheetBackdrop, dom.actionSheet);
    }

    function onSheetActionClick(event) {
        const button = event.target.closest('[data-action]');
        if (!button) {
            return;
        }
        const action = button.getAttribute('data-action');
        const noteId = app.currentNoteId;
        closeActionSheet();
        if (!noteId) {
            return;
        }

        if (action === 'import') {
            requestImport('note');
        } else if (action === 'rename') {
            openRename(noteId);
        } else if (action === 'edit') {
            openEditor('edit', noteId);
        } else if (action === 'theme') {
            cycleTheme();
        } else if (action === 'delete') {
            openDeleteConfirm(noteId);
        }
    }

    function openDeleteConfirm(noteId) {
        const note = Store.getNote(noteId);
        if (!note) {
            return;
        }
        dom.confirmTitle.textContent = '删除这篇笔记？';
        dom.confirmMessage.textContent = `“${note.title}” 将被永久删除，无法恢复。`;
        dom.confirmOk.textContent = '删除';
        app.pendingConfirm = () => {
            Store.deleteNote(noteId);
            app.currentNoteId = null;
            app.searchIndex.clear();
            showLibrary({restoreScroll: false});
            showToast('笔记已删除');
        };
        openLayer(dom.confirmBackdrop, dom.confirmDialog, dom.confirmCancel);
    }

    function closeConfirm() {
        hideLayer(dom.confirmBackdrop, dom.confirmDialog);
        app.pendingConfirm = null;
    }

    function confirmPendingAction() {
        const action = app.pendingConfirm;
        hideLayer(dom.confirmBackdrop, dom.confirmDialog);
        app.pendingConfirm = null;
        if (typeof action === 'function') {
            action();
        }
    }

    function openRename(noteId) {
        const note = Store.getNote(noteId);
        if (!note) {
            return;
        }
        dom.renameInput.value = note.title;
        openLayer(dom.renameBackdrop, dom.renameDialog, dom.renameInput);
        requestAnimationFrame(() => {
            dom.renameInput.focus();
            dom.renameInput.select();
        });
    }

    function closeRename() {
        hideLayer(dom.renameBackdrop, dom.renameDialog);
    }

    function submitRename(event) {
        event.preventDefault();
        const noteId = app.currentNoteId;
        if (!noteId) {
            closeRename();
            return;
        }
        const value = dom.renameInput.value.trim();
        if (!value) {
            dom.renameInput.focus();
            return;
        }
        const note = Store.renameNote(noteId, value);
        closeRename();
        if (note) {
            renderNote(note);
            showToast('标题已更新');
        }
    }

    /* ---------------- Layer state / focus ---------------- */

    function openLayer(backdrop, panel, focusTarget) {
        const anythingOpen = isAnyOverlayOpen();
        if (!anythingOpen && document.activeElement && document.activeElement !== document.body) {
            app.lastFocused = document.activeElement;
        }
        backdrop.hidden = false;
        panel.hidden = false;
        syncOverlayState();
        if (focusTarget) {
            requestAnimationFrame(() => focusTarget.focus({preventScroll: true}));
        }
    }

    function hideLayer(backdrop, panel) {
        blurInside(panel);
        backdrop.hidden = true;
        panel.hidden = true;
        syncOverlayState();
    }

    function blurInside(panel) {
        const active = document.activeElement;
        if (active && panel && panel.contains(active) && typeof active.blur === 'function') {
            active.blur();
        }
    }

    function isAnyOverlayOpen() {
        return !dom.editorOverlay.hidden
            || !dom.actionSheet.hidden
            || !dom.confirmDialog.hidden
            || !dom.renameDialog.hidden;
    }

    function syncOverlayState() {
        const open = isAnyOverlayOpen();
        document.body.classList.toggle('overlay-open', open);
        if (dom.appShell) {
            try {
                dom.appShell.inert = open;
            } catch (error) {
                if (open) {
                    dom.appShell.setAttribute('inert', '');
                } else {
                    dom.appShell.removeAttribute('inert');
                }
            }
        }
        if (!open && app.lastFocused && app.lastFocused.isConnected) {
            const target = app.lastFocused;
            app.lastFocused = null;
            requestAnimationFrame(() => {
                try {
                    target.focus({preventScroll: true});
                } catch (error) {
                    // Ignore focus restoration when the target is gone.
                }
            });
        }
    }

    /* ---------------- Editor ---------------- */

    function openEditor(mode, noteId) {
        let note = null;
        if (mode === 'edit') {
            note = noteId ? Store.getNote(noteId) : (app.currentNoteId ? Store.getNote(app.currentNoteId) : null);
            if (!note) {
                showToast('找不到要编辑的笔记');
                return;
            }
        }

        app.editorMode = mode;
        app.editorNoteId = note ? note.id : null;
        app.editorFormat = mode === 'edit' ? 'html' : 'markdown';
        app.editorPreviewing = false;

        dom.editorModeLabel.textContent = mode === 'edit' ? 'Edit' : 'Compose';
        dom.editorTitleLabel.textContent = mode === 'edit' ? '编辑笔记' : '新建笔记';
        dom.editorTitle.value = note ? note.title : '';
        dom.editorTextarea.value = note ? note.html : '';
        dom.editorTextarea.hidden = false;
        dom.editorPreview.hidden = true;
        dom.editorPreview.innerHTML = '';
        dom.editorPreviewToggle.setAttribute('aria-pressed', 'false');
        dom.editorPreviewToggle.textContent = '预览';
        dom.editorFormatSwitch.hidden = mode === 'edit';
        dom.editorFormatLabel.hidden = mode !== 'edit';
        dom.editorFormatLabel.textContent = 'HTML 源码';

        for (const button of dom.editorFormatSwitch.querySelectorAll('[data-format]')) {
            button.classList.toggle('is-active', button.getAttribute('data-format') === app.editorFormat);
        }
        updateEditorPlaceholder();

        dom.editorOverlay.hidden = false;
        syncOverlayState();
        requestAnimationFrame(() => {
            if (mode === 'create') {
                dom.editorTitle.focus();
            } else {
                dom.editorTextarea.focus();
            }
        });
    }

    function closeEditor(restoreFocus) {
        blurInside(dom.editorOverlay);
        dom.editorOverlay.hidden = true;
        dom.editorPreview.hidden = true;
        dom.editorPreview.innerHTML = '';
        dom.editorTextarea.hidden = false;
        app.editorMode = null;
        app.editorNoteId = null;
        app.editorPreviewing = false;
        syncOverlayState();
    }

    function chooseEditorFormat(format) {
        if (app.editorMode === 'edit' || (format !== 'markdown' && format !== 'html')) {
            return;
        }
        app.editorFormat = format;
        for (const button of dom.editorFormatSwitch.querySelectorAll('[data-format]')) {
            button.classList.toggle('is-active', button.getAttribute('data-format') === format);
        }
        updateEditorPlaceholder();
        if (app.editorPreviewing) {
            renderEditorPreview();
        }
    }

    function updateEditorPlaceholder() {
        if (app.editorMode === 'edit') {
            dom.editorTextarea.placeholder = '直接编辑安全 HTML……';
            dom.editorHint.textContent = '任务状态保存在 data-* 属性中。为保证安全，脚本、内联样式和事件属性会被移除。';
            return;
        }
        if (app.editorFormat === 'markdown') {
            dom.editorTextarea.placeholder = '# 标题\n\n- [ ] 第一件事\n- [ ] 第二件事\n\n用 Markdown 写点什么……';
            dom.editorHint.textContent = '支持 GFM 任务列表、表格、代码块、链接与原生 HTML。保存后会进行安全净化。';
        } else {
            dom.editorTextarea.placeholder = '<h1>标题</h1>\n<p>用 HTML 写点什么……</p>\n<ul>\n  <li>一个条目</li>\n</ul>';
            dom.editorHint.textContent = '只保留安全的语义标签；脚本、内联样式和事件属性会被移除。';
        }
    }

    function toggleEditorPreview() {
        app.editorPreviewing = !app.editorPreviewing;
        if (app.editorPreviewing) {
            renderEditorPreview();
            dom.editorTextarea.hidden = true;
            dom.editorPreview.hidden = false;
            dom.editorPreviewToggle.setAttribute('aria-pressed', 'true');
            dom.editorPreviewToggle.textContent = '编辑';
        } else {
            dom.editorPreview.hidden = true;
            dom.editorTextarea.hidden = false;
            dom.editorPreviewToggle.setAttribute('aria-pressed', 'false');
            dom.editorPreviewToggle.textContent = '预览';
            dom.editorTextarea.focus();
        }
    }

    function renderEditorPreview() {
        const source = dom.editorTextarea.value;
        let html = '';
        try {
            html = app.editorFormat === 'html'
                ? Parser.htmlToHtml(source)
                : Parser.markdownToHtml(source);
        } catch (error) {
            html = '<p>无法渲染这段内容。</p>';
        }
        dom.editorPreview.innerHTML = html;
        Parser.enhanceContent(dom.editorPreview);
        for (const checkbox of dom.editorPreview.querySelectorAll('.nt-checkbox')) {
            checkbox.disabled = true;
            checkbox.tabIndex = -1;
        }
        if (!dom.editorPreview.textContent.trim() && dom.editorPreview.querySelectorAll('img, hr, table').length === 0) {
            dom.editorPreview.innerHTML = '<p class="note-empty">这里会显示预览。</p>';
        }
    }

    function submitEditor(event) {
        event.preventDefault();
        const source = dom.editorTextarea.value;
        if (!source.trim()) {
            if (app.editorPreviewing) {
                toggleEditorPreview();
            }
            dom.editorTextarea.focus();
            showToast('先写一点内容再保存');
            return;
        }

        let html;
        try {
            html = app.editorFormat === 'html'
                ? Parser.htmlToHtml(source)
                : Parser.markdownToHtml(source);
        } catch (error) {
            showToast('内容解析失败，请检查格式');
            return;
        }

        if (!html.trim()) {
            showToast('内容为空，未能保存');
            return;
        }

        const enteredTitle = dom.editorTitle.value.trim();
        const derivedTitle = Parser.firstHeadingText(html) || Parser.topText(html) || '未命名笔记';
        const title = Parser.truncate(enteredTitle || derivedTitle, 64) || '未命名笔记';

        if (app.editorMode === 'edit' && app.editorNoteId) {
            const updated = Store.updateNote(app.editorNoteId, {title, html});
            closeEditor();
            if (updated) {
                app.currentNoteId = updated.id;
                renderNote(updated);
                dom.libraryScreen.hidden = true;
                dom.noteScreen.hidden = false;
                app.currentView = 'note';
                window.scrollTo(0, 0);
                showToast('笔记已保存');
            }
            return;
        }

        const note = Store.createNote({title, html});
        closeEditor();
        app.searchIndex.clear();
        clearSearch();
        openNote(note.id);
        showToast('笔记已创建');
    }

    function onEditorTextareaKeydown(event) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            dom.editorForm.requestSubmit();
            return;
        }
        if (event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            const textarea = dom.editorTextarea;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            textarea.value = textarea.value.slice(0, start) + '    ' + textarea.value.slice(end);
            textarea.selectionStart = textarea.selectionEnd = start + 4;
        }
    }

    /* ---------------- Import ---------------- */

    function requestImport(target) {
        app.importTarget = target === 'note' ? 'note' : 'library';
        const bridge = nativeBridge();
        if (bridge && typeof bridge.pickFiles === 'function') {
            try {
                bridge.pickFiles();
            } catch (error) {
                showToast('无法打开文件选择器');
            }
            return;
        }
        dom.fileInput.value = '';
        dom.fileInput.click();
    }

    function receiveNativeFiles(payload) {
        let parsed = payload;
        if (typeof payload === 'string') {
            try {
                parsed = JSON.parse(payload);
            } catch (error) {
                showToast('读取文件结果时出错');
                return;
            }
        }
        processImportPayload(parsed);
    }

    async function onBrowserFilesChosen() {
        const files = Array.from(dom.fileInput.files || []);
        if (!files.length) {
            return;
        }
        showToast('正在读取文件…');
        const payload = {files: [], errors: [], cancelled: false};
        const accepted = files.slice(0, 20);
        if (files.length > 20) {
            payload.errors.push('一次最多导入 20 个文件');
        }
        for (const file of accepted) {
            const format = Parser.detectFormat(file.name, file.type);
            if (!format) {
                payload.errors.push(`${file.name}：不支持的文件类型`);
                continue;
            }
            if (file.size > 1.5 * 1024 * 1024) {
                payload.errors.push(`${file.name}：文件超过 1.5 MB`);
                continue;
            }
            try {
                const text = await file.text();
                payload.files.push({name: file.name, format, text, size: file.size});
            } catch (error) {
                payload.errors.push(`${file.name}：读取失败`);
            }
        }
        dom.fileInput.value = '';
        processImportPayload(payload);
    }

    function processImportPayload(payload) {
        if (!payload || payload.cancelled) {
            app.importTarget = 'library';
            return;
        }
        const errors = Array.isArray(payload.errors) ? payload.errors.filter(Boolean) : [];
        const files = (Array.isArray(payload.files) ? payload.files : []).filter((file) => (
            file && typeof file.name === 'string' && typeof file.text === 'string'
        ));

        if (files.length === 0) {
            app.importTarget = 'library';
            showToast(errors.length ? errors[0] : '没有可导入的文件');
            return;
        }

        const combined = Parser.combineFiles(files);
        if (!combined.imported) {
            app.importTarget = 'library';
            showToast(errors.length ? errors[0] : '文件内容无法解析');
            return;
        }

        const target = app.importTarget;
        const currentNote = target === 'note' && app.currentNoteId
            ? Store.getNote(app.currentNoteId)
            : null;
        const suffix = errors.length > 0
            ? `，${errors.length} 个未导入`
            : '';

        if (currentNote) {
            const updated = Store.updateContent(currentNote.id, `${currentNote.html}\n${combined.html}`);
            setStrikeMode(false, false);
            if (updated) {
                renderNote(updated);
                refreshNoteMeta(updated);
            }
            app.importTarget = 'library';
            showToast(`已导入 ${combined.imported} 个文件${suffix}`);
        } else {
            const note = Store.createNote({title: combined.title, html: combined.html});
            app.importTarget = 'library';
            app.searchIndex.clear();
            clearSearch();
            openNote(note.id);
            showToast(`已导入 ${combined.imported} 个文件${suffix}`);
        }

        if (errors.length > 0) {
            console.warn('Some files were not imported:', errors);
        }
    }

    /* ---------------- Theme ---------------- */

    function cycleTheme() {
        const order = ['auto', 'light', 'dark'];
        const index = order.indexOf(app.themeMode);
        const next = order[(index + 1) % order.length];
        applyTheme(next, true);
        showToast(themeLabel(next));
    }

    function applyTheme(mode, persist) {
        const safe = ['auto', 'light', 'dark'].includes(mode) ? mode : 'auto';
        app.themeMode = safe;
        const dark = safe === 'dark' || (safe === 'auto' && dom.mediaDark && dom.mediaDark.matches);
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        document.documentElement.style.backgroundColor = dark ? '#171613' : '#f4f0e7';
        if (dom.themeColor) {
            dom.themeColor.setAttribute('content', dark ? '#171613' : '#f4f0e7');
        }
        if (dom.themeToggle) {
            dom.themeToggle.setAttribute('data-mode', safe);
            dom.themeToggle.setAttribute('aria-label', `${themeLabel(safe)}。点击切换外观`);
            dom.themeToggle.title = themeLabel(safe);
        }
        if (persist) {
            Store.setTheme(safe);
        }
        const bridge = nativeBridge();
        if (bridge && typeof bridge.setTheme === 'function') {
            try {
                bridge.setTheme(dark ? 'dark' : 'light');
            } catch (error) {
                // A browser preview has no native theme bridge.
            }
        }
    }

    function themeLabel(mode) {
        if (mode === 'light') {
            return '外观：浅色';
        }
        if (mode === 'dark') {
            return '外观：深色';
        }
        return '外观：跟随系统';
    }

    /* ---------------- Keyboard & back ---------------- */

    function onDocumentKeydown(event) {
        if (event.key !== 'Escape') {
            return;
        }
        if (handleBack()) {
            event.preventDefault();
        }
    }

    function handleBack() {
        if (!dom.editorOverlay.hidden) {
            closeEditor();
            return true;
        }
        if (!dom.confirmDialog.hidden) {
            closeConfirm();
            return true;
        }
        if (!dom.renameDialog.hidden) {
            closeRename();
            return true;
        }
        if (!dom.actionSheet.hidden) {
            closeActionSheet();
            return true;
        }
        if (app.strikeMode) {
            setStrikeMode(false);
            return true;
        }
        if (app.currentView === 'note') {
            showLibrary({restoreScroll: true});
            return true;
        }
        return false;
    }

    function onWindowScroll() {
        if (app.currentView !== 'note') {
            return;
        }
        dom.noteTopbar.classList.toggle('is-scrolled', window.scrollY > 8);
    }

    /* ---------------- Utilities ---------------- */

    function nativeHaptic() {
        const bridge = nativeBridge();
        if (bridge && typeof bridge.haptic === 'function') {
            try {
                bridge.haptic();
            } catch (error) {
                // Haptics are optional.
            }
        }
    }

    function handleStorageError(message) {
        const now = Date.now();
        if (now - app.lastStorageErrorAt < 2500) {
            return;
        }
        app.lastStorageErrorAt = now;
        showToast(message || '保存失败');
    }

    function showToast(message) {
        if (!message) {
            return;
        }
        window.clearTimeout(app.toastTimer);
        dom.toast.textContent = message;
        dom.toast.hidden = false;
        app.toastTimer = window.setTimeout(() => {
            dom.toast.hidden = true;
        }, 2800);
    }

    function relativeTime(timestamp) {
        const time = Number(timestamp) || Date.now();
        const diff = Math.max(0, Date.now() - time);
        if (diff < 45 * 1000) {
            return '刚刚';
        }
        if (diff < 60 * 60 * 1000) {
            return `${Math.max(1, Math.round(diff / 60000))} 分钟前`;
        }
        if (diff < 24 * 60 * 60 * 1000) {
            return `${Math.max(1, Math.round(diff / 3600000))} 小时前`;
        }
        if (diff < 48 * 60 * 60 * 1000) {
            return '昨天';
        }
        if (diff < 7 * 24 * 60 * 60 * 1000) {
            return `${Math.floor(diff / 86400000)} 天前`;
        }
        return formatShortDate(time);
    }

    function formatShortDate(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        if (date.getFullYear() === now.getFullYear()) {
            return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
        }
        return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
    }

    function formatFullDate(timestamp) {
        const date = new Date(Number(timestamp) || Date.now());
        const pad = (value) => String(value).padStart(2, '0');
        return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function escapeAttr(value) {
        return ESC(value).replace(/\n/g, ' ');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
