/* Reading table gestures. Controls are outside the note; drops move original
 * child nodes, preserving checkbox state and formula DOM without overwrites. */
(function (global) {
    'use strict';
    const HOLD_MS = 430;
    let controller = null;
    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
    const rowsOf = table => Array.from(table.rows).filter(row => row.closest('table') === table);
    const gridOf = table => rowsOf(table).map(row => Array.from(row.cells));
    function regular(grid) {
        const width = grid[0]?.length || 0;
        return width > 0 && grid.every(row => row.length === width && row.every(cell => cell.colSpan === 1 && cell.rowSpan === 1));
    }
    function reordered(length, from, to) {
        const order = Array.from({length}, (_, index) => index);
        order.splice(to, 0, order.splice(from, 1)[0]);
        return order;
    }
    class ReadingTableDrag {
        constructor(container, options) {
            this.container = container; this.options = options; this.events = [];
            this.layer = document.createElement('div'); this.layer.className = 'table-drag-layer';
            this.layer.setAttribute('aria-label', '表格移动手柄');
            this.status = document.createElement('div'); this.status.className = 'table-drag-status';
            this.status.setAttribute('role', 'status'); this.status.hidden = true;
            document.body.append(this.layer, this.status);
            this.listen(container, 'pointerdown', event => this.cellDown(event), true);
            this.listen(this.layer, 'pointerdown', event => this.handleDown(event));
            this.listen(this.layer, 'click', event => event.preventDefault());
            this.listen(document, 'pointermove', event => this.move(event), true);
            this.listen(document, 'pointerup', event => this.finish(event, false), true);
            this.listen(document, 'pointercancel', event => this.finish(event, true), true);
            this.listen(document, 'lostpointercapture', event => {
                // Android transfers implicit capture from the pressed td/button
                // to our stable container. Its old target legitimately loses
                // capture; only loss on the current capture target cancels.
                if (this.gesture?.id === event.pointerId && event.target === this.gesture.capture) this.cancel();
            }, true);
            this.listen(document, 'pointerdown', event => {
                // Suppress only the synthetic click belonging to the completed
                // hold. A new intentional tap (notably a task checkbox) is valid.
                this.ignoreClickUntil = 0;
                if (this.gesture && event.pointerId !== this.gesture.id) this.cancel();
            }, true);
            this.listen(document, 'touchmove', event => { if (this.gesture?.active) event.preventDefault(); }, {capture: true, passive: false});
            this.listen(document, 'contextmenu', event => {
                if ((container.contains(event.target) || this.layer.contains(event.target)) && (this.gesture || Date.now() < this.ignoreClickUntil)) event.preventDefault();
            }, true);
            this.listen(document, 'selectstart', event => {
                if (this.gesture?.active && (container.contains(event.target) || this.layer.contains(event.target))) event.preventDefault();
            }, true);
            this.listen(container, 'dragstart', event => { if (this.gesture) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
            this.listen(document, 'click', event => {
                if (Date.now() < this.ignoreClickUntil && (container.contains(event.target) || this.layer.contains(event.target))) { event.preventDefault(); event.stopImmediatePropagation(); }
            }, true);
            this.listen(document, 'keydown', event => {
                if (event.key === 'Escape' && this.gesture) { event.preventDefault(); event.stopImmediatePropagation(); this.cancel(); }
            }, true);
            this.listen(global, 'scroll', () => this.scrolled(), {passive: true});
            this.listen(container, 'scroll', () => this.scrolled(), {capture: true, passive: true});
            this.listen(global, 'resize', () => { this.cancel(); this.refresh(); });
            this.listen(global, 'blur', () => this.cancel());
            this.listen(global, 'notedown-display-change', () => { this.cancel(); this.refresh(); });
            if (global.visualViewport) {
                this.listen(global.visualViewport, 'resize', () => { this.cancel(); this.refresh(); });
                this.listen(global.visualViewport, 'scroll', () => this.refresh());
            }
            this.contentObserver = new MutationObserver(() => {
                if (this.gesture && (!this.gesture.table.isConnected || this.gesture.table.innerHTML !== this.gesture.snapshot)) this.cancel();
                this.refresh();
            });
            this.contentObserver.observe(container, {childList: true, subtree: true});
            this.visibilityObserver = new MutationObserver(() => this.refresh());
            this.visibilityObserver.observe(document.body, {attributes: true, subtree: true, attributeFilter: ['hidden', 'inert']});
            if (global.ResizeObserver) {
                this.resizeObserver = new ResizeObserver(() => this.refresh()); this.resizeObserver.observe(container);
            }
            this.refresh();
        }
        listen(target, name, callback, options) {
            target.addEventListener(name, callback, options); this.events.push(() => target.removeEventListener(name, callback, options));
        }
        enabled() {
            return !this.destroyed && this.container.isConnected && this.container.getBoundingClientRect().height > 0
                && !this.container.closest('[hidden], [inert], [contenteditable="true"]') && (!this.options.isEnabled || this.options.isEnabled());
        }
        area() {
            const v = global.visualViewport, top = v?.offsetTop || 0;
            const bar = document.getElementById('note-topbar')?.getBoundingClientRect();
            return {top: Math.max(top, bar && bar.height > 0 ? bar.bottom : top), bottom: top + (v?.height || global.innerHeight),
                left: v?.offsetLeft || 0, right: (v?.offsetLeft || 0) + (v?.width || global.innerWidth)};
        }
        scrolled() { if (this.gesture && !this.gesture.active) this.cancel(); this.refresh(); }
        refresh() { if (!this.destroyed) { cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => this.draw()); } }
        draw() {
            if (!this.enabled()) { this.cancel(); this.layer.replaceChildren(); if (!this.status.hidden) this.status.hidden = true; return; }
            const area = this.area();
            this.layer.style.clipPath = `inset(${area.top}px ${Math.max(0, global.innerWidth - area.right)}px ${Math.max(0, global.innerHeight - area.bottom)}px ${area.left}px)`;
            if (this.gesture?.active) { this.paint(); return; }
            if (this.gesture) return;
            this.layer.replaceChildren();
            for (const table of this.container.querySelectorAll('table')) {
                // Nested grids keep safe cell exchange. Their exterior gutters
                // would overlap the parent cell, so only top-level tables get handles.
                if (table.parentElement.closest('table')) continue;
                const bounds = table.getBoundingClientRect();
                if (bounds.bottom <= area.top || bounds.top >= area.bottom || bounds.width < 1) continue;
                const rows = rowsOf(table);
                rows.forEach((row, index) => {
                    const rect = row.getBoundingClientRect();
                    if (rect.bottom <= area.top || rect.top >= area.bottom) return;
                    const height = Math.min(44, Math.max(26, rect.height - 2));
                    this.handle(table, 'row', index, bounds.left - 30, rect.top + (rect.height - height) / 2, 30, height);
                });
                if (!rows[0]) continue;
                const top = Math.min(bounds.top, rows[0].getBoundingClientRect().top) - 29;
                Array.from(rows[0].cells).forEach((cell, index) => {
                    const rect = cell.getBoundingClientRect(), left = Math.max(bounds.left, rect.left), right = Math.min(bounds.right, rect.right);
                    if (right - left < 24) return;
                    const width = Math.min(44, right - left);
                    this.handle(table, 'column', index, left + (right - left - width) / 2, top, width, 28);
                });
            }
        }
        handle(table, kind, index, left, top, width, height) {
            const button = document.createElement('button'); button.type = 'button';
            button.className = `table-drag-handle table-drag-${kind}`;
            button.dataset.tableDrag = kind; button.dataset.index = String(index); button.tableTarget = table;
            button.setAttribute('aria-label', `长按移动第 ${index + 1} ${kind === 'row' ? '行' : '列'}`); button.title = button.getAttribute('aria-label');
            Object.assign(button.style, {left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`}); this.layer.appendChild(button);
        }
        handleDown(event) {
            const button = event.target.closest('[data-table-drag]');
            if (!button || event.button !== 0 || event.isPrimary === false || !this.enabled()) return;
            event.preventDefault(); event.stopPropagation();
            // The reading container stays mounted while gutters are repainted
            // or faded. Old Android WebViews can release capture on an overlay
            // button whose hit testing changes during a native long press.
            this.begin(event, button.tableTarget, button.dataset.tableDrag, Number(button.dataset.index), this.container);
        }
        cellDown(event) {
            const cell = event.target?.closest?.('td, th');
            if (!cell || !this.container.contains(cell)) return;
            // Do not let a table-in-list or list-in-cell arm NoteDrag's timer.
            event.stopPropagation();
            if (!this.enabled() || event.button !== 0 || event.isPrimary === false) return;
            if (event.target.closest('a, button, input, label, select, textarea, summary, [contenteditable="true"], .nt-checkbox')) return;
            const selection = global.getSelection();
            if (selection && !selection.isCollapsed && (this.container.contains(selection.anchorNode) || this.container.contains(selection.focusNode))) return;
            this.begin(event, cell.closest('table'), 'cell', cell, this.container);
        }
        begin(event, table, kind, from, capture) {
            this.cancel(); if (!table || !this.container.contains(table)) return;
            global.NoteDrag?.cancel();
            this.gesture = {id: event.pointerId, kind, from, to: from, table, capture, grid: gridOf(table), snapshot: table.innerHTML,
                active: false, moved: false, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY};
            this.timer = global.setTimeout(() => this.start(), HOLD_MS);
        }
        message(text, duration = 2400) {
            clearTimeout(this.messageTimer); this.status.textContent = text;
            if (this.options.onMessage) { this.status.hidden = true; this.options.onMessage(text); return; }
            this.status.style.top = `${this.area().top + 8}px`; this.status.hidden = false;
            this.messageTimer = setTimeout(() => { this.status.hidden = true; }, duration);
        }
        start() {
            const drag = this.gesture;
            if (!drag || !this.enabled() || !drag.table.isConnected || drag.table.innerHTML !== drag.snapshot) { this.cancel(); return; }
            if (drag.kind !== 'cell' && !regular(drag.grid)) {
                this.message('含合并单元格或不规则行的表格暂不支持整行整列移动；可长按单元格交换内容'); this.cancel(); return;
            }
            drag.active = true; this.container.dataset.tableDragging = 'true'; this.layer.classList.add('is-dragging');
            global.getSelection()?.removeAllRanges();
            try { drag.capture.setPointerCapture(drag.id); } catch (_) { /* OS may already have canceled the touch. */ }
            if (this.options.onHaptic) this.options.onHaptic();
            this.message(drag.kind === 'cell' ? '拖到另一单元格交换内容，松手保存' : `拖动整${drag.kind === 'row' ? '行' : '列'}，松手保存`, 10000);
            this.paint(); this.tick();
        }
        move(event) {
            const drag = this.gesture; if (!drag || drag.id !== event.pointerId) return;
            drag.x = event.clientX; drag.y = event.clientY;
            if (!drag.active) { if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 9) this.cancel(); return; }
            if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 9) drag.moved = true;
            event.preventDefault(); event.stopImmediatePropagation(); this.target(); this.paint();
        }
        target() {
            const drag = this.gesture; if (!drag?.active) return;
            const rect = drag.table.getBoundingClientRect(), area = this.area();
            if (drag.x < rect.left - (drag.kind === 'row' ? 40 : 0) || drag.x > rect.right + 4 || drag.y < rect.top - (drag.kind === 'column' ? 36 : 0) || drag.y > rect.bottom + 4) { drag.to = null; return; }
            const x = clamp(drag.x, Math.max(rect.left, area.left) + 1, Math.min(rect.right, area.right) - 1);
            const y = clamp(drag.y, area.top + 1, area.bottom - 1);
            if (drag.kind === 'cell') {
                const hit = document.elementsFromPoint(x, y).find(element => /^(TD|TH)$/.test(element.tagName));
                // Never search past the closest cell into an ancestor table:
                // an outer cell cannot be dropped into its own descendant.
                drag.to = hit?.closest('table') === drag.table && drag.grid.some(row => row.includes(hit)) ? hit : null;
            } else if (drag.kind === 'row') {
                const index = rowsOf(drag.table).findIndex(row => { const r = row.getBoundingClientRect(); return y >= r.top && y < r.bottom; }); drag.to = index < 0 ? null : index;
            } else {
                const index = drag.grid[0].findIndex(cell => { const r = cell.getBoundingClientRect(); return x >= r.left && x < r.right; }); drag.to = index < 0 ? null : index;
            }
        }
        paint() {
            const drag = this.gesture; if (!drag?.active) return;
            this.layer.querySelectorAll('.table-drag-source, .table-drag-target').forEach(element => element.remove());
            const tableRect = drag.table.getBoundingClientRect();
            for (const [value, className] of [[drag.from, 'table-drag-source'], [drag.to, 'table-drag-target']]) {
                if (value == null) continue;
                drag.grid.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
                    if (!(drag.kind === 'cell' ? cell === value : drag.kind === 'row' ? rowIndex === value : columnIndex === value)) return;
                    const rect = cell.getBoundingClientRect(), left = Math.max(rect.left, tableRect.left), right = Math.min(rect.right, tableRect.right);
                    if (right <= left) return;
                    const box = document.createElement('div'); box.className = className;
                    Object.assign(box.style, {left: `${left}px`, top: `${rect.top}px`, width: `${right - left}px`, height: `${rect.height}px`}); this.layer.appendChild(box);
                }));
            }
        }
        tick(timestamp) {
            const drag = this.gesture; if (!drag?.active) return;
            if (!this.enabled() || !drag.table.isConnected) { this.cancel(); return; }
            // Holding a row near a viewport edge merely selects it. Only an
            // intentional drag may scroll or move it after the hold threshold.
            if (!drag.moved) { this.dragFrame = requestAnimationFrame(time => this.tick(time)); return; }
            const area = this.area(), edge = Math.min(65, (area.bottom - area.top) / 4);
            const elapsed = drag.lastFrame ? Math.min(34, timestamp - drag.lastFrame) / 16.667 : 1; drag.lastFrame = timestamp;
            const speed = drag.y < area.top + edge ? -Math.min(15, (area.top + edge - drag.y) / edge * 15) : drag.y > area.bottom - edge ? Math.min(15, (drag.y - area.bottom + edge) / edge * 15) : 0;
            const rect = drag.table.getBoundingClientRect();
            const horizontal = drag.kind !== 'row' && drag.table.scrollWidth > drag.table.clientWidth
                ? drag.x < rect.left + 42 ? -Math.min(14, (rect.left + 42 - drag.x) / 42 * 14) : drag.x > rect.right - 42 ? Math.min(14, (drag.x - rect.right + 42) / 42 * 14) : 0 : 0;
            if (speed || horizontal) {
                if (speed) global.scrollBy(0, speed * elapsed);
                if (horizontal) drag.table.scrollLeft += horizontal * elapsed;
                this.target(); this.paint();
            }
            this.dragFrame = requestAnimationFrame(time => this.tick(time));
        }
        apply(drag) {
            const cells = drag.grid.flat(), original = cells.map(cell => Array.from(cell.childNodes));
            let order = Array.from({length: cells.length}, (_, index) => index);
            if (drag.kind === 'cell') {
                const a = cells.indexOf(drag.from), b = cells.indexOf(drag.to); [order[a], order[b]] = [order[b], order[a]];
            } else if (drag.kind === 'row') {
                const width = drag.grid[0].length;
                order = reordered(drag.grid.length, drag.from, drag.to).flatMap(row => Array.from({length: width}, (_, column) => row * width + column));
            } else {
                const width = drag.grid[0].length, columns = reordered(width, drag.from, drag.to);
                order = drag.grid.flatMap((row, index) => columns.map(column => index * width + column));
            }
            // Preserve grid wrappers/attributes, caption and colgroup. Actual
            // descendants move, retaining checked properties and math content.
            cells.forEach((cell, index) => cell.replaceChildren(...original[order[index]]));
            return () => { if (drag.table.isConnected && this.container.contains(drag.table)) cells.forEach((cell, index) => cell.replaceChildren(...original[index])); };
        }
        finish(event, canceled) {
            const drag = this.gesture; if (!drag || drag.id !== event.pointerId) return;
            if (!drag.active) { this.cancel(); return; }
            event.preventDefault(); event.stopImmediatePropagation(); drag.x = event.clientX; drag.y = event.clientY; this.target();
            const commit = !canceled && drag.moved && this.enabled() && drag.table.isConnected && drag.table.innerHTML === drag.snapshot && drag.to != null && drag.to !== drag.from;
            this.gesture = null; this.cleanup(drag);
            if (commit) {
                const rollback = this.apply(drag); let success = false;
                try { success = !this.options.onCommit || this.options.onCommit() !== false; } catch (error) { console.warn('Table move could not be saved.', error); }
                if (!success) { rollback(); this.message('保存失败，已还原表格'); }
                else this.message(drag.kind === 'cell' ? '已交换单元格内容' : `已移动整${drag.kind === 'row' ? '行' : '列'}`);
            }
            this.refresh();
        }
        cleanup(drag) {
            clearTimeout(this.timer); cancelAnimationFrame(this.dragFrame); delete this.container.dataset.tableDragging;
            this.layer.classList.remove('is-dragging'); this.layer.querySelectorAll('.table-drag-source, .table-drag-target').forEach(element => element.remove());
            if (drag?.active) { this.ignoreClickUntil = Date.now() + 500; try { drag.capture.releasePointerCapture(drag.id); } catch (_) { /* Released already. */ } }
        }
        cancel() { const drag = this.gesture; this.gesture = null; this.cleanup(drag); if (drag) this.refresh(); }
        destroy() {
            this.destroyed = true; this.cleanup(this.gesture); this.gesture = null; cancelAnimationFrame(this.frame); clearTimeout(this.messageTimer);
            this.events.forEach(remove => remove()); this.contentObserver.disconnect(); this.visibilityObserver.disconnect(); this.resizeObserver?.disconnect();
            this.layer.remove(); this.status.remove();
        }
    }
    const api = {
        init(container, options = {}) { controller?.destroy(); controller = container ? new ReadingTableDrag(container, options) : null; return api; },
        refresh() { controller?.refresh(); }, cancel() { controller?.cancel(); }, destroy() { controller?.destroy(); controller = null; },
        get isDragging() { return Boolean(controller?.gesture?.active); }
    };
    global.NoteTableDrag = api;
})(window);
