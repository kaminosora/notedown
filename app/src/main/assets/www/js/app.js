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

    const RICH_ICONS = {
        undo: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 14 4 9l5-5M4 9h9a6 6 0 0 1 0 12h-2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        redo: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 14 5-5-5-5m5 5h-9a6 6 0 0 0 0 12h2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        bulletList: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="5" cy="7" r="1.4" fill="currentColor"/><circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="5" cy="17" r="1.4" fill="currentColor"/><path d="M9 7h10M9 12h10M9 17h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
        task: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4" width="16" height="16" rx="4" stroke="currentColor" stroke-width="1.6"/><path d="m7.5 12 3 3 6-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        quote: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 17V11h5v4.3c0 2.2-1.1 3.6-3.3 4.2M13 17V11h5v4.3c0 2.2-1.1 3.6-3.3 4.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        codeBlock: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="m8.5 9.5-2.2 2.5 2.2 2.5M15.5 9.5l2.2 2.5-2.2 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        link: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        eraser: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 14 7.5-7.5a2.1 2.1 0 0 1 3 0l4 4a2.1 2.1 0 0 1 0 3L14 18H8l-4-4Zm5 4h11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };

    const RICH_TOOLS = [
        {action: 'undo', label: '撤销', html: RICH_ICONS.undo},
        {action: 'redo', label: '重做', html: RICH_ICONS.redo},
        {separator: true},
        {action: 'format', value: '<h1>', label: '一级标题', text: 'H1', glyphClass: 'is-upright'},
        {action: 'format', value: '<h2>', label: '二级标题', text: 'H2', glyphClass: 'is-upright'},
        {action: 'format', value: '<h3>', label: '三级标题', text: 'H3', glyphClass: 'is-upright'},
        {action: 'format', value: '<p>', label: '正文', text: '¶', glyphClass: 'is-upright'},
        {separator: true},
        {action: 'bold', label: '加粗', text: 'B', glyphClass: 'is-bold', toggle: 'bold'},
        {action: 'italic', label: '斜体', text: 'I', glyphClass: 'is-italic', toggle: 'italic'},
        {action: 'strike', label: '删除线', text: 'S', glyphClass: 'is-strike', toggle: 'strikeThrough'},
        {action: 'inline-code', label: '行内代码', text: '</>', glyphClass: 'is-code'},
        {action: 'link', label: '插入链接', html: RICH_ICONS.link},
        {separator: true},
        {action: 'bullet-list', label: '无序列表', html: RICH_ICONS.bulletList},
        {action: 'number-list', label: '有序列表', text: '1.', glyphClass: 'is-upright'},
        {action: 'task-list', label: '任务清单', html: RICH_ICONS.task},
        {action: 'quote', label: '引用', html: RICH_ICONS.quote},
        {action: 'code-block', label: '代码块', html: RICH_ICONS.codeBlock},
        {action: 'divider', label: '分割线', text: '—', glyphClass: 'is-upright'},
        {separator: true},
        {action: 'clear', label: '清除格式', html: RICH_ICONS.eraser}
    ];

    const app = {
        currentView: 'library',
        currentNoteId: null,
        libraryScrollY: 0,
        themeMode: 'auto',
        strikeMode: false,
        editorMode: null,
        editorNoteId: null,
        editorFormat: 'rich',
        editorPreviewing: false,
        richEditor: null,
        editorMobile: null,
        mathUi: null,
        displayUi: null,
        linkRange: null,
        importTarget: 'library',
        pendingConfirm: null,
        editorBaseline: null,
        recoveryError: null,
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
            'edit-note-button', 'strike-button', 'note-menu-button',
            'strike-banner', 'strike-done',
            'note-title', 'note-index', 'note-updated', 'note-stats',
            'note-content', 'action-sheet-backdrop', 'action-sheet', 'sheet-title',
            'sheet-actions', 'sheet-cancel', 'confirm-backdrop', 'confirm-dialog',
            'confirm-title', 'confirm-message', 'confirm-cancel', 'confirm-ok',
            'rename-backdrop', 'rename-dialog', 'rename-form', 'rename-input',
            'rename-cancel', 'editor-overlay', 'editor-form', 'editor-cancel',
            'editor-save', 'editor-mode-label', 'editor-title-label',
            'editor-title', 'editor-mode-tabs', 'editor-rich', 'rich-toolbar',
            'editor-preview-toggle', 'editor-textarea', 'editor-preview',
            'editor-hint', 'editor-link-layer', 'editor-link-form',
            'editor-link-input', 'editor-link-cancel', 'editor-link-backdrop',
            'file-input', 'toast'
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

    function snapshotNativeBackup() {
        const bridge = nativeBridge();
        if (!bridge || typeof bridge.snapshotBackup !== 'function') {
            return;
        }
        try {
            bridge.snapshotBackup();
        } catch (error) {
            // A rolling backup is best-effort; never block startup for it.
        }
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
        app.recoveryError = Store.getLoadError();
        if (!app.recoveryError) {
            snapshotNativeBackup();
        }

        app.themeMode = Store.getPrefs().theme || 'auto';
        window.NoteDisplay.apply(Store.getPrefs().displayScale);
        applyTheme(app.themeMode, false);

        if (!Store.loadWarning && !app.recoveryError) {
            seedWelcomeNote();
        }

        buildRichToolbar();
        bindEvents();
        initDrag();
        renderLibrary();
        showLibrary({restoreScroll: false, skipRender: true});
        exposeNativeHooks();
        app.booted = true;

        if (app.recoveryError) {
            showRecoveryBanner();
        } else if (Store.loadWarning) {
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
        dom.editNoteButton.addEventListener('click', () => {
            if (app.currentNoteId) {
                openEditor('edit', app.currentNoteId);
            }
        });
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
        dom.editorCancel.addEventListener('click', () => requestCloseEditor());
        for (const button of dom.editorModeTabs.querySelectorAll('[data-editor-mode]')) {
            button.addEventListener('click', () => switchEditorMode(button.getAttribute('data-editor-mode')));
        }
        dom.editorPreviewToggle.addEventListener('click', toggleEditorPreview);
        dom.fileInput.addEventListener('change', onBrowserFilesChosen);
        dom.editorTitle.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                focusEditorText();
            }
        });
        dom.editorTextarea.addEventListener('keydown', onEditorTextareaKeydown);
        dom.editorPreview.addEventListener('click', (event) => {
            if (event.target.closest('a[href]')) {
                event.preventDefault();
            }
        });
        dom.editorRich.addEventListener('keydown', onRichEditorKeydown);
        dom.editorLinkForm.addEventListener('submit', submitLinkDialog);
        dom.editorLinkCancel.addEventListener('click', () => closeLinkDialog(true));
        dom.editorLinkBackdrop.addEventListener('click', () => closeLinkDialog(true));

        app.editorMobile = window.NoteEditorMobile.create({
            overlay: dom.editorOverlay, rich: dom.editorRich,
            scroll: dom.editorOverlay.querySelector('.editor-scroll'),
            toolbar: dom.richToolbar, textarea: dom.editorTextarea, title: dom.editorTitle,
            getEditor: () => app.richEditor,
            isRich: () => app.editorFormat === 'rich' && !dom.editorForm.inert && !dom.editorOverlay.inert
        });
        app.mathUi = window.NoteEditorMath.create({
            overlay: dom.editorOverlay, form: dom.editorForm, toolbar: dom.richToolbar,
            getEditor: () => app.richEditor,
            reveal: () => app.editorMobile.reveal(),
            onChange: () => { updateRichEmptyState(); updateRichToolbarState(); },
            toast: showToast
        });
        app.displayUi = window.NoteDisplay.create({store: Store, onLayerChange: syncOverlayState, toast: showToast});
        document.getElementById('display-settings').addEventListener('click', () => app.displayUi.open());
        document.addEventListener('keydown', onDocumentKeydown);
    }

    function initDrag() {
        const commit = () => {
            if (!app.currentNoteId) return false;
            const updated = persistOpenNote();
            if (updated) {
                refreshNoteMeta(updated);
            }
            return Boolean(updated);
        };
        window.NoteDrag.init(dom.noteContent, {onHaptic: nativeHaptic, onCommit: commit});
        window.NoteTableDrag.init(dom.noteContent, {
            isEnabled: () => app.currentView === 'note' && !dom.noteScreen.hidden && !app.strikeMode && !isAnyOverlayOpen(),
            onHaptic: nativeHaptic,
            onMessage: showToast,
            onCommit: commit
        });
    }

    function cancelReadingDrag() {
        window.NoteDrag.cancel();
        window.NoteTableDrag.cancel();
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
        cancelReadingDrag();
        app.currentNoteId = id;
        app.currentView = 'note';
        setStrikeMode(false, false);
        renderNote(note);
        dom.libraryScreen.hidden = true;
        dom.noteScreen.hidden = false;
        window.NoteTableDrag.refresh();
        dom.noteTopbar.classList.remove('is-scrolled');
        document.title = `${note.title} · Notedown`;
        window.scrollTo(0, 0);
        requestAnimationFrame(() => {
            dom.noteContent.focus({preventScroll: true});
        });
    }

    function showLibrary(options) {
        const settings = options || {};
        cancelReadingDrag();
        setStrikeMode(false, false);
        dom.noteScreen.hidden = true;
        dom.libraryScreen.hidden = false;
        app.currentView = 'library';
        app.currentNoteId = null;
        window.NoteTableDrag.refresh();
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

    /* ---------------- Recovery ---------------- */

    function showRecoveryBanner() {
        if (dom.recoveryBanner) {
            return;
        }
        const banner = document.createElement('section');
        banner.className = 'recovery-banner';
        banner.setAttribute('role', 'alert');
        banner.innerHTML = `
            <p class="recovery-kicker">Recovery mode</p>
            <h2 class="recovery-title">本地笔记数据无法读取</h2>
            <p class="recovery-copy">为避免覆盖原有内容，保存已暂停。可以先从上次启动时保存的自动备份恢复；也可以清空后重新开始。</p>
            <div class="recovery-actions">
                <button type="button" class="button" data-recovery="restore">从自动备份恢复</button>
                <button type="button" class="button button-outline" data-recovery="reset">清空并重新开始</button>
            </div>`;
        banner.addEventListener('click', onRecoveryClick);
        const main = dom.libraryScreen.querySelector('.library-main');
        (main || dom.libraryScreen).prepend(banner);
        dom.recoveryBanner = banner;
    }

    function hideRecoveryBanner() {
        if (!dom.recoveryBanner) {
            return;
        }
        dom.recoveryBanner.remove();
        dom.recoveryBanner = null;
    }

    function onRecoveryClick(event) {
        const button = event.target.closest('[data-recovery]');
        if (!button) {
            return;
        }
        if (button.getAttribute('data-recovery') === 'restore') {
            restoreFromBackup();
        } else {
            confirmRecoveryReset();
        }
    }

    function finishRecovery() {
        app.recoveryError = null;
        app.searchIndex.clear();
        hideRecoveryBanner();
    }

    function restoreFromBackup() {
        const bridge = nativeBridge();
        if (!bridge || typeof bridge.loadBackupData !== 'function') {
            showToast('当前环境没有可用的自动备份');
            return;
        }
        let raw = '';
        try {
            raw = bridge.loadBackupData() || '';
        } catch (error) {
            raw = '';
        }
        if (!raw) {
            showToast('没有找到可用的自动备份');
            return;
        }
        if (!Store.restore(raw)) {
            showToast('备份内容同样无法读取');
            return;
        }
        finishRecovery();
        renderLibrary();
        showToast('已从自动备份恢复笔记');
    }

    function confirmRecoveryReset() {
        openConfirmDialog({
            title: '清空本地笔记并重新开始？',
            message: '无法读取的原始数据会被覆盖，且不能撤销。',
            confirmLabel: '清空并重新开始',
            onConfirm: () => {
                if (!Store.reset()) {
                    showToast('无法写入，请检查存储空间');
                    return false;
                }
                finishRecovery();
                seedWelcomeNote();
                renderLibrary();
                return true;
            }
        });
    }

    /* ---------------- Note view ---------------- */

    function renderNote(note) {
        cancelReadingDrag();
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
        window.NoteTableDrag.refresh();
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
        empty.textContent = '这篇笔记还没有内容。点右上角的铅笔按钮开始编辑。';
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
        } else {
            // Reading-mode actions modify the DOM before saving. Restore the
            // committed snapshot so a failed checkbox/strike/drag is visible.
            const saved = Store.getNote(app.currentNoteId);
            if (saved) renderNote(saved);
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
        cancelReadingDrag();
        dom.strikeButton.setAttribute('aria-pressed', app.strikeMode ? 'true' : 'false');
        dom.strikeButton.setAttribute('aria-label', app.strikeMode ? '退出划线模式' : '进入划线模式');
        dom.strikeBanner.hidden = !app.strikeMode;
        document.body.classList.toggle('strike-mode', app.strikeMode);
        window.NoteTableDrag.refresh();
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
            {id: 'edit', label: '编辑笔记', icon: ICONS.edit},
            {id: 'theme', label: `切换外观 · ${themeLabel(app.themeMode).replace('外观：', '')}`, icon: ICONS.theme},
            {id: 'display', label: `显示比例 · ${Store.getPrefs().displayScale}%`, icon: '<span aria-hidden="true">Aa</span>'},
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
        } else if (action === 'display') {
            app.displayUi.open();
        } else if (action === 'delete') {
            openDeleteConfirm(noteId);
        }
    }

    function openConfirmDialog(options) {
        const settings = options || {};
        dom.confirmTitle.textContent = settings.title || '确认操作';
        dom.confirmMessage.textContent = settings.message || '';
        dom.confirmOk.textContent = settings.confirmLabel || '确认';
        dom.confirmCancel.textContent = settings.cancelLabel || '取消';
        app.pendingConfirm = typeof settings.onConfirm === 'function' ? settings.onConfirm : null;
        openLayer(dom.confirmBackdrop, dom.confirmDialog, dom.confirmCancel);
    }

    function openDeleteConfirm(noteId) {
        const note = Store.getNote(noteId);
        if (!note) {
            return;
        }
        openConfirmDialog({
            title: '删除这篇笔记？',
            message: `“${note.title}” 将被永久删除，无法恢复。`,
            confirmLabel: '删除',
            onConfirm: () => {
                if (!Store.deleteNote(noteId)) return false;
                app.currentNoteId = null;
                app.searchIndex.clear();
                showLibrary({restoreScroll: false});
                showToast('笔记已删除');
                return true;
            }
        });
    }

    function closeConfirm() {
        hideLayer(dom.confirmBackdrop, dom.confirmDialog);
        app.pendingConfirm = null;
    }

    function confirmPendingAction() {
        const action = app.pendingConfirm;
        if (typeof action === 'function' && action() === false) return;
        hideLayer(dom.confirmBackdrop, dom.confirmDialog);
        app.pendingConfirm = null;
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
        if (!note) return;
        closeRename();
        renderNote(note);
        showToast('标题已更新');
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
            || Boolean(app.displayUi && app.displayUi.isOpen)
            || !dom.actionSheet.hidden
            || !dom.confirmDialog.hidden
            || !dom.renameDialog.hidden;
    }

    function syncOverlayState() {
        const open = isAnyOverlayOpen();
        if (open) cancelReadingDrag();
        dom.editorOverlay.inert = !dom.confirmDialog.hidden || Boolean(app.displayUi && app.displayUi.isOpen);
        document.body.classList.toggle('overlay-open', open);
        window.NoteTableDrag.refresh();
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
        cancelReadingDrag();
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
        app.editorFormat = 'rich';
        app.editorPreviewing = false;

        app.linkRange = null;

        dom.editorLinkLayer.hidden = true;
        dom.editorForm.inert = false;
        dom.editorModeLabel.textContent = mode === 'edit' ? 'Edit' : 'Compose';
        dom.editorTitleLabel.textContent = mode === 'edit' ? '编辑笔记' : '新建笔记';
        dom.editorTitle.value = note ? note.title : '';
        dom.editorPreview.innerHTML = '';
        dom.editorPreview.hidden = true;
        dom.editorTextarea.value = '';
        dom.editorPreviewToggle.setAttribute('aria-pressed', 'false');
        dom.editorPreviewToggle.textContent = '预览';

        setRichContent(note ? Parser.sanitizeHtml(note.html) : '');
        applyEditorModeUi();
        // Snapshot what "unchanged" means for the discard guard below.
        app.editorBaseline = {
            title: dom.editorTitle.value.trim(),
            html: captureEditorHtml()
        };
        dom.editorOverlay.hidden = false;
        app.editorMobile.open();
        updateRichToolbarState();
        syncOverlayState();

        requestAnimationFrame(() => {
            if (mode === 'create') {
                dom.editorTitle.focus();
            } else {
                focusRichAtStart();
            }
        });
    }

    function closeEditor(restoreFocus) {
        app.mathUi.close(false);
        closeLinkDialog(false);
        blurInside(dom.editorOverlay);
        dom.editorOverlay.hidden = true;
        dom.editorPreview.hidden = true;
        dom.editorPreview.innerHTML = '';
        dom.editorTextarea.hidden = true;
        dom.editorTextarea.value = '';
        dom.editorRich.hidden = false;
        if (app.richEditor) app.richEditor.destroy();
        app.richEditor = null;
        app.editorMobile.close();
        dom.editorRich.innerHTML = '';
        app.editorMode = null;
        app.editorNoteId = null;
        app.editorFormat = 'rich';
        app.editorPreviewing = false;

        app.linkRange = null;
        app.editorBaseline = null;
        syncOverlayState();
    }

    function editorHasUnsavedChanges() {
        if (!app.editorMode || !app.editorBaseline) {
            return false;
        }
        if (dom.editorTitle.value.trim() !== app.editorBaseline.title) {
            return true;
        }
        try {
            return captureEditorHtml() !== app.editorBaseline.html;
        } catch (error) {
            // A conversion failure must not be treated as "nothing changed".
            return true;
        }
    }

    function requestCloseEditor() {
        if (!editorHasUnsavedChanges()) {
            closeEditor();
            return;
        }
        openConfirmDialog({
            title: '放弃未保存的修改？',
            message: '这篇笔记的修改还没有保存，离开后会丢失。',
            confirmLabel: '放弃修改',
            cancelLabel: '继续编辑',
            onConfirm: closeEditor
        });
    }

    function captureEditorHtml() {
        if (app.editorFormat === 'rich') {
            return Parser.sanitizeHtml(app.richEditor.getHTML());
        }
        const source = dom.editorTextarea.value;
        if (app.editorFormat === 'markdown') {
            return Parser.markdownToHtml(source);
        }
        return Parser.htmlToHtml(source);
    }

    function switchEditorMode(target) {
        if (!app.editorMode || target === app.editorFormat) {
            return;
        }
        if (!['rich', 'markdown', 'html'].includes(target)) {
            return;
        }

        let html;
        try {
            html = captureEditorHtml();
        } catch (error) {
            showToast('当前内容无法转换，请检查格式');
            return;
        }

        if (target === 'markdown') {
            try {
                dom.editorTextarea.value = NoteMarkdown.htmlToMarkdown(html);
            } catch (error) {
                showToast('无法转换为 Markdown');
                return;
            }
        } else if (target === 'html') {
            dom.editorTextarea.value = html;
        }

        app.editorMobile.resetSelection();
        app.editorFormat = target;
        app.editorPreviewing = false;
        dom.editorPreview.hidden = true;
        dom.editorPreview.innerHTML = '';
        dom.editorPreviewToggle.setAttribute('aria-pressed', 'false');
        dom.editorPreviewToggle.textContent = '预览';

        if (target === 'rich') {
            setRichContent(html);
            applyEditorModeUi();
            requestAnimationFrame(() => focusRichAtStart());
        } else {
            applyEditorModeUi();
            requestAnimationFrame(() => {
                dom.editorTextarea.focus();
                dom.editorTextarea.setSelectionRange(0, 0);
                dom.editorTextarea.scrollTop = 0;
            });
        }
    }

    function applyEditorModeUi() {
        const mode = app.editorFormat;
        for (const button of dom.editorModeTabs.querySelectorAll('[data-editor-mode]')) {
            const active = button.getAttribute('data-editor-mode') === mode;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
        }

        const rich = mode === 'rich';
        app.mathUi.setMode(rich);
        dom.editorRich.hidden = !rich;
        dom.richToolbar.hidden = !rich;
        dom.editorPreviewToggle.hidden = rich;
        if (rich) {
            dom.editorTextarea.hidden = true;
            dom.editorPreview.hidden = true;
        } else {
            dom.editorTextarea.hidden = app.editorPreviewing;
            dom.editorPreview.hidden = !app.editorPreviewing;
        }
        updateEditorHint();
        updateRichEmptyState();
        updateRichToolbarState();
    }

    function updateEditorHint() {
        if (app.editorFormat === 'rich') {
            dom.editorTextarea.placeholder = '从这里开始写……';
            dom.editorHint.textContent = '在阅读页面长按表格外侧点状手柄可排序；这里可编辑文字和增删行列。“选区”支持跨屏拖选，ƒx 可展开公式工具。';
        } else if (app.editorFormat === 'markdown') {
            dom.editorTextarea.placeholder = '# 标题\n\n- [ ] 第一件事\n- [ ] 第二件事\n\n用 Markdown 写点什么……';
            dom.editorHint.textContent = '编辑 Markdown 源码；$…$ 为行内公式，$$…$$ 为独立公式。可切换预览检查结果。';
        } else {
            dom.editorTextarea.placeholder = '<h1>标题</h1>\n<p>用 HTML 写点什么……</p>\n<ul>\n  <li>一个条目</li>\n</ul>';
            dom.editorHint.textContent = '直接编辑安全 HTML；支持 $…$ / $$…$$ 公式，或修改公式元素的 data-latex 源码。脚本、内联样式和事件属性会被移除。';
        }
    }

    function focusEditorText() {
        if (app.editorFormat === 'rich') {
            focusRichForCommand();
        } else {
            dom.editorTextarea.focus();
        }
    }

    function setRichContent(html) {
        if (app.richEditor) app.richEditor.destroy();
        app.richEditor = window.NoteRichEditor.create({
            element: dom.editorRich,
            html: html || '<p></p>',
            onChange: () => {
                updateRichEmptyState();
                updateRichToolbarState();
                if (app.editorMobile) app.editorMobile.changed();
            },
            onSelectionChange: () => {
                updateRichToolbarState();
                if (app.editorMobile) app.editorMobile.selectionChanged();
            },
            onReveal: () => app.editorMobile && app.editorMobile.reveal(),
            onEditMath: () => app.mathUi && app.mathUi.open()
        });
        updateRichEmptyState();
        updateRichToolbarState();
    }

    function updateRichEmptyState() {
        const doc = app.richEditor && app.richEditor.view.state.doc;
        dom.editorRich.setAttribute('data-empty', doc && doc.childCount === 1
            && doc.firstChild.type.name === 'paragraph' && doc.firstChild.content.size === 0 ? 'true' : 'false');
    }

    function focusRichAtStart() {
        if (app.richEditor) app.richEditor.focus('start');
        if (app.editorMobile) app.editorMobile.reveal();
    }

    function focusRichForCommand() {
        if (app.richEditor) app.richEditor.focus();
    }

    function buildRichToolbar() {
        dom.richToolbar.replaceChildren();
        const groups = [RICH_TOOLS, [
            {action: 'cursor-mode', label: '拖动光标', text: '光标'},
            {action: 'select-mode', label: '调整光标与选区', text: '选区'},
            {action: 'block-up', label: '上移当前块或列表项', text: '上移'},
            {action: 'block-down', label: '下移当前块或列表项', text: '下移'},
            {action: 'block-before', label: '在当前块前插入段落', text: '前插'},
            {action: 'block-after', label: '在当前块后插入段落', text: '后插'},
            {action: 'block-delete', label: '删除当前块或列表项', text: '删块'},
            {separator: true},
            {action: 'table', label: '插入表格', text: '表格'},
            {action: 'add-row', label: '在下方增加一行', text: '+行'},
            {action: 'delete-row', label: '删除当前行', text: '−行'},
            {action: 'add-column', label: '在右侧增加一列', text: '+列'},
            {action: 'delete-column', label: '删除当前列', text: '−列'},
            {action: 'delete-table', label: '删除当前表格', text: '删表'},
            {separator: true},
            {action: 'display', label: '调整显示比例', text: '比例'}
        ]];
        for (const [index, tools] of groups.entries()) {
            const row = document.createElement('div');
            row.className = 'rich-toolbar-row';
            row.setAttribute('role', 'group');
            row.setAttribute('aria-label', index ? '选区与内容块操作' : '文字格式');
            for (const tool of tools) {
                if (tool.separator) {
                    const separator = document.createElement('span');
                    separator.className = 'rich-tool-sep';
                    separator.setAttribute('aria-hidden', 'true');
                    row.appendChild(separator);
                    continue;
                }
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'rich-tool';
                button.title = tool.label;
                button.setAttribute('aria-label', tool.label);
                button.dataset.richAction = tool.action;
                if (tool.value) button.dataset.richValue = tool.value;
                if (tool.html) button.innerHTML = tool.html;
                else {
                    const glyph = document.createElement('span');
                    glyph.className = `rich-tool-glyph ${tool.glyphClass || 'is-upright'}`;
                    glyph.textContent = tool.text;
                    button.appendChild(glyph);
                }
                // Cancel focus changes, but leave touch scrolling to the UA.
                // Click (including accessibility activation) is the only command trigger.
                button.addEventListener('mousedown', event => event.preventDefault());
                button.addEventListener('click', event => {
                    event.preventDefault();
                    runRichToolAction(tool);
                });
                row.appendChild(button);
            }
            dom.richToolbar.appendChild(row);
        }
    }

    function updateRichToolbarState() {
        if (!app.richEditor || app.editorFormat !== 'rich') return;
        if (app.mathUi) app.mathUi.update();
        for (const button of dom.richToolbar.querySelectorAll('[data-rich-action]')) {
            const action = button.dataset.richAction;
            const value = button.dataset.richValue;
            if (action === 'display') { button.disabled = false; continue; }
            if (action === 'select-mode' || action === 'cursor-mode') {
                const selected = app.editorMobile && (action === 'select-mode' ? app.editorMobile.selecting : app.editorMobile.cursorMode);
                button.setAttribute('aria-pressed', selected ? 'true' : 'false');
                continue;
            }
            button.disabled = !app.richEditor.can(action, value);
            button.setAttribute('aria-pressed', app.richEditor.isActive(action, value) ? 'true' : 'false');
        }
    }

    function runRichToolAction(tool) {
        if (!app.editorMode || app.editorFormat !== 'rich' || !app.richEditor) return;
        if (tool.action === 'display') { app.displayUi.open(); return; }
        if (tool.action === 'select-mode' || tool.action === 'cursor-mode') {
            app.editorMobile.toggleSelection(tool.action === 'select-mode' ? 'range' : 'cursor');
            updateRichToolbarState();
            return;
        }
        if (tool.action === 'link') {
            openLinkDialog();
            return;
        }
        app.richEditor.run(tool.action, tool.value);
        updateRichEmptyState();
        updateRichToolbarState();
        app.editorMobile.reveal();
    }

    function openLinkDialog() {
        if (!app.richEditor) return;
        app.linkRange = app.richEditor.selectionBookmark();
        dom.editorLinkInput.value = app.richEditor.getLink() || '';
        dom.editorForm.inert = true;
        dom.editorLinkLayer.hidden = false;
        requestAnimationFrame(() => dom.editorLinkInput.focus());
    }

    function closeLinkDialog(refocus) {
        if (dom.editorLinkLayer.hidden) return;
        dom.editorLinkLayer.hidden = true;
        dom.editorForm.inert = false;
        dom.editorLinkInput.value = '';
        if (refocus && app.richEditor) {
            if (app.linkRange) app.richEditor.restoreBookmark(app.linkRange);
            app.richEditor.focus();
        }
        app.linkRange = null;
    }

    function normalizeLinkUrl(value) {
        let url = String(value || '').trim();
        if (!url) return '';
        if (/^#/.test(url)) return url;
        if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
        try {
            const parsed = new URL(url);
            return ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol) ? url : null;
        } catch (error) {
            return null;
        }
    }

    function submitLinkDialog(event) {
        event.preventDefault();
        if (!app.richEditor || !app.linkRange) return;
        const url = normalizeLinkUrl(dom.editorLinkInput.value);
        if (url === null) {
            dom.editorLinkInput.focus();
            showToast('请输入有效的链接地址');
            return;
        }
        dom.editorForm.inert = false;
        dom.editorLinkLayer.hidden = true;
        app.richEditor.restoreBookmark(app.linkRange);
        app.richEditor.setLink(url);
        app.linkRange = null;
        app.richEditor.focus();
        updateRichToolbarState();
        app.editorMobile.reveal();
    }

    function onRichEditorKeydown(event) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            dom.editorForm.requestSubmit();
        }
    }

    function toggleEditorPreview() {
        if (app.editorFormat === 'rich') {
            return;
        }
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

    function editorHtmlIsMeaningful(html) {
        if (!html || !html.trim()) {
            return false;
        }
        const holder = document.createElement('div');
        holder.innerHTML = html;
        return Boolean(holder.textContent.replace(/\s+/g, ''))
            || Boolean(holder.querySelector('img, hr, table, li, pre'));
    }

    function submitEditor(event) {
        event.preventDefault();
        let html;
        try {
            html = captureEditorHtml();
        } catch (error) {
            showToast('内容解析失败，请检查格式');
            return;
        }

        if (!editorHtmlIsMeaningful(html)) {
            if (app.editorFormat === 'rich') {
                focusRichAtStart();
            } else {
                dom.editorTextarea.focus();
            }
            showToast('先写一点内容再保存');
            return;
        }

        const enteredTitle = dom.editorTitle.value.trim();
        const derivedTitle = Parser.firstHeadingText(html) || Parser.topText(html) || '未命名笔记';
        const title = Parser.truncate(enteredTitle || derivedTitle, 64) || '未命名笔记';

        const wasEdit = app.editorMode === 'edit';
        let saved;
        if (wasEdit && app.editorNoteId) {
            saved = Store.updateNote(app.editorNoteId, {title, html});
        } else {
            saved = Store.createNote({title, html});
        }
        if (!saved) {
            showToast('保存失败，请重试');
            return;
        }

        closeEditor();
        app.searchIndex.clear();
        if (!wasEdit) {
            clearSearch();
        }
        app.currentNoteId = saved.id;
        app.currentView = 'note';
        dom.libraryScreen.hidden = true;
        dom.noteScreen.hidden = false;
        renderNote(saved);
        window.scrollTo(0, 0);
        showToast(wasEdit ? '笔记已保存' : '笔记已创建');
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

        app.importTarget = 'library';
        if (currentNote) {
            const merged = `${currentNote.html}\n${combined.html}`;
            const updated = Store.updateContent(currentNote.id, merged);
            if (!updated) {
                openEditor('edit', currentNote.id);
                setRichContent(merged);
                showToast('导入内容尚未保存，已保留在编辑器，请重试');
                return;
            }
            setStrikeMode(false, false);
            app.searchIndex.clear();
            renderNote(updated);
            refreshNoteMeta(updated);
            showToast(`已导入 ${combined.imported} 个文件${suffix}`);
        } else {
            const note = Store.createNote({title: combined.title, html: combined.html});
            if (!note) {
                openEditor('create');
                dom.editorTitle.value = combined.title;
                setRichContent(combined.html);
                showToast('导入内容尚未保存，已保留在编辑器，请重试');
                return;
            }
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
        if (applyTheme(next, true)) showToast(themeLabel(next));
    }

    function applyTheme(mode, persist) {
        const safe = ['auto', 'light', 'dark'].includes(mode) ? mode : 'auto';
        if (persist && !Store.setTheme(safe)) return false;
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
        const bridge = nativeBridge();
        if (bridge && typeof bridge.setTheme === 'function') {
            try {
                bridge.setTheme(dark ? 'dark' : 'light');
            } catch (error) {
                // A browser preview has no native theme bridge.
            }
        }
        return true;
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
        if (window.NoteTableDrag.isDragging) {
            window.NoteTableDrag.cancel();
            return true;
        }
        if (app.displayUi && app.displayUi.isOpen) {
            app.displayUi.close();
            return true;
        }
        if (app.mathUi && app.mathUi.isOpen) {
            app.mathUi.close(true);
            return true;
        }
        if (!dom.editorLinkLayer.hidden) {
            closeLinkDialog(true);
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
        if (!dom.editorOverlay.hidden) {
            requestCloseEditor();
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
