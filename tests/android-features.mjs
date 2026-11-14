// Installed QA APK checks using native ADB long-press drags and a real IME.
// MuMu profile: Android 15, 1440x2560 / 360dpi, Fcitx5 0.1.3 English.
import {_android as android} from 'playwright-core';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const adbPath = process.env.ADB_PATH;
assert.ok(adbPath, 'Set ADB_PATH');
const serial = process.env.ANDROID_SERIAL || '127.0.0.1:16384';
const pkg = 'io.github.kaminosora.notedown.qa';
const output = process.env.ANDROID_TEST_OUTPUT || '.test-artifacts/v1.3.1/android';
fs.mkdirSync(output, {recursive: true});
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], {maxBuffer: 12 * 1024 * 1024});
const shell = (...args) => adb('shell', ...args).toString().trim();
const rotation = shell('settings', 'get', 'system', 'user_rotation');
const autoRotation = shell('settings', 'get', 'system', 'accelerometer_rotation');
const report = [];
let device, page, dpr, origin, baseHeight;
let fixtureId = 0;
const table = '<table><tr><th>A0</th><th>A1</th><th>A2</th></tr><tr><td>B0</td><td>B1</td><td>B2</td></tr><tr><td>C0</td><td>C1</td><td>C2</td></tr></table>';
const pause = (ms = 250) => page.waitForTimeout(ms);
const screenshot = name => fs.writeFileSync(`${output}/${name}.png`, adb('exec-out', 'screencap', '-p'));
async function test(name, fn) {
    if (process.env.ANDROID_TEST_FILTER && !new RegExp(process.env.ANDROID_TEST_FILTER).test(name)) return;
    try { await fn(); report.push({name, passed: true}); console.log(`PASS ${name}`); }
    catch (error) {
        // A failed mid-hold assertion must not leave an injected finger down.
        shell('input', 'touchscreen', 'motionevent', 'UP', '0', '0');
        report.push({name, passed: false, error: error.stack}); console.error(`FAIL ${name}: ${error.message}`); screenshot(`feature-failure-${report.length}`);
    }
}
async function fixture(html) {
    if (await page.locator('#editor-math-layer').isVisible()) await page.locator('#editor-math-cancel').click();
    if (await page.locator('#editor-overlay').isVisible()) {
        await page.locator('#editor-cancel').click();
        if (await page.locator('#confirm-dialog').isVisible()) await page.locator('#confirm-ok').click();
    }
    if (await page.locator('#note-screen').isVisible()) await page.locator('#back-button').click();
    await page.locator('#new-note-fab').click();
    await page.locator('[data-editor-mode="html"]').click();
    await page.locator('#editor-title').fill(`1.3.1 Android 功能验收 ${++fixtureId}`);
    await page.locator('#editor-textarea').fill(html);
    await page.locator('[data-editor-mode="rich"]').click();
    await pause(400);
}
async function readingFixture(html) {
    await fixture(html);
    await page.locator('#editor-save').click();
    await page.waitForFunction(height => innerHeight >= height - 2, baseHeight);
    await pause(500);
    assert.ok(!/mInputShown=true/.test(shell('dumpsys', 'input_method')), 'Reading has no IME');
}
const grid = () => page.locator('#note-content table tr').evaluateAll(rows => rows.map(row => Array.from(row.cells).map(cell => cell.textContent)));
const point = box => ({x: Math.round(origin.x + (box.x + box.width / 2) * dpr), y: Math.round(origin.y + (box.y + box.height / 2) * dpr)});
async function drag(fromLocator, toLocator) {
    const from = point(await fromLocator.boundingBox()), to = point(await toLocator.boundingBox());
    if (process.env.ANDROID_GESTURE_TRACE) console.log(JSON.stringify({from, to, before: await page.evaluate(() => ({height: innerHeight, events: window.__gestureEvents}))}));
    // Explicitly hold one native pointer: MuMu's draganddrop command can begin
    // movement before the application's long-press threshold on some profiles.
    shell('input', 'touchscreen', 'motionevent', 'DOWN', String(from.x), String(from.y));
    await pause(650);
    if (process.env.ANDROID_GESTURE_TRACE) console.log(JSON.stringify(await page.evaluate(() => ({height: innerHeight, active: NoteTableDrag.isDragging, events: window.__gestureEvents}))));
    if (await page.locator('#editor-overlay').isHidden()) {
        assert.ok(!/mInputShown=true/.test(shell('dumpsys', 'input_method')), 'Reading long press does not open the keyboard');
        assert.ok(await page.evaluate(() => NoteTableDrag.isDragging), 'Native hold starts reading drag');
    }
    for (let step = 1; step <= 10; step++) {
        shell('input', 'touchscreen', 'motionevent', 'MOVE', String(Math.round(from.x + (to.x - from.x) * step / 10)), String(Math.round(from.y + (to.y - from.y) * step / 10)));
        await pause(25);
    }
    shell('input', 'touchscreen', 'motionevent', 'UP', String(to.x), String(to.y));
    await pause(400);
    if (process.env.ANDROID_GESTURE_TRACE) console.log(JSON.stringify(await page.evaluate(() => ({height: innerHeight, events: window.__gestureEvents}))));
}
try {
    // Clear any interrupted ADB gesture from an earlier failed QA process.
    shell('input', 'touchscreen', 'motionevent', 'UP', '0', '0');
    shell('settings', 'put', 'system', 'accelerometer_rotation', '0');
    shell('settings', 'put', 'system', 'user_rotation', '0');
    shell('am', 'force-stop', pkg);
    shell('am', 'start', '-W', '-n', `${pkg}/io.github.kaminosora.notedown.MainActivity`);
    device = (await android.devices()).find(item => item.serial() === serial);
    assert.ok(device);
    page = await (await device.webView({pkg})).page();
    page.setDefaultTimeout(7000);
    if (process.env.ANDROID_GESTURE_TRACE) await page.evaluate(() => {
        window.__gestureEvents = [];
        for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'notedown-table-drag']) document.addEventListener(type, event => __gestureEvents.push({type, target: event.target.className, x: event.clientX, y: event.clientY, active: event.detail?.active, time: performance.now()}), true);
        visualViewport.addEventListener('resize', () => __gestureEvents.push({type: 'resize', height: innerHeight, time: performance.now()}));
    });
    await page.evaluate(() => { const create = NoteRichEditor.create; NoteRichEditor.create = (...args) => window.__editor = create(...args); });
    baseHeight = await page.evaluate(() => innerHeight);
    dpr = await page.evaluate(() => devicePixelRatio);
    spawnSync(adbPath, ['-s', serial, 'shell', 'uiautomator', 'dump', '/sdcard/notedown-features-ui.xml']);
    const bounds = shell('cat', '/sdcard/notedown-features-ui.xml').match(/class="android.webkit.WebView"[^>]*bounds="\[(\d+),(\d+)\]/);
    assert.ok(bounds); origin = {x: +bounds[1], y: +bounds[2]};

    await test('native reading edge holds reorder rows and columns without opening the IME', async () => {
        await readingFixture(table);
        const before = await grid();
        await drag(page.locator('[data-table-drag="row"][data-index="0"]'), page.locator('[data-table-drag="row"][data-index="2"]'));
        assert.deepEqual(await grid(), [before[1], before[2], before[0]]);
        await readingFixture(table);
        await drag(page.locator('[data-table-drag="column"][data-index="0"]'), page.locator('[data-table-drag="column"][data-index="2"]'));
        assert.deepEqual(await grid(), before.map(row => [row[1], row[2], row[0]]));
        assert.ok(Math.abs((await page.evaluate(() => innerHeight)) - baseHeight) <= 2);
        screenshot('table-native-rows-columns');
    });
    await test('native reading cell hold swaps and persists contents without keyboard; editor has no table gestures', async () => {
        await readingFixture(table);
        await drag(page.locator('#note-content th').first(), page.locator('#note-content td').last());
        const result = await grid();
        assert.equal(result[0][0], 'C2'); assert.equal(result[2][2], 'A0');
        assert.equal(result.flat().filter(value => value === 'A0').length, 1);
        const canonical = await page.evaluate(title => NoteStore.getNotes().find(note => note.title === title).html, `1.3.1 Android 功能验收 ${fixtureId}`);
        assert.ok(!/table-drag|selectedCell/.test(canonical));
        assert.equal(await page.locator('#editor-overlay').isHidden(), true);
        assert.ok(!/mInputShown=true/.test(shell('dumpsys', 'input_method')));
        screenshot('table-native-cell-swap');
        await page.locator('#edit-note-button').click();
        await pause(200);
        assert.equal(await page.locator('[data-table-drag]:visible').count(), 0);
        const before = await page.evaluate(() => __editor.getHTML());
        const cell = point(await page.locator('#editor-rich th').first().boundingBox());
        shell('input', 'touchscreen', 'motionevent', 'DOWN', String(cell.x), String(cell.y)); await pause(700);
        shell('input', 'touchscreen', 'motionevent', 'UP', String(cell.x), String(cell.y)); await pause();
        assert.equal(await page.evaluate(() => __editor.getHTML()), before);
        assert.equal(await page.evaluate(() => NoteTableDrag.isDragging), false);
    });
    await test('reading table hold edge-scrolls the full page and outside drop cancels without IME', async () => {
        await readingFixture('<table><tr><th>编号</th><th>内容</th></tr>' + Array.from({length: 75}, (_, i) => `<tr><td>${i}</td><td>阅读页面连续拖动 ${i}</td></tr>`).join('') + '</table>');
        const original = await grid();
        const box = await page.locator('[data-table-drag="row"][data-index="1"]').boundingBox();
        const start = point(box);
        const bottom = Math.round(origin.y + (await page.evaluate(() => innerHeight - 18)) * dpr);
        shell('input', 'touchscreen', 'motionevent', 'DOWN', String(start.x), String(start.y)); await pause(650);
        shell('input', 'touchscreen', 'motionevent', 'MOVE', String(start.x), String(bottom)); await pause(1500);
        assert.ok(await page.evaluate(() => scrollY > 120), 'Held pointer scrolls the reading page');
        assert.ok(!/mInputShown=true/.test(shell('dumpsys', 'input_method')));
        screenshot('table-reading-native-edge-scroll');
        shell('input', 'touchscreen', 'motionevent', 'MOVE', '1435', String(bottom)); await pause(100);
        shell('input', 'touchscreen', 'motionevent', 'UP', '1435', String(bottom)); await pause();
        assert.deepEqual(await grid(), original, 'Dropping outside the table does not change content');
        assert.equal(await page.evaluate(() => NoteTableDrag.isDragging), false);
    });
    await test('formula toolbar and native soft-key input stay visible above the IME', async () => {
        await fixture('<p>Formula input</p>');
        if (await page.locator('#math-toolbar').isHidden()) await page.locator('#editor-math-toggle').click();
        await page.locator('#math-toolbar button', {hasText: '分式'}).click();
        const source = page.locator('#editor-math-input');
        await source.fill('\\frac{1}{2}');
        await source.evaluate(el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
        await pause(550);
        assert.ok((await page.evaluate(() => innerHeight)) < baseHeight - 100, 'Real IME must be showing');
        shell('input', 'tap', '432', '2266'); // English soft-key x.
        await pause(400);
        assert.equal(await source.inputValue(), '\\frac{1}{2}x');
        assert.equal(await page.locator('#editor-math-preview .katex').count(), 1);
        const sourceRect = await source.boundingBox();
        assert.ok(sourceRect.y + sourceRect.height < await page.evaluate(() => innerHeight));
        await page.locator('#editor-math-apply').click();
        const latex = await page.locator('#editor-rich [data-math]').getAttribute('data-latex');
        assert.equal(latex, '\\frac{1}{2}x');
        assert.equal(await page.locator('#editor-rich [data-math] .katex').count(), 1);
        screenshot('formula-native-keyboard');
    });
    await test('formula source survives modes, native save, reopen and dialog cancellation', async () => {
        await fixture('<p>行内 $x^2$ 与 \\(a+b\\)</p><p>$$\\int_0^1 x\\,dx$$</p>');
        assert.equal(await page.locator('#editor-rich [data-math]').count(), 3);
        const getFormulas = () => page.locator('#editor-rich [data-math]').evaluateAll(nodes => nodes.map(node => [node.dataset.math, node.dataset.latex]));
        const before = await getFormulas();
        await page.locator('[data-editor-mode="markdown"]').click();
        await page.locator('[data-editor-mode="html"]').click();
        await page.locator('[data-editor-mode="rich"]').click();
        assert.deepEqual(await getFormulas(), before);
        await page.locator('#editor-save').click();
        assert.equal(await page.locator('#note-content .katex').count(), 3);
        const saved = JSON.parse(adb('exec-out', 'run-as', pkg, 'cat', 'files/notes.json'));
        assert.ok(saved.notes.some(note => note.html.includes('data-latex="x^2"')));
        await page.locator('#edit-note-button').click();
        assert.deepEqual(await getFormulas(), before);
        await page.locator('#editor-rich [data-math]').first().dblclick();
        await page.locator('#editor-math-input').fill('unsaved formula');
        await page.evaluate(() => Notedown.handleBack());
        assert.deepEqual(await getFormulas(), before);
        screenshot('formula-native-reopened');
    });
} finally {
    shell('settings', 'put', 'system', 'user_rotation', rotation);
    shell('settings', 'put', 'system', 'accelerometer_rotation', autoRotation);
    if (device) await device.close();
    const result = {passed: report.filter(test => test.passed).length, failed: report.filter(test => !test.passed).length, tests: report};
    fs.writeFileSync(`${output}/features.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({passed: result.passed, failed: result.failed}));
    if (result.failed) process.exitCode = 1;
}
