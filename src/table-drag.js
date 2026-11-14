// Table gestures use a single document transaction on drop. Handles and drag
// previews live outside the editable DOM, so they cannot enter saved notes.
import {Plugin, TextSelection} from 'prosemirror-state';
import {Fragment} from 'prosemirror-model';
import {CellSelection, TableMap} from 'prosemirror-tables';
import {closeHistory} from 'prosemirror-history';

const HOLD_MS = 430;
const MOVE_TOLERANCE = 9;

function cellsInTable(table) {
    const cells = [];
    table.forEach((row, rowOffset, rowIndex) => row.forEach((cell, cellOffset, columnIndex) => {
        cells.push({node: cell, row: rowIndex, column: columnIndex, offset: rowOffset + 1 + cellOffset});
    }));
    return cells;
}

function simpleGrid(table) {
    const map = TableMap.get(table);
    return !map.problems?.length && cellsInTable(table).every(cell => cell.node.attrs.colspan === 1 && cell.node.attrs.rowspan === 1)
        && table.childCount === map.height && Array.from({length: table.childCount}, (_, i) => table.child(i).childCount).every(width => width === map.width);
}

function reordered(values, from, to) {
    const next = values.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
}

// Contents move with their formatting. Header cell/row roles remain attached to
// the grid positions: dragging through a header never leaves a header in tbody.
function keepCellRole(incoming, slot) {
    return slot.type.create({...incoming.attrs, scope: slot.attrs.scope}, incoming.content, incoming.marks);
}

function moveGrid(table, kind, from, to) {
    const rows = Array.from({length: table.childCount}, (_, i) => table.child(i));
    if (kind === 'row') {
        return table.copy(Fragment.fromArray(reordered(rows, from, to).map((row, index) => rows[index].type.create(
            {...row.attrs, section: rows[index].attrs.section},
            Fragment.fromArray(Array.from({length: row.childCount}, (_, column) => keepCellRole(row.child(column), rows[index].child(column)))), row.marks
        ))));
    }
    return table.copy(Fragment.fromArray(rows.map(row => {
        const original = Array.from({length: row.childCount}, (_, i) => row.child(i));
        return row.copy(Fragment.fromArray(reordered(original, from, to).map((cell, index) => keepCellRole(cell, original[index]))));
    })));
}

function exchangeCells(table, from, to) {
    const cells = cellsInTable(table);
    const source = cells.find(cell => cell.offset === from)?.node;
    const target = cells.find(cell => cell.offset === to)?.node;
    if (!source || !target) return null;
    // Only content is exchanged. Spans, row/column headers and alignment belong
    // to the existing cells and remain valid even in a merged-cell table.
    return table.copy(Fragment.fromArray(Array.from({length: table.childCount}, (_, rowIndex) => {
        const row = table.child(rowIndex);
        return row.copy(Fragment.fromArray(cells.filter(cell => cell.row === rowIndex).map(cell =>
            cell.offset === from ? cell.node.copy(target.content) : cell.offset === to ? cell.node.copy(source.content) : cell.node)));
    })));
}

export function createTableDragPlugin() {
    return new Plugin({view: view => new TableDragView(view)});
}

class TableDragView {
    constructor(view) {
        this.view = view;
        this.rich = view.dom;
        this.host = view.dom.closest('.editor-overlay') || document.body;
        this.scroll = view.dom.closest('.editor-scroll') || view.dom.parentElement;
        this.layer = document.createElement('div');
        this.layer.className = 'table-drag-layer';
        this.layer.setAttribute('aria-label', '表格移动手柄');
        this.layer.contentEditable = 'false';
        this.host.appendChild(this.layer);
        this.status = document.createElement('div');
        this.status.className = 'table-drag-status';
        this.status.setAttribute('role', 'status');
        this.status.hidden = true;
        this.host.appendChild(this.status);
        this.events = [];
        this.listen(this.rich, 'pointerdown', event => this.beginCell(event), true);
        this.listen(this.rich, 'pointerover', event => this.activateTable(event.target));
        this.listen(this.layer, 'pointerdown', event => this.beginHandle(event));
        this.listen(this.layer, 'click', event => { event.preventDefault(); });
        this.listen(document, 'pointermove', event => this.move(event), true);
        this.listen(document, 'pointerup', event => this.finish(event, false), true);
        this.listen(document, 'pointercancel', event => this.finish(event, true), true);
        this.listen(document, 'lostpointercapture', event => {
            if (this.gesture?.id === event.pointerId) this.cancel();
        }, true);
        this.listen(document, 'touchmove', event => { if (this.gesture?.active) event.preventDefault(); }, {capture: true, passive: false});
        this.listen(this.rich, 'contextmenu', event => {
            if (this.gesture || Date.now() < this.ignoreClickUntil) event.preventDefault();
        }, true);
        this.listen(this.rich, 'dragstart', event => { if (this.gesture) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
        this.listen(this.rich, 'click', event => {
            if (Date.now() < this.ignoreClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
        }, true);
        this.listen(document, 'keydown', event => {
            if (event.key === 'Escape' && this.gesture) { event.preventDefault(); event.stopImmediatePropagation(); this.cancel(); }
        }, true);
        this.listen(this.scroll, 'scroll', () => { if (this.gesture && !this.gesture.active) this.cancel(); this.schedule(); }, {passive: true});
        this.listen(window, 'resize', () => { this.cancel(); this.schedule(); });
        this.listen(window, 'blur', () => this.cancel());
        if (window.visualViewport) this.listen(window.visualViewport, 'resize', () => { this.cancel(); this.schedule(); });
        this.visibilityObserver = new MutationObserver(() => this.schedule());
        this.visibilityObserver.observe(this.rich, {attributes: true, attributeFilter: ['hidden']});
        this.visibilityObserver.observe(this.host, {attributes: true, subtree: true, attributeFilter: ['hidden', 'inert']});
        this.schedule();
    }

    listen(target, name, callback, options) {
        target.addEventListener(name, callback, options);
        this.events.push(() => target.removeEventListener(name, callback, options));
    }

    area() {
        const rect = this.scroll.getBoundingClientRect();
        const bar = this.host.querySelector('#rich-toolbar')?.getBoundingClientRect();
        const viewport = window.visualViewport;
        const top = Math.max(rect.top, viewport?.offsetTop || 0);
        return {top: bar && bar.top <= top + 2 ? Math.max(top, bar.bottom + 3) : top,
            bottom: Math.min(rect.bottom, viewport ? viewport.offsetTop + viewport.height : innerHeight), left: rect.left, right: rect.right};
    }

    visible() { return !this.rich.hidden && this.rich.isConnected && this.rich.getBoundingClientRect().height > 0 && !this.host.hidden && !this.rich.closest('[inert]'); }

    info(dom) {
        if (!dom || !this.rich.contains(dom)) return null;
        let found = null;
        this.view.state.doc.descendants((node, pos) => {
            if (!found && node.type.spec.tableRole === 'table' && this.view.nodeDOM(pos) === dom) found = {dom, node, pos, cells: cellsInTable(node)};
            return !found;
        });
        return found;
    }

    activateTable(target) {
        const table = target?.closest?.('table');
        if (!this.gesture && table && this.rich.contains(table) && this.tableDOM !== table) { this.tableDOM = table; this.schedule(); }
    }

    schedule() {
        cancelAnimationFrame(this.frame);
        this.frame = requestAnimationFrame(() => this.draw());
    }

    draw() {
        if (!this.visible()) { this.layer.replaceChildren(); if (!this.status.hidden) this.status.hidden = true; this.cancel(); return; }
        const area = this.area();
        this.layer.style.clipPath = `inset(${area.top}px ${Math.max(0, innerWidth - area.right)}px ${Math.max(0, innerHeight - area.bottom)}px ${Math.max(0, area.left)}px)`;
        if (this.gesture?.active) { this.paintDrag(); return; }
        let table = this.tableDOM;
        if (!table?.isConnected || !this.rich.contains(table) || table.getBoundingClientRect().bottom < area.top || table.getBoundingClientRect().top > area.bottom) {
            table = Array.from(this.rich.querySelectorAll('table')).find(candidate => {
                const rect = candidate.getBoundingClientRect();
                return rect.bottom > area.top && rect.top < area.bottom;
            });
            this.tableDOM = table;
        }
        const info = this.info(table);
        // Keep the held button alive until activation/pointerup.
        if (this.gesture) return;
        this.layer.replaceChildren();
        if (!info) return;
        const rows = Array.from(table.rows).filter(row => row.closest('table') === table);
        const gridTop = rows[0]?.getBoundingClientRect().top;
        if (gridTop == null) return;
        const bounds = table.getBoundingClientRect();
        rows.forEach((row, index) => {
            const rect = row.getBoundingClientRect();
            const height = Math.min(42, Math.max(26, rect.height - 2));
            if (rect.bottom < area.top || rect.top > area.bottom) return;
            this.handle('row', index, bounds.left - 29, rect.top + (rect.height - height) / 2, 28, height);
        });
        // In merged tables these handles remain discoverable and explain why
        // row/column rearrangement is unavailable instead of altering spans.
        const map = TableMap.get(info.node);
        const first = rows[0];
        for (let index = 0; index < map.width; index += 1) {
            const cell = first?.cells[index];
            if (!cell) break;
            const rect = cell.getBoundingClientRect();
            // A caption precedes the grid but is part of the table. The gutter
            // belongs outside the whole table so it never intercepts caption
            // focus or text selection.
            this.handle('column', index, rect.left + Math.max(0, (rect.width - 42) / 2), Math.min(bounds.top, gridTop) - 27, Math.min(42, rect.width), 26);
        }
    }

    handle(kind, index, left, top, width, height) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `table-drag-handle table-drag-${kind}`;
        button.dataset.tableDrag = kind;
        button.dataset.index = String(index);
        button.setAttribute('aria-label', `长按移动第 ${index + 1} ${kind === 'row' ? '行' : '列'}`);
        button.title = button.getAttribute('aria-label');
        Object.assign(button.style, {left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`});
        this.layer.appendChild(button);
    }

    beginHandle(event) {
        const handle = event.target.closest('[data-table-drag]');
        if (!handle || event.button !== 0 || !this.visible()) return;
        event.preventDefault();
        event.stopPropagation();
        this.begin(event, handle.dataset.tableDrag, Number(handle.dataset.index), this.info(this.tableDOM), handle);
    }

    beginCell(event) {
        if (event.button !== 0 || event.isPrimary === false || !this.visible() || event.target.closest('button, input, textarea, select, a, [data-math]')) return;
        const cell = event.target.closest('td, th');
        if (!cell || !this.rich.contains(cell) || this.view.composing) return;
        // Existing text selection and the explicit text-selection handles have
        // priority. A plain tap/ordinary swipe is never converted into a drag.
        if (!this.view.state.selection.empty && !(this.view.state.selection instanceof CellSelection)) return;
        const selectionHandles = this.host.querySelector('.editor-selection-handles');
        if (selectionHandles && !selectionHandles.hidden) return;
        const table = cell.closest('table');
        const info = this.info(table);
        const source = info && this.modelCell(info, cell);
        if (!source) return;
        this.tableDOM = table;
        this.begin(event, 'cell', source.offset, info, this.rich);
    }

    modelCell(info, dom) {
        return info.cells.find(cell => this.view.nodeDOM(info.pos + 1 + cell.offset) === dom);
    }

    begin(event, kind, from, info, capture) {
        this.cancel();
        if (!info) return;
        this.gesture = {id: event.pointerId, kind, from, to: from, info, capture,
            doc: this.view.state.doc, bookmark: this.view.state.selection.getBookmark(),
            x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, active: false};
        this.timer = setTimeout(() => this.start(), HOLD_MS);
    }

    message(text, duration = 2400) {
        clearTimeout(this.messageTimer);
        this.status.textContent = text;
        this.status.hidden = false;
        const area = this.area();
        this.status.style.top = `${area.top + 8}px`;
        this.messageTimer = setTimeout(() => { this.status.hidden = true; }, duration);
    }

    start() {
        const drag = this.gesture;
        if (!drag || !this.visible() || drag.doc !== this.view.state.doc) return this.cancel();
        if (drag.kind !== 'cell' && !simpleGrid(drag.info.node)) {
            this.message('含合并单元格的表格暂不支持整行整列移动；可长按单元格交换内容');
            this.cancel();
            return;
        }
        drag.active = true;
        this.rich.dataset.tableDragging = 'true';
        this.rich.dispatchEvent(new CustomEvent('notedown-table-drag', {bubbles: true, detail: {active: true}}));
        try { drag.capture.setPointerCapture(drag.id); } catch (_) { /* Pointer can be canceled by the OS. */ }
        let source = drag.info.cells.find(cell => drag.kind === 'cell' ? cell.offset === drag.from : drag.kind === 'row' ? cell.row === drag.from : cell.column === drag.from);
        const $cell = this.view.state.doc.resolve(drag.info.pos + 1 + source.offset);
        const selection = drag.kind === 'row' ? CellSelection.rowSelection($cell) : drag.kind === 'column' ? CellSelection.colSelection($cell) : new CellSelection($cell);
        this.view.dispatch(this.view.state.tr.setSelection(selection).setMeta('addToHistory', false));
        this.message(drag.kind === 'cell' ? '拖到另一单元格交换内容，松手完成' : `移动整${drag.kind === 'row' ? '行' : '列'}，松手完成`, 10000);
        this.paintDrag();
        this.tick();
    }

    move(event) {
        const drag = this.gesture;
        if (!drag || event.pointerId !== drag.id) return;
        drag.x = event.clientX; drag.y = event.clientY;
        if (!drag.active) {
            if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > MOVE_TOLERANCE) this.cancel();
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        this.target();
        this.paintDrag();
    }

    target() {
        const drag = this.gesture;
        if (!drag?.active) return;
        const tableRect = drag.info.dom.getBoundingClientRect();
        const area = this.area();
        // Drop outside the table cancels; the outer gutter remains a valid
        // destination for row/column dragging, but never for cell exchange.
        if (drag.x < tableRect.left - (drag.kind === 'row' ? 40 : 0) || drag.x > tableRect.right + 5 || drag.y < tableRect.top - (drag.kind === 'column' ? 36 : 0) || drag.y > tableRect.bottom + 5) {
            drag.to = null; return;
        }
        const x = Math.max(tableRect.left + 1, Math.min(tableRect.right - 1, drag.x));
        const y = Math.max(area.top + 1, Math.min(area.bottom - 1, drag.y));
        const hit = document.elementsFromPoint(x, y).find(element => /^(TD|TH)$/.test(element.tagName) && element.closest('table') === drag.info.dom);
        const cell = hit && this.modelCell(drag.info, hit);
        if (drag.kind === 'cell') drag.to = cell?.offset ?? null;
        else if (drag.kind === 'row') {
            const rows = Array.from(drag.info.dom.rows).filter(row => row.closest('table') === drag.info.dom);
            drag.to = rows.findIndex(row => { const r = row.getBoundingClientRect(); return y >= r.top && y <= r.bottom; });
            if (drag.to < 0) drag.to = null;
        } else {
            const first = drag.info.dom.rows[0];
            drag.to = Array.from(first.cells).findIndex(item => { const r = item.getBoundingClientRect(); return x >= r.left && x <= r.right; });
            if (drag.to < 0) drag.to = null;
        }
    }

    outline(rect, className) {
        const box = document.createElement('div');
        box.className = className;
        Object.assign(box.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`});
        this.layer.appendChild(box);
    }

    paintDrag() {
        const drag = this.gesture;
        if (!drag?.active) return;
        this.layer.querySelectorAll('.table-drag-source, .table-drag-target').forEach(element => element.remove());
        for (const [value, className] of [[drag.from, 'table-drag-source'], [drag.to, 'table-drag-target']]) {
            if (value == null) continue;
            for (const cell of drag.info.cells) {
                if (!(drag.kind === 'cell' ? cell.offset === value : drag.kind === 'row' ? cell.row === value : cell.column === value)) continue;
                const element = this.view.nodeDOM(drag.info.pos + 1 + cell.offset);
                if (element) this.outline(element.getBoundingClientRect(), className);
            }
        }
    }

    tick() {
        if (!this.gesture?.active) return;
        const area = this.area();
        const y = this.gesture.y;
        const edge = Math.min(48, (area.bottom - area.top) / 4);
        const speed = y < area.top + edge ? -Math.min(12, (area.top + edge - y) / edge * 12) : y > area.bottom - edge ? Math.min(12, (y - area.bottom + edge) / edge * 12) : 0;
        const x = this.gesture.x;
        const horizontal = this.gesture.kind !== 'row' && this.scroll.scrollWidth > this.scroll.clientWidth
            ? x < area.left + edge ? -Math.min(12, (area.left + edge - x) / edge * 12) : x > area.right - edge ? Math.min(12, (x - area.right + edge) / edge * 12) : 0 : 0;
        if (speed || horizontal) { this.scroll.scrollTop += speed; this.scroll.scrollLeft += horizontal; this.target(); this.paintDrag(); }
        this.dragFrame = requestAnimationFrame(() => this.tick());
    }

    finish(event, canceled) {
        const drag = this.gesture;
        if (!drag || drag.id !== event.pointerId) return;
        if (!drag.active) { this.cancel(); return; }
        event.preventDefault();
        event.stopImmediatePropagation();
        drag.x = event.clientX; drag.y = event.clientY;
        this.target();
        const changed = !canceled && drag.to != null && drag.to !== drag.from && drag.doc === this.view.state.doc;
        const table = changed ? drag.kind === 'cell' ? exchangeCells(drag.info.node, drag.from, drag.to) : moveGrid(drag.info.node, drag.kind, drag.from, drag.to) : null;
        this.gesture = null;
        this.cleanup(drag);
        if (table) {
            const tr = closeHistory(this.view.state.tr).replaceWith(drag.info.pos, drag.info.pos + drag.info.node.nodeSize, table);
            const cells = cellsInTable(table);
            const destination = drag.kind === 'cell' ? drag.info.cells.find(cell => cell.offset === drag.to) : null;
            const cell = cells.find(cell => drag.kind === 'cell' ? cell.row === destination.row && cell.column === destination.column : drag.kind === 'row' ? cell.row === drag.to : cell.column === drag.to);
            if (cell) tr.setSelection(TextSelection.near(tr.doc.resolve(drag.info.pos + 2 + cell.offset)));
            this.view.dispatch(tr);
            this.view.dispatch(closeHistory(this.view.state.tr));
            this.message(drag.kind === 'cell' ? '已交换单元格内容，可撤销' : `已移动整${drag.kind === 'row' ? '行' : '列'}，可撤销`);
        } else {
            try { this.view.dispatch(this.view.state.tr.setSelection(drag.bookmark.resolve(this.view.state.doc)).setMeta('addToHistory', false)); } catch (_) { /* Document may have changed externally. */ }
            this.message('已取消移动');
        }
        this.schedule();
    }

    cleanup(drag) {
        clearTimeout(this.timer);
        cancelAnimationFrame(this.dragFrame);
        delete this.rich.dataset.tableDragging;
        if (drag?.active) {
            this.rich.dispatchEvent(new CustomEvent('notedown-table-drag', {bubbles: true, detail: {active: false}}));
            this.ignoreClickUntil = Date.now() + 500;
            try { drag.capture.releasePointerCapture(drag.id); } catch (_) { /* Already released. */ }
        }
    }

    cancel() {
        const drag = this.gesture;
        this.gesture = null;
        this.cleanup(drag);
        if (drag?.active && drag.doc === this.view.state.doc) {
            try { this.view.dispatch(this.view.state.tr.setSelection(drag.bookmark.resolve(this.view.state.doc)).setMeta('addToHistory', false)); } catch (_) { /* Best-effort cancel after an external transaction. */ }
        }
        if (drag) this.schedule();
    }

    update(view, previous) {
        this.view = view;
        if (this.gesture && !previous.doc.eq(view.state.doc)) this.cancel();
        this.schedule();
    }

    destroy() {
        this.cleanup(this.gesture);
        this.gesture = null;
        cancelAnimationFrame(this.frame);
        clearTimeout(this.messageTimer);
        this.visibilityObserver.disconnect();
        this.events.forEach(remove => remove());
        this.layer.remove();
        this.status.remove();
    }
}
