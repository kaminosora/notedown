/* Viewport and selection gestures. Scrolling never remaps the stationary end
 * of a selection. Only an explicit handle/mouse drag may move its active end. */
(function (global) {
    'use strict';

    function create({overlay, rich, scroll, toolbar, textarea, title, getEditor, isRich}) {
        let revealFrame = 0;
        let dragFrame = 0;
        let drag = null;
        let lastSelection = null;
        let selectionMode = '';
        let restoring = false;
        let tableDragging = false;
        const handles = document.createElement('div');
        handles.className = 'editor-selection-handles';
        handles.hidden = true;
        overlay.appendChild(handles);
        const handleButtons = ['anchor', 'head'].map(end => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'editor-selection-handle';
            button.dataset.selectionEnd = end;
            button.setAttribute('aria-label', end === 'anchor' ? '拖动选区起点' : '拖动光标或选区终点');
            button.addEventListener('pointerdown', event => beginHandle(event, end));
            button.addEventListener('pointermove', moveHandle);
            button.addEventListener('pointerup', stopDrag);
            button.addEventListener('pointercancel', stopDrag);
            button.addEventListener('lostpointercapture', stopDrag);
            button.addEventListener('click', event => event.preventDefault());
            handles.appendChild(button);
            return button;
        });

        function active() { return !overlay.hidden && isRich() && getEditor(); }
        function bounds() {
            const rect = scroll.getBoundingClientRect();
            const bar = toolbar.hidden ? null : toolbar.getBoundingClientRect();
            const viewport = global.visualViewport;
            const top = Math.max(rect.top, viewport ? viewport.offsetTop : 0);
            return {
                top: bar && bar.bottom > top && bar.top <= top + 2 ? bar.bottom + 10 : top + 10,
                bottom: Math.min(rect.bottom, viewport ? viewport.offsetTop + viewport.height : innerHeight) - 22,
                left: rich.getBoundingClientRect().left + 5,
                right: rich.getBoundingClientRect().right - 5
            };
        }

        function viewportChanged() {
            if (overlay.hidden) return;
            const viewport = global.visualViewport;
            overlay.style.top = `${viewport ? viewport.offsetTop : 0}px`;
            overlay.style.height = `${viewport ? viewport.height : innerHeight}px`;
            reveal();
            drawHandles();
        }

        function reveal() {
            cancelAnimationFrame(revealFrame);
            revealFrame = requestAnimationFrame(() => {
                if (overlay.hidden || drag || tableDragging) return;
                let rect = null;
                if (active() && (document.activeElement === rich || rich.contains(document.activeElement))) {
                    const view = getEditor().view;
                    // Reading/reviewing an existing range must not jump to its far end.
                    if (!view.state.selection.empty) return;
                    try { rect = view.coordsAtPos(view.state.selection.head); } catch (_) { return; }
                } else if (document.activeElement === textarea && !textarea.hidden) {
                    rect = textareaCaret();
                } else if (document.activeElement === title) {
                    rect = title.getBoundingClientRect();
                }
                if (!rect) return;
                const area = bounds();
                if (rect.bottom > area.bottom) scroll.scrollTop += rect.bottom - area.bottom;
                else if (rect.top < area.top) scroll.scrollTop -= area.top - rect.top;
                drawHandles();
            });
        }

        function textareaCaret() {
            // A mirror measures wrapped source lines without modifying the textarea
            // or its selection/IME composition. The textarea retains native scrolling.
            const mirror = document.createElement('div');
            const style = getComputedStyle(textarea);
            for (const key of ['font', 'lineHeight', 'letterSpacing', 'padding', 'border', 'boxSizing', 'wordBreak', 'tabSize']) {
                mirror.style[key] = style[key];
            }
            Object.assign(mirror.style, {position: 'fixed', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', width: `${textarea.clientWidth}px`});
            mirror.textContent = textarea.value.slice(0, textarea.selectionEnd);
            const marker = document.createElement('span');
            marker.textContent = '\u200b';
            mirror.appendChild(marker);
            document.body.appendChild(mirror);
            const y = marker.offsetTop;
            const lineHeight = parseFloat(style.lineHeight) || 24;
            if (y < textarea.scrollTop) textarea.scrollTop = y;
            else if (y + lineHeight > textarea.scrollTop + textarea.clientHeight) textarea.scrollTop = y + lineHeight - textarea.clientHeight;
            const rect = textarea.getBoundingClientRect();
            mirror.remove();
            return {top: rect.top + y - textarea.scrollTop, bottom: rect.top + y - textarea.scrollTop + lineHeight};
        }

        function validDOMSelection(selection) {
            return selection && selection.rangeCount && rich.contains(selection.anchorNode) && rich.contains(selection.focusNode);
        }

        function remember() {
            if (!active()) return;
            const selection = global.getSelection();
            if (!validDOMSelection(selection)) return;
            const view = getEditor().view;
            try {
                lastSelection = {
                    anchor: view.posAtDOM(selection.anchorNode, selection.anchorOffset),
                    head: view.posAtDOM(selection.focusNode, selection.focusOffset)
                };
            } catch (_) { /* Ignore an intermediate browser DOM mutation. */ }
        }

        function guardSelection() {
            if (!active() || restoring || tableDragging) return;
            const selection = global.getSelection();
            if (validDOMSelection(selection)) {
                remember();
                drawHandles();
                return;
            }
            // Do not steal a title, source or link input selection. A range that
            // crosses the editor boundary is always restored, even if focus moved.
            const crosses = selection && (rich.contains(selection.anchorNode) || rich.contains(selection.focusNode));
            if (!lastSelection || (!crosses && document.activeElement !== rich)) return;
            restoring = true;
            getEditor().select(lastSelection.anchor, lastSelection.head);
            getEditor().focus();
            restoring = false;
        }

        function selectionChanged() {
            if (!active()) return;
            if (validDOMSelection(global.getSelection())) {
                const selection = getEditor().view.state.selection;
                lastSelection = {anchor: selection.anchor, head: selection.head};
            }
            drawHandles();
        }

        function changed() {
            if (active()) {
                const selection = getEditor().view.state.selection;
                lastSelection = {anchor: selection.anchor, head: selection.head};
            }
            reveal();
            drawHandles();
        }

        function drawHandles() {
            handles.hidden = !selectionMode || !active() || tableDragging;
            if (handles.hidden) return;
            const area = bounds();
            const view = getEditor().view;
            for (const button of handleButtons) {
                const end = button.dataset.selectionEnd;
                button.hidden = selectionMode === 'cursor' && end === 'anchor';
                if (button.hidden) continue;
                try {
                    const rect = view.coordsAtPos(view.state.selection[end]);
                    button.hidden = rect.bottom < area.top || rect.bottom > area.bottom;
                    // Never clamp an off-screen stationary endpoint to the edge.
                    // Its handle disappears until the original position reappears.
                    button.style.left = `${Math.min(area.right, Math.max(area.left, rect.left))}px`;
                    button.style.top = `${rect.bottom}px`;
                } catch (_) { button.hidden = true; }
            }
        }

        function beginHandle(event, end) {
            if (!active() || event.button !== 0) return;
            event.preventDefault();
            const selection = getEditor().view.state.selection;
            drag = {kind: 'handle', id: event.pointerId, end,
                anchor: selection.anchor, head: selection.head, x: event.clientX, y: event.clientY};
            event.currentTarget.setPointerCapture(event.pointerId);
            dragFrame = requestAnimationFrame(dragTick);
        }

        function moveHandle(event) {
            if (!drag || drag.kind !== 'handle' || drag.id !== event.pointerId) return;
            event.preventDefault();
            drag.x = event.clientX;
            drag.y = event.clientY - 12;
            moveActiveEnd();
        }

        function moveActiveEnd() {
            if (!drag || !active()) return;
            const area = bounds();
            const view = getEditor().view;
            const coords = {left: Math.max(area.left, Math.min(area.right, drag.x)), top: Math.max(area.top + 1, Math.min(area.bottom - 1, drag.y))};
            const hit = view.posAtCoords(coords);
            if (!hit) return;
            // posAtCoords resolves only within this editor's model. The opposite
            // endpoint is the original document position, regardless of scrolling.
            if (selectionMode === 'cursor' && drag.kind === 'handle') getEditor().select(hit.pos, hit.pos);
            else if (drag.end === 'anchor') getEditor().select(hit.pos, drag.head);
            else getEditor().select(drag.anchor, hit.pos);
            drawHandles();
        }

        function dragTick() {
            if (!drag || !active()) return;
            const area = bounds();
            const edge = Math.min(52, (area.bottom - area.top) / 4);
            let speed = 0;
            if (drag.y < area.top + edge) speed = -Math.min(14, (area.top + edge - drag.y) / edge * 14);
            else if (drag.y > area.bottom - edge) speed = Math.min(14, (drag.y - area.bottom + edge) / edge * 14);
            if (speed) {
                const before = scroll.scrollTop;
                scroll.scrollTop += speed;
                if (scroll.scrollTop !== before) moveActiveEnd();
            }
            dragFrame = requestAnimationFrame(dragTick);
        }

        function stopDrag() {
            drag = null;
            cancelAnimationFrame(dragFrame);
            drawHandles();
        }

        function resetSelection() {
            stopDrag();
            selectionMode = '';
            lastSelection = null;
            handles.hidden = true;
        }

        function toggleSelection(mode = 'range') {
            if (!active()) return;
            stopDrag();
            selectionMode = selectionMode === mode ? '' : mode;
            const editor = getEditor();
            editor.focus();
            const selection = editor.view.state.selection;
            if (selectionMode === 'cursor') editor.select(selection.head, selection.head);
            else if (selectionMode === 'range' && selection.empty) {
                const pos = selection.head;
                const end = selection.$head.end();
                editor.select(pos, pos < end ? pos + 1 : Math.max(selection.$head.start(), pos - 1));
            }
            drawHandles();
        }

        rich.addEventListener('pointerdown', event => {
            if (event.pointerType !== 'mouse' || event.button !== 0 || !active() || tableDragging) return;
            if (event.target.closest('input, button, img, [contenteditable="false"]')) return;
            const hit = getEditor().view.posAtCoords({left: event.clientX, top: event.clientY});
            if (!hit) return;
            // Native mouse selection remains in charge until a drag reaches an edge.
            drag = {kind: 'mouse', pending: true, startX: event.clientX, startY: event.clientY,
                id: event.pointerId, end: 'head', anchor: event.shiftKey ? getEditor().view.state.selection.anchor : hit.pos, x: event.clientX, y: event.clientY};
        });
        document.addEventListener('pointermove', event => {
            if (!drag || drag.kind !== 'mouse' || event.pointerId !== drag.id) return;
            drag.x = event.clientX;
            drag.y = event.clientY;
            if (drag.pending && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 5) {
                drag.pending = false;
                dragFrame = requestAnimationFrame(dragTick);
            }
        });
        rich.addEventListener('dragstart', stopDrag);
        rich.addEventListener('notedown-table-drag', event => {
            tableDragging = Boolean(event.detail?.active);
            stopDrag();
            if (!tableDragging) selectionChanged();
        });
        document.addEventListener('pointerup', stopDrag);
        document.addEventListener('pointercancel', stopDrag);
        document.addEventListener('selectionchange', guardSelection);
        rich.addEventListener('compositionend', reveal);
        rich.addEventListener('input', reveal);
        textarea.addEventListener('input', reveal);
        textarea.addEventListener('keyup', reveal);
        overlay.addEventListener('focusin', reveal);
        scroll.addEventListener('scroll', drawHandles, {passive: true});
        global.addEventListener('resize', viewportChanged);
        global.addEventListener('blur', stopDrag);
        if (global.visualViewport) {
            global.visualViewport.addEventListener('resize', viewportChanged);
            global.visualViewport.addEventListener('scroll', viewportChanged);
        }
        return {
            reveal, changed, selectionChanged, toggleSelection, resetSelection,
            get selecting() { return selectionMode === 'range'; },
            get cursorMode() { return selectionMode === 'cursor'; },
            open() { resetSelection(); scroll.scrollTop = 0; viewportChanged(); },
            close() { resetSelection(); cancelAnimationFrame(revealFrame); overlay.style.removeProperty('height'); overlay.style.removeProperty('top'); }
        };
    }
    global.NoteEditorMobile = {create};
})(window);
