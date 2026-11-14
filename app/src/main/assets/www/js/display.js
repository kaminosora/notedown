(function (global) {
    'use strict';
    // Use the browser viewport rather than a CSS transform: the layout, native
    // selection and ProseMirror hit-testing keep the same CSS coordinate space.
    function normalize(value) {
        if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return 100;
        const number = Number(value);
        return Number.isFinite(number) ? Math.round(Math.max(60, Math.min(150, number)) / 5) * 5 : 100;
    }
    let appliedPercent = 100;
    let viewportFrame = 0;
    function updateViewport() {
        const scale = appliedPercent / 100;
        const viewport = document.querySelector('meta[name="viewport"]');
        if (!viewport) return;
        // With width=device-width, scales above 1 leave normal-flow content at
        // the original device width while the visual viewport gets narrower.
        // The visual viewport's own width × current scale is the actual host
        // width, independent of our requested scale, including split windows
        // and native insets. Do not derive this from innerWidth or screen.width.
        const visual = global.visualViewport;
        const hostWidth = visual && visual.width > 0 && visual.scale > 0
            ? Math.round(visual.width * visual.scale)
            : document.documentElement.clientWidth;
        const width = hostWidth > 0 ? Math.max(1, Math.round(hostWidth / scale)) : 'device-width';
        const content = `width=${width}, initial-scale=${scale}, minimum-scale=${scale}, maximum-scale=${scale}, viewport-fit=cover`;
        // A width change can itself emit resize. Coalescing and equality checks
        // prevent resize feedback; keyboard height-only changes make no write.
        if (viewport.content !== content) viewport.content = content;
    }
    function scheduleViewport() {
        if (viewportFrame) return;
        viewportFrame = requestAnimationFrame(() => { viewportFrame = 0; updateViewport(); });
    }
    global.addEventListener('resize', scheduleViewport, {passive: true});
    if (global.visualViewport) global.visualViewport.addEventListener('resize', scheduleViewport, {passive: true});
    function apply(value) {
        const percent = normalize(value);
        appliedPercent = percent;
        document.documentElement.dataset.displayScale = String(percent);
        updateViewport();
        scheduleViewport();
        global.dispatchEvent(new CustomEvent('notedown-display-change', {detail: {percent}}));
    }
    function create({store, onLayerChange, toast}) {
        let previous = 100, lastFocus = null;
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop display-backdrop'; backdrop.hidden = true;
        const panel = document.createElement('section');
        panel.id = 'display-dialog'; panel.className = 'dialog display-dialog'; panel.hidden = true;
        panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'display-title');
        panel.innerHTML = `<form id="display-form">
          <p class="kicker">Display</p><h2 id="display-title">显示比例</h2>
          <p class="dialog-copy">缩小后可显示更多内容，放大后更易阅读。只影响 Notedown，不修改手机系统设置。</p>
          <div class="display-scale-controls"><button id="display-minus" class="button button-outline" type="button" aria-label="缩小 5%">−</button>
            <output id="display-value" for="display-scale">100%</output><button id="display-plus" class="button button-outline" type="button" aria-label="放大 5%">+</button></div>
          <input id="display-scale" type="range" min="60" max="150" step="5" value="100" aria-label="应用显示比例">
          <div class="display-presets"><button type="button" data-display-preset="65">65% · 更多内容</button><button type="button" data-display-preset="80">80% · 紧凑</button><button type="button" data-display-preset="100">100% · 默认</button><button type="button" data-display-preset="125">125% · 大字</button></div>
          <p class="display-browser-hint" hidden>桌面浏览器请使用浏览器菜单中的缩放；此偏好在移动设备中生效。</p>
          <div class="dialog-actions"><button id="display-reset" class="text-button" type="button">恢复默认</button><button id="display-cancel" class="button button-outline" type="button">取消</button><button id="display-save" class="button button-primary" type="submit">保存</button></div>
        </form>`;
        document.body.append(backdrop, panel);
        const slider = panel.querySelector('#display-scale');
        const value = panel.querySelector('#display-value');
        const minus = panel.querySelector('#display-minus'), plus = panel.querySelector('#display-plus');
        panel.querySelector('.display-browser-hint').hidden = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
        function sync() {
            value.value = `${slider.value}%`; value.textContent = value.value;
            slider.setAttribute('aria-valuetext', value.value);
            minus.disabled = Number(slider.value) <= 60; plus.disabled = Number(slider.value) >= 150;
            panel.querySelectorAll('[data-display-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.displayPreset === slider.value)));
        }
        function preview(next) { slider.value = normalize(next); sync(); apply(slider.value); }
        // Changing the coordinate system while dragging the slider makes its
        // thumb jump. Show the number live, then apply when the pointer releases.
        slider.addEventListener('input', sync);
        slider.addEventListener('change', () => preview(slider.value));
        minus.addEventListener('click', () => preview(Number(slider.value) - 5));
        plus.addEventListener('click', () => preview(Number(slider.value) + 5));
        panel.querySelectorAll('[data-display-preset]').forEach(button => button.addEventListener('click', () => preview(button.dataset.displayPreset)));
        panel.querySelector('#display-reset').addEventListener('click', () => preview(100));
        panel.querySelector('#display-cancel').addEventListener('click', () => close());
        backdrop.addEventListener('click', () => close());
        panel.querySelector('form').addEventListener('submit', event => {
            event.preventDefault();
            if (!store.setDisplayScale(Number(slider.value))) {
                preview(previous);
                toast('显示比例未保存，请重试');
                return;
            }
            previous = normalize(store.getPrefs().displayScale);
            close();
        });
        panel.addEventListener('keydown', event => {
            if (event.key !== 'Tab') return;
            const targets = Array.from(panel.querySelectorAll('button, input')).filter(el => !el.disabled);
            const first = targets[0], last = targets[targets.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        });
        function open() {
            previous = normalize(store.getPrefs().displayScale);
            lastFocus = document.activeElement;
            slider.value = previous; sync();
            panel.hidden = false; backdrop.hidden = false;
            onLayerChange();
            requestAnimationFrame(() => slider.focus({preventScroll: true}));
        }
        function close() {
            if (panel.hidden) return;
            apply(previous);
            if (panel.contains(document.activeElement)) document.activeElement.blur();
            panel.hidden = true; backdrop.hidden = true;
            onLayerChange();
            if (lastFocus?.isConnected) lastFocus.focus({preventScroll: true});
        }
        return {open, close, get isOpen() { return !panel.hidden; }};
    }
    global.NoteDisplay = {normalize, apply, create};
})(window);
