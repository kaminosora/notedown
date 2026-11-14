/* Mobile Chromium uses a real page-scale viewport here, not a mocked
 * visualViewport. Font-size overrides approximate large text for browser QA;
 * system font scaling and Android IME are verified separately on the device. */
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve('app/src/main/assets/www');
const executablePath = [process.env.CHROME_PATH, process.env.CHROME_BIN,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'
].find(file => file && fs.existsSync(file));
assert.ok(executablePath, 'Set CHROME_PATH');
const server = http.createServer((request, response) => {
    const route = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, route === '/' ? 'index.html' : route.slice(1));
    if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
    fs.readFile(file, (error, body) => {
        if (error) return response.writeHead(404).end();
        response.writeHead(200, {'Content-Type': {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2'}[path.extname(file)] || 'application/octet-stream'}).end(body);
    });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({executablePath, headless: true});
const output = '.test-artifacts/display';
fs.mkdirSync(output, {recursive: true});
const results = [];
const mobileAgent = 'Mozilla/5.0 (Linux; Android 15; Test) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
async function pause(page, ms = 180) { await page.waitForTimeout(ms); }
async function instrument(page) {
    await page.evaluate(() => {
        const create = NoteRichEditor.create;
        NoteRichEditor.create = (...args) => window.__editor = create(...args);
    });
}
async function metrics(page) {
    return page.evaluate(() => ({scale: visualViewport.scale, width: visualViewport.width, height: visualViewport.height,
        layoutWidth: innerWidth, scrollX, documentWidth: document.documentElement.scrollWidth,
        applied: Number(document.documentElement.dataset.displayScale), saved: NoteStore.getPrefs().displayScale}));
}
async function assertScale(page, percent, width = 412) {
    await pause(page, 260);
    const measured = await metrics(page);
    assert.ok(Math.abs(measured.scale - percent / 100) < 0.02, JSON.stringify(measured));
    assert.ok(Math.abs(measured.width - width / (percent / 100)) < 2, JSON.stringify(measured));
    assert.equal(measured.applied, percent);
    return measured;
}
async function range(page, value) {
    // Drive the range's native input/change path; presets and +/− are also
    // exercised through real touch clicks below.
    await page.locator('#display-scale').evaluate((slider, next) => {
        slider.value = String(next);
        slider.dispatchEvent(new Event('input', {bubbles: true}));
        slider.dispatchEvent(new Event('change', {bubbles: true}));
    }, value);
    await pause(page);
}
async function saveScale(page, percent) {
    await page.locator('#display-settings').tap();
    const preset = page.locator(`[data-display-preset="${percent}"]`);
    if (await preset.count()) await preset.tap();
    else await range(page, percent);
    await page.locator('#display-save').tap();
    await pause(page);
}
async function openHtml(page, html) {
    await page.locator('#new-note-fab').tap();
    await page.locator('#editor-title').fill('Display regression');
    await page.locator('[data-editor-mode="html"]').tap();
    await page.locator('#editor-textarea').fill(html);
    await page.locator('[data-editor-mode="rich"]').tap();
    await pause(page);
}
async function test(name, run, {width = 412, native = false} = {}) {
    if (process.env.TEST_FILTER && !new RegExp(process.env.TEST_FILTER).test(name)) return;
    const context = await browser.newContext({viewport: {width, height: 915}, isMobile: true, hasTouch: true,
        deviceScaleFactor: 1, userAgent: mobileAgent});
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (native) await page.addInitScript(() => {
        window.__disk = {fail: false, attempts: 0, json: JSON.stringify({version: 1, seeded: true,
            prefs: {theme: 'auto', displayScale: 100},
            notes: [{id: 'original', title: 'Original', html: '<p>Keep this note</p>', createdAt: 1, updatedAt: 1}]})};
        window.NotedownNative = {
            loadData() { return __disk.json; },
            saveData(json) { __disk.attempts++; if (__disk.fail) return false; __disk.json = json; return true; },
            pickFiles() {}, haptic() {}, setTheme() {}
        };
    });
    try {
        await page.goto(baseUrl, {waitUntil: 'networkidle'});
        await instrument(page);
        await run(page, context);
        assert.deepEqual(errors, [], 'No page errors');
        results.push({name, passed: true}); console.log(`PASS ${name}`);
    } catch (error) {
        results.push({name, passed: false, error: error.stack}); console.error(`FAIL ${name}: ${error.message}`);
        await page.screenshot({path: `${output}/failure-${results.length}.png`}).catch(() => {});
    } finally { await context.close(); }
}

try {
    await test('60/80/100/150 percent use real mobile viewport scale without mutating notes', async page => {
        const before = await page.evaluate(() => NoteStore.getNotes());
        await page.locator('#display-settings').tap();
        const measures = [];
        for (const percent of [60, 80, 100, 150]) {
            await range(page, percent);
            measures.push(await assertScale(page, percent));
            assert.equal(await page.locator('#display-value').innerText(), `${percent}%`);
            assert.deepEqual(await page.evaluate(() => NoteStore.getNotes()), before);
            assert.equal(await page.evaluate(() => NoteStore.getPrefs().displayScale), 100, 'Preview does not persist until Save');
            const center = await page.locator('#display-save').evaluate(node => {
                const r = node.getBoundingClientRect();
                return {visible: r.left >= visualViewport.offsetLeft && r.right <= visualViewport.offsetLeft + visualViewport.width + 1,
                    left: r.left, right: r.right, visualWidth: visualViewport.width};
            });
            assert.equal(center.visible, true, JSON.stringify(center));
        }
        await page.locator('#display-cancel').tap();
        await assertScale(page, 100);
        fs.writeFileSync(`${output}/viewport-metrics.json`, JSON.stringify(measures, null, 2));
    });

    await test('presets, +/- steps, Cancel, Android Back and reset respect the last saved scale', async page => {
        await saveScale(page, 80);
        await assertScale(page, 80);
        await page.locator('#display-settings').tap();
        await page.locator('#display-plus').tap();
        await assertScale(page, 85);
        await page.locator('#display-minus').tap();
        await assertScale(page, 80);
        await page.locator('[data-display-preset="125"]').tap();
        await assertScale(page, 125);
        assert.equal(await page.evaluate(() => Notedown.handleBack()), true);
        await assertScale(page, 80);
        assert.equal(await page.locator('#display-dialog').isHidden(), true);
        await page.locator('#display-settings').tap();
        await page.locator('#display-reset').tap();
        await assertScale(page, 100);
        await page.locator('#display-cancel').tap();
        await assertScale(page, 80);
        await page.locator('#display-settings').tap();
        await page.locator('#display-reset').tap();
        await page.locator('#display-save').tap();
        await assertScale(page, 100);
        assert.equal(await page.evaluate(() => NoteStore.getPrefs().displayScale), 100);
    });

    await test('saved scale survives reload and is reachable from reading and editing', async page => {
        const before = await page.evaluate(() => NoteStore.getNotes());
        await saveScale(page, 80);
        await page.reload({waitUntil: 'networkidle'});
        await instrument(page);
        await assertScale(page, 80);
        assert.deepEqual(await page.evaluate(() => NoteStore.getNotes()), before);
        await page.locator('.note-card').first().tap();
        await page.locator('#note-menu-button').tap();
        await page.locator('[data-action="display"]').tap();
        assert.equal(await page.locator('#display-scale').inputValue(), '80');
        await page.locator('#display-cancel').tap();
        await page.locator('#edit-note-button').tap();
        const editorBefore = await page.evaluate(() => __editor.getHTML());
        await page.locator('[data-rich-action="display"]').tap();
        await page.locator('[data-display-preset="65"]').tap();
        await page.locator('#display-save').tap();
        await assertScale(page, 65);
        assert.equal(await page.locator('#editor-overlay').evaluate(node => node.inert), false);
        assert.equal(await page.evaluate(() => __editor.getHTML()), editorBefore);
        assert.deepEqual(await page.evaluate(() => NoteStore.getNotes()), before);
    });

    await test('native save failure rolls viewport back and retains the dialog for retry', async page => {
        const before = await page.evaluate(() => __disk.json);
        await page.evaluate(() => { __disk.fail = true; });
        await page.locator('#display-settings').tap();
        await page.locator('[data-display-preset="80"]').tap();
        await assertScale(page, 80);
        await page.locator('#display-save').tap();
        await assertScale(page, 100);
        assert.equal(await page.locator('#display-dialog').isVisible(), true);
        assert.equal(await page.locator('#display-scale').inputValue(), '100');
        assert.equal(await page.evaluate(() => NoteStore.getPrefs().displayScale), 100);
        assert.equal(await page.evaluate(() => __disk.json), before);
        assert.equal(await page.evaluate(() => __disk.attempts), 1);
        await page.evaluate(() => { __disk.fail = false; });
        await page.locator('[data-display-preset="80"]').tap();
        await page.locator('#display-save').tap();
        await assertScale(page, 80);
        const after = await page.evaluate(() => JSON.parse(__disk.json));
        assert.equal(after.prefs.displayScale, 80);
        assert.deepEqual(after.notes, JSON.parse(before).notes);
    }, {native: true});

    for (const width of [320, 412]) {
        await test(`${width}px: enlarged library and reading layouts keep right-edge actions inside the viewport`, async page => {
            const before = await page.evaluate(() => NoteStore.getNotes());
            async function fits(selectors) {
                const geometry = await page.evaluate(selectors => ({
                    viewportWidth: visualViewport.width,
                    layoutWidth: document.documentElement.clientWidth,
                    documentWidth: document.documentElement.scrollWidth,
                    scrollX,
                    controls: selectors.map(selector => {
                        const rect = document.querySelector(selector).getBoundingClientRect();
                        return {selector, left: rect.left, right: rect.right};
                    })
                }), selectors);
                assert.ok(Math.abs(geometry.layoutWidth - geometry.viewportWidth) <= 1, JSON.stringify(geometry));
                assert.ok(geometry.documentWidth <= Math.ceil(geometry.viewportWidth) + 1, JSON.stringify(geometry));
                assert.ok(Math.abs(geometry.scrollX) <= 1, JSON.stringify(geometry));
                assert.ok(geometry.controls.every(control => control.left >= -1 && control.right <= geometry.viewportWidth + 1), JSON.stringify(geometry));
            }
            for (const percent of [125, 150]) {
                await saveScale(page, percent);
                await assertScale(page, percent, width);
                await fits(['.library-header', '#display-settings', '#theme-toggle', '#import-library']);
                await page.locator('#display-settings').tap();
                assert.equal(await page.locator('#display-dialog').isVisible(), true);
                await page.locator('#display-cancel').tap();
                await page.locator('.note-card').first().tap();
                await fits(['.note-topbar', '#back-button', '#edit-note-button', '#note-menu-button']);
                await page.locator('#note-menu-button').tap();
                await page.locator('[data-action="display"]').tap();
                assert.equal(await page.locator('#display-scale').inputValue(), String(percent));
                await page.locator('#display-cancel').tap();
                await page.screenshot({path: `${output}/enlarged-reading-${width}-${percent}.png`});
                await page.locator('#back-button').tap();
            }
            await page.reload({waitUntil: 'networkidle'});
            await assertScale(page, 150, width);
            await fits(['.library-header', '#display-settings', '#theme-toggle', '#import-library']);
            // A host-width change models rotation/split-window resizing. Scale
            // and metadata must settle once, without growing or shrinking again.
            await page.setViewportSize({width: 640, height: 440});
            await assertScale(page, 150, 640);
            const first = await metrics(page);
            await pause(page, 500);
            assert.deepEqual(await metrics(page), first, 'Viewport resize must not cause scale feedback');
            await fits(['.library-header', '#display-settings', '#theme-toggle', '#import-library']);
            assert.deepEqual(await page.evaluate(() => NoteStore.getNotes()), before);
        }, {width});
    }

    for (const width of [320, 412]) {
        await test(`${width}px: compact display with 125% text keeps title, typing, formula dialog and toolbar usable`, async page => {
            await page.addStyleTag({content: 'html { font-size: 125% !important; } body { font-size: 125% !important; }'});
            await saveScale(page, 80);
            await assertScale(page, 80, width);
            await openHtml(page, Array.from({length: 60}, (_, i) => `<p>Note text line ${i}</p>`).join(''));
            await page.locator('#editor-title').fill('125% text remains editable');
            await page.setViewportSize({width, height: 440});
            await page.evaluate(() => __editor.focus('end'));
            await pause(page);
            await page.keyboard.insertText(' visible typing');
            await pause(page);
            const state = await page.evaluate(() => {
                const caret = __editor.view.coordsAtPos(__editor.view.state.selection.head);
                const bar = document.getElementById('rich-toolbar').getBoundingClientRect();
                const area = document.querySelector('.editor-scroll').getBoundingClientRect();
                return {caretTop: caret.top, caretBottom: caret.bottom, height: visualViewport.height,
                    barTop: bar.top, barBottom: bar.bottom, areaTop: area.top,
                    leaked: Boolean(document.elementFromPoint(area.left + area.width / 2, bar.top - 1)?.closest('#editor-rich'))};
            });
            assert.ok(state.caretTop >= state.barBottom && state.caretBottom < state.height, JSON.stringify(state));
            assert.ok(Math.abs(state.barTop - state.areaTop) <= 1, JSON.stringify(state));
            assert.equal(state.leaked, false);
            await page.locator('#editor-math-toggle').tap();
            await page.locator('#math-toolbar').getByRole('button', {name: '分式', exact: true}).tap();
            await page.locator('#editor-math-input').fill(String.raw`\frac{a+b}{c}`);
            await page.locator('#editor-math-apply').scrollIntoViewIfNeeded();
            await page.screenshot({path: `${output}/compact-font125-${width}.png`});
            await page.locator('#editor-math-apply').tap();
            assert.equal(await page.locator('#editor-rich [data-math]').getAttribute('data-latex'), String.raw`\frac{a+b}{c}`);
            const html = await page.evaluate(() => __editor.getHTML());
            assert.ok(html.includes(' visible typing'));
            assert.doesNotMatch(html, /display-dialog|editor-math|katex|table-drag/);
            await page.locator('#editor-save').tap();
            assert.equal(await page.locator('#note-title').innerText(), '125% text remains editable');
        }, {width});
    }

    await test('scaled mobile pointer drag exchanges both cell contents and the unsaved guard still works', async (page, context) => {
        await saveScale(page, 80);
        await openHtml(page, '<p>before</p><table><tr><td>source</td><td><strong>target content</strong></td></tr><tr><td>third</td><td>fourth</td></tr></table><p>after</p>');
        await page.locator('#editor-save').tap();
        const saved = await page.evaluate(() => NoteStore.getNotes().find(note => note.title === 'Display regression'));
        await page.locator('#edit-note-button').tap();
        await pause(page);
        const cells = page.locator('#editor-rich td');
        const from = await cells.nth(0).boundingBox(), to = await cells.nth(1).boundingBox();
        assert.ok(from && to);
        const session = await context.newCDPSession(page);
        const start = {x: from.x + from.width / 2, y: from.y + from.height / 2};
        const end = {x: to.x + to.width / 2, y: to.y + to.height / 2};
        await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [start]});
        await pause(page, 510);
        assert.equal(await page.locator('#editor-rich').getAttribute('data-table-dragging'), 'true');
        for (let step = 1; step <= 10; step++) {
            const ratio = step / 10;
            await session.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio}]});
        }
        await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        await pause(page);
        assert.deepEqual(await cells.allTextContents(), ['target content', 'source', 'third', 'fourth']);
        assert.equal(await cells.nth(0).locator('strong').innerText(), 'target content');
        assert.doesNotMatch(await page.evaluate(() => __editor.getHTML()), /table-drag|display-dialog/);
        await page.locator('#editor-cancel').tap();
        assert.equal(await page.locator('#confirm-dialog').isVisible(), true);
        await page.locator('#confirm-cancel').tap();
        assert.equal(await page.locator('#editor-overlay').isVisible(), true);
        assert.deepEqual(await page.evaluate(id => NoteStore.getNote(id), saved.id), saved, 'Draft drag never overwrites saved note');
        await page.locator('[data-rich-action="undo"]').tap();
        assert.deepEqual(await cells.allTextContents(), ['source', 'target content', 'third', 'fourth']);
    });
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
const passed = results.filter(item => item.passed).length, failed = results.length - passed;
fs.writeFileSync(`${output}/report.json`, JSON.stringify({passed, failed, results}, null, 2));
console.log(`${passed} display regressions passed; ${failed} failed.`);
if (failed) process.exitCode = 1;
