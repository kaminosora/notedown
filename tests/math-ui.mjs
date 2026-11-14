/* Formula UI checks in Chromium. Keyboard-sized viewports simulate layout;
 * Android IME and native touch acceptance are recorded separately. */
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'app/src/main/assets/www');
const executablePath = [process.env.CHROME_PATH, process.env.CHROME_BIN,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean).find(candidate => fs.existsSync(candidate));
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chrome/Chromium browser');
const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(webRoot, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (!file.startsWith(webRoot + path.sep)) return response.writeHead(403).end();
    fs.readFile(file, (error, data) => {
        if (error) return response.writeHead(404).end();
        const type = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
            '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf'}[path.extname(file)] || 'application/octet-stream';
        response.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store'}).end(data);
    });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({executablePath, headless: true});
const artifacts = path.join(root, '.test-artifacts/math-ui');
fs.mkdirSync(artifacts, {recursive: true});
const results = [];

async function settle(page) { await page.waitForTimeout(120); }
async function instrument(page) {
    await page.evaluate(() => {
        const create = NoteRichEditor.create;
        NoteRichEditor.create = (...args) => window.__editor = create(...args);
    });
}
async function openHtml(page, html = '<p>Before formula. After formula.</p>') {
    await page.locator('#new-note-fab').click();
    await page.locator('#editor-title').fill('Formula UI regression');
    await page.locator('[data-editor-mode="html"]').click();
    await page.locator('#editor-textarea').fill(html);
    await page.locator('[data-editor-mode="rich"]').click();
    await settle(page);
    await page.evaluate(() => __editor.focus('end'));
    await settle(page);
}
async function showTools(page) {
    const toggle = page.locator('#editor-math-toggle');
    if (await toggle.getAttribute('aria-checked') !== 'true') await toggle.click();
    assert.equal(await page.locator('#math-toolbar').isVisible(), true);
}
async function formulaDialog(page, name = '分式') {
    await showTools(page);
    await page.locator('#math-toolbar').getByRole('button', {name, exact: true}).click();
    await page.locator('#editor-math-layer').waitFor({state: 'visible'});
    await settle(page);
}
async function modelHtml(page) { return page.evaluate(() => __editor.getHTML()); }
async function test(name, run, settings = {}) {
    if (process.env.TEST_FILTER && !new RegExp(process.env.TEST_FILTER).test(name)) return;
    const context = await browser.newContext({viewport: {width: 412, height: 915}, ...settings});
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    const external = [];
    const failedResources = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => {
        if (request.url().startsWith(baseUrl)) failedResources.push(request.url());
    });
    page.on('response', response => {
        if (response.url().startsWith(baseUrl) && response.status() >= 400) failedResources.push(response.url());
    });
    await context.route('**/*', route => {
        if (route.request().url().startsWith(baseUrl)) return route.continue();
        external.push(route.request().url());
        return route.abort('internetdisconnected');
    });
    try {
        await page.goto(baseUrl, {waitUntil: 'networkidle'});
        await instrument(page);
        await run(page, context);
        assert.deepEqual(errors, [], 'No uncaught formula UI errors');
        assert.deepEqual(failedResources, [], 'All bundled scripts, CSS and fonts load');
        assert.deepEqual(external, [], 'No external resources needed while offline');
        console.log(`PASS ${name}`);
        results.push({name, passed: true});
    } catch (error) {
        console.error(`FAIL ${name}: ${error.message}`);
        results.push({name, passed: false, error: error.stack});
        await page.screenshot({path: path.join(artifacts, `failure-${results.length}.png`)}).catch(() => {});
    } finally { await context.close(); }
}

try {
    await test('formula switch adds a third row, hides in source modes and persists on reopen', async page => {
        await openHtml(page);
        assert.equal(await page.locator('#editor-math-toggle').getAttribute('aria-checked'), 'false');
        assert.equal(await page.locator('#math-toolbar').isHidden(), true);
        assert.equal(await page.locator('#rich-toolbar > .rich-toolbar-row:visible').count(), 2);
        await showTools(page);
        assert.equal(await page.locator('#rich-toolbar > .rich-toolbar-row:visible').count(), 3);
        for (const mode of ['markdown', 'html']) {
            await page.locator(`[data-editor-mode="${mode}"]`).click();
            assert.equal(await page.locator('#editor-math-toggle').isHidden(), true);
            assert.equal(await page.locator('#math-toolbar').isVisible(), false);
        }
        await page.locator('[data-editor-mode="rich"]').click();
        assert.equal(await page.locator('#math-toolbar').isVisible(), true);
        await page.locator('#editor-save').click();
        await page.reload({waitUntil: 'networkidle'});
        await instrument(page);
        await page.locator('#new-note-fab').click();
        assert.equal(await page.locator('#editor-math-toggle').getAttribute('aria-checked'), 'true');
        assert.equal(await page.locator('#math-toolbar').isVisible(), true);
        await page.locator('#editor-math-toggle').click();
        assert.equal(await page.locator('#math-toolbar').isHidden(), true);
    });

    await test('template insertion, double-click editing, deletion and undo preserve formula source', async page => {
        await openHtml(page);
        await formulaDialog(page);
        assert.equal(await page.locator('#editor-math-input').inputValue(), String.raw`\frac{a}{b}`);
        assert.equal(await page.locator('#editor-math-preview .katex').count(), 1);
        await page.locator('#editor-math-apply').click();
        assert.equal(await page.locator('#editor-rich [data-math="inline"]').getAttribute('data-latex'), String.raw`\frac{a}{b}`);
        await page.locator('#editor-rich [data-math]').dblclick();
        assert.equal(await page.locator('#editor-math-input').inputValue(), String.raw`\frac{a}{b}`);
        await page.locator('#editor-math-input').fill('E=mc^2');
        await page.locator('#editor-math-layout').selectOption('block');
        await page.locator('#editor-math-apply').click();
        assert.equal(await page.locator('#editor-rich [data-math="block"]').getAttribute('data-latex'), 'E=mc^2');
        const beforeDelete = await modelHtml(page);
        await page.locator('#editor-rich [data-math]').dblclick();
        await page.locator('#editor-math-delete').click();
        assert.equal(await page.locator('#editor-rich [data-math]').count(), 0);
        await page.locator('[data-rich-action="undo"]').click();
        assert.equal(await modelHtml(page), beforeDelete);
        assert.doesNotMatch(await modelHtml(page), /class="katex|contenteditable|editor-math/);
    });

    await test('cancel and Android Back discard formula dialog edits without changing the document', async page => {
        await openHtml(page, '<p>Keep <span data-math="inline" data-latex="x^2">x^2</span> unchanged.</p>');
        const before = await modelHtml(page);
        for (const viaBack of [false, true]) {
            await page.locator('#editor-rich [data-math]').dblclick();
            await page.locator('#editor-math-input').fill('changed^{999}');
            if (viaBack) assert.equal(await page.evaluate(() => Notedown.handleBack()), true);
            else await page.locator('#editor-math-layer').getByRole('button', {name: '取消', exact: true}).click();
            assert.equal(await page.locator('#editor-math-layer').isHidden(), true);
            assert.equal(await page.locator('#editor-overlay').isVisible(), true);
            assert.equal(await page.locator('#editor-form').evaluate(node => node.inert), false);
            assert.equal(await modelHtml(page), before);
        }
    });

    await test('Markdown and HTML formula code round-trips through rich editing and saved reading', async page => {
        await openHtml(page);
        const markdown = String.raw`Inline $x_i^2$ and \(\alpha+\beta\).

$$
\frac{1}{2}
$$

\[\sum_{i=1}^{n} i\]` + '\n\n`$literal$`';
        await page.locator('[data-editor-mode="markdown"]').click();
        await page.locator('#editor-textarea').fill(markdown);
        await page.locator('[data-editor-mode="rich"]').click();
        await settle(page);
        assert.equal(await page.locator('#editor-rich [data-math]').count(), 4);
        const formulas = await page.locator('#editor-rich [data-math]').evaluateAll(nodes => nodes.map(n => [n.dataset.math, n.dataset.latex]));
        for (const mode of ['html', 'markdown', 'html', 'rich']) await page.locator(`[data-editor-mode="${mode}"]`).click();
        assert.deepEqual(await page.locator('#editor-rich [data-math]').evaluateAll(nodes => nodes.map(n => [n.dataset.math, n.dataset.latex])), formulas);
        await page.locator('#editor-save').click();
        assert.equal(await page.locator('#note-content [data-math] .katex').count(), 4);
        await page.locator('#edit-note-button').click();
        assert.deepEqual(await page.locator('#editor-rich [data-math]').evaluateAll(nodes => nodes.map(n => [n.dataset.math, n.dataset.latex])), formulas);
    });

    for (const width of [412, 320]) {
        await test(`formula row and dialog remain usable at ${width}px with a keyboard-sized viewport`, async page => {
            await openHtml(page, Array.from({length: 60}, (_, i) => `<p>Long formula note line ${i}</p>`).join(''));
            await showTools(page);
            await page.setViewportSize({width, height: 400});
            await page.evaluate(() => __editor.focus('end'));
            await settle(page);
            const seam = await page.evaluate(() => {
                const scroll = document.querySelector('.editor-scroll').getBoundingClientRect();
                const toolbar = document.getElementById('rich-toolbar').getBoundingClientRect();
                const hitsEditor = document.elementFromPoint(scroll.left + scroll.width / 2, toolbar.top - 1)?.closest('#editor-rich');
                return {scrollTop: scroll.top, toolbarTop: toolbar.top, hitsEditor: Boolean(hitsEditor)};
            });
            assert.ok(Math.abs(seam.scrollTop - seam.toolbarTop) <= 1, JSON.stringify(seam));
            assert.equal(seam.hitsEditor, false);
            await formulaDialog(page);
            await page.locator('#editor-math-input').fill(String.raw`\int_0^1 x^2\,dx`);
            await settle(page);
            const dialog = await page.locator('.editor-math-dialog').boundingBox();
            assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= width + 1, JSON.stringify(dialog));
            assert.ok(dialog.y >= 0 && dialog.y + dialog.height <= 401, JSON.stringify(dialog));
            await page.locator('#editor-math-apply').scrollIntoViewIfNeeded();
            await page.screenshot({path: path.join(artifacts, `dialog-${width}.png`)});
            await page.locator('#editor-math-apply').click();
            assert.equal(await page.locator('#editor-rich [data-math]').getAttribute('data-latex'), String.raw`\int_0^1 x^2\,dx`);
        }, {viewport: {width, height: 915}});
    }

    await test('empty and invalid formula input are recoverable without losing source', async page => {
        await openHtml(page);
        await formulaDialog(page, '行内公式');
        assert.equal(await page.locator('#editor-math-apply').isDisabled(), true);
        const invalid = String.raw`\unknowncommand{x}`;
        await page.locator('#editor-math-input').fill(invalid);
        await settle(page);
        assert.equal(await page.locator('#editor-math-error').isVisible(), true);
        assert.equal(await page.locator('#editor-math-apply').isEnabled(), true);
        await page.locator('#editor-math-apply').click();
        assert.equal(await page.locator('#editor-rich [data-math]').getAttribute('data-latex'), invalid);
        assert.equal(await page.locator('#editor-rich .nt-math-error').count(), 1);
        await page.locator('#editor-rich [data-math]').dblclick();
        await page.locator('#editor-math-input').fill('x^2');
        await page.locator('#editor-math-apply').click();
        assert.equal(await page.locator('#editor-rich .nt-math-error').count(), 0);
        assert.equal(await page.locator('#editor-rich .katex').count(), 1);
    });

    await test('formula display and preview load bundled KaTeX fonts with external networking blocked', async page => {
        await openHtml(page);
        await formulaDialog(page, '矩阵');
        await page.locator('#editor-math-input').fill(String.raw`\mathbb{R} \quad \mathcal{L} \quad \int_0^\infty \frac{\sqrt{x}}{1+x^2}\,dx \quad \begin{pmatrix} a & b \\ c & d \end{pmatrix}`);
        await settle(page);
        await page.evaluate(() => document.fonts.ready);
        const fonts = await page.evaluate(() => Array.from(document.fonts).filter(font => /KaTeX/.test(font.family)).map(font => ({family: font.family, status: font.status})));
        assert.ok(fonts.some(font => font.status === 'loaded'), JSON.stringify(fonts));
        assert.ok(fonts.every(font => font.status !== 'error'), JSON.stringify(fonts));
        assert.equal(await page.locator('#editor-math-preview .katex').count(), 1);
        await page.locator('#editor-math-apply').click();
        await page.locator('#editor-save').click();
        assert.equal(await page.locator('#note-content .katex').count(), 1);
        await page.screenshot({path: path.join(artifacts, 'offline-formula.png')});
    });
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
const passed = results.filter(result => result.passed).length;
const failed = results.length - passed;
fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify({passed, failed, results}, null, 2));
console.log(`${passed} formula UI regressions passed; ${failed} failed.`);
if (failed) process.exitCode = 1;
