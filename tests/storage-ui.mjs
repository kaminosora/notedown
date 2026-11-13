/* Fault-injection tests of the UI against a failing native persistence bridge. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'app/src/main/assets/www');
const executablePath = [process.env.CHROME_PATH, process.env.CHROME_BIN,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean).find(candidate => fs.existsSync(candidate));
assert.ok(executablePath, 'Set CHROME_PATH to a browser');
const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(webRoot, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (!file.startsWith(webRoot + path.sep)) return response.writeHead(403).end();
    fs.readFile(file, (error, data) => {
        if (error) return response.writeHead(404).end();
        const type = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'}[path.extname(file)] || 'application/octet-stream';
        response.writeHead(200, {'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store'}).end(data);
    });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless: true, executablePath});
const originalHtml = '<p>Original paragraph</p><ul><li data-task="true" data-checked="false">task</li><li>second</li><li>third</li></ul><p>Trailing paragraph</p>';
let passed = 0;
const failures = [];

async function failWrites(page, fail) { await page.evaluate(value => { window.__disk.fail = value; }, fail); }
async function openNote(page) { await page.locator('.note-card').first().click(); }
async function menu(page, action) {
    await page.locator('#note-menu-button').click();
    await page.locator(`[data-action="${action}"]`).click();
}
async function test(name, run) {
    const context = await browser.newContext({viewport: {width: 412, height: 915}});
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({html}) => {
        window.__disk = {fail: false, attempts: 0, json: JSON.stringify({
            version: 1, seeded: true, prefs: {theme: 'auto'},
            notes: [{id: 'original', title: 'Original', html, createdAt: 1, updatedAt: 1}]
        })};
        window.NotedownNative = {
            loadData() { return window.__disk.json; },
            saveData(json) {
                window.__disk.attempts++;
                if (window.__disk.fail) return false;
                window.__disk.json = json;
                return true;
            },
            pickFiles() {}, haptic() {}, setTheme() {}
        };
    }, {html: originalHtml});
    try {
        await page.goto(baseUrl, {waitUntil: 'networkidle'});
        await run(page);
        assert.deepEqual(errors, [], 'No uncaught UI exceptions');
        console.log(`PASS ${name}`);
        passed++;
    } catch (error) {
        failures.push({name, message: error.stack});
        console.error(`FAIL ${name}: ${error.message}`);
    } finally { await context.close(); }
}

try {
    for (const edit of [false, true]) {
        await test(`${edit ? 'edit' : 'create'} failure keeps draft and retry saves`, async page => {
            if (edit) { await openNote(page); await page.locator('#edit-note-button').click(); }
            else await page.locator('#new-note-fab').click();
            await page.locator('#editor-title').fill('Draft title');
            await page.locator('[data-editor-mode="markdown"]').click();
            await page.locator('#editor-textarea').fill('Unsaved draft content');
            await failWrites(page, true);
            await page.locator('#editor-save').click();
            assert.equal(await page.locator('#editor-overlay').isVisible(), true);
            assert.equal(await page.locator('#editor-textarea').inputValue(), 'Unsaved draft content');
            assert.equal(await page.evaluate(() => NoteStore.getNote('original').title), 'Original');
            await failWrites(page, false);
            await page.locator('#editor-save').click();
            assert.equal(await page.locator('#editor-overlay').isVisible(), false);
            assert.match(await page.locator('#note-content').innerText(), /Unsaved draft content/);
            assert.equal(await page.evaluate(() => NoteStore.getNotes().length), edit ? 1 : 2);
        });
    }

    await test('delete failure keeps confirmation and note; retry deletes', async page => {
        await openNote(page);
        await menu(page, 'delete');
        await failWrites(page, true);
        await page.locator('#confirm-ok').click();
        assert.equal(await page.locator('#confirm-dialog').isVisible(), true);
        assert.equal(await page.evaluate(() => NoteStore.getNotes().length), 1);
        assert.doesNotMatch(await page.locator('#toast').innerText(), /已删除/);
        await failWrites(page, false);
        await page.locator('#confirm-ok').click();
        assert.equal(await page.locator('#confirm-dialog').isVisible(), false);
        assert.equal(await page.evaluate(() => NoteStore.getNotes().length), 0);
    });

    await test('rename failure preserves input and original title', async page => {
        await openNote(page);
        await menu(page, 'rename');
        await page.locator('#rename-input').fill('New title');
        await failWrites(page, true);
        await page.locator('#rename-form button[type="submit"]').click();
        assert.equal(await page.locator('#rename-dialog').isVisible(), true);
        assert.equal(await page.locator('#rename-input').inputValue(), 'New title');
        assert.equal(await page.locator('#note-title').innerText(), 'Original');
        await failWrites(page, false);
        await page.locator('#rename-form button[type="submit"]').click();
        assert.equal(await page.locator('#rename-dialog').isVisible(), false);
        assert.equal(await page.locator('#note-title').innerText(), 'New title');
    });

    await test('checkbox, strike, and reorder failures restore committed reading content', async page => {
        await openNote(page);
        await failWrites(page, true);
        await page.locator('#note-content .nt-checkbox').click();
        assert.equal(await page.locator('#note-content .nt-checkbox').isChecked(), false);
        await page.locator('#strike-button').click();
        await page.locator('#note-content p').first().click();
        assert.equal(await page.locator('#note-content p').first().getAttribute('data-struck'), null);
        await page.locator('#strike-done').click();
        const second = await page.locator('#note-content li').nth(1).boundingBox();
        const third = await page.locator('#note-content li').nth(2).boundingBox();
        await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(450);
        await page.mouse.move(third.x + third.width / 2, third.y + third.height + 8, {steps: 12});
        await page.mouse.up();
        await page.waitForTimeout(400);
        assert.deepEqual(await page.locator('#note-content li').allTextContents(), ['task', 'second', 'third']);
        assert.equal(await page.evaluate(() => window.__disk.attempts), 3, 'Reorder reached the save boundary');
        assert.equal(await page.evaluate(() => NoteStore.getNote('original').html), originalHtml);
    });

    for (const append of [false, true]) {
        await test(`${append ? 'append' : 'new'} import failure retains content in an editor for retry`, async page => {
            if (append) { await openNote(page); await menu(page, 'import'); }
            else await page.locator('#import-library').click();
            await failWrites(page, true);
            await page.evaluate(() => Notedown.onNativeFiles({
                files: [{name: 'pending.md', format: 'markdown', text: '# Imported\n\nPending import content'}], errors: [], cancelled: false
            }));
            assert.equal(await page.locator('#editor-overlay').isVisible(), true);
            assert.match(await page.locator('#editor-rich').innerText(), /Pending import content/);
            if (append) assert.match(await page.locator('#editor-rich').innerText(), /Original paragraph/);
            assert.equal(await page.evaluate(() => NoteStore.getNotes().length), 1);
            assert.equal(await page.evaluate(() => NoteStore.getNote('original').html), originalHtml);
            assert.doesNotMatch(await page.locator('#toast').innerText(), /已导入/);
            await failWrites(page, false);
            await page.locator('#editor-save').click();
            assert.equal(await page.locator('#editor-overlay').isVisible(), false);
            assert.match(await page.locator('#note-content').innerText(), /Pending import content/);
            assert.equal(await page.evaluate(() => NoteStore.getNotes().length), append ? 1 : 2);
        });
    }

    await test('theme failure retains the displayed and persisted preference', async page => {
        await failWrites(page, true);
        await page.locator('#theme-toggle').click();
        assert.equal(await page.locator('#theme-toggle').getAttribute('data-mode'), 'auto');
        assert.equal(await page.evaluate(() => NoteStore.getPrefs().theme), 'auto');
        await failWrites(page, false);
        await page.locator('#theme-toggle').click();
        assert.equal(await page.locator('#theme-toggle').getAttribute('data-mode'), 'light');
        assert.equal(await page.evaluate(() => NoteStore.getPrefs().theme), 'light');
    });
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
console.log(`${passed} storage UI regressions passed; ${failures.length} failed.`);
if (failures.length) {
    for (const failure of failures) console.error(failure.name + '\n' + failure.message);
    process.exitCode = 1;
}
