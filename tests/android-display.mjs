// Opt-in QA APK check at a phone-like density and 125% system font size.
// Configure MuMu to 1440x2560 / 560dpi and select Fcitx5 before running.
import {_android as android} from 'playwright-core';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const adbPath = process.env.ADB_PATH;
assert.ok(adbPath, 'Set ADB_PATH');
const serial = process.env.ANDROID_SERIAL || '127.0.0.1:16384';
const pkg = 'io.github.kaminosora.notedown.qa';
const out = '.test-artifacts/v1.3.0/android';
fs.mkdirSync(out, {recursive: true});
const adb = (...a) => execFileSync(adbPath, ['-s', serial, ...a], {maxBuffer: 12 * 1024 * 1024});
const shell = (...a) => adb('shell', ...a).toString().trim();
const results = [];
let page, device, origin;
const pause = (ms = 350) => page.waitForTimeout(ms);
const shot = name => fs.writeFileSync(`${out}/${name}.png`, adb('exec-out', 'screencap', '-p'));
async function test(name, fn) {
    try { await fn(); results.push({name, passed: true}); console.log(`PASS ${name}`); }
    catch (error) { results.push({name, passed: false, error: error.stack}); console.error(`FAIL ${name}: ${error.message}`); shot(`display-failure-${results.length}`); }
}
async function attach() {
    page = await (await device.webView({pkg})).page();
    page.setDefaultTimeout(7000);
    await page.evaluate(() => { const c = NoteRichEditor.create; NoteRichEditor.create = (...a) => window.__editor = c(...a); });
}
async function readOrigin() {
    spawnSync(adbPath, ['-s', serial, 'shell', 'uiautomator', 'dump', '/sdcard/notedown-display-ui.xml']);
    const bounds = shell('cat', '/sdcard/notedown-display-ui.xml').match(/class="android.webkit.WebView"[^>]*bounds="\[(\d+),(\d+)\]/);
    assert.ok(bounds); origin = {x: +bounds[1], y: +bounds[2]};
}
async function fixture(html) {
    if (await page.locator('#editor-overlay').isVisible()) {
        await page.locator('#editor-cancel').click();
        if (await page.locator('#confirm-dialog').isVisible()) await page.locator('#confirm-ok').click();
    }
    if (await page.locator('#note-screen').isVisible()) await page.locator('#back-button').click();
    await page.locator('#new-note-fab').click();
    await page.locator('[data-editor-mode="html"]').click();
    await page.locator('#editor-textarea').fill(html);
    await page.locator('[data-editor-mode="rich"]').click(); await pause(700);
}
async function nativeDrag(source, target) {
    const factor = await page.evaluate(() => devicePixelRatio * visualViewport.scale);
    const a = await source.boundingBox(), b = await target.boundingBox();
    const from = {x: Math.round(origin.x + (a.x + a.width / 2) * factor), y: Math.round(origin.y + (a.y + a.height / 2) * factor)};
    const to = {x: Math.round(origin.x + (b.x + b.width / 2) * factor), y: Math.round(origin.y + (b.y + b.height / 2) * factor)};
    shell('input', 'touchscreen', 'motionevent', 'DOWN', String(from.x), String(from.y)); await pause(650);
    for (let step = 1; step <= 10; step++) {
        shell('input', 'touchscreen', 'motionevent', 'MOVE', String(Math.round(from.x + (to.x - from.x) * step / 10)), String(Math.round(from.y + (to.y - from.y) * step / 10))); await pause(25);
    }
    shell('input', 'touchscreen', 'motionevent', 'UP', String(to.x), String(to.y)); await pause();
}
try {
    shell('am', 'force-stop', pkg); shell('am', 'start', '-W', '-n', `${pkg}/io.github.kaminosora.notedown.MainActivity`);
    device = (await android.devices()).find(d => d.serial() === serial); assert.ok(device);
    await attach(); await readOrigin();
    await test('phone density uses real viewport scaling with cancel, save and restart persistence', async () => {
        await page.locator('#display-settings').click(); await page.locator('#display-reset').click(); await pause();
        const baseWidth = await page.evaluate(() => innerWidth);
        assert.ok(baseWidth >= 400 && baseWidth <= 420, String(baseWidth));
        const samples = [];
        for (const scale of [80, 65, 125, 150, 100]) {
            if (scale === 150) await page.locator('#display-scale').evaluate(el => { el.value = '150'; el.dispatchEvent(new Event('change', {bubbles: true})); });
            else await page.locator(`[data-display-preset="${scale}"]`).click();
            await pause();
            const sample = await page.evaluate(() => ({width: innerWidth, scale: visualViewport.scale, height: innerHeight, layoutWidth: document.documentElement.scrollWidth, headerRight: document.querySelector('.library-header').getBoundingClientRect().right}));
            assert.ok(Math.abs(sample.scale - scale / 100) < .004, JSON.stringify(sample));
            assert.ok(Math.abs(sample.width - baseWidth * 100 / scale) < 2, JSON.stringify(sample));
            assert.ok(sample.layoutWidth <= sample.width + 1 && sample.headerRight <= sample.width + 1, JSON.stringify(sample));
            samples.push({percent: scale, ...sample});
        }
        await page.locator('[data-display-preset="65"]').click(); await pause();
        await page.locator('#display-save').click(); await pause();
        shot('phone-display-65-library');
        // A restarted Android process has a different WebView target. Recreate
        // the Playwright connection so its old target cache is not reused.
        await device.close();
        shell('am', 'force-stop', pkg); shell('am', 'start', '-W', '-n', `${pkg}/io.github.kaminosora.notedown.MainActivity`);
        device = (await android.devices()).find(d => d.serial() === serial);
        await attach(); await pause();
        assert.equal(await page.evaluate(() => NoteStore.getPrefs().displayScale), 65);
        assert.ok(Math.abs((await page.evaluate(() => visualViewport.scale)) - .65) < .004);
        fs.writeFileSync(`${out}/display-metrics.json`, JSON.stringify({density: shell('wm', 'density'), fontScale: shell('settings', 'get', 'system', 'font_scale'), samples}, null, 2));
    });
    await test('scaled phone table row and cell drags hit their intended targets', async () => {
        await fixture('<table><tr><th>A</th><th>B</th></tr><tr><td>C</td><td>D</td></tr><tr><td>E</td><td>F</td></tr></table>');
        await readOrigin();
        const grid = () => page.locator('#editor-rich tr').evaluateAll(rows => rows.map(row => Array.from(row.cells).map(cell => cell.textContent)));
        await nativeDrag(page.locator('[data-table-drag="row"][data-index="0"]'), page.locator('[data-table-drag="row"][data-index="2"]'));
        assert.deepEqual(await grid(), [['C', 'D'], ['E', 'F'], ['A', 'B']]);
        await page.locator('[data-rich-action="undo"]').click(); await pause();
        await nativeDrag(page.locator('#editor-rich th p').first(), page.locator('#editor-rich td p').last());
        assert.deepEqual(await grid(), [['F', 'B'], ['C', 'D'], ['E', 'A']]);
        shot('phone-display-65-table');
    });
    await test('scaled phone typing caret, sticky toolbar and formula dialog avoid the keyboard', async () => {
        await fixture(Array.from({length: 60}, (_, i) => `<p>手机显示比例测试 ${i}</p>`).join(''));
        await page.evaluate(() => __editor.focus('end')); await pause(500);
        // Native soft keys keep the IME open; CDP text insertion may hide it.
        const caret = await page.evaluate(() => ({rect: __editor.view.coordsAtPos(__editor.view.state.selection.head), factor: devicePixelRatio * visualViewport.scale}));
        shell('input', 'tap', String(Math.round(origin.x + caret.rect.left * caret.factor)), String(Math.round(origin.y + (caret.rect.top + 8) * caret.factor)));
        await page.evaluate(() => __editor.focus('end')); await pause(700);
        shell('input', 'tap', '72', '1868'); // Fcitx English q, 1440x2560 / 560dpi.
        await pause(500);
        assert.ok((await page.locator('#editor-rich').innerText()).trimEnd().endsWith('q'));
        const metrics = await page.evaluate(() => ({caret: __editor.view.coordsAtPos(__editor.view.state.selection.head), height: visualViewport.height, bar: document.getElementById('rich-toolbar').getBoundingClientRect().toJSON(), scroll: document.querySelector('.editor-scroll').getBoundingClientRect().toJSON()}));
        assert.ok(metrics.height < 950, 'Native soft keyboard must reduce the 1073px scaled viewport');
        assert.ok(metrics.caret.bottom < metrics.height - 4 && metrics.caret.top > metrics.bar.bottom, JSON.stringify(metrics));
        assert.ok(Math.abs(metrics.bar.top - metrics.scroll.top) <= 1, JSON.stringify(metrics));
        if (await page.locator('#math-toolbar').isHidden()) await page.locator('#editor-math-toggle').click();
        await page.locator('#math-toolbar button', {hasText: '分式'}).click();
        await page.locator('#editor-math-input').fill('\\frac{a}{b}'); await pause(500);
        await page.locator('#editor-math-input').evaluate(el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
        shell('input', 'tap', '432', '2266'); // Native soft-key x.
        await pause(500);
        assert.equal(await page.locator('#editor-math-input').inputValue(), '\\frac{a}{b}x');
        assert.equal(await page.locator('#editor-math-preview .katex').count(), 1);
        const input = await page.locator('#editor-math-input').boundingBox();
        assert.ok(input.y >= 0 && input.y + input.height < await page.evaluate(() => visualViewport.height));
        shot('phone-display-65-formula');
        await page.locator('#editor-math-apply').click(); await pause(700);
        assert.equal(await page.locator('#editor-rich [data-math]').getAttribute('data-latex'), '\\frac{a}{b}x');
        await page.locator('[data-rich-action="display"]').click(); await page.locator('#display-reset').click(); await page.locator('#display-save').click(); await pause();
        assert.equal(await page.evaluate(() => NoteStore.getPrefs().displayScale), 100);
    });
} finally {
    if (device) await device.close();
    const report = {passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results};
    fs.writeFileSync(`${out}/display.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({passed: report.passed, failed: report.failed}));
    if (report.failed) process.exitCode = 1;
}
