/*
 * Long-press list reordering.
 *
 * - Works only inside a direct <ul>/<ol>.
 * - Long press (360 ms) lifts the row into a fixed-position ghost.
 * - Other rows are moved with FLIP animations, so the reorder is smooth even
 *   when the finger moves quickly.
 * - Near the top/bottom edge the page auto-scrolls. Speed grows
 *   quadratically as the pointer gets closer to the edge.
 */
(function (global) {
    'use strict';

    const LONG_PRESS_MS = 360;
    const MOVE_CANCEL_PX = 9;
    const MAX_SCROLL_SPEED = 20; // CSS pixels per 60 Hz frame
    const MIN_EDGE_RANGE = 88;
    const MAX_EDGE_RANGE = 150;
    const ANIMATION_MS = 185;

    let container = null;
    let options = {};
    let pending = null;
    let drag = null;
    let indicators = null;
    let suppressClick = null;
    let suppressClickTimer = 0;
    let bound = false;
    let settling = null;

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function prefersReducedMotion() {
        return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function edgeRange() {
        return clamp((global.innerHeight || 800) * 0.18, MIN_EDGE_RANGE, MAX_EDGE_RANGE);
    }

    /**
     * A pure helper used by the UI and by tests. At the edge (distance 0) the
     * speed is maxSpeed; at the boundary of the active range it is zero.
     */
    function autoScrollSpeed(distance, range, maxSpeed) {
        const safeRange = range > 0 ? range : MIN_EDGE_RANGE;
        const safeMax = maxSpeed > 0 ? maxSpeed : MAX_SCROLL_SPEED;
        if (!Number.isFinite(distance) || distance >= safeRange) {
            return 0;
        }
        const proximity = 1 - clamp(distance, 0, safeRange) / safeRange;
        return safeMax * Math.pow(proximity, 1.75);
    }

    function ensureIndicators() {
        if (indicators) {
            return indicators;
        }
        const top = document.createElement('div');
        top.className = 'drag-edge drag-edge-top';
        top.setAttribute('aria-hidden', 'true');
        const bottom = document.createElement('div');
        bottom.className = 'drag-edge drag-edge-bottom';
        bottom.setAttribute('aria-hidden', 'true');
        document.body.append(top, bottom);
        indicators = {top, bottom};
        return indicators;
    }

    function setIndicator(element, opacity) {
        if (!element) {
            return;
        }
        element.style.opacity = opacity > 0.01 ? String(clamp(opacity, 0, 0.9)) : '0';
    }

    function hideIndicators() {
        if (!indicators) {
            return;
        }
        setIndicator(indicators.top, 0);
        setIndicator(indicators.bottom, 0);
    }

    function installClickSuppressor() {
        removeClickSuppressor();
        suppressClick = (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            removeClickSuppressor();
        };
        document.addEventListener('click', suppressClick, true);
        suppressClickTimer = global.setTimeout(removeClickSuppressor, 420);
    }

    function removeClickSuppressor() {
        if (suppressClickTimer) {
            global.clearTimeout(suppressClickTimer);
            suppressClickTimer = 0;
        }
        if (suppressClick) {
            document.removeEventListener('click', suppressClick, true);
            suppressClick = null;
        }
    }

    function isExcludedTarget(target) {
        if (!(target instanceof Element)) {
            return true;
        }
        return Boolean(target.closest(
            'a, button, input, label, select, textarea, summary, table, [contenteditable="true"], .nt-checkbox'
        ));
    }

    function itemFromTarget(target) {
        if (!(target instanceof Element)) {
            return null;
        }
        const item = target.closest('li');
        if (!item || !container.contains(item)) {
            return null;
        }
        const list = item.parentElement;
        if (!list || (list.tagName !== 'UL' && list.tagName !== 'OL')) {
            return null;
        }
        if (list !== container && !container.contains(list)) {
            return null;
        }
        const siblings = Array.from(list.children).filter((child) => child.tagName === 'LI');
        if (siblings.length < 2) {
            return null;
        }
        return item;
    }

    function cancelPending() {
        if (pending) {
            global.clearTimeout(pending.timer);
            pending = null;
        }
    }

    function onPointerDown(event) {
        if (settling) settling();
        if (drag) {
            return;
        }
        if (event.pointerType === 'mouse' && event.button !== 0) {
            return;
        }
        if (event.isPrimary === false) {
            return;
        }
        if (isExcludedTarget(event.target)) {
            return;
        }
        const item = itemFromTarget(event.target);
        if (!item) {
            return;
        }

        cancelPending();
        const pointer = {
            item,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            x: event.clientX,
            y: event.clientY,
            timer: 0
        };
        pending = pointer;
        pointer.timer = global.setTimeout(() => {
            if (pending !== pointer) {
                return;
            }
            pending = null;
            beginDrag(pointer);
        }, LONG_PRESS_MS);
    }

    function onPointerMoveBeforeDrag(event) {
        if (drag) {
            return;
        }
        if (!pending || event.pointerId !== pending.pointerId) {
            return;
        }
        pending.x = event.clientX;
        pending.y = event.clientY;
        const dx = event.clientX - pending.startX;
        const dy = event.clientY - pending.startY;
        if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
            cancelPending();
        }
    }

    function onPointerUpBeforeDrag(event) {
        if (!drag && pending && (!event || event.pointerId === pending.pointerId)) {
            if (event && event.pointerId !== pending.pointerId) {
                return;
            }
            cancelPending();
        }
    }

    function beginDrag(pointer) {
        const item = pointer.item;
        if (!item.isConnected) {
            return;
        }
        const list = item.parentElement;
        if (!list || (list.tagName !== 'UL' && list.tagName !== 'OL')) {
            return;
        }
        const rect = item.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) {
            return;
        }

        const ghost = item.cloneNode(true);
        ghost.removeAttribute('id');
        for (const element of ghost.querySelectorAll('[id]')) {
            element.removeAttribute('id');
        }
        const sourceChecks = item.querySelectorAll('.nt-checkbox');
        const ghostChecks = ghost.querySelectorAll('.nt-checkbox');
        for (let index = 0; index < ghostChecks.length && index < sourceChecks.length; index++) {
            ghostChecks[index].checked = sourceChecks[index].checked;
        }
        ghost.classList.remove('drag-origin', 'is-dragging');
        ghost.classList.add('drag-ghost');
        ghost.style.position = 'fixed';
        ghost.style.left = `${rect.left}px`;
        ghost.style.top = `${rect.top}px`;
        ghost.style.width = `${rect.width}px`;
        ghost.style.height = `${rect.height}px`;
        ghost.style.margin = '0';
        ghost.style.boxSizing = 'border-box';
        ghost.style.listStyle = 'none';
        ghost.style.pointerEvents = 'none';
        ghost.style.overflow = 'hidden';
        ghost.style.willChange = 'transform';
        ghost.style.transform = 'translate3d(0, 0, 0) scale(1.015)';
        container.appendChild(ghost);

        item.classList.add('drag-origin');
        item.setAttribute('aria-grabbed', 'true');
        document.body.classList.add('is-dragging');
        document.addEventListener('touchmove', blockTouchScroll, {passive: false, capture: true});
        document.addEventListener('dragstart', blockDragStart, true);

        drag = {
            pointerId: pointer.pointerId,
            item,
            list,
            ghost,
            baseRect: rect,
            startX: pointer.startX,
            startY: pointer.startY,
            x: pointer.x,
            y: pointer.y,
            orderChanged: false,
            raf: 0,
            lastFrame: 0,
            touchMoveHandler: blockTouchScroll
        };

        try {
            container.setPointerCapture(pointer.pointerId);
        } catch (error) {
            // Pointer capture is a convenience, not a requirement.
        }

        if (typeof options.onHaptic === 'function') {
            options.onHaptic();
        }
        moveGhost(drag.x, drag.y);
        updateDropTarget();
        drag.lastFrame = performance.now();
        drag.raf = global.requestAnimationFrame(autoScrollFrame);
    }

    function blockTouchScroll(event) {
        if (drag) {
            event.preventDefault();
        }
    }

    function blockDragStart(event) {
        if (drag) {
            event.preventDefault();
        }
    }

    function moveGhost(x, y) {
        if (!drag || !drag.ghost) {
            return;
        }
        const dx = x - drag.startX;
        const dy = y - drag.startY;
        drag.ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.015)`;
    }

    function onPointerMove(event) {
        if (!drag || event.pointerId !== drag.pointerId) {
            return;
        }
        if (event.cancelable) {
            event.preventDefault();
        }
        drag.x = event.clientX;
        drag.y = event.clientY;
        moveGhost(drag.x, drag.y);
        updateDropTarget();
    }

    function onPointerUp(event) {
        if (!drag || (event && event.pointerId !== drag.pointerId)) {
            return;
        }
        finishDrag();
    }

    function onPointerCancel(event) {
        if (!drag || (event && event.pointerId !== drag.pointerId)) {
            return;
        }
        finishDrag();
    }

    function cancelCurrent() {
        if (drag) {
            finishDrag(true);
        }
        if (settling) settling();
        cancelPending();
    }

    function finishDrag(immediate) {
        if (!drag) {
            return;
        }
        const current = drag;
        drag = null;

        // The browser emits a click right after pointerup. Install the
        // suppressor synchronously, before the settle animation finishes, so
        // a long press never also toggles strike-through or opens a link.
        installClickSuppressor();

        if (current.raf) {
            global.cancelAnimationFrame(current.raf);
        }
        hideIndicators();
        document.removeEventListener('touchmove', blockTouchScroll, {capture: true});
        document.removeEventListener('dragstart', blockDragStart, true);
        document.body.classList.remove('is-dragging');
        try {
            container.releasePointerCapture(current.pointerId);
        } catch (error) {
            // Ignore an already released pointer.
        }

        const itemRect = current.item.getBoundingClientRect();
        const targetX = itemRect.left - current.baseRect.left;
        const targetY = itemRect.top - current.baseRect.top;
        const currentTransform = current.ghost.style.transform;
        const targetTransform = `translate3d(${targetX}px, ${targetY}px, 0) scale(1)`;

        const cleanup = () => {
            if (current.ghost && current.ghost.isConnected) {
                current.ghost.remove();
            }
            current.item.classList.remove('drag-origin');
            current.item.removeAttribute('aria-grabbed');
            if (current.orderChanged && typeof options.onCommit === 'function') {
                options.onCommit();
            }
        };

        if (immediate || prefersReducedMotion() || typeof current.ghost.animate !== 'function') {
            cleanup();
            return;
        }

        let settled = false;
        const settle = () => {
            if (settled) {
                return;
            }
            settled = true;
            if (settling === settle) settling = null;
            cleanup();
        };
        // Navigation or a new gesture must finish the old save while its note
        // is still current, rather than committing after the settle animation.
        settling = settle;
        try {
            const animation = current.ghost.animate(
                [
                    {transform: currentTransform, offset: 0},
                    {transform: targetTransform, offset: 1}
                ],
                {
                    duration: ANIMATION_MS,
                    easing: 'cubic-bezier(.18,.72,.24,1)'
                }
            );
            animation.addEventListener('finish', settle, {once: true});
            animation.addEventListener('cancel', settle, {once: true});
            global.setTimeout(settle, ANIMATION_MS + 90);
        } catch (error) {
            settle();
        }
    }

    function positionSiblings(before) {
        if (!drag) {
            return;
        }
        for (const sibling of drag.list.children) {
            if (sibling === drag.item || sibling.tagName !== 'LI') {
                continue;
            }
            const oldRect = before.get(sibling);
            if (!oldRect) {
                continue;
            }
            const newRect = sibling.getBoundingClientRect();
            const delta = oldRect.top - newRect.top;
            if (Math.abs(delta) < 0.5) {
                continue;
            }
            if (typeof sibling.animate !== 'function' || prefersReducedMotion()) {
                continue;
            }
            sibling.animate(
                [
                    {transform: `translateY(${delta}px)`},
                    {transform: 'translateY(0)'}
                ],
                {
                    duration: 185,
                    easing: 'cubic-bezier(.2,.75,.25,1)'
                }
            );
        }
    }

    function updateDropTarget() {
        if (!drag) {
            return;
        }
        const siblings = Array.from(drag.list.children)
            .filter((child) => child.tagName === 'LI' && child !== drag.item);
        if (siblings.length === 0) {
            return;
        }

        for (const sibling of drag.list.children) {
            if (sibling.tagName === 'LI' && typeof sibling.getAnimations === 'function') {
                for (const animation of sibling.getAnimations()) {
                    animation.cancel();
                }
            }
        }

        const before = new Map();
        for (const sibling of siblings) {
            before.set(sibling, sibling.getBoundingClientRect());
        }

        let reference = null;
        for (const sibling of siblings) {
            const rect = before.get(sibling);
            if (drag.y < rect.top + rect.height / 2) {
                reference = sibling;
                break;
            }
        }

        const alreadyThere = reference
            ? drag.item.nextElementSibling === reference
            : drag.item.nextElementSibling === null;
        if (alreadyThere) {
            return;
        }

        drag.list.insertBefore(drag.item, reference);
        drag.orderChanged = true;
        positionSiblings(before);
    }

    function autoScrollFrame(timestamp) {
        if (!drag) {
            return;
        }
        const deltaMs = drag.lastFrame ? Math.min(34, timestamp - drag.lastFrame) : 16.67;
        drag.lastFrame = timestamp;

        const range = edgeRange();
        const topDistance = clamp(drag.y, 0, global.innerHeight);
        const bottomDistance = clamp(global.innerHeight - drag.y, 0, global.innerHeight);

        let direction = 0;
        let speed = 0;
        if (topDistance < range && topDistance <= bottomDistance) {
            direction = -1;
            speed = autoScrollSpeed(topDistance, range, MAX_SCROLL_SPEED);
        } else if (bottomDistance < range) {
            direction = 1;
            speed = autoScrollSpeed(bottomDistance, range, MAX_SCROLL_SPEED);
        }

        const scrollingElement = document.scrollingElement || document.documentElement;
        const scrollTop = global.scrollY || scrollingElement.scrollTop || 0;
        const maxScroll = Math.max(0, scrollingElement.scrollHeight - global.innerHeight);
        const canScroll = direction < 0 ? scrollTop > 0.5 : scrollTop < maxScroll - 0.5;

        if (direction !== 0 && speed > 0 && canScroll) {
            const amount = (speed * deltaMs) / 16.667;
            global.scrollBy(0, direction * amount);
            updateDropTarget();

            const proximity = speed / MAX_SCROLL_SPEED;
            const overlay = ensureIndicators();
            setIndicator(direction < 0 ? overlay.top : overlay.bottom, 0.22 + proximity * 0.6);
            setIndicator(direction < 0 ? overlay.bottom : overlay.top, 0);
        } else {
            hideIndicators();
        }

        drag.raf = global.requestAnimationFrame(autoScrollFrame);
    }

    function onContextMenu(event) {
        if (drag || (pending && event.target instanceof Element && event.target.closest('li'))) {
            event.preventDefault();
        }
    }

    function init(element, nextOptions) {
        if (!element) {
            return;
        }
        if (bound) {
            destroy();
        }
        container = element;
        options = nextOptions || {};
        bound = true;
        container.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('pointermove', onPointerMoveBeforeDrag, {passive: true});
        document.addEventListener('pointermove', onPointerMove, {passive: false});
        document.addEventListener('pointerup', handlePointerUp, true);
        document.addEventListener('pointercancel', handlePointerCancel, true);
        document.addEventListener('contextmenu', onContextMenu, true);
        ensureIndicators();
    }

    function handlePointerUp(event) {
        if (drag) {
            onPointerUp(event);
        } else {
            onPointerUpBeforeDrag(event);
        }
    }

    function handlePointerCancel(event) {
        if (drag) {
            onPointerCancel(event);
        } else {
            onPointerUpBeforeDrag(event);
        }
    }

    function destroy() {
        cancelCurrent();
        removeClickSuppressor();
        if (container) {
            container.removeEventListener('pointerdown', onPointerDown);
        }
        document.removeEventListener('pointermove', onPointerMoveBeforeDrag);
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', handlePointerUp, true);
        document.removeEventListener('pointercancel', handlePointerCancel, true);
        document.removeEventListener('contextmenu', onContextMenu, true);
        document.removeEventListener('touchmove', blockTouchScroll, {capture: true});
        document.removeEventListener('dragstart', blockDragStart, true);
        if (indicators) {
            indicators.top.remove();
            indicators.bottom.remove();
            indicators = null;
        }
        container = null;
        bound = false;
    }

    global.NoteDrag = {
        init,
        destroy,
        cancel: cancelCurrent,
        autoScrollSpeed,
        edgeRange
    };
})(window);
