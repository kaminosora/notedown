(function (global) {
    'use strict';
    const templates = [
        {label: '分式', latex: String.raw`\frac{a}{b}`},
        {label: '根式', latex: String.raw`\sqrt{x}`},
        {label: '上下标', latex: 'x_{i}^{2}'},
        {label: '求和', latex: String.raw`\sum_{i=1}^{n} x_i`, display: true},
        {label: '积分', latex: String.raw`\int_{a}^{b} f(x)\,dx`, display: true},
        {label: '矩阵', latex: String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`, display: true},
        {label: '希腊字母', latex: String.raw`\alpha + \beta = \gamma`}
    ];

    function create({overlay, form, toolbar, getEditor, reveal, onChange, toast}) {
        const toggle = document.getElementById('editor-math-toggle');
        let visible = false;
        try { visible = localStorage.getItem('notedown.math-tools') === '1'; } catch (_) { /* Optional UI preference. */ }
        let bookmark = null;
        let editing = false;
        let renderFrame = 0;
        const row = document.createElement('div');
        row.id = 'math-toolbar';
        row.className = 'rich-toolbar-row math-toolbar';
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', '公式工具');
        toolbar.appendChild(row);
        const editButton = button('编辑公式', () => open());
        for (const [label, display] of [['行内公式', false], ['独立公式', true]]) {
            row.appendChild(button(label, () => open({latex: '', display})));
        }
        row.appendChild(editButton);
        for (const template of templates) row.appendChild(button(template.label, () => open(template)));

        const layer = document.createElement('div');
        layer.id = 'editor-math-layer';
        layer.className = 'editor-link-layer editor-math-layer';
        layer.hidden = true;
        layer.innerHTML = `<div class="editor-link-backdrop" data-math-dismiss></div>
            <section class="editor-link-dialog editor-math-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-math-title">
              <form id="editor-math-form" novalidate>
                <div class="math-dialog-heading"><h2 id="editor-math-title">插入公式</h2>
                  <select id="editor-math-layout" aria-label="公式显示方式"><option value="inline">行内公式</option><option value="block">独立公式</option></select></div>
                <label class="field-label" for="editor-math-input">LaTeX 源码</label>
                <textarea id="editor-math-input" class="text-input math-source" rows="3" maxlength="10000" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="例如：\\frac{a}{b}，无需输入外围 $ 符号"></textarea>
                <div class="math-snippets" role="group" aria-label="插入公式片段"></div>
                <div id="editor-math-preview" class="math-preview" aria-label="公式预览"></div>
                <p id="editor-math-error" class="math-error" role="status" hidden></p>
                <div class="dialog-actions"><button id="editor-math-delete" class="text-button" type="button" hidden>删除公式</button>
                  <button class="button button-outline" type="button" data-math-dismiss>取消</button>
                  <button id="editor-math-apply" class="button button-primary" type="submit">插入</button></div>
              </form>
            </section>`;
        overlay.appendChild(layer);
        const source = layer.querySelector('#editor-math-input');
        const layout = layer.querySelector('#editor-math-layout');
        const preview = layer.querySelector('#editor-math-preview');
        const error = layer.querySelector('#editor-math-error');
        const apply = layer.querySelector('#editor-math-apply');
        const remove = layer.querySelector('#editor-math-delete');
        const snippets = layer.querySelector('.math-snippets');
        for (const template of templates) {
            snippets.appendChild(button(template.label, () => {
                const start = source.selectionStart;
                source.setRangeText(template.latex, start, source.selectionEnd, 'select');
                source.focus({preventScroll: true});
                render();
            }));
        }
        for (const target of layer.querySelectorAll('[data-math-dismiss]')) target.addEventListener('click', () => close(true));
        source.addEventListener('input', render);
        layout.addEventListener('change', render);
        source.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); submit(); }
        });
        layer.querySelector('form').addEventListener('submit', event => { event.preventDefault(); submit(); });
        layer.addEventListener('keydown', event => {
            if (event.key !== 'Tab') return;
            const focusable = Array.from(layer.querySelectorAll('button, select, textarea')).filter(el => !el.hidden && !el.disabled);
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        });
        remove.addEventListener('click', () => submit(true));
        toggle.addEventListener('mousedown', event => event.preventDefault());
        toggle.addEventListener('click', () => {
            visible = !visible;
            try { localStorage.setItem('notedown.math-tools', visible ? '1' : '0'); } catch (_) { /* Optional UI preference. */ }
            syncToggle();
            reveal();
        });
        function button(label, action) {
            const element = document.createElement('button');
            element.type = 'button'; element.className = 'rich-tool'; element.textContent = label;
            element.setAttribute('aria-label', label);
            element.addEventListener('mousedown', event => event.preventDefault());
            element.addEventListener('click', action);
            return element;
        }
        function syncToggle() { row.hidden = !visible; toggle.setAttribute('aria-checked', String(visible)); }
        function update() { editButton.disabled = !getEditor()?.getMath(); }
        function open(template) {
            const editor = getEditor();
            if (!editor || overlay.hidden || toggle.hidden) return;
            const existing = template ? null : editor.getMath();
            editing = Boolean(existing);
            bookmark = editor.selectionBookmark();
            source.value = existing?.latex ?? template?.latex ?? '';
            layout.value = (existing?.display ?? template?.display) ? 'block' : 'inline';
            layer.querySelector('#editor-math-title').textContent = editing ? '编辑公式' : '插入公式';
            apply.textContent = editing ? '更新' : '插入';
            remove.hidden = !editing;
            form.inert = true;
            layer.hidden = false;
            render();
            requestAnimationFrame(() => { source.focus(); source.setSelectionRange(0, source.value.length); });
        }
        function render() {
            cancelAnimationFrame(renderFrame);
            renderFrame = requestAnimationFrame(() => {
                if (layer.hidden) return;
                apply.disabled = !source.value.trim();
                if (!source.value.trim()) { preview.textContent = '预览将在这里显示'; error.hidden = true; return; }
                const result = global.NoteMath.renderFormula(preview, source.value, layout.value === 'block');
                error.hidden = result.ok;
                error.textContent = result.ok ? '' : `暂时无法排版，源码仍可保存：${result.error || '请检查公式语法'}`;
            });
        }
        function close(refocus = true) {
            if (layer.hidden) return;
            cancelAnimationFrame(renderFrame);
            layer.hidden = true;
            form.inert = false;
            const editor = getEditor();
            if (refocus && editor) {
                if (bookmark) editor.restoreBookmark(bookmark);
                editor.focus();
                reveal();
            }
            bookmark = null;
        }
        function submit(deleting = false) {
            const editor = getEditor();
            if (!editor || !bookmark || (!deleting && !source.value.trim())) return;
            const value = {latex: deleting ? '' : source.value, display: layout.value === 'block'};
            editor.restoreBookmark(bookmark);
            if (!editor.setMath(value)) { toast('此处无法插入公式，请先选择正文位置'); return; }
            // Keep the transaction's new selection; the saved bookmark is pre-edit.
            close(false);
            editor.focus();
            onChange(); reveal();
        }
        syncToggle();
        return {open, close, update, get isOpen() { return !layer.hidden; },
            setMode(rich) { toggle.hidden = !rich; if (!rich) close(false); syncToggle(); }};
    }
    global.NoteEditorMath = {create};
})(window);
