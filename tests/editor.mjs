/* Rich-editor regressions in real Chromium. The viewport/composition cases are
 * deterministic browser simulations, not substitutes for an Android IME test.
 * Run npm run build:editor && node tests/editor.mjs.
 */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'app/src/main/assets/www');
const candidates = [process.env.CHROME_PATH, process.env.CHROME_BIN,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const executablePath = candidates.find(candidate => fs.existsSync(candidate));
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chrome/Chromium browser');
const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const resolved = path.resolve(webRoot, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (!resolved.startsWith(webRoot + path.sep)) return response.writeHead(403).end();
    fs.readFile(resolved, (error, data) => {
        if (error) return response.writeHead(404).end();
        const type = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'}[path.extname(resolved)] || 'application/octet-stream';
        response.writeHead(200, {'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store'}).end(data);
    });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({executablePath, headless: true});
let passed = 0;
const failures = [];

async function settle(page) { await page.waitForTimeout(70); }
async function openHtml(page, html = '<p>alpha beta gamma</p>') {
    await page.locator('#new-note-fab').click();
    await page.locator('[data-editor-mode="html"]').click();
    await page.locator('#editor-title').fill('Editor regression');
    await page.locator('#editor-textarea').fill(html);
    await page.locator('[data-editor-mode="rich"]').click();
    await settle(page);
    assert.ok(await page.evaluate(() => Boolean(window.__editor?.view)), 'App uses the transaction-based editor');
}
async function tool(page, action, value) {
    let selector = `[data-rich-action="${action}"]`;
    if (value) selector += `[data-rich-value="${value}"]`;
    await page.locator(selector).click();
    await settle(page);
}
async function html(page) { return page.evaluate(() => window.__editor.getHTML()); }
async function select(page, startText, endText = startText, options = {}) {
    await page.evaluate(({startText, endText, options}) => {
        const rich = document.getElementById('editor-rich');
        const walker = document.createTreeWalker(rich, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        const start = nodes.find(node => node.textContent.includes(startText));
        const end = nodes.find(node => node.textContent.includes(endText));
        if (!start || !end) throw new Error(`Text not found: ${startText} / ${endText}`);
        const a = start.textContent.indexOf(startText) + (options.atEnd ? startText.length : 0);
        const b = options.caret ? a : end.textContent.indexOf(endText) + endText.length;
        rich.focus({preventScroll: true});
        const selection = getSelection();
        if (options.reverse) selection.setBaseAndExtent(end, b, start, a);
        else selection.setBaseAndExtent(start, a, end, b);
    }, {startText, endText, options});
    await settle(page);
}
async function core(page, action, value) {
    const result = await page.evaluate(({action, value}) => window.__editor.run(action, value), {action, value});
    await settle(page);
    return result;
}
async function snapshotSelection(page) {
    return page.evaluate(() => {
        const selection = getSelection();
        const view = window.__editor.view;
        return {anchor: view.posAtDOM(selection.anchorNode, selection.anchorOffset),
            head: view.posAtDOM(selection.focusNode, selection.focusOffset), text: selection.toString()};
    });
}
async function test(name, fn, settings = {}) {
    if (process.env.TEST_FILTER && !new RegExp(process.env.TEST_FILTER).test(name)) return;
    const context = await browser.newContext({viewport: {width: 412, height: 915}, deviceScaleFactor: 1, ...settings});
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.addInitScript(() => {
        window.__testViewport = {height: 915, offsetTop: 0};
        Object.defineProperties(visualViewport, {
            height: {get: () => window.__testViewport.height, configurable: true},
            offsetTop: {get: () => window.__testViewport.offsetTop, configurable: true}
        });
    });
    try {
        await page.goto(baseUrl, {waitUntil: 'networkidle'});
        await page.evaluate(() => {
            const create = window.NoteRichEditor.create;
            window.NoteRichEditor.create = function (...args) {
                const editor = create(...args);
                window.__editor = editor;
                return editor;
            };
        });
        await fn(page, context);
        assert.deepEqual(errors, [], 'No runtime exceptions');
        console.log(`PASS ${name}`);
        passed++;
    } catch (error) {
        failures.push({name, message: error.stack});
        console.error(`FAIL ${name}: ${error.message}`);
        fs.mkdirSync(path.join(root, '.test-artifacts'), {recursive: true});
        await page.screenshot({path: path.join(root, '.test-artifacts', `editor-failure-${failures.length}.png`)}).catch(() => {});
    } finally { await context.close(); }
}

try {
    for (const [action, selector] of [['bold', 'strong'], ['italic', 'em'], ['strike', 's, del'], ['inline-code', 'code']]) {
        await test(`${action}: apply/toggle/undo/redo`, async page => {
            await openHtml(page);
            await select(page, 'beta');
            await tool(page, action);
            assert.equal(await page.locator('#editor-rich').locator(selector).innerText(), 'beta');
            await tool(page, 'undo');
            assert.equal(await page.locator('#editor-rich').locator(selector).count(), 0);
            await tool(page, 'redo');
            assert.equal(await page.locator('#editor-rich').locator(selector).innerText(), 'beta');
            await select(page, 'beta');
            await tool(page, action);
            assert.equal(await page.locator('#editor-rich').locator(selector).count(), 0);
            assert.equal(await page.locator('#editor-rich').innerText(), 'alpha beta gamma');
        });
    }
    await test('headings and paragraph keep surrounding text', async page => {
        await openHtml(page, '<p>before</p><p>heading</p><p>after</p>');
        for (const tag of ['h1', 'h2', 'h3', 'p']) {
            await select(page, 'heading', 'heading', {caret: true});
            await tool(page, 'format', `<${tag}>`);
            assert.equal(await page.locator(`#editor-rich > ${tag}`).filter({hasText: 'heading'}).count(), 1);
        }
        assert.equal(await page.locator('#editor-rich > p').count(), 3);
    });
    await test('multi-paragraph inline code remains valid and clear removes marks', async page => {
        await openHtml(page, '<p>alpha</p><p>beta</p>');
        await select(page, 'alpha', 'beta');
        await tool(page, 'inline-code');
        assert.equal(await page.locator('#editor-rich > p > code').count(), 2);
        assert.equal(await page.locator('#editor-rich code p, #editor-rich code code').count(), 0);
        await tool(page, 'clear');
        assert.equal(await page.locator('#editor-rich code, #editor-rich strong, #editor-rich em').count(), 0);
    });
    await test('multi-paragraph bullet and numbered lists toggle', async page => {
        await openHtml(page, '<p>alpha</p><p>beta</p><p>tail</p>');
        await select(page, 'alpha', 'beta');
        await tool(page, 'bullet-list');
        assert.equal(await page.locator('#editor-rich > ul > li').count(), 2);
        await select(page, 'alpha', 'beta');
        await tool(page, 'number-list');
        assert.equal(await page.locator('#editor-rich > ol > li').count(), 2);
        assert.equal(await page.locator('#editor-rich > ul').count(), 0);
        await select(page, 'alpha', 'beta');
        await tool(page, 'number-list');
        assert.equal(await page.locator('#editor-rich > ol').count(), 0);
        assert.equal(await page.locator('#editor-rich > p').count(), 3);
    });
    await test('task list converts complete selection and checkbox undo works', async page => {
        await openHtml(page, '<p>alpha</p><p>beta</p><p>tail</p>');
        await select(page, 'alpha', 'beta');
        await tool(page, 'task-list');
        assert.equal(await page.locator('#editor-rich li[data-task="true"]').count(), 2);
        const checkbox = page.locator('#editor-rich .nt-checkbox').first();
        await checkbox.click();
        await settle(page);
        assert.equal(await checkbox.isChecked(), true);
        await tool(page, 'undo');
        assert.equal(await checkbox.isChecked(), false);
        await tool(page, 'redo');
        assert.equal(await checkbox.isChecked(), true);
        await page.locator('[data-editor-mode="markdown"]').click();
        const markdown = await page.locator('#editor-textarea').inputValue();
        assert.match(markdown, /- \[x\] alpha/);
        assert.match(markdown, /- \[ \] beta/);
        await page.locator('[data-editor-mode="rich"]').click();
        assert.equal(await page.locator('#editor-rich .nt-checkbox').count(), 2);
        assert.equal(await page.locator('#editor-rich .nt-checkbox').first().isChecked(), true);
    });
    await test('task Enter creates an unchecked sibling; empty Enter exits list', async page => {
        await openHtml(page, '<ul><li data-task="true" data-checked="true">first</li></ul>');
        await select(page, 'first', 'first', {caret: true, atEnd: true});
        await page.keyboard.press('Enter');
        await settle(page);
        assert.equal(await page.locator('#editor-rich li[data-task="true"]').count(), 2);
        assert.equal(await page.locator('#editor-rich .nt-checkbox').nth(1).isChecked(), false);
        await page.keyboard.press('Enter');
        await page.keyboard.type('outside');
        await settle(page);
        assert.equal(await page.locator('#editor-rich li').count(), 1);
        assert.equal(await page.locator('#editor-rich > p').last().innerText(), 'outside');
    });
    await test('quote toggle preserves multiple paragraphs and is undoable', async page => {
        await openHtml(page, '<p>alpha</p><p>beta</p>');
        await select(page, 'alpha', 'beta');
        await tool(page, 'quote');
        assert.equal(await page.locator('#editor-rich > blockquote > p').count(), 2);
        await tool(page, 'undo');
        assert.equal(await page.locator('#editor-rich blockquote').count(), 0);
        await tool(page, 'redo');
        await select(page, 'alpha', 'beta');
        await tool(page, 'quote');
        assert.equal(await page.locator('#editor-rich blockquote').count(), 0);
    });
    await test('code blocks use pre/code and preserve literal whitespace in Markdown', async page => {
        const source = 'first\n\n\n-  literal\n1.  literal\nlast';
        await openHtml(page, '<p>code here</p><p>after</p>');
        await select(page, 'code here');
        await tool(page, 'code-block');
        assert.equal(await page.locator('#editor-rich pre > code').count(), 1);
        await select(page, 'code here');
        await page.keyboard.insertText(source);
        await settle(page);
        await page.locator('[data-editor-mode="markdown"]').click();
        const markdown = await page.locator('#editor-textarea').inputValue();
        // Exact code without a trailing newline may use raw HTML in Markdown.
        assert.ok(/(```|<pre>)/.test(markdown));
        // The decoded code text below must match byte-for-byte in either representation.
        await page.locator('[data-editor-mode="rich"]').click();
        assert.equal(await page.locator('#editor-rich pre > code').textContent(), source);
        await select(page, 'last', 'last', {caret: true, atEnd: true});
        await page.keyboard.press('Control+Enter');
        await page.keyboard.type('outside code');
        assert.equal(await page.locator('#editor-rich > p').filter({hasText: 'outside code'}).count(), 1);
    });
    await test('links create, edit and remove with selection restoration', async page => {
        await openHtml(page);
        await select(page, 'beta');
        await tool(page, 'link');
        await page.locator('#editor-link-input').fill('https://example.com/first');
        await page.locator('#editor-link-form button[type="submit"]').click();
        await settle(page);
        assert.equal(await page.locator('#editor-rich a').getAttribute('href'), 'https://example.com/first');
        await select(page, 'beta', 'beta', {caret: true});
        await tool(page, 'link');
        assert.equal(await page.locator('#editor-link-input').inputValue(), 'https://example.com/first');
        await page.locator('#editor-link-input').fill('https://example.com/second');
        await page.locator('#editor-link-form button[type="submit"]').click();
        assert.equal(await page.locator('#editor-rich a').getAttribute('href'), 'https://example.com/second');
        await select(page, 'beta');
        await core(page, 'unlink');
        assert.equal(await page.locator('#editor-rich a').count(), 0);
        await tool(page, 'undo');
        assert.equal(await page.locator('#editor-rich a').getAttribute('href'), 'https://example.com/second');
    });
    await test('divider insertion and non-text block operations are undoable', async page => {
        await openHtml(page, '<p>before</p><p>after</p>');
        await select(page, 'before', 'before', {caret: true, atEnd: true});
        await tool(page, 'divider');
        assert.equal(await page.locator('#editor-rich hr').count(), 1);
        await tool(page, 'undo');
        assert.equal(await page.locator('#editor-rich hr').count(), 0);
        await tool(page, 'redo');
        await page.locator('#editor-rich hr').click();
        await core(page, 'block-down');
        const moved = await html(page);
        assert.ok(moved.indexOf('<hr') > moved.indexOf('after'), moved);
        await core(page, 'block-delete');
        assert.equal(await page.locator('#editor-rich hr').count(), 0);
        await tool(page, 'undo');
        assert.equal(await page.locator('#editor-rich hr').count(), 1);
    });
    await test('blocks move, insert paragraphs before/after and preserve order on undo', async page => {
        await openHtml(page, '<p>first</p><pre><code>code</code></pre><p>last</p>');
        await select(page, 'code', 'code', {caret: true});
        await core(page, 'block-up');
        assert.equal(await page.locator('#editor-rich > :first-child').evaluate(node => node.tagName), 'PRE');
        await tool(page, 'undo');
        assert.equal(await page.locator('#editor-rich > :nth-child(2)').evaluate(node => node.tagName), 'PRE');
        await select(page, 'code', 'code', {caret: true});
        await core(page, 'block-before');
        await page.keyboard.type('inserted before');
        await select(page, 'code', 'code', {caret: true});
        await core(page, 'block-after');
        await page.keyboard.type('inserted after');
        const content = await html(page);
        assert.ok(content.indexOf('inserted before') < content.indexOf('<pre'));
        assert.ok(content.indexOf('inserted after') > content.indexOf('</pre>'));
    });
    await test('table row/column insertion and deletion preserve cells and undo', async page => {
        await openHtml(page, '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>C</td><td>D</td></tr></tbody></table><p>end</p>');
        await select(page, 'C', 'C', {caret: true});
        await core(page, 'add-row');
        assert.equal(await page.locator('#editor-rich table tr').count(), 3);
        await core(page, 'add-column');
        assert.equal(await page.locator('#editor-rich table tr').first().locator('th,td').count(), 3);
        await core(page, 'delete-column');
        assert.equal(await page.locator('#editor-rich table tr').first().locator('th,td').count(), 2);
        await core(page, 'delete-row');
        assert.equal(await page.locator('#editor-rich table tr').count(), 2);
        await core(page, 'delete-table');
        assert.equal(await page.locator('#editor-rich table').count(), 0);
        await tool(page, 'undo');
        assert.equal(await page.locator('#editor-rich table').count(), 1);
    });
    await test('safe HTML paste is structural, task controls work and undo removes paste', async page => {
        await openHtml(page, '<p>before after</p>');
        await select(page, 'before', 'before', {caret: true, atEnd: true});
        const before = await html(page);
        await page.evaluate(() => {
            const clipboardData = new DataTransfer();
            clipboardData.setData('text/html', '<p onclick="window.__bad=1">pasted</p><ul><li data-task="true" data-checked="true">task</li></ul><script>window.__bad=1</script><a href="javascript:alert(1)">bad</a>');
            clipboardData.setData('text/plain', 'pasted task bad');
            document.getElementById('editor-rich').dispatchEvent(new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData}));
        });
        await settle(page);
        assert.equal(await page.locator('#editor-rich script, #editor-rich [onclick], #editor-rich p p, #editor-rich p ul').count(), 0);
        assert.equal(await page.locator('#editor-rich .nt-checkbox').count(), 1);
        assert.equal(await page.locator('#editor-rich .nt-checkbox').isChecked(), true);
        assert.ok(!(await html(page)).includes('javascript:'));
        assert.equal(await page.evaluate(() => window.__bad), undefined);
        await tool(page, 'undo');
        assert.equal(await html(page), before);
    });
    await test('external drop uses the drop position and sanitizes content', async page => {
        await openHtml(page, '<p>first</p><p>middle</p><p>finish</p>');
        await select(page, 'first', 'first', {caret: true});
        const before = await html(page);
        await page.evaluate(() => {
            const rich = document.getElementById('editor-rich');
            const node = rich.querySelector('p:last-child').firstChild;
            const range = document.createRange();
            range.setStart(node, node.textContent.length);
            range.collapse(true);
            const rect = range.getBoundingClientRect();
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/html', '<b onclick="window.__bad=1">dropped</b><script>window.__bad=1</script>');
            dataTransfer.setData('text/plain', 'dropped');
            rich.dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer, clientX: rect.left, clientY: rect.top + rect.height / 2}));
        });
        await settle(page);
        const result = await html(page);
        assert.ok(result.indexOf('dropped') > result.indexOf('middle'), result);
        assert.ok(!result.includes('onclick'));
        assert.equal(await page.evaluate(() => window.__bad), undefined);
        await tool(page, 'undo');
        assert.equal(await html(page), before);
    });
    await test('internal text drag moves once instead of duplicating the source', async page => {
        await openHtml(page, '<p>move first</p><p>middle</p><p>finish</p>');
        await select(page, 'move');
        await page.evaluate(() => {
            const rich = document.getElementById('editor-rich');
            const source = getSelection().getRangeAt(0).getBoundingClientRect();
            const dataTransfer = new DataTransfer();
            rich.dispatchEvent(new DragEvent('dragstart', {bubbles: true, cancelable: true, dataTransfer, clientX: source.left, clientY: source.top + 5}));
            const node = rich.querySelector('p:last-child').firstChild;
            const range = document.createRange();
            range.setStart(node, node.textContent.length);
            range.collapse(true);
            const rect = range.getBoundingClientRect();
            rich.dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer, clientX: rect.left, clientY: rect.top + rect.height / 2}));
            rich.dispatchEvent(new DragEvent('dragend', {bubbles: true, dataTransfer}));
        });
        await settle(page);
        const result = await html(page);
        assert.equal((result.match(/move/g) || []).length, 1, result);
        assert.ok(result.indexOf('move') > result.indexOf('middle'), result);
        await tool(page, 'undo');
        assert.equal(await page.locator('#editor-rich > p').first().innerText(), 'move first');
    });
    await test('model HTML preserves existing semantic content and metadata', async page => {
        const htmlSource = '<div data-file="source.md"></div><p data-struck="true"><u>u</u><mark>mark</mark><sub>sub</sub><sup>sup</sup><kbd>key</kbd><small>small</small></p><details><summary>summary</summary><p>details body</p></details><figure><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==" alt="pixel"><figcaption>caption</figcaption></figure><ol start="4"><li>item</li></ol>';
        await openHtml(page, htmlSource);
        const result = await html(page);
        for (const marker of ['data-file="source.md"', 'data-struck="true"', '<u>', '<mark>', '<sub>', '<sup>', '<kbd>', '<small>', '<details>', '<summary>', '<figure>', '<figcaption>', 'start="4"']) assert.ok(result.includes(marker), `${marker}: ${result}`);
        await page.locator('#editor-save').click();
        await page.locator('#edit-note-button').click();
        assert.equal(await html(page), result);
    });
    await test('collapsed mark state applies to subsequent typing and undo shortcut', async page => {
        await openHtml(page, '<p>hello</p>');
        await select(page, 'hello', 'hello', {caret: true, atEnd: true});
        await tool(page, 'bold');
        assert.equal(await page.locator('[data-rich-action="bold"]').getAttribute('aria-pressed'), 'true');
        await page.keyboard.type(' typed');
        await settle(page);
        assert.equal(await page.locator('#editor-rich strong').innerText(), ' typed');
        await page.keyboard.press('Control+z');
        await settle(page);
        assert.equal(await page.locator('#editor-rich').innerText(), 'hello');
        await page.keyboard.press('Control+Shift+z');
        await settle(page);
        assert.equal(await page.locator('#editor-rich strong').innerText(), ' typed');
    });
    await test('parser and Markdown preserve fenced-code language, blank lines and indentation', async page => {
        const result = await page.evaluate(() => {
            const source = '```js\nfirst\n\n\n\n-   x\n1.   x\n  indented\nlast\n```\n';
            const first = NoteParser.markdownToHtml(source);
            const exported = NoteMarkdown.htmlToMarkdown(first);
            const second = NoteParser.markdownToHtml(exported);
            const holder = document.createElement('div');
            holder.innerHTML = first;
            const initial = {code: holder.querySelector('pre code').textContent, language: holder.querySelector('pre code').className};
            holder.innerHTML = second;
            const final = {code: holder.querySelector('pre code').textContent, language: holder.querySelector('pre code').className};
            return {initial, final, exported};
        });
        assert.equal(result.initial.language, 'language-js');
        assert.deepEqual(result.final, result.initial);
        assert.ok(result.exported.includes('-   x\n1.   x'));
        assert.ok(result.exported.includes('first\n\n\n\n'));
    });
    await test('Markdown round-trip keeps complex table spans and paragraph cells', async page => {
        const result = await page.evaluate(() => {
            const source = '<table><tbody><tr><td rowspan="2"><p>first</p><p>second</p></td><td>A</td><td>B</td></tr><tr><td colspan="2">wide</td></tr></tbody></table>';
            const markdown = NoteMarkdown.htmlToMarkdown(source);
            const roundTrip = NoteParser.markdownToHtml(markdown);
            const holder = document.createElement('div');
            holder.innerHTML = roundTrip;
            return {markdown, rows: holder.querySelectorAll('tr').length, cells: holder.querySelectorAll('td').length,
                rowspan: holder.querySelector('[rowspan]')?.getAttribute('rowspan'),
                colspan: holder.querySelector('[colspan]')?.getAttribute('colspan'),
                paragraphs: Array.from(holder.querySelectorAll('td p'), node => node.textContent)};
        });
        assert.equal(result.rows, 2);
        assert.equal(result.cells, 4);
        assert.equal(result.rowspan, '2');
        assert.equal(result.colspan, '2');
        assert.deepEqual(result.paragraphs, ['first', 'second']);
    });
    await test('Markdown round-trip preserves multi-paragraph task with nested list', async page => {
        const result = await page.evaluate(() => {
            const source = '<ul><li data-task="true" data-checked="true"><p>first</p><p>second</p><ul><li>nested</li></ul></li></ul>';
            const markdown = NoteMarkdown.htmlToMarkdown(source);
            const holder = document.createElement('div');
            holder.innerHTML = NoteParser.markdownToHtml(markdown);
            const item = holder.querySelector('li[data-task="true"]');
            return {markdown, tasks: holder.querySelectorAll('li[data-task="true"]').length,
                checked: item?.getAttribute('data-checked'), paragraphs: Array.from(item?.querySelectorAll(':scope > p') || [], node => node.textContent.trim()),
                nested: item?.querySelector('ul li')?.textContent};
        });
        assert.equal(result.tasks, 1, result.markdown);
        assert.equal(result.checked, 'true');
        assert.deepEqual(result.paragraphs, ['first', 'second']);
        assert.equal(result.nested, 'nested');
    });
    await test('sanitizer allows only safe code-language class and permitted tags', async page => {
        const result = await page.evaluate(() => {
            const holder = document.createElement('div');
            holder.innerHTML = NoteParser.sanitizeHtml('<aside>aside text</aside><p class="language-js evil">paragraph</p><pre><code class="evil language-js extra">code</code></pre><code class="language-js&quot; onclick=&quot;evil">bad</code><style>p{display:none}</style>');
            return {html: holder.innerHTML, classNames: Array.from(holder.querySelectorAll('[class]'), node => [node.tagName, node.className])};
        });
        assert.ok(!result.html.includes('<aside'));
        assert.ok(!result.html.includes('<style'));
        assert.ok(!result.html.includes('onclick='));
        assert.deepEqual(result.classNames, [['CODE', 'language-js']]);
    });
    await test('Markdown typing shortcuts create structural blocks and Backspace reverts a rule', async page => {
        await openHtml(page, '<p>start</p>');
        for (const [prefix, selector] of [['# ', 'h1'], ['- ', 'ul > li'], ['1. ', 'ol > li'], ['> ', 'blockquote'], ['[ ] ', 'li[data-task="true"]'], ['```js ', 'pre > code']]) {
            await page.evaluate(() => { __editor.setHTML('<p></p>'); __editor.focus('start'); });
            await page.keyboard.type(prefix + 'typed');
            await settle(page);
            assert.equal(await page.locator('#editor-rich').locator(selector).count(), 1, prefix);
            assert.equal(await page.locator('#editor-rich').locator(selector).innerText(), 'typed', prefix);
        }
        await page.evaluate(() => { __editor.setHTML('<p></p>'); __editor.focus('start'); });
        await page.keyboard.type('# ');
        assert.equal(await page.locator('#editor-rich > h1').count(), 1);
        await page.keyboard.press('Backspace');
        assert.equal(await page.locator('#editor-rich > h1').count(), 0);
        assert.equal(await page.locator('#editor-rich > p').textContent(), '# ');
    });
    await test('list indentation and list-item move preserve neighbors', async page => {
        await openHtml(page, '<ul><li>alpha</li><li>beta</li></ul>');
        await select(page, 'beta', 'beta', {caret: true});
        await page.keyboard.press('Tab');
        await settle(page);
        assert.equal(await page.locator('#editor-rich > ul > li').count(), 1);
        assert.equal(await page.locator('#editor-rich li li').innerText(), 'beta');
        await page.keyboard.press('Shift+Tab');
        await settle(page);
        assert.equal(await page.locator('#editor-rich > ul > li').count(), 2);
        await core(page, 'block-up');
        assert.equal(await page.locator('#editor-rich > ul > li').first().innerText(), 'beta');
        await tool(page, 'undo');
        assert.equal(await page.locator('#editor-rich > ul > li').first().innerText(), 'alpha');
    });
    await test('insert-table toolbar creates an editable table and Tab adds a final row', async page => {
        await openHtml(page, '<p>table below</p>');
        await select(page, 'table below', 'table below', {caret: true, atEnd: true});
        await tool(page, 'table');
        assert.equal(await page.locator('#editor-rich table tr').count(), 3);
        assert.equal(await page.locator('#editor-rich table th, #editor-rich table td').count(), 9);
        const lastCell = page.locator('#editor-rich table td').last();
        await lastCell.click();
        await page.keyboard.type('last cell');
        await page.keyboard.press('Tab');
        await settle(page);
        assert.equal(await page.locator('#editor-rich table tr').count(), 4);
        await page.keyboard.type('new row');
        assert.equal(await page.locator('#editor-rich table tr').last().locator('td').first().innerText(), 'new row');
    });
    await test('empty task items and empty code blocks survive Markdown conversion', async page => {
        const result = await page.evaluate(() => {
            const source = '<ul><li data-task="true" data-checked="false"><p></p></li></ul><pre><code></code></pre>';
            const markdown = NoteMarkdown.htmlToMarkdown(source);
            const holder = document.createElement('div');
            holder.innerHTML = NoteParser.markdownToHtml(markdown);
            return {markdown, tasks: holder.querySelectorAll('li[data-task="true"]').length, code: holder.querySelectorAll('pre code').length};
        });
        assert.equal(result.tasks, 1, result.markdown);
        assert.equal(result.code, 1, result.markdown);
    });
    await test('Chinese composition commits once and keeps document editable', async (page, context) => {
        await openHtml(page, '<p>输入：</p>');
        await select(page, '输入：', '输入：', {caret: true, atEnd: true});
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.imeSetComposition', {text: '中文', selectionStart: 2, selectionEnd: 2});
        await cdp.send('Input.insertText', {text: '中文'});
        await settle(page);
        assert.equal(await page.locator('#editor-rich').innerText(), '输入：中文');
        await page.keyboard.insertText('继续');
        assert.equal(await page.locator('#editor-rich').innerText(), '输入：中文继续');
    });
    await test('visual viewport keyboard shrink reveals typing caret', async page => {
        await openHtml(page, Array.from({length: 50}, (_, i) => `<p>paragraph ${i} long content for scrolling</p>`).join(''));
        await select(page, 'paragraph 49 long content for scrolling', 'paragraph 49 long content for scrolling', {caret: true, atEnd: true});
        await page.evaluate(() => {
            window.__testViewport.height = 480;
            visualViewport.dispatchEvent(new Event('resize'));
        });
        await page.keyboard.insertText(' 文末输入');
        await page.waitForTimeout(200);
        const result = await page.evaluate(() => {
            const caret = getSelection().getRangeAt(0).getBoundingClientRect();
            const overlay = document.getElementById('editor-overlay').getBoundingClientRect();
            const scroll = document.querySelector('.editor-scroll').getBoundingClientRect();
            return {caret: {top: caret.top, bottom: caret.bottom}, overlayBottom: overlay.bottom, scrollTop: scroll.top, scrollBottom: scroll.bottom};
        });
        assert.ok(result.overlayBottom <= 481, JSON.stringify(result));
        assert.ok(result.caret.top >= result.scrollTop - 1, JSON.stringify(result));
        assert.ok(result.caret.bottom <= Math.min(result.scrollBottom, 480) + 1, JSON.stringify(result));
    });
    await test('forward/reverse selection stays exact while endpoints scroll offscreen', async page => {
        await openHtml(page, Array.from({length: 60}, (_, i) => `<p>line ${String(i).padStart(2, '0')} selection text</p>`).join(''));
        for (const reverse of [false, true]) {
            await select(page, 'line 05 selection text', 'line 54 selection text', {reverse});
            const before = await snapshotSelection(page);
            await page.evaluate(() => {
                const scroller = document.querySelector('.editor-scroll');
                scroller.scrollTop = scroller.scrollHeight / 2;
            });
            await page.waitForTimeout(150);
            assert.deepEqual(await snapshotSelection(page), before);
            await page.evaluate(() => document.querySelector('.editor-scroll').scrollTop = 0);
            await page.waitForTimeout(100);
            assert.deepEqual(await snapshotSelection(page), before);
        }
    });
    await test('selection handles edge-scroll while the opposite endpoint remains fixed', async page => {
        await openHtml(page, Array.from({length: 70}, (_, i) => `<p>row ${String(i).padStart(2, '0')} selectable content</p>`).join(''));
        for (const end of ['head', 'anchor']) {
            await page.evaluate(() => document.querySelector('.editor-scroll').scrollTop = 0);
            await select(page, 'row 00 selectable content', 'row 02 selectable content', {reverse: end === 'anchor'});
            if (end === 'head') await tool(page, 'select-mode');
            const original = await page.evaluate(() => ({anchor: __editor.view.state.selection.anchor, head: __editor.view.state.selection.head}));
            const handle = page.locator(`.editor-selection-handle[data-selection-end="${end}"]`);
            await handle.waitFor({state: 'visible'});
            const box = await handle.boundingBox();
            const area = await page.locator('.editor-scroll').boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(area.x + area.width / 2, area.y + area.height - 4, {steps: 8});
            await page.waitForTimeout(550);
            const during = await page.evaluate(() => ({anchor: __editor.view.state.selection.anchor, head: __editor.view.state.selection.head, scroll: document.querySelector('.editor-scroll').scrollTop}));
            await page.mouse.up();
            const stationary = end === 'head' ? 'anchor' : 'head';
            assert.equal(during[stationary], original[stationary]);
            assert.ok(during[end] > original[end], JSON.stringify({original, during}));
            assert.ok(during.scroll > 100, JSON.stringify(during));
            const saved = await snapshotSelection(page);
            await page.evaluate(() => document.querySelector('.editor-scroll').scrollTop += 300);
            await settle(page);
            assert.deepEqual(await snapshotSelection(page), saved);
        }
    });
    await test('cursor handle edge-scroll moves a collapsed caret without selecting outside content', async page => {
        await openHtml(page, Array.from({length: 70}, (_, i) => `<p>cursor row ${String(i).padStart(2, '0')}</p>`).join(''));
        await select(page, 'cursor row 00', 'cursor row 00', {caret: true, atEnd: true});
        await tool(page, 'cursor-mode');
        const handle = page.locator('.editor-selection-handle[data-selection-end="head"]');
        await handle.waitFor({state: 'visible'});
        const box = await handle.boundingBox();
        const area = await page.locator('.editor-scroll').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(area.x + area.width / 2, area.y + area.height - 4, {steps: 8});
        await page.waitForTimeout(500);
        await page.mouse.up();
        const result = await page.evaluate(() => ({anchor: __editor.view.state.selection.anchor, head: __editor.view.state.selection.head, scroll: document.querySelector('.editor-scroll').scrollTop, within: document.getElementById('editor-rich').contains(getSelection().focusNode)}));
        assert.equal(result.anchor, result.head);
        assert.ok(result.scroll > 100);
        assert.ok(result.head > 100);
        assert.equal(result.within, true);
    });
    await test('touch toolbar swiping scrolls without applying a command or losing selection', async (page, context) => {
        await openHtml(page, '<p>keep selected text</p>');
        await select(page, 'selected');
        const before = await html(page);
        const selection = await snapshotSelection(page);
        const toolbar = page.locator('#rich-toolbar .rich-toolbar-row').first();
        await toolbar.evaluate(node => { node.scrollLeft = 0; });
        const box = await toolbar.boundingBox();
        const cdp = await context.newCDPSession(page);
        const y = box.y + box.height / 2;
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: box.x + box.width - 35, y}]});
        for (let step = 1; step <= 10; step++) {
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: box.x + box.width - 35 - step * (box.width - 70) / 10, y}]});
        }
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        await page.waitForTimeout(200);
        assert.ok(await toolbar.evaluate(node => node.scrollLeft) > 50);
        assert.equal(await html(page), before);
        assert.deepEqual(await snapshotSelection(page), selection);
    }, {hasTouch: true, isMobile: true});
    await test('accidental cross-editor native selection cannot include toolbar or page', async page => {
        await openHtml(page, '<p>alpha beta</p><p>gamma delta</p>');
        await select(page, 'alpha', 'gamma');
        await page.evaluate(() => {
            const rich = document.getElementById('editor-rich');
            const outside = document.getElementById('editor-hint').firstChild;
            getSelection().setBaseAndExtent(rich.querySelector('p').firstChild, 0, outside, Math.min(3, outside.textContent.length));
        });
        await page.waitForTimeout(150);
        const within = await page.evaluate(() => {
            const rich = document.getElementById('editor-rich');
            const selection = getSelection();
            return rich.contains(selection.anchorNode) && rich.contains(selection.focusNode);
        });
        assert.equal(within, true);
        await tool(page, 'bold');
        assert.equal(await page.locator('#editor-hint strong, #rich-toolbar strong').count(), 0);
    });
    await test('standalone image moves as a block and deletion keeps adjacent text', async page => {
        const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
        await openHtml(page, `<p>before</p><p><img src="${image}" alt="pixel"></p><p>after</p>`);
        await page.locator('#editor-rich img[src]').click();
        await settle(page);
        assert.equal(await page.evaluate(() => __editor.view.state.selection.node?.type.name), 'image');
        await core(page, 'block-down');
        const moved = await html(page);
        assert.ok(moved.indexOf('<img') > moved.indexOf('after'), moved);
        await core(page, 'block-delete');
        assert.equal(await page.locator('#editor-rich img[src]').count(), 0);
        assert.ok((await html(page)).includes('before'));
        assert.ok((await html(page)).includes('after'));
        await tool(page, 'undo');
        assert.equal(await page.locator('#editor-rich img[src]').count(), 1);
        await page.locator('#editor-rich img[src]').click();
        await core(page, 'block-before');
        await page.keyboard.type('before picture');
        await page.locator('#editor-rich img[src]').click();
        await core(page, 'block-after');
        await page.keyboard.type('after picture');
        const inserted = await html(page);
        assert.ok(inserted.indexOf('before picture') < inserted.indexOf('<img'));
        assert.ok(inserted.indexOf('after picture') > inserted.indexOf('<img'));
    });
    await test('source modes keep end-of-text visible above a small keyboard viewport', async page => {
        await openHtml(page, '<p>initial text</p>');
        await page.evaluate(() => { __testViewport.height = 360; visualViewport.dispatchEvent(new Event('resize')); });
        for (const mode of ['markdown', 'html']) {
            await page.locator(`[data-editor-mode="${mode}"]`).click();
            const textarea = page.locator('#editor-textarea');
            await textarea.fill(Array.from({length: 80}, (_, i) => mode === 'html' ? `<p>source line ${i}</p>` : `source line ${i}`).join('\n'));
            await textarea.press('Control+End');
            await page.keyboard.insertText(' end');
            await page.waitForTimeout(180);
            const result = await textarea.evaluate(node => {
                const rect = node.getBoundingClientRect();
                return {scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
                    top: rect.top, bottom: rect.bottom, end: node.selectionEnd, length: node.value.length,
                    overlayBottom: document.getElementById('editor-overlay').getBoundingClientRect().bottom};
            });
            assert.equal(result.end, result.length);
            assert.ok(result.scrollTop > 0, JSON.stringify(result));
            assert.ok(result.scrollTop + result.clientHeight >= result.scrollHeight - 40, JSON.stringify(result));
            assert.ok(result.bottom <= 360 + 2, JSON.stringify(result));
            assert.ok(result.overlayBottom <= 361, JSON.stringify(result));
        }
        await page.locator('#editor-title').focus();
        await page.keyboard.insertText(' title');
        await page.waitForTimeout(150);
        const title = await page.locator('#editor-title').boundingBox();
        const scroll = await page.locator('.editor-scroll').boundingBox();
        assert.ok(title.y >= scroll.y - 1);
        assert.ok(title.y + title.height <= 360);
    });
    await test('switching modes and reopening cancels selection handles and active edge scrolling', async page => {
        await openHtml(page, Array.from({length: 50}, (_, i) => `<p>lifecycle row ${i}</p>`).join(''));
        await select(page, 'lifecycle row 0', 'lifecycle row 2');
        await tool(page, 'select-mode');
        const handle = await page.locator('.editor-selection-handle[data-selection-end="head"]').boundingBox();
        const area = await page.locator('.editor-scroll').boundingBox();
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await page.mouse.down();
        await page.mouse.move(area.x + area.width / 2, area.y + area.height - 3, {steps: 5});
        await page.waitForTimeout(100);
        await page.evaluate(() => document.querySelector('[data-editor-mode="markdown"]').click());
        await page.waitForTimeout(120);
        assert.equal(await page.locator('.editor-selection-handles').isHidden(), true);
        const top = await page.locator('.editor-scroll').evaluate(node => node.scrollTop);
        await page.waitForTimeout(180);
        assert.equal(await page.locator('.editor-scroll').evaluate(node => node.scrollTop), top);
        await page.mouse.up();
        await page.locator('[data-editor-mode="rich"]').click();
        assert.equal(await page.locator('.editor-selection-handles').isHidden(), true);
        await page.locator('#editor-cancel').click();
        await page.locator('#confirm-dialog:not([hidden])').waitFor();
        assert.match(await page.locator('#confirm-title').innerText(), /放弃未保存的修改/);
        await page.locator('#confirm-ok').click();
        await page.locator('#editor-overlay').waitFor({state: 'hidden'});
        await page.locator('#new-note-fab').click();
        await settle(page);
        assert.equal(await page.locator('.editor-selection-handles').isHidden(), true);
        assert.equal(await page.locator('#editor-rich').textContent(), '');
        assert.equal(await page.locator('[data-rich-action="select-mode"]').getAttribute('aria-pressed'), 'false');
        assert.equal(await page.locator('[data-rich-action="cursor-mode"]').getAttribute('aria-pressed'), 'false');
    });
    await test('converting one list item preserves unselected siblings', async page => {
        await openHtml(page, '<ul><li>alpha</li><li>beta</li><li>gamma</li></ul>');
        await select(page, 'beta');
        await tool(page, 'number-list');
        assert.equal(await page.locator('#editor-rich > ul').count(), 2);
        assert.equal(await page.locator('#editor-rich > ol > li').innerText(), 'beta');
        assert.equal(await page.locator('#editor-rich > ul').first().innerText(), 'alpha');
        assert.equal(await page.locator('#editor-rich > ul').last().innerText(), 'gamma');
        await tool(page, 'undo');
        assert.equal(await page.locator('#editor-rich > ul > li').count(), 3);
        assert.equal(await page.locator('#editor-rich > ol').count(), 0);
    });
    await test('link dialog keeps document anchor URLs unchanged', async page => {
        await openHtml(page, '<p>jump here</p>');
        await select(page, 'jump');
        await tool(page, 'link');
        await page.locator('#editor-link-input').fill('#section-two');
        await page.locator('#editor-link-form button[type="submit"]').click();
        assert.equal(await page.locator('#editor-rich a').getAttribute('href'), '#section-two');
        await page.locator('[data-editor-mode="markdown"]').click();
        assert.ok((await page.locator('#editor-textarea').inputValue()).includes('(#section-two)'));
        await page.locator('[data-editor-mode="rich"]').click();
        assert.equal(await page.locator('#editor-rich a').getAttribute('href'), '#section-two');
    });
    await test('holding a stationary mouse at the edge does not start autoscroll', async page => {
        await openHtml(page, Array.from({length: 70}, (_, i) => `<p>stationary row ${i}</p>`).join(''));
        await page.locator('.editor-scroll').evaluate(node => { node.scrollTop = 250; });
        const area = await page.locator('.editor-scroll').boundingBox();
        await page.mouse.move(area.x + area.width / 2, area.y + area.height - 30);
        await page.mouse.down();
        await page.waitForTimeout(80);
        const before = await page.locator('.editor-scroll').evaluate(node => node.scrollTop);
        await page.waitForTimeout(400);
        const after = await page.locator('.editor-scroll').evaluate(node => node.scrollTop);
        await page.mouse.up();
        assert.ok(Math.abs(after - before) < 2, JSON.stringify({before, after}));
    });
    await test('sticky toolbar seals the scrollport top at mobile and tablet widths', async page => {
        await openHtml(page, Array.from({length: 80}, (_, i) => `<p>sticky row ${i}: 这是用来检查工具栏上方是否漏出正文的长笔记。</p>`).join(''));
        for (const width of [412, 640]) {
            await page.setViewportSize({width, height: 915});
            await page.evaluate(() => {
                __testViewport.height = 915;
                visualViewport.dispatchEvent(new Event('resize'));
            });
            await settle(page);
            await page.locator('.editor-scroll').evaluate(node => { node.scrollTop = (node.scrollHeight - node.clientHeight) * 0.5; });
            await settle(page);
            const layout = await page.evaluate(() => {
                const scroll = document.querySelector('.editor-scroll');
                const toolbar = document.getElementById('rich-toolbar');
                const rich = document.getElementById('editor-rich');
                const scrollRect = scroll.getBoundingClientRect();
                const toolbarRect = toolbar.getBoundingClientRect();
                const richRect = rich.getBoundingClientRect();
                const xs = [richRect.left + 10, (richRect.left + richRect.right) / 2, richRect.right - 10];
                const leaks = xs.flatMap(x => [scrollRect.top - 2, scrollRect.top + 2].map(y => {
                    const hit = document.elementFromPoint(x, y);
                    return {x, y, richContent: Boolean(hit && rich.contains(hit))};
                }));
                return {scrollTop: scroll.scrollTop, scrollportTop: scrollRect.top, toolbarTop: toolbarRect.top, leaks};
            });
            assert.ok(layout.scrollTop > 100, `${width}px: ${JSON.stringify(layout)}`);
            assert.ok(Math.abs(layout.toolbarTop - layout.scrollportTop) <= 1, `${width}px: ${JSON.stringify(layout)}`);
            assert.ok(layout.leaks.every(hit => !hit.richContent), `${width}px: ${JSON.stringify(layout)}`);
            fs.mkdirSync(path.join(root, '.test-artifacts'), {recursive: true});
            await page.screenshot({path: path.join(root, `.test-artifacts/editor-sticky-${width}.png`)});

            await page.evaluate(() => { __testViewport.height = 480; visualViewport.dispatchEvent(new Event('resize')); });
            await page.evaluate(() => __editor.focus('end'));
            await settle(page);
            await page.keyboard.insertText(` 输入验证 ${width}`);
            await page.waitForTimeout(180);
            const typing = await page.evaluate(() => {
                const view = __editor.view;
                const caret = view.coordsAtPos(view.state.selection.head);
                const toolbar = document.getElementById('rich-toolbar').getBoundingClientRect();
                const scroll = document.querySelector('.editor-scroll').getBoundingClientRect();
                return {caretTop: caret.top, caretBottom: caret.bottom, toolbarTop: toolbar.top, toolbarBottom: toolbar.bottom, scrollTop: scroll.top, scrollBottom: scroll.bottom};
            });
            assert.ok(Math.abs(typing.toolbarTop - typing.scrollTop) <= 1, `${width}px: ${JSON.stringify(typing)}`);
            assert.ok(typing.caretTop >= typing.toolbarBottom - 1, `${width}px: ${JSON.stringify(typing)}`);
            assert.ok(typing.caretBottom <= Math.min(480, typing.scrollBottom) + 1, `${width}px: ${JSON.stringify(typing)}`);
            await page.screenshot({path: path.join(root, `.test-artifacts/editor-sticky-caret-${width}.png`), clip: {x: 0, y: 0, width, height: 480}});
        }
    });
    await test('table captions are read-only while nearby cells and HTML-mode captions stay editable', async page => {
        await openHtml(page, '<p>before</p><table><caption>original caption</caption><tbody><tr><td>cell text</td></tr></tbody></table>');
        const caption = page.locator('#editor-rich caption');
        assert.equal(await caption.getAttribute('contenteditable'), 'false');
        assert.match(await caption.getAttribute('title'), /HTML/);
        assert.match(await caption.getAttribute('aria-label'), /只读/);
        const initial = await html(page);
        await caption.click();
        await page.keyboard.press('End');
        await page.keyboard.type(' ignored');
        await settle(page);
        assert.equal(await caption.textContent(), 'original caption');
        assert.equal(await html(page), initial, 'Typing on a read-only caption must not redirect text into another paragraph');
        await page.locator('#editor-rich td p').click();
        await page.keyboard.press('End');
        await page.keyboard.type(' EDIT');
        await settle(page);
        assert.equal(await page.locator('#editor-rich td p').textContent(), 'cell text EDIT');
        assert.equal(await page.locator('#editor-rich > p').textContent(), 'before');
        assert.ok((await html(page)).includes('<td><p>cell text EDIT</p></td>'));
        assert.ok(!(await html(page)).includes('只读'), 'Editor hints must not enter saved HTML');
        await page.locator('[data-editor-mode="html"]').click();
        const source = await page.locator('#editor-textarea').inputValue();
        await page.locator('#editor-textarea').fill(source.replace('original caption', 'edited caption'));
        await page.locator('[data-editor-mode="rich"]').click();
        assert.equal(await caption.textContent(), 'edited caption');
        await page.locator('#editor-save').click();
        await page.locator('#edit-note-button').click();
        assert.equal(await caption.textContent(), 'edited caption');
        assert.equal(await page.locator('#editor-rich td p').textContent(), 'cell text EDIT');
    });
    await test('splitting reversed ordered lists preserves explicit and implicit numbering', async page => {
        await openHtml(page, '<p>initial</p>');
        for (const {attributes, first, last} of [
            {attributes: 'reversed start="5"', first: 5, last: 3},
            {attributes: 'reversed', first: 3, last: 1}
        ]) {
            await page.evaluate(attributes => __editor.setHTML(`<ol ${attributes}><li>alpha</li><li>beta</li><li>gamma</li></ol>`), attributes);
            await select(page, 'beta');
            await tool(page, 'bullet-list');
            const result = await page.evaluate(() => {
                const holder = document.createElement('div');
                holder.innerHTML = __editor.getHTML();
                return Array.from(holder.querySelectorAll(':scope > ol'), list => ({start: list.start, reversed: list.reversed, text: list.textContent}));
            });
            assert.deepEqual(result, [{start: first, reversed: true, text: 'alpha'}, {start: last, reversed: true, text: 'gamma'}], attributes);
            assert.equal(await page.locator('#editor-rich > ul > li').innerText(), 'beta');
            await tool(page, 'undo');
            assert.equal(await page.locator('#editor-rich > ol').count(), 1);
            assert.equal(await page.locator('#editor-rich > ol > li').count(), 3);
            assert.equal(await page.locator('#editor-rich > ol').evaluate(list => list.start), first);
            await tool(page, 'redo');
            assert.equal(await page.locator('#editor-rich > ol').last().evaluate(list => list.start), last);
        }
    });
    await test('mobile editor snapshot with keyboard-sized viewport', async page => {
        await openHtml(page, '<p>手机编辑：文字、任务与表格</p><ul><li data-task="true" data-checked="true">已完成的准备</li><li data-task="true" data-checked="false">继续补充笔记</li></ul><table><tbody><tr><th>项目</th><th>进度</th></tr><tr><td>编辑体验</td><td>验证中</td></tr></tbody></table><p>从这里继续输入。</p>');
        await page.evaluate(() => {
            window.__testViewport.height = 480;
            visualViewport.dispatchEvent(new Event('resize'));
        });
        await select(page, '从这里继续输入。', '从这里继续输入。', {caret: true, atEnd: true});
        await page.keyboard.insertText(' 新内容');
        await page.waitForTimeout(200);
        fs.mkdirSync(path.join(root, '.test-artifacts'), {recursive: true});
        await page.screenshot({path: path.join(root, '.test-artifacts/editor-mobile.png'), clip: {x: 0, y: 0, width: 412, height: 480}});
    });
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
const report = {passed, failed: failures.length, failures, scope: 'Chromium browser regression; IME and visual viewport are simulated, Android device acceptance is separate.'};
fs.mkdirSync(path.join(root, '.test-artifacts'), {recursive: true});
fs.writeFileSync(path.join(root, '.test-artifacts/editor-report.json'), JSON.stringify(report, null, 2));
if (failures.length) {
    console.error(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
} else console.log(`ALL PASS (${passed} rich-editor cases)`);
