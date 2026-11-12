/*
 * Headless browser regression tests for the Notedown web layer.
 *
 * The test serves app/src/main/assets/www from a temporary local HTTP server,
 * then drives the app with a real Chrome/Chromium instance. It covers the
 * behaviour that lives outside the small Android WebView shell:
 *
 *   1. Markdown/HTML parsing and XSS-safe sanitisation.
 *   2. Task checkboxes and the independent strike-through mode.
 *   3. The Markdown editor and created note.
 *   4. Long-press list reordering, FLIP animations, numbering, auto-scroll.
 *   5. Multi-file Markdown/HTML import into one note, plus append.
 *
 * Run: npm install && npm run test:e2e
 * Set CHROME_PATH if Chrome/Chromium is not in a standard location.
 */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'app', 'src', 'main', 'assets', 'www');

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml'
};

function startServer() {
    const server = http.createServer((request, response) => {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        const resolved = path.resolve(webRoot, relative);
        if (!resolved.startsWith(webRoot + path.sep)) {
            response.writeHead(403).end('Forbidden');
            return;
        }
        fs.readFile(resolved, (error, data) => {
            if (error) {
                response.writeHead(404).end('Not found');
                return;
            }
            response.writeHead(200, {
                'Content-Type': mimeTypes[path.extname(resolved)] || 'application/octet-stream',
                'Cache-Control': 'no-store'
            });
            response.end(data);
        });
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

function browserExecutable() {
    const candidates = [
        process.env.CHROME_PATH,
        process.env.CHROME_BIN,
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/opt/google/chrome/chrome',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ].filter(Boolean);
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (!found) {
        throw new Error('Chrome/Chromium not found. Set CHROME_PATH to an executable browser.');
    }
    return found;
}

async function newPage(browser, baseUrl) {
    const context = await browser.newContext({
        viewport: {width: 412, height: 915},
        deviceScaleFactor: 2
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
        if (message.type() === 'error') {
            errors.push(`console: ${message.text()}`);
        }
    });
    await page.goto(`${baseUrl}/index.html`, {waitUntil: 'networkidle'});
    await page.waitForTimeout(300);
    return {context, page, errors};
}

async function clickNoteMenu(page) {
    await page.locator('#note-menu-button').click();
    await page.locator('#action-sheet:not([hidden])').waitFor();
}

async function createHtmlNote(page, title, html) {
    await page.locator('#new-note-fab').click();
    await page.locator('#editor-overlay:not([hidden])').waitFor();
    await page.locator('[data-editor-mode="html"]').click();
    await page.locator('#editor-title').fill(title);
    await page.locator('#editor-textarea').fill(html);
    await page.locator('#editor-save').click();
    await page.locator('#note-screen:not([hidden])').waitFor();
}

async function putCaretAtEnd(page) {
    await page.evaluate(() => {
        const rich = document.getElementById('editor-rich');
        rich.focus();
        const range = document.createRange();
        range.selectNodeContents(rich);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    });
}

async function selectRichText(page, text, length) {
    return page.evaluate(({text, length}) => {
        const rich = document.getElementById('editor-rich');
        const walker = document.createTreeWalker(rich, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const index = node.nodeValue.indexOf(text);
            if (index >= 0) {
                const range = document.createRange();
                range.setStart(node, index);
                range.setEnd(node, index + (length || text.length));
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                return true;
            }
        }
        return false;
    }, {text, length: length || text.length});
}

const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true,
    args: ['--hide-scrollbars']
});

const failures = [];

try {
    /* 1. Parser + sanitizer. */
    {
        const {context, page, errors} = await newPage(browser, baseUrl);
        const result = await page.evaluate(() => {
            const html = NoteParser.htmlToHtml(`
                <h1>Title</h1>
                <script>window.__bad = true</script>
                <p onclick="alert(1)">Hello <strong>world</strong></p>
                <ul><li><input type="checkbox" checked> done task</li><li>[ ] plain marker</li></ul>
                <a href="javascript:alert(1)">bad link</a>
                <a href="https://example.com">good link</a>
                <img src="x" onerror="alert(1)">
            `);
            const markdown = NoteParser.markdownToHtml(`# MD

- [x] checked
- [ ] open

1. one
2. two`);
            const exported = NoteMarkdown.htmlToMarkdown(`
                <h1>导出</h1>
                <p data-struck="true">划掉的段落</p>
                <div data-file="来源.md"></div>
                <ul><li data-task="true" data-checked="true">完成项</li><li data-task="true" data-checked="false">待办项</li></ul>
            `);
            const roundTrip = NoteParser.markdownToHtml(exported);
            return {
                html,
                markdown,
                exported,
                roundTrip,
                counts: NoteParser.countTasks(markdown),
                roundTripCounts: NoteParser.countTasks(roundTrip),
                preserved: NoteParser.sanitizeHtml('<p data-struck="true">x</p><li data-task="true" data-checked="true">task</li>')
            };
        });
        assert.ok(!result.html.includes('<script'));
        assert.ok(!result.html.includes('onclick'));
        assert.ok(!result.html.includes('onerror'));
        assert.ok(!result.html.includes('javascript:'));
        assert.ok(result.html.includes('href="https://example.com"'));
        assert.ok(result.html.includes('data-task="true"'));
        assert.ok(result.html.includes('data-checked="true"'));
        assert.ok(result.markdown.includes('data-task="true"'));
        assert.deepEqual(result.counts, {total: 2, done: 1});
        assert.ok(result.preserved.includes('data-struck'));
        assert.ok(result.preserved.includes('data-checked'));
        assert.match(result.exported, /- \[x\] 完成项/);
        assert.match(result.exported, /- \[ \] 待办项/);
        assert.ok(!result.exported.includes('\\[x\\]'));
        assert.match(result.exported, /~~划掉的段落~~/);
        assert.match(result.exported, /data-file="来源\.md"/);
        assert.ok(result.roundTrip.includes('data-file="来源.md"'));
        assert.deepEqual(result.roundTripCounts, {total: 2, done: 1});
        assert.deepEqual(errors, []);
        await context.close();
        console.log('PASS parser + sanitizer');
    }

    /* 2. Reading, checkbox and strike mode. */
    {
        const {context, page, errors} = await newPage(browser, baseUrl);
        assert.equal(await page.locator('.note-card').count(), 1);
        await page.locator('.note-card').first().click();
        await page.locator('#note-screen:not([hidden])').waitFor();
        assert.equal(await page.locator('#note-title').innerText(), '欢迎来到 Notedown');
        assert.equal(await page.locator('#note-content .nt-checkbox').count(), 3);

        const checkbox = page.locator('#note-content .nt-checkbox').nth(1);
        assert.equal(await checkbox.isChecked(), false);
        await checkbox.click();
        await page.waitForTimeout(150);
        assert.equal(await checkbox.isChecked(), true);
        assert.equal(await page.locator('#note-content li[data-task="true"]').nth(1).getAttribute('data-checked'), 'true');

        await page.locator('#strike-button').click();
        assert.equal(await page.locator('#strike-banner').isVisible(), true);
        const paragraph = page.locator('#note-content p').first();
        await paragraph.click();
        assert.equal(await paragraph.getAttribute('data-struck'), 'true');
        await paragraph.click();
        assert.equal(await paragraph.getAttribute('data-struck'), null);
        await page.locator('#strike-done').click();
        assert.equal(await page.locator('#strike-banner').isHidden(), true);

        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('notedown.state.v1')));
        assert.equal(saved.notes[0].html.includes('data-checked="true"'), true);
        assert.deepEqual(errors, []);
        await context.close();
        console.log('PASS checkbox + strike');
    }

    /* 3. Rich editor, Markdown and HTML modes. */
    {
        const {context, page, errors} = await newPage(browser, baseUrl);
        await page.locator('.note-card').first().click();
        await page.waitForTimeout(200);
        assert.equal(await page.locator('#edit-note-button').isVisible(), true);
        await page.locator('#edit-note-button').click();
        await page.locator('#editor-overlay:not([hidden])').waitFor();
        await page.waitForTimeout(250);

        assert.equal(await page.locator('#editor-mode-tabs [data-editor-mode]').count(), 3);
        assert.equal(await page.locator('#editor-rich').isVisible(), true);
        assert.ok(await page.locator('#rich-toolbar .rich-tool').count() >= 15);
        assert.equal(await page.locator('#editor-preview-toggle').isHidden(), true);

        // Checkboxes stay interactive while editing.
        const editingTask = page.locator('#editor-rich li[data-task="true"]').nth(2);
        assert.equal(await editingTask.getAttribute('data-checked'), 'false');
        await page.locator('#editor-rich .nt-checkbox').nth(2).click();
        await page.waitForTimeout(120);
        assert.equal(await editingTask.getAttribute('data-checked'), 'true');

        // Directly edit the visible text, then bold part of it.
        await putCaretAtEnd(page);
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await page.keyboard.type('富文本编辑测试');
        await page.waitForTimeout(120);
        assert.equal(await selectRichText(page, '富文本编辑测试'), true);
        await page.locator('[data-rich-action="bold"]').click();
        await page.waitForTimeout(120);
        assert.equal(await page.locator('#editor-rich b, #editor-rich strong').count() > 0, true);

        // Wrap part of the new text in a link using the toolbar dialog.
        await selectRichText(page, '富文本', 3);
        await page.locator('[data-rich-action="link"]').click();
        await page.locator('#editor-link-layer:not([hidden])').waitFor();
        await page.locator('#editor-link-input').fill('https://example.com/linked');
        await page.locator('#editor-link-form button[type="submit"]').click();
        await page.waitForTimeout(180);
        assert.equal(await page.locator('#editor-rich a[href="https://example.com/linked"]').count(), 1);

        // Add a new task from a normal paragraph.
        await putCaretAtEnd(page);
        await page.keyboard.press('Enter');
        await page.keyboard.type('新增清单项');
        await page.waitForTimeout(120);
        assert.equal(await selectRichText(page, '新增清单项'), true);
        await page.locator('[data-rich-action="task-list"]').click();
        await page.waitForTimeout(180);
        assert.equal(await page.locator('#editor-rich li[data-task="true"]').count(), 4);

        // Switch to Markdown and verify round-tripping and preview.
        await page.locator('[data-editor-mode="markdown"]').click();
        await page.waitForTimeout(200);
        const markdown = await page.locator('#editor-textarea').inputValue();
        assert.match(markdown, /- \[x\]/);
        assert.match(markdown, /- \[ \]/);
        assert.ok(markdown.includes('富文本'));
        assert.ok(markdown.includes('编辑测试'));
        assert.ok(markdown.includes('https://example.com/linked'));
        assert.ok(!markdown.includes('\\[x\\]'));
        await page.locator('#editor-textarea').focus();
        await page.keyboard.press('Control+End');
        await page.keyboard.type('\n\n来自 Markdown 的追加段落。');
        await page.locator('#editor-preview-toggle').click();
        await page.waitForTimeout(180);
        assert.match(await page.locator('#editor-preview').innerText(), /来自 Markdown 的追加段落/);
        await page.locator('[data-editor-mode="rich"]').click();
        await page.waitForTimeout(180);
        assert.match(await page.locator('#editor-rich').innerText(), /来自 Markdown 的追加段落/);
        await page.locator('#editor-save').click();
        await page.locator('#editor-overlay').waitFor({state: 'hidden'});
        await page.waitForTimeout(300);
        assert.equal(await page.locator('#note-screen').isVisible(), true);
        assert.match(await page.locator('#note-content').innerText(), /富文本编辑测试/);
        assert.match(await page.locator('#note-content').innerText(), /来自 Markdown 的追加段落/);
        assert.equal(await page.locator('#note-content a[href="https://example.com/linked"]').count(), 1);
        assert.equal(await page.locator('#note-content li[data-task="true"]').count(), 4);
        assert.equal(await page.locator('#note-content li[data-task="true"]').nth(2).getAttribute('data-checked'), 'true');

        // HTML mode still works on an existing note.
        await page.locator('#edit-note-button').click();
        await page.locator('#editor-overlay:not([hidden])').waitFor();
        await page.locator('[data-editor-mode="html"]').click();
        await page.waitForTimeout(150);
        const htmlSource = await page.locator('#editor-textarea').inputValue();
        assert.ok(htmlSource.includes('data-task="true"'));
        await page.locator('#editor-textarea').focus();
        await page.keyboard.press('Control+End');
        await page.keyboard.type('\n<p>来自 HTML 的追加段落。</p>');
        await page.locator('#editor-save').click();
        await page.locator('#editor-overlay').waitFor({state: 'hidden'});
        await page.waitForTimeout(250);
        assert.match(await page.locator('#note-content').innerText(), /来自 HTML 的追加段落/);
        assert.deepEqual(errors, []);
        await context.close();
        console.log('PASS rich editor + Markdown/HTML modes');
    }

    /* 4. Editor + reorder + auto-scroll on an ordered list. */
    {
        const {context, page, errors} = await newPage(browser, baseUrl);
        const items = Array.from({length: 34}, (_, index) => (
            `<li>条目 ${String(index + 1).padStart(2, '0')}</li>`
        )).join('');
        const html = `<h1>拖动测试</h1><p>长按并拖到边缘。</p><ol>${items}</ol><p>列表结束</p>${'<p>这一段用于制造足够长的滚动距离。</p>'.repeat(10)}`;
        await createHtmlNote(page, '拖动测试', html);
        assert.equal(await page.locator('#note-content ol > li').count(), 34);

        const speeds = await page.evaluate(() => ({
            edge: NoteDrag.autoScrollSpeed(0, 120, 20),
            middle: NoteDrag.autoScrollSpeed(60, 120, 20),
            outside: NoteDrag.autoScrollSpeed(120, 120, 20)
        }));
        assert.equal(speeds.edge, 20);
        assert.ok(speeds.middle > 0 && speeds.middle < 20);
        assert.equal(speeds.outside, 0);

        let first = page.locator('#note-content ol > li').first();
        let box = await first.boundingBox();
        assert.ok(box);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(480);
        assert.equal(await page.locator('.drag-ghost').count(), 1);

        const third = await page.locator('#note-content ol > li').nth(3).boundingBox();
        await page.mouse.move(box.x + box.width / 2, third.y + third.height / 2, {steps: 12});
        await page.waitForTimeout(240);
        const orderWhileDragging = await page.locator('#note-content ol > li').evaluateAll((nodes) => (
            nodes.slice(0, 6).map((node) => node.textContent.trim())
        ));
        assert.ok(await page.evaluate(() => document.getAnimations().length) > 0);
        await page.mouse.up();
        await page.waitForTimeout(300);
        assert.equal(await page.locator('.drag-ghost').count(), 0);
        const orderAfterDrop = await page.locator('#note-content ol > li').evaluateAll((nodes) => (
            nodes.slice(0, 6).map((node) => node.textContent.trim())
        ));
        assert.deepEqual(orderAfterDrop, orderWhileDragging);
        assert.notDeepEqual(orderAfterDrop, ['条目 01', '条目 02', '条目 03', '条目 04', '条目 05', '条目 06']);

        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(100);
        first = page.locator('#note-content ol > li').first();
        box = await first.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(460);
        const beforeScroll = await page.evaluate(() => window.scrollY);
        await page.mouse.move(box.x + box.width / 2, 905, {steps: 8});
        await page.waitForTimeout(800);
        const afterScroll = await page.evaluate(() => window.scrollY);
        assert.ok(afterScroll > beforeScroll + 20, `auto-scroll failed (${beforeScroll} -> ${afterScroll})`);
        await page.mouse.up();
        await page.waitForTimeout(300);

        // A long press must not also act as a strike-mode tap on release.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.locator('#strike-button').click();
        const dragTarget = page.locator('#note-content ol > li').nth(1);
        const dragBox = await dragTarget.boundingBox();
        await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(450);
        await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + 60, {steps: 6});
        await page.mouse.up();
        await page.waitForTimeout(350);
        assert.equal(await page.locator('#note-content [data-struck="true"]').count(), 0);

        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('notedown.state.v1')));
        assert.ok(stored.notes.some((note) => note.title === '拖动测试' && note.html.includes('<ol>')));
        assert.deepEqual(errors, []);
        await context.close();
        console.log('PASS long-press reorder + FLIP + numbered list + auto-scroll');
    }

    /* 4. Multi-format import and append. */
    {
        const {context, page, errors} = await newPage(browser, baseUrl);
        const htmlFile = {
            name: '第一份.html',
            mimeType: 'text/html',
            buffer: Buffer.from(`<!doctype html><html><head><title>被忽略</title><style>body{display:none}</style><script>alert('xss')</script></head><body><h1>HTML 行程</h1><p onclick="alert(1)">保留的段落</p><ul><li><input type="checkbox" checked> 已带走的牙刷</li><li>[ ] 还没收拾的行李</li></ul><img src="x" onerror="alert(1)"></body></html>`)
        };
        const markdownFile = {
            name: '第二份.md',
            mimeType: 'text/markdown',
            buffer: Buffer.from('# Markdown 清单\n\n- [ ] 第一项\n- [x] 第二项')
        };

        const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.locator('#import-library').click()
        ]);
        assert.equal(chooser.isMultiple(), true);
        await chooser.setFiles([htmlFile, markdownFile]);
        await page.locator('#note-screen:not([hidden])').waitFor();
        await page.waitForTimeout(350);
        assert.match(await page.locator('#note-title').innerText(), /HTML 行程 \+1/);
        assert.equal(await page.locator('#note-content .nt-file-label').count(), 2);
        assert.equal(await page.locator('#note-content .nt-checkbox').count(), 4);
        assert.equal(await page.locator('#note-content script, #note-content [onclick], #note-content [onerror]').count(), 0);

        const titleBefore = await page.locator('#note-title').innerText();
        await clickNoteMenu(page);
        const [appendChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.locator('[data-action="import"]').click()
        ]);
        await appendChooser.setFiles([{
            name: '追加.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('这是追加的纯文本。\n\n第二段。')
        }]);
        await page.waitForTimeout(350);
        assert.equal(await page.locator('#note-title').innerText(), titleBefore);
        assert.equal(await page.locator('#note-content .nt-file-label').count(), 3);
        assert.match(await page.locator('#note-content').innerText(), /追加的纯文本/);
        assert.deepEqual(errors, []);
        await context.close();
        console.log('PASS multi-file import + append');
    }
} catch (error) {
    failures.push(error);
} finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
}

if (failures.length > 0) {
    console.error(failures[0]);
    process.exit(1);
}
console.log('ALL PASS');
