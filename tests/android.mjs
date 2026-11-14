/* Opt-in integration checks against an installed .qa APK on a real Android
 * runtime. Never clears or edits the user's production application data.
 * Select Fcitx5 0.1.3 with its English soft keyboard at 1440×2560 / 360dpi.
 * See docs/android-validation.md. Soft-key coordinates are profile-specific.
 */
import {_android as android} from 'playwright-core';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const adbPath = process.env.ADB_PATH;
assert.ok(adbPath, 'Set ADB_PATH to the emulator/device adb executable');
const serial = process.env.ANDROID_SERIAL || '127.0.0.1:16384';
const pkg = 'io.github.kaminosora.notedown.qa';
const output = path.resolve(process.env.ANDROID_TEST_OUTPUT || '.test-artifacts/android15');
fs.mkdirSync(output, {recursive: true});
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], {maxBuffer: 12 * 1024 * 1024});
const shell = (...args) => adb('shell', ...args).toString().trim();
const originalRotation = shell('settings', 'get', 'system', 'user_rotation');
const originalAutoRotation = shell('settings', 'get', 'system', 'accelerometer_rotation');
const results = [];
let page;
let device;
let webOrigin = {x: 0, y: 0};
let baseHeight;
const errors = [];

async function pause(ms = 180) { await page.waitForTimeout(ms); }
async function screenshot(name) { fs.writeFileSync(path.join(output, `${name}.png`), adb('exec-out', 'screencap', '-p')); }
async function test(name, fn) {
    if (process.env.ANDROID_TEST_FILTER && !new RegExp(process.env.ANDROID_TEST_FILTER).test(name)) return;
    try {
        await fn();
        assert.deepEqual(errors.splice(0), []);
        results.push({name, passed: true});
        console.log(`PASS ${name}`);
    } catch (error) {
        results.push({name, passed: false, error: error.stack});
        console.error(`FAIL ${name}: ${error.message}`);
        await screenshot(`failure-${results.length}`);
    }
}
async function select(start, end = start, {caret = false, reverse = false} = {}) {
    await page.evaluate(({start, end, caret, reverse}) => {
        const rich = document.getElementById('editor-rich');
        const walker = document.createTreeWalker(rich, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        const a = nodes.find(n => n.textContent.includes(start));
        const b = nodes.find(n => n.textContent.includes(end));
        if (!a || !b) throw new Error(`Missing fixture text: ${start}, ${end}`);
        const from = a.textContent.indexOf(start) + (caret ? start.length : 0);
        const to = b.textContent.indexOf(end) + end.length;
        rich.focus({preventScroll: true});
        getSelection().setBaseAndExtent(reverse ? b : a, reverse ? to : from, reverse ? a : b, reverse ? from : to);
    }, {start, end, caret, reverse});
    await pause();
}
async function selection() {
    return page.evaluate(() => {
        const s = __editor.view.state.selection;
        const dom = getSelection();
        const rich = document.getElementById('editor-rich');
        return {anchor: s.anchor, head: s.head, text: dom.toString(), inside: rich.contains(dom.anchorNode) && rich.contains(dom.focusNode)};
    });
}
async function tool(action) {
    await page.locator(`[data-rich-action="${action}"]`).click();
    await pause();
}
async function discardFixture() {
    if (!await page.locator('#editor-overlay').isVisible()) return;
    await page.locator('#editor-cancel').click();
    if (await page.locator('#confirm-dialog').isVisible()) {
        assert.match(await page.locator('#confirm-title').innerText(), /放弃未保存的修改/);
        await page.locator('#confirm-ok').click();
    }
    await page.locator('#editor-overlay').waitFor({state: 'hidden'});
}
async function fixture(html) {
    await discardFixture();
    if (await page.locator('#note-screen').isVisible()) await page.locator('#back-button').click();
    await page.locator('#new-note-fab').click();
    await page.locator('[data-editor-mode="html"]').click();
    await page.locator('#editor-title').fill('MuMu Android 15 验收');
    await page.locator('#editor-textarea').fill(html);
    await page.locator('[data-editor-mode="rich"]').click();
    await pause();
}
async function refreshWebOrigin() {
    // MuMu's uiautomator can return 139 after successfully writing the XML.
    spawnSync(adbPath, ['-s', serial, 'shell', 'uiautomator', 'dump', '/sdcard/notedown-qa-ui.xml']);
    const xml = shell('cat', '/sdcard/notedown-qa-ui.xml');
    const match = xml.match(/class="android.webkit.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    assert.ok(match, 'Native WebView bounds available');
    webOrigin = {x: +match[1], y: +match[2]};
}
async function nativeTap(cssX, cssY) {
    const dpr = await page.evaluate(() => devicePixelRatio);
    shell('input', 'tap', String(Math.round(webOrigin.x + cssX * dpr)), String(Math.round(webOrigin.y + cssY * dpr)));
    await pause(350);
}
async function nativeSwipe(from, to, duration = 1000) {
    const dpr = await page.evaluate(() => devicePixelRatio);
    shell('input', 'touchscreen', 'swipe',
        String(Math.round(webOrigin.x + from.x * dpr)), String(Math.round(webOrigin.y + from.y * dpr)),
        String(Math.round(webOrigin.x + to.x * dpr)), String(Math.round(webOrigin.y + to.y * dpr)), String(duration));
    await pause(250);
}
async function softTypeNative() {
    // Fcitx5 0.1.3 English layout at MuMu's 1440×2560 / 360dpi.
    // ADB `input text` is a physical-key event: this IME intentionally hides
    // its virtual keyboard on physical input, so tap the visible soft keys.
    assert.ok(shell('wm', 'size').includes('1440x2560'));
    for (const [x, y] of [[1008, 2266], [144, 2075], [648, 1878], [1080, 1878], [720, 2266], [360, 1878]]) {
        shell('input', 'tap', String(x), String(y));
        await pause(80);
    }
}
async function caretMetrics() {
    return page.evaluate(() => {
        const view = __editor.view;
        const rect = view.coordsAtPos(view.state.selection.head);
        const bar = document.getElementById('rich-toolbar').getBoundingClientRect();
        const scroll = document.querySelector('.editor-scroll');
        return {top: rect.top, bottom: rect.bottom, height: innerHeight, visualHeight: visualViewport.height,
            barBottom: bar.bottom, scrollTop: scroll.scrollTop, overlayBottom: document.getElementById('editor-overlay').getBoundingClientRect().bottom};
    });
}

async function showKeyboardAtCaret() {
    await page.evaluate(() => __editor.focus());
    await pause(250);
    const point = await page.evaluate(() => {
        const r = __editor.view.coordsAtPos(__editor.view.state.selection.head);
        return {x: r.left, y: (r.top + r.bottom) / 2};
    });
    await nativeTap(point.x, point.y);
    await pause(650);
    assert.ok((await page.evaluate(() => innerHeight)) < baseHeight - 100, 'A real nonzero-height keyboard must be visible');
}

try {
    shell('settings', 'put', 'system', 'accelerometer_rotation', '0');
    shell('settings', 'put', 'system', 'user_rotation', '0');
    shell('am', 'force-stop', pkg);
    shell('am', 'start', '-W', '-n', `${pkg}/io.github.kaminosora.notedown.MainActivity`);
    device = (await android.devices()).find(item => item.serial() === serial);
    assert.ok(device, 'ADB device connected');
    page = await (await device.webView({pkg})).page();
    page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(() => {
        const create = NoteRichEditor.create;
        NoteRichEditor.create = (...args) => window.__editor = create(...args);
    });
    await discardFixture();
    await pause(500);
    baseHeight = await page.evaluate(() => innerHeight);
    await refreshWebOrigin();
    const metadata = {
        android: shell('getprop', 'ro.build.version.release'), api: shell('getprop', 'ro.build.version.sdk'),
        model: shell('getprop', 'ro.product.model'), ime: shell('settings', 'get', 'secure', 'default_input_method'),
        webview: shell('dumpsys', 'webviewupdate').split('\n').find(line => line.includes('Current WebView package'))?.trim(),
        screen: shell('wm', 'size'), density: shell('wm', 'density')
    };
    fs.writeFileSync(path.join(output, 'metadata.json'), JSON.stringify(metadata, null, 2));

    await test('native keyboard resizes WebView and keeps title visible', async () => {
        await fixture('<p>Native IME test</p>');
        await page.locator('#editor-title').click();
        await pause(700);
        const dimensions = await page.evaluate(() => ({height: innerHeight, vv: visualViewport.height, title: document.getElementById('editor-title').getBoundingClientRect().bottom}));
        assert.ok(dimensions.height < baseHeight - 100, JSON.stringify({baseHeight, dimensions}));
        assert.ok(Math.abs(dimensions.height - dimensions.vv) < 2, 'No double keyboard inset');
        assert.ok(dimensions.title < dimensions.height);
        await screenshot('native-keyboard-title');
    });
    await test('native text input at long-document end stays above the keyboard', async () => {
        await fixture(Array.from({length: 70}, (_, i) => `<p>line ${String(i).padStart(2, '0')} native editor content</p>`).join(''));
        await select('line 69 native editor content', undefined, {caret: true});
        await showKeyboardAtCaret();
        await select('line 69 native editor content', undefined, {caret: true});
        await softTypeNative();
        await pause(600);
        const metrics = await caretMetrics();
        assert.ok(metrics.bottom < metrics.height - 5, JSON.stringify(metrics));
        assert.ok(metrics.top > metrics.barBottom, JSON.stringify(metrics));
        assert.ok(metrics.scrollTop > 1000);
        assert.ok((await page.locator('#editor-rich').innerText()).trimEnd().endsWith('native'));
        assert.ok(metrics.height < baseHeight - 100, 'Soft keyboard remains visible during typing');
        const seam = await page.evaluate(() => ({bar: document.getElementById('rich-toolbar').getBoundingClientRect().top,
            scroll: document.querySelector('.editor-scroll').getBoundingClientRect().top}));
        assert.ok(Math.abs(seam.bar - seam.scroll) <= 1, JSON.stringify(seam));
        await screenshot('native-keyboard-long-note');
    });
    await test('keyboard hide/show cycles do not accumulate inset or lose the draft', async () => {
        const before = await page.evaluate(() => __editor.getHTML());
        await showKeyboardAtCaret();
        const visible = await page.evaluate(() => innerHeight);
        for (let i = 0; i < 3; i++) {
            shell('input', 'keyevent', '4');
            await pause(400);
            assert.equal(await page.locator('#editor-overlay').isVisible(), true, 'Back hides IME before closing editor');
            const height = await page.evaluate(() => innerHeight);
            assert.ok(height > visible + 100, `${height} / ${visible}`);
            await showKeyboardAtCaret();
            assert.ok(Math.abs((await page.evaluate(() => innerHeight)) - visible) < 3);
        }
        assert.equal(await page.evaluate(() => __editor.getHTML()), before);
    });
    await test('formatting, tasks, code, table and block operations work in WebView 110', async () => {
        await fixture('<p>alpha beta gamma</p><p>second row</p><p>third row</p>');
        await select('beta'); await tool('bold');
        assert.equal(await page.locator('#editor-rich strong').innerText(), 'beta');
        await tool('undo'); assert.equal(await page.locator('#editor-rich strong').count(), 0);
        await select('second row', 'third row'); await tool('task-list');
        assert.equal(await page.locator('#editor-rich li[data-task="true"]').count(), 2);
        await page.locator('#editor-rich .nt-checkbox:visible').first().click();
        assert.equal(await page.locator('#editor-rich li[data-checked="true"]').count(), 1);
        await select('alpha'); await tool('code-block');
        assert.equal(await page.locator('#editor-rich pre code').count(), 1);
        const beforeMove = await page.locator('#editor-rich > *').evaluateAll(nodes => nodes.map(n => n.tagName));
        await tool('block-down');
        const afterMove = await page.locator('#editor-rich > *').evaluateAll(nodes => nodes.map(n => n.tagName));
        assert.equal(afterMove.indexOf('PRE'), beforeMove.indexOf('PRE') + 1, JSON.stringify({beforeMove, afterMove}));
        await tool('block-after'); await tool('table');
        const cell = page.locator('#editor-rich th p').first();
        await cell.click(); await tool('add-row'); await tool('add-column');
        assert.equal(await page.locator('#editor-rich tr').count(), 4);
        assert.equal(await page.locator('#editor-rich tr').first().locator('th').count(), 4);
        await tool('delete-table'); assert.equal(await page.locator('#editor-rich table').count(), 0);
        await tool('undo'); assert.equal(await page.locator('#editor-rich table').count(), 1);
    });
    await test('native handle swipes edge-scroll while the opposite endpoint stays fixed', async () => {
        await fixture(Array.from({length: 80}, (_, i) => `<p>selection ${String(i).padStart(2, '0')} native range</p>`).join(''));
        await select('selection 00 native range'); await tool('select-mode');
        const before = await selection();
        const handle = await page.locator('[data-selection-end="head"]').boundingBox();
        const scroll = await page.locator('.editor-scroll').boundingBox();
        await nativeSwipe({x: handle.x + handle.width / 2, y: handle.y + handle.height / 2},
            {x: scroll.x + scroll.width / 2, y: scroll.y + scroll.height - 2}, 1800);
        const after = await selection();
        assert.equal(after.anchor, before.anchor);
        assert.ok(after.head > before.head + 100, JSON.stringify({before, after}));
        assert.equal(after.inside, true);
        const stopped = await page.evaluate(() => document.querySelector('.editor-scroll').scrollTop);
        await pause(300);
        assert.equal(await page.evaluate(() => document.querySelector('.editor-scroll').scrollTop), stopped);
        await screenshot('native-selection-edge');
    });
    await test('forward/reverse ranges remain stable across real WebView scrolling', async () => {
        for (const reverse of [false, true]) {
            await select('selection 05 native range', 'selection 70 native range', {reverse});
            const before = await selection();
            for (const ratio of [0.5, 0, 1]) {
                await page.evaluate(ratio => { const s = document.querySelector('.editor-scroll'); s.scrollTop = s.scrollHeight * ratio; }, ratio);
                await pause(200);
                assert.deepEqual(await selection(), before);
            }
        }
    });
    await test('native cursor handle remains collapsed during edge scrolling', async () => {
        await select('selection 00 native range', undefined, {caret: true});
        await tool('cursor-mode');
        await pause(250);
        const handle = await page.locator('[data-selection-end="head"]').boundingBox();
        const scroll = await page.locator('.editor-scroll').boundingBox();
        assert.ok(handle);
        await nativeSwipe({x: handle.x + handle.width / 2, y: handle.y + handle.height / 2},
            {x: scroll.x + scroll.width / 2, y: scroll.y + scroll.height - 2}, 1600);
        const after = await selection();
        assert.equal(after.anchor, after.head);
        assert.ok(after.head > 100);
        assert.equal(after.inside, true);
    });
    await test('landscape keyboard resize retains text and visible caret', async () => {
        await select('selection 79 native range', undefined, {caret: true});
        await showKeyboardAtCaret();
        await select('selection 79 native range', undefined, {caret: true});
        const before = await page.evaluate(() => __editor.getHTML());
        shell('settings', 'put', 'system', 'user_rotation', '1');
        await pause(800);
        const m = await caretMetrics();
        assert.ok(m.bottom <= m.height - 5 && m.top >= m.barBottom, JSON.stringify(m));
        assert.ok(m.height < 500, 'Landscape keyboard still occupies native window space');
        assert.equal(await page.evaluate(() => __editor.getHTML()), before);
        await screenshot('native-keyboard-landscape');
        shell('settings', 'put', 'system', 'user_rotation', '0');
        await pause(600);
    });
    await test('Markdown/HTML conversion and native AtomicFile save reopen preserve content', async () => {
        await fixture('<h2>安卓验收</h2><p>保存正文</p><ul><li data-task="true" data-checked="true"><p>完成项目</p></li></ul><pre><code class="language-js">first\n\n\nlast\n</code></pre>');
        const before = await page.locator('#editor-rich pre code').textContent();
        await page.locator('[data-editor-mode="markdown"]').click();
        await page.locator('[data-editor-mode="html"]').click();
        await page.locator('[data-editor-mode="rich"]').click();
        assert.equal(await page.locator('#editor-rich pre code').textContent(), before);
        await page.locator('#editor-save').click(); await pause();
        assert.equal(await page.locator('#note-content li[data-checked="true"]').count(), 1);
        const persisted = JSON.parse(adb('exec-out', 'run-as', pkg, 'cat', 'files/notes.json'));
        assert.ok(persisted.notes.some(n => n.html.includes('保存正文')));
        await page.locator('#edit-note-button').click();
        assert.equal(await page.locator('#editor-rich pre code').textContent(), before);
    });
} finally {
    shell('settings', 'put', 'system', 'user_rotation', originalRotation);
    shell('settings', 'put', 'system', 'accelerometer_rotation', originalAutoRotation);
    if (device) await device.close();
    const report = {passed: results.filter(x => x.passed).length, failed: results.filter(x => !x.passed).length, results,
        scope: 'Installed APK on MuMu Android 15; native ADB touches, real IME/window insets, WebView DOM assertions. Physical-device/OEM diversity remains untested.'};
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({passed: report.passed, failed: report.failed}));
    if (report.failed) process.exitCode = 1;
}
