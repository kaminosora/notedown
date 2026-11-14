/* Reading-mode pointer integration: holds save immediately, editing retains
 * ordinary caret/selection gestures and never mounts table drag handles. */
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve('app/src/main/assets/www');
const executablePath = [process.env.CHROME_PATH, process.env.CHROME_BIN,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].find(file => file && fs.existsSync(file));
assert.ok(executablePath, 'Set CHROME_PATH');
const server = http.createServer((request, response) => {
    const file = path.resolve(root, decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/$/, '/index.html').slice(1));
    if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
    fs.readFile(file, (error, body) => {
        if (error) return response.writeHead(404).end();
        response.writeHead(200, {'Content-Type': {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2'}[path.extname(file)] || 'application/octet-stream'}).end(body);
    });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({executablePath, headless: true});
const output = '.test-artifacts/table-drag';
fs.mkdirSync(output, {recursive: true});
const failures = [];
let passed = 0;
const fixture = '<p>above table</p><table><thead><tr><th>A head</th><th>B head</th><th>C head</th></tr></thead><tbody><tr><td>one</td><td><strong>two bold</strong></td><td>three</td></tr><tr><td>four</td><td>five</td><td>six</td></tr></tbody></table><p>after table</p>';
const mobile = {hasTouch: true, isMobile: true, viewport: {width: 412, height: 915},
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Test) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'};
const saved = page => page.evaluate(() => NoteStore.getNote('table-test'));
const html = async page => (await saved(page)).html;
const rows = page => page.locator('#note-content table').first().locator(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr').evaluateAll(nodes => nodes.map(row => Array.from(row.cells).map(cell => cell.textContent)));
const dragging = page => page.evaluate(() => Boolean(NoteTableDrag.isDragging));
async function pause(page, ms = 160) { await page.waitForTimeout(ms); }
async function open(page) {
    await page.locator('.note-card').first().click(); await pause(page);
    assert.equal(await page.locator('#editor-overlay').isVisible(), false);
}
async function center(locator) {
    const rect = await locator.boundingBox(); assert.ok(rect, 'Gesture target is visible');
    return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
}
async function drag(page, source, destination, {cancel = false, duration = 500} = {}) {
    const start = await center(source), end = await center(destination);
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await pause(page, duration);
    if (duration >= 430) assert.equal(await dragging(page), true, 'Reading table hold begins dragging');
    await page.mouse.move(end.x, end.y, {steps: 12});
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up(); await pause(page);
}
async function touchDrag(page, context, source, target, {duration = 510, cancel = false} = {}) {
    const start = await center(source), end = await center(target), session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [start]}); await pause(page, duration);
    if (duration >= 430) assert.equal(await dragging(page), true, 'Actual browser touch starts a reading drag');
    for (let step = 1; step <= 10; step++) {
        await session.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: start.x + (end.x - start.x) * step / 10, y: start.y + (end.y - start.y) * step / 10}]});
        await pause(page, 15);
    }
    await session.send('Input.dispatchTouchEvent', {type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: []});
    await pause(page); await session.detach();
}
async function cleanSaved(page) {
    assert.doesNotMatch(await html(page), /table-drag|data-table-dragging|drag-ghost|katex|contenteditable/i);
    assert.equal(await dragging(page), false);
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.isContentEditable)), false);
}
async function test(name, callback, {source = fixture, native = false, ...options} = {}) {
    if (process.env.TEST_FILTER && !new RegExp(process.env.TEST_FILTER).test(name)) return;
    const context = await browser.newContext({viewport: {width: 640, height: 960}, ...options});
    const page = await context.newPage(); page.setDefaultTimeout(6000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({source, native}) => {
        const initial = JSON.stringify({version: 1, seeded: true, prefs: {theme: 'auto', displayScale: 100},
            notes: [{id: 'table-test', title: 'Table regression', html: source, createdAt: 1, updatedAt: 1}]});
        if (!localStorage.getItem('notedown.state.v1')) localStorage.setItem('notedown.state.v1', initial);
        if (native) {
            window.__disk = {fail: false, attempts: 0, json: localStorage.getItem('notedown.state.v1')};
            window.NotedownNative = {
                loadData() { return __disk.json; },
                saveData(json) { __disk.attempts++; if (__disk.fail) return false; __disk.json = json; localStorage.setItem('notedown.state.v1', json); return true; },
                pickFiles() {}, haptic() {}, setTheme() {}
            };
        }
    }, {source, native});
    try {
        await page.goto(`http://127.0.0.1:${server.address().port}`, {waitUntil: 'networkidle'});
        await page.evaluate(() => { const create = NoteRichEditor.create; NoteRichEditor.create = (...args) => window.__editor = create(...args); });
        await callback(page, context); assert.deepEqual(errors, [], 'No uncaught page errors');
        console.log(`PASS ${name}`); passed++;
    } catch (error) {
        failures.push({name, error: error.stack}); console.error(`FAIL ${name}: ${error.stack}`);
        await page.screenshot({path: `${output}/failure-${failures.length}.png`}).catch(() => {});
    } finally { await context.close(); }
}

try {
    await test('row handles reorder contents while keeping sections and header roles; reload persists', async page => {
        await open(page);
        assert.match(await page.locator('[data-table-drag="row"][data-index="2"]').evaluate(node => getComputedStyle(node, '::after').content), /⠿/);
        await drag(page, page.locator('[data-table-drag="row"][data-index="2"]'), page.locator('#note-content tr').first());
        assert.deepEqual(await rows(page), [['four', 'five', 'six'], ['A head', 'B head', 'C head'], ['one', 'two bold', 'three']]);
        assert.equal(await page.locator('#note-content thead th').count(), 3);
        assert.equal(await page.locator('#note-content tbody tr').count(), 2); await cleanSaved(page);
        const committed = await saved(page);
        await page.reload({waitUntil: 'networkidle'}); await open(page);
        assert.deepEqual(await saved(page), committed);
        assert.deepEqual(await rows(page), [['four', 'five', 'six'], ['A head', 'B head', 'C head'], ['one', 'two bold', 'three']]);
    });
    await test('column handles reorder every section without losing rich content or cell attributes', async page => {
        await open(page);
        await drag(page, page.locator('[data-table-drag="column"][data-index="0"]'), page.locator('#note-content th').nth(2));
        assert.deepEqual(await rows(page), [['B head', 'C head', 'A head'], ['two bold', 'three', 'one'], ['five', 'six', 'four'], ['foot B', 'foot C', 'foot A']]);
        assert.equal(await page.locator('#note-content strong').innerText(), 'two bold');
        assert.equal(await page.locator('#note-content tfoot tr').count(), 1);
        assert.equal(await page.locator('#note-content thead th').count(), 3);
        assert.equal(await page.locator('#note-content tbody td').first().getAttribute('align'), 'right');
        await cleanSaved(page);
    }, {source: fixture.replace('<td>one</td>', '<td align="right">one</td>').replace('</tbody>', '</tbody><tfoot><tr><td>foot A</td><td>foot B</td><td>foot C</td></tr></tfoot>')});
    await test('caption stays readable and column handles do not overlap its text', async page => {
        await open(page);
        const before = await saved(page), caption = page.locator('#note-content caption'), captionRect = await caption.boundingBox();
        for (const handle of await page.locator('[data-table-drag="column"]').all()) {
            const rect = await handle.boundingBox(); assert.ok(rect.y + rect.height <= captionRect.y + 1, JSON.stringify({rect, captionRect}));
        }
        await caption.click(); await page.keyboard.type('must not enter caption');
        assert.deepEqual(await saved(page), before);
        assert.equal(await page.evaluate(() => Boolean(document.activeElement?.isContentEditable)), false);
        await drag(page, page.locator('[data-table-drag="column"][data-index="0"]'), page.locator('#note-content td').nth(1));
        assert.deepEqual(await rows(page), [['beta', 'alpha'], ['delta', 'gamma']]);
        assert.equal(await caption.textContent(), 'original caption'); await cleanSaved(page);
    }, {source: '<p>before</p><table><caption>original caption</caption><tr><td>alpha</td><td>beta</td></tr><tr><td>gamma</td><td>delta</td></tr></table>'});
    await test('cell exchange preserves unequal rich contents, spans, attributes and formula source', async page => {
        await open(page); const cells = page.locator('#note-content td');
        await drag(page, cells.first(), cells.last());
        assert.equal(await cells.first().innerText(), 'a much longer target');
        assert.equal(await cells.first().getAttribute('colspan'), '2');
        assert.equal(await cells.first().getAttribute('rowspan'), '2');
        assert.equal(await cells.last().getAttribute('align'), 'right');
        assert.equal(await cells.last().locator('strong').textContent(), 'formula ');
        assert.equal(await cells.last().locator('[data-math]').getAttribute('data-latex'), String.raw`\frac{x^2}{2}`);
        assert.equal(await cells.last().locator('.katex').count(), 1);
        assert.match(await html(page), /data-latex="\\frac\{x\^2\}\{2\}"/); await cleanSaved(page);
        await page.reload({waitUntil: 'networkidle'}); await open(page);
        assert.equal(await page.locator('#note-content td').last().locator('[data-math]').getAttribute('data-latex'), String.raw`\frac{x^2}{2}`);
    }, {source: '<table><tr><td colspan="2" rowspan="2"><strong>formula </strong><span data-math="inline" data-latex="\\frac{x^2}{2}">\\frac{x^2}{2}</span></td><td>right</td></tr><tr><td align="right"><em>a much longer target</em></td></tr></table>'});
    await test('Escape, Android Back, touch cancel and outside drop leave saved content unchanged', async (page, context) => {
        await open(page); const before = await saved(page), cells = page.locator('#note-content td');
        await drag(page, cells.first(), cells.last(), {cancel: true}); assert.deepEqual(await saved(page), before);
        await drag(page, cells.first(), page.locator('#note-content > p').last()); assert.deepEqual(await saved(page), before);
        await touchDrag(page, context, cells.first(), cells.last(), {cancel: true}); assert.deepEqual(await saved(page), before);
        const start = await center(cells.first());
        await page.mouse.move(start.x, start.y); await page.mouse.down(); await pause(page, 500);
        assert.equal(await dragging(page), true);
        assert.equal(await page.evaluate(() => Notedown.handleBack()), true); await page.mouse.up();
        assert.deepEqual(await saved(page), before); assert.equal(await page.locator('#note-screen').isVisible(), true); await cleanSaved(page);
    }, mobile);
    await test('movement before hold deadline retains normal swipe and selection behavior', async (page, context) => {
        await open(page); const before = await saved(page), cells = page.locator('#note-content td');
        await drag(page, cells.first(), cells.last(), {duration: 40}); assert.deepEqual(await saved(page), before);
        await touchDrag(page, context, cells.first(), cells.last(), {duration: 20}); await pause(page, 500);
        assert.deepEqual(await saved(page), before); await cleanSaved(page);
    }, mobile);
    await test('implicit capture transfer ignores the old handle or cell; losing container capture cancels without saving', async page => {
        await open(page); const before = await saved(page);
        await page.evaluate(() => { __disk.attempts = 0; });
        for (const selector of ['[data-table-drag="row"][data-index="1"]', '#note-content td']) {
            const source = page.locator(selector).first(), start = await center(source);
            await page.mouse.move(start.x, start.y); await page.mouse.down(); await pause(page, 520);
            assert.equal(await dragging(page), true);
            assert.equal(await page.locator('#note-content').evaluate(node => node.hasPointerCapture(1)), true);
            // Android WebView releases its implicit td/button capture while
            // granting explicit capture to the stable reading container.
            await source.evaluate(node => node.dispatchEvent(new PointerEvent('lostpointercapture', {pointerId: 1, pointerType: 'mouse', bubbles: true})));
            await pause(page, 80);
            assert.equal(await dragging(page), true, 'Old-target capture loss must not cancel the transferred gesture');
            await page.locator('#note-content').evaluate(node => node.releasePointerCapture(1));
            await page.mouse.move(start.x + 1, start.y + 1);
            await page.waitForFunction(() => !NoteTableDrag.isDragging);
            await page.mouse.up(); await pause(page);
            assert.deepEqual(await saved(page), before);
            assert.equal(await page.evaluate(() => __disk.attempts), 0);
            assert.equal(await page.locator('#note-content').getAttribute('data-table-dragging'), null);
        }
    }, {native: true});
    await test('merged grids reject row and column moves without discarding content', async page => {
        await open(page); const before = await saved(page);
        for (const kind of ['row', 'column']) {
            const start = await center(page.locator(`[data-table-drag="${kind}"][data-index="0"]`));
            await page.mouse.move(start.x, start.y); await page.mouse.down(); await pause(page, 500); await page.mouse.up();
            assert.equal(await dragging(page), false);
            assert.match(await page.locator('.table-drag-status').textContent(), /合并|不规则/);
            assert.deepEqual(await saved(page), before);
        }
    }, {source: '<table><tr><td colspan="2">wide cell</td><td>right</td></tr><tr><td>left</td><td>middle</td><td>last</td></tr></table>'});
    await test('failed native commit restores reading DOM and stored HTML; retry saves once', async page => {
        await open(page); const before = await saved(page), oldRows = await rows(page);
        await page.evaluate(() => { __disk.fail = true; __disk.attempts = 0; });
        await drag(page, page.locator('#note-content td').first(), page.locator('#note-content td').last());
        assert.deepEqual(await saved(page), before); assert.deepEqual(await rows(page), oldRows);
        assert.deepEqual(await page.evaluate(() => JSON.parse(__disk.json).notes[0]), before);
        assert.equal(await page.evaluate(() => __disk.attempts), 1);
        await page.evaluate(() => { __disk.fail = false; __disk.attempts = 0; });
        await drag(page, page.locator('#note-content td').first(), page.locator('#note-content td').last());
        assert.equal(await page.evaluate(() => __disk.attempts), 1);
        assert.deepEqual((await rows(page)).slice(1), [['six', 'two bold', 'three'], ['four', 'five', 'one']]);
        assert.equal(await page.evaluate(() => JSON.parse(__disk.json).notes[0].html), await html(page)); await cleanSaved(page);
    }, {native: true});
    await test('edge hold scrolls the reading page and stops immediately after cancellation', async page => {
        await open(page); const before = await saved(page), start = await center(page.locator('[data-table-drag="row"][data-index="0"]'));
        await page.mouse.move(start.x, start.y); await page.mouse.down(); await pause(page, 500); assert.equal(await dragging(page), true);
        await page.mouse.move(start.x, 950, {steps: 10}); await pause(page, 550);
        assert.ok(await page.evaluate(() => scrollY) > 150);
        await page.keyboard.press('Escape'); await page.mouse.up();
        const stopped = await page.evaluate(() => scrollY); await pause(page, 220);
        assert.equal(await page.evaluate(() => scrollY), stopped); assert.deepEqual(await saved(page), before);
        assert.equal((await rows(page))[0][0], 'row 0');
    }, {source: '<table>' + Array.from({length: 50}, (_, i) => `<tr><td>row ${i}</td><td>value ${i}</td></tr>`).join('') + '</table>'});
    await test('stationary hold near the bottom edge never scrolls or saves until the pointer moves', async page => {
        await open(page); const before = await saved(page), scrollBefore = await page.evaluate(() => scrollY);
        const position = await page.locator('[data-table-drag="row"]').evaluateAll(handles => handles.map(node => {
            const r = node.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2};
        }).filter(point => point.y > innerHeight - 130 && point.y < innerHeight - 10).at(-1));
        assert.ok(position, 'A visible row handle is inside the bottom auto-scroll zone');
        await page.mouse.move(position.x, position.y); await page.mouse.down(); await pause(page, 1050);
        assert.equal(await dragging(page), true);
        assert.equal(await page.evaluate(() => scrollY), scrollBefore);
        await page.mouse.up(); await pause(page);
        assert.deepEqual(await saved(page), before);
        assert.equal(await page.evaluate(() => scrollY), scrollBefore);
    }, {source: '<table>' + Array.from({length: 50}, (_, i) => `<tr><td>row ${i}</td><td>value ${i}</td></tr>`).join('') + '</table>'});
    await test('tables inside lists take priority; parent order and nested checkbox remain intact', async page => {
        await open(page);
        await drag(page, page.locator('#note-content td').first(), page.locator('#note-content td').last());
        assert.deepEqual(await rows(page), [['beta', 'alpha']]);
        assert.equal(await page.locator('#note-content > ul > li').count(), 2);
        assert.equal(await page.locator('#note-content > ul > li').first().locator('table').count(), 1);
        assert.equal(await page.locator('.drag-ghost').count(), 0);
        await page.locator('#note-content .nt-checkbox').click();
        assert.equal(await page.locator('#note-content .nt-checkbox').isChecked(), true);
        assert.match(await html(page), /data-checked="true"/); await cleanSaved(page);
    }, {source: '<ul><li>parent with table<table><tr><td>alpha</td><td>beta</td></tr></table><ul><li data-task="true" data-checked="false">nested task</li><li>nested second</li></ul></li><li>parent second</li></ul>'});
    await test('nested and separate tables cannot receive another tables cell', async page => {
        await open(page); const before = await saved(page), outer = page.locator('#note-content > table').first();
        await drag(page, outer.locator(':scope > tbody > tr > td').first(), outer.locator('table td').first());
        assert.deepEqual(await saved(page), before);
        await drag(page, outer.locator('table td').first(), page.locator('#note-content > table').last().locator('td').first());
        assert.deepEqual(await saved(page), before); await cleanSaved(page);
    }, {source: '<table><tr><td>outer alpha</td><td><table><tr><td>inner alpha</td><td>inner beta</td></tr></table></td></tr></table><p>between</p><table><tr><td>other alpha</td><td>other beta</td></tr></table>'});
    await test('opening the editor during list settle flushes exactly one save before reading the draft', async page => {
        await open(page);
        await page.evaluate(() => { __disk.attempts = 0; });
        const items = page.locator('#note-content > ul > li'), start = await center(items.first()), end = await center(items.last());
        await page.mouse.move(start.x, start.y); await page.mouse.down(); await pause(page, 420);
        await page.mouse.move(end.x, end.y + 8, {steps: 8});
        assert.deepEqual(await items.allTextContents(), ['second', 'third', 'first']);
        await page.mouse.up();
        // Exercise navigation before the 185ms settle completes. Its synthetic
        // post-drag click may consume one click; the second reaches the same UI
        // handler synchronously, without waiting for the animation/save timer.
        const result = await page.evaluate(() => {
            const beforeOpen = __disk.attempts;
            const button = document.getElementById('edit-note-button');
            button.click();
            if (document.getElementById('editor-overlay').hidden) button.click();
            return {beforeOpen, attempts: __disk.attempts, text: Array.from(document.querySelectorAll('#editor-rich li'), item => item.textContent)};
        });
        assert.equal(result.beforeOpen, 0, 'The test opens while the list is still settling');
        assert.equal(result.attempts, 1);
        assert.deepEqual(result.text, ['second', 'third', 'first']);
        await pause(page, 400);
        assert.equal(await page.evaluate(() => __disk.attempts), 1, 'Late animation callbacks do not save again');
        assert.doesNotMatch(await html(page), /drag-origin|drag-ghost/);
    }, {native: true, source: '<ul><li>first</li><li>second</li><li>third</li></ul>'});
    await test('menus, display dialog, strike mode and editor hide reading handles', async page => {
        await open(page); assert.equal(await page.locator('[data-table-drag="row"]:visible').count(), 3);
        await page.locator('#note-menu-button').click(); await pause(page); assert.equal(await page.locator('[data-table-drag]:visible').count(), 0);
        await page.locator('[data-action="display"]').click(); await pause(page); assert.equal(await page.locator('[data-table-drag]:visible').count(), 0);
        await page.locator('#display-cancel').click(); await pause(page); assert.equal(await page.locator('[data-table-drag="row"]:visible').count(), 3);
        await page.locator('#strike-button').click(); await pause(page); assert.equal(await page.locator('[data-table-drag]:visible').count(), 0);
        await page.locator('#strike-button').click(); await pause(page);
        await page.locator('#edit-note-button').click(); await pause(page); assert.equal(await page.locator('[data-table-drag]:visible').count(), 0);
        await page.locator('#editor-cancel').click(); await pause(page); assert.equal(await page.locator('[data-table-drag="row"]:visible').count(), 3);
    });
    for (const scale of [65, 80, 150]) {
        await test(`${scale}% mobile viewport: touch cells and outer handles hit intended reading positions`, async (page, context) => {
            await page.locator('#display-settings').tap();
            await page.locator('#display-scale').evaluate((slider, value) => { slider.value = String(value); slider.dispatchEvent(new Event('input', {bubbles: true})); }, scale);
            await page.locator('#display-save').tap(); await pause(page, 250);
            assert.ok(Math.abs(await page.evaluate(() => visualViewport.scale) - scale / 100) < 0.02); await open(page);
            const cells = page.locator('#note-content td');
            await touchDrag(page, context, cells.first(), cells.last()); assert.deepEqual(await rows(page), [['delta', 'beta'], ['gamma', 'alpha']]);
            await touchDrag(page, context, page.locator('[data-table-drag="row"][data-index="1"]'), page.locator('#note-content tr').first());
            assert.deepEqual(await rows(page), [['gamma', 'alpha'], ['delta', 'beta']]);
            await touchDrag(page, context, page.locator('[data-table-drag="column"][data-index="0"]'), cells.nth(1));
            assert.deepEqual(await rows(page), [['alpha', 'gamma'], ['beta', 'delta']]); await cleanSaved(page);
            await page.screenshot({path: `${output}/reading-touch-${scale}.png`});
        }, {...mobile, source: '<p>before</p><table><tr><td>alpha</td><td>beta</td></tr><tr><td>gamma</td><td>delta</td></tr></table><p>after</p>'});
    }
    await test('rich editor has no handles and a long hold never rearranges cells; typing works', async (page, context) => {
        await open(page); const before = await saved(page);
        await page.locator('#edit-note-button').tap(); await pause(page);
        assert.equal(await page.locator('[data-table-drag]:visible').count(), 0); assert.equal(await page.locator('#editor-rich [data-table-drag]').count(), 0);
        const cells = page.locator('#editor-rich td'), original = await cells.allTextContents();
        // Stay in one column so desktop Chromium's touch emulation does not
        // interpret a wide diagonal swipe as its own history-back gesture.
        const source = await center(cells.first()), target = await center(cells.nth(3)), cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [source]}); await pause(page, 520); assert.equal(await dragging(page), false);
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [target]});
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []}); await pause(page);
        assert.deepEqual(await cells.allTextContents(), original, JSON.stringify(await page.evaluate(() => ({url: location.href, length: document.body.innerHTML.length, overlay: document.getElementById('editor-overlay')?.hidden, text: document.body.innerText.slice(0, 200)}))));
        await cells.first().tap(); await page.keyboard.press('End'); await page.keyboard.insertText(' typed');
        assert.match(await cells.first().innerText(), /one typed/); assert.equal(await cells.last().innerText(), 'six');
        assert.deepEqual(await saved(page), before, 'Rich text remains a draft until Save');
        await page.locator('#editor-save').tap(); await pause(page); assert.match(await html(page), /one typed/); await cleanSaved(page);
    }, mobile);
} finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
}
fs.writeFileSync(`${output}/report.json`, JSON.stringify({passed, failures}, null, 2));
fs.writeFileSync('.test-artifacts/table-drag-report.json', JSON.stringify({passed, failures}, null, 2));
console.log(`${passed} table drag tests passed; ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
