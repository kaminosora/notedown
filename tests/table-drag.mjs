/* Browser pointer integration: hold first, then move, release/cancel. */
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
    const route = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, route === '/' ? 'index.html' : route.slice(1));
    if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
    fs.readFile(file, (error, body) => {
        if (error) return response.writeHead(404).end();
        response.writeHead(200, {'Content-Type': {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2'}[path.extname(file)] || 'application/octet-stream'}).end(body);
    });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({executablePath, headless: true});
const failures = [];
let passed = 0;
const fixture = '<p>above table</p><table><thead><tr><th>A head</th><th>B head</th><th>C head</th></tr></thead><tbody><tr><td>one</td><td><strong>two bold</strong></td><td>three</td></tr><tr><td>four</td><td>five</td><td>six</td></tr></tbody></table><p>after table</p>';

async function open(page, html = fixture) {
    await page.locator('#new-note-fab').click();
    await page.locator('[data-editor-mode="html"]').click();
    await page.locator('#editor-textarea').fill(html);
    await page.locator('[data-editor-mode="rich"]').click();
    await page.waitForTimeout(160);
}
const html = page => page.evaluate(() => __editor.getHTML());
const rows = page => page.locator('#editor-rich table tr').evaluateAll(nodes => nodes.map(row => Array.from(row.cells).map(cell => cell.textContent)));
async function center(locator) {
    const rect = await locator.boundingBox();
    assert.ok(rect, 'Gesture target is visible');
    return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
}
async function drag(page, source, destination, {cancel = false, duration = 480} = {}) {
    const start = await center(source);
    const end = await center(destination);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.waitForTimeout(duration);
    if (duration >= 430) assert.equal(await page.locator('#editor-rich').getAttribute('data-table-dragging'), 'true');
    await page.mouse.move(end.x, end.y, {steps: 12});
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(100);
}
async function test(name, callback, options = {}) {
    if (process.env.TEST_FILTER && !new RegExp(process.env.TEST_FILTER).test(name)) return;
    const context = await browser.newContext({viewport: {width: 640, height: 960}, ...options});
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto(`http://127.0.0.1:${server.address().port}`, {waitUntil: 'networkidle'});
        await page.evaluate(() => {
            const create = NoteRichEditor.create;
            NoteRichEditor.create = (...args) => window.__editor = create(...args);
        });
        await callback(page, context);
        assert.deepEqual(errors, []);
        console.log(`PASS ${name}`); passed++;
    } catch (error) {
        failures.push({name, error: error.stack});
        console.error(`FAIL ${name}: ${error.stack}`);
        fs.mkdirSync('.test-artifacts', {recursive: true});
        await page.screenshot({path: `.test-artifacts/table-drag-failure-${failures.length}.png`});
    } finally { await context.close(); }
}

try {
    await test('row gutter hold reorders row contents and preserves header roles; one undo', async page => {
        await open(page);
        const before = await html(page);
        await drag(page, page.locator('[data-table-drag="row"][data-index="2"]'), page.locator('#editor-rich tr').first());
        assert.deepEqual(await rows(page), [['four', 'five', 'six'], ['A head', 'B head', 'C head'], ['one', 'two bold', 'three']]);
        assert.equal(await page.locator('#editor-rich tr').first().locator('th').count(), 3);
        assert.ok((await html(page)).includes('<thead>'));
        await page.locator('[data-rich-action="undo"]').click();
        assert.equal(await html(page), before);
        await page.locator('[data-rich-action="redo"]').click();
        assert.equal((await rows(page))[0][0], 'four');
    });
    await test('column gutter hold reorders every row, without losing rich content', async page => {
        await open(page);
        const before = await html(page);
        await drag(page, page.locator('[data-table-drag="column"][data-index="0"]'), page.locator('#editor-rich th').nth(2));
        assert.deepEqual(await rows(page), [['B head', 'C head', 'A head'], ['two bold', 'three', 'one'], ['five', 'six', 'four']]);
        assert.equal(await page.locator('#editor-rich td strong').innerText(), 'two bold');
        await page.locator('[data-rich-action="undo"]').click();
        assert.equal(await html(page), before);
    });
    await test('column gutter stays above caption and does not intercept caption focus', async page => {
        await open(page, '<p>before</p><table><caption>original caption</caption><tr><td>alpha</td><td>beta</td></tr><tr><td>gamma</td><td>delta</td></tr></table>');
        const before = await html(page);
        const caption = page.locator('#editor-rich caption');
        const captionRect = await caption.boundingBox();
        for (const handle of await page.locator('[data-table-drag="column"]').all()) {
            const rect = await handle.boundingBox();
            assert.ok(rect.y + rect.height <= captionRect.y, JSON.stringify({rect, captionRect}));
        }
        await caption.click();
        assert.equal(await caption.evaluate(element => document.activeElement === element), true);
        await page.keyboard.type('must not enter caption');
        assert.equal(await html(page), before);
        await drag(page, page.locator('[data-table-drag="column"][data-index="0"]'), page.locator('#editor-rich td').nth(1));
        assert.deepEqual(await rows(page), [['beta', 'alpha'], ['delta', 'gamma']]);
        assert.equal(await caption.textContent(), 'original caption');
    });
    await test('cell hold swaps unequal length rich contents and retains both cells', async page => {
        await open(page);
        const before = await html(page);
        await drag(page, page.locator('#editor-rich td').nth(1), page.locator('#editor-rich td').nth(5));
        assert.deepEqual(await rows(page), [['A head', 'B head', 'C head'], ['one', 'six', 'three'], ['four', 'five', 'two bold']]);
        assert.equal(await page.locator('#editor-rich td').nth(5).locator('strong').innerText(), 'two bold');
        const saved = await html(page);
        assert.ok(!/table-drag|data-table-dragging/.test(saved));
        await page.locator('[data-rich-action="undo"]').click();
        assert.equal(await html(page), before);
    });
    await test('escape and outside drop cancel with no content/history mutation', async page => {
        await open(page);
        const before = await html(page);
        await drag(page, page.locator('[data-table-drag="row"][data-index="2"]'), page.locator('#editor-rich tr').first(), {cancel: true});
        assert.equal(await html(page), before);
        await drag(page, page.locator('#editor-rich td').first(), page.locator('#editor-rich > p').last());
        assert.equal(await html(page), before);
        assert.equal(await page.locator('#editor-rich').getAttribute('data-table-dragging'), null);
    });
    await test('movement before long-press deadline keeps normal text/scroll gesture', async page => {
        await open(page);
        const before = await html(page);
        await drag(page, page.locator('#editor-rich td').first(), page.locator('#editor-rich td').nth(2), {duration: 40});
        assert.equal(await html(page), before);
        assert.equal(await page.locator('#editor-rich').getAttribute('data-table-dragging'), null);
    });
    await test('merged grid rejects row moves but permits safe cell content exchange', async page => {
        await open(page, '<table><tr><td colspan="2">wide cell</td><td>right</td></tr><tr><td>left</td><td>middle</td><td>last</td></tr></table>');
        const before = await html(page);
        const start = await center(page.locator('[data-table-drag="row"][data-index="0"]'));
        await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.waitForTimeout(480); await page.mouse.up();
        assert.match(await page.locator('.table-drag-status').innerText(), /合并单元格/);
        assert.equal(await html(page), before);
        await drag(page, page.locator('#editor-rich td').first(), page.locator('#editor-rich td').last());
        assert.equal(await page.locator('#editor-rich td').first().innerText(), 'last');
        assert.equal(await page.locator('#editor-rich td').last().innerText(), 'wide cell');
        assert.equal(await page.locator('#editor-rich td').first().getAttribute('colspan'), '2');
    });
    await test('touch long-press swaps cells through real browser touch events', async (page, context) => {
        await open(page);
        const source = await center(page.locator('#editor-rich td').first());
        const target = await center(page.locator('#editor-rich td').last());
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [source]});
        await page.waitForTimeout(500);
        assert.equal(await page.locator('#editor-rich').getAttribute('data-table-dragging'), 'true');
        for (let i = 1; i <= 10; i++) {
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: source.x + (target.x - source.x) * i / 10, y: source.y + (target.y - source.y) * i / 10}]});
            await page.waitForTimeout(20);
        }
        fs.mkdirSync('.test-artifacts', {recursive: true});
        await page.screenshot({path: '.test-artifacts/table-drag-mobile.png'});
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        await page.waitForTimeout(120);
        assert.deepEqual(await rows(page), [['A head', 'B head', 'C head'], ['six', 'two bold', 'three'], ['four', 'five', 'one']]);
    }, {hasTouch: true, isMobile: true, viewport: {width: 412, height: 915}});
    await test('touch swipe before holding does not reorder or start dragging', async (page, context) => {
        await open(page);
        const before = await html(page);
        const source = await center(page.locator('#editor-rich td').first());
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [source]});
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: source.x, y: source.y - 90}]});
        await page.waitForTimeout(500);
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        assert.equal(await html(page), before);
        assert.equal(await page.locator('#editor-rich').getAttribute('data-table-dragging'), null);
    }, {hasTouch: true, isMobile: true});
    await test('edge hold scrolls long table and stops immediately after cancellation', async page => {
        await open(page, '<table>' + Array.from({length: 50}, (_, i) => `<tr><td>row ${i}</td><td>value ${i}</td></tr>`).join('') + '</table>');
        const start = await center(page.locator('[data-table-drag="row"][data-index="0"]'));
        const scroll = await page.locator('.editor-scroll').boundingBox();
        await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.waitForTimeout(480);
        await page.mouse.move(start.x, scroll.y + scroll.height - 5, {steps: 10});
        await page.waitForTimeout(550);
        const moved = await page.locator('.editor-scroll').evaluate(element => element.scrollTop);
        assert.ok(moved > 150, String(moved));
        await page.keyboard.press('Escape'); await page.mouse.up();
        const stopped = await page.locator('.editor-scroll').evaluate(element => element.scrollTop);
        await page.waitForTimeout(200);
        assert.equal(await page.locator('.editor-scroll').evaluate(element => element.scrollTop), stopped);
        assert.equal((await rows(page))[0][0], 'row 0');
    });
    await test('switching editor modes removes handles and cancels a pending hold', async page => {
        await open(page);
        assert.equal(await page.locator('.table-drag-layer').count(), 1);
        await page.locator('[data-editor-mode="html"]').click();
        await page.waitForTimeout(150);
        assert.equal(await page.locator('.table-drag-handle:visible').count(), 0);
        await page.locator('[data-editor-mode="rich"]').click();
        await page.waitForTimeout(150);
        assert.equal(await page.locator('.table-drag-layer').count(), 1);
        assert.equal(await page.locator('[data-table-drag="row"]').count(), 3);
    });
    await test('lost pointer capture cancels without editing and inert editor hides handles', async page => {
        await open(page);
        const before = await html(page);
        const source = await center(page.locator('#editor-rich td').first());
        await page.mouse.move(source.x, source.y); await page.mouse.down(); await page.waitForTimeout(480);
        assert.equal(await page.locator('#editor-rich').getAttribute('data-table-dragging'), 'true');
        await page.evaluate(() => document.getElementById('editor-rich').releasePointerCapture(1));
        await page.waitForTimeout(80);
        await page.mouse.up();
        assert.equal(await page.locator('#editor-rich').getAttribute('data-table-dragging'), null);
        assert.equal(await html(page), before);
        await page.evaluate(() => document.querySelector('.editor-shell').inert = true);
        await page.waitForTimeout(100);
        assert.equal(await page.locator('.table-drag-handle').count(), 0);
        await page.evaluate(() => document.querySelector('.editor-shell').inert = false);
        await page.waitForTimeout(100);
        assert.equal(await page.locator('[data-table-drag="row"]').count(), 3);
    });
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
fs.mkdirSync('.test-artifacts', {recursive: true});
fs.writeFileSync('.test-artifacts/table-drag-report.json', JSON.stringify({passed, failures}, null, 2));
console.log(`${passed} table drag tests passed; ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
