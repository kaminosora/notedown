/* Real Chromium checks for offline LaTeX parsing, editing and persistence. */
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
const webRoot = path.resolve('app/src/main/assets/www');
const executablePath = [process.env.CHROME_PATH, process.env.CHROME_BIN,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].find(file => file && fs.existsSync(file));
assert.ok(executablePath, 'Set CHROME_PATH to Chromium');
const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(webRoot, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (!file.startsWith(webRoot + path.sep)) return response.writeHead(403).end();
    fs.readFile(file, (error, data) => {
        if (error) return response.writeHead(404).end();
        response.writeHead(200, {'Content-Type': {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2'}[path.extname(file)] || 'application/octet-stream'}).end(data);
    });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({executablePath, headless: true});
const results = [];
async function test(name, run) {
    if (process.env.TEST_MATH_FILTER && !new RegExp(process.env.TEST_MATH_FILTER).test(name)) return;
    const context = await browser.newContext({viewport: {width: 412, height: 915}});
    const page = await context.newPage();
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('data:')) external.push(request.url()); });
    page.setDefaultTimeout(5000);
    try {
        await page.goto(base);
        await page.evaluate(() => {
            const create = NoteRichEditor.create;
            NoteRichEditor.create = (...args) => window.__editor = create(...args);
        });
        await run(page);
        assert.deepEqual(errors, []);
        assert.deepEqual(external, [], 'Math never requests a remote resource');
        results.push({name, passed: true}); console.log(`PASS ${name}`);
    } catch (error) {
        results.push({name, passed: false, error: error.stack}); console.error(`FAIL ${name}: ${error.stack}`);
        fs.mkdirSync('.test-artifacts', {recursive:true});
        await page.screenshot({path:`.test-artifacts/math-failure-${results.length}.png`});
    } finally { await context.close(); }
}
async function fixture(page, source, mode = 'html') {
    await page.locator('#new-note-fab').click();
    await page.locator(`[data-editor-mode="${mode}"]`).click();
    await page.locator('#editor-title').fill('公式验收');
    await page.locator('#editor-textarea').fill(source);
    await page.locator('[data-editor-mode="rich"]').click();
    await page.waitForTimeout(100);
}
async function formulas(page) {
    return page.evaluate(() => { const root = document.createElement('div'); root.innerHTML = __editor.getHTML();
        return Array.from(root.querySelectorAll('[data-math]'), el => ({latex:el.getAttribute('data-latex'), display:el.getAttribute('data-math') === 'block'})); });
}
try {
    await test('Markdown math delimiters leave code, escapes and currency intact', async page => {
        const value = await page.evaluate(() => {
            const md = String.raw`Inline $x^2$ and \(\alpha+\beta\).

$$\frac{a}{b}$$

\[\sum_{i=1}^{n}i\]

Keep \$5 and $10 dollars, \$literal\$ and ` + '`$code$`' + '\n\n```latex\n$x$\n```';
            const root=document.createElement('div'); root.innerHTML=NoteParser.markdownToHtml(md);
            return {math:Array.from(root.querySelectorAll('[data-math]'), n=>[n.getAttribute('data-latex'),n.getAttribute('data-math')]), code:root.querySelector('pre code')?.textContent, inline:root.querySelector('p code')?.textContent, text:root.textContent,html:root.innerHTML};
        });
        assert.deepEqual(value.math, [['x^2','inline'],['\\alpha+\\beta','inline'],['\\frac{a}{b}','block'],['\\sum_{i=1}^{n}i','block']]);
        assert.equal(value.code, '$x$\n'); assert.equal(value.inline, '$code$');
        assert.ok(value.text.includes('$5 and $10 dollars'));
    });
    await test('HTML delimiters normalize mixed display formulas without touching code', async page => {
        const result = await page.evaluate(() => {
            const root=document.createElement('div');
            root.innerHTML=NoteParser.htmlToHtml(String.raw`<p>before \[x^2\] middle $$y^2$$ after \(z\)</p><pre>$code$</pre><p>cost $5 and $10</p>`);
            return {math:Array.from(root.querySelectorAll('[data-math]'), e=>[e.tagName,e.getAttribute('data-latex')]), text:root.textContent, invalid:root.querySelector('p div') !== null};
        });
        assert.deepEqual(result.math,[['DIV','x^2'],['DIV','y^2'],['SPAN','z']]);
        assert.equal(result.invalid,false); assert.ok(result.text.includes('middle')); assert.ok(result.text.includes('after')); assert.ok(result.text.includes('$code$'));
    });
    await test('LaTeX source survives rich, Markdown, HTML and table round trips', async page => {
        const source = '<p>inline <span data-math="inline" data-latex="x_{i}^{2}">x_{i}^{2}</span></p><div data-math="block" data-latex="\\begin{aligned}a&amp;=b\\\\c&amp;=d\\end{aligned}"></div><table><tr><th>Math</th></tr><tr><td><span data-math="inline" data-latex="\\frac{x}{y}"></span></td></tr></table>';
        await fixture(page, source);
        const before=await formulas(page);
        for(let i=0;i<2;i++) {
            await page.locator('[data-editor-mode="markdown"]').click();
            await page.locator('[data-editor-mode="html"]').click();
            await page.locator('[data-editor-mode="rich"]').click();
        }
        assert.deepEqual(await formulas(page),before);
        assert.equal(await page.locator('#editor-rich [data-math] .katex').count(),3);
        const saved=await page.evaluate(()=>__editor.getHTML());
        assert.ok(!/katex|<math|<svg/.test(saved));
    });
    await test('Supported formulas render locally and retain accessible MathML', async page => {
        const result=await page.evaluate(async()=>{
            const root=document.createElement('section');document.body.appendChild(root);
            const samples=[String.raw`\frac{a}{b}`,String.raw`\sqrt{x_1^2+y_1^2}`,String.raw`\int_0^\infty e^{-x}dx`,String.raw`\sum_{i=1}^n i`,String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`];
            const ok=samples.map(latex=>{const el=document.createElement('div');root.appendChild(el);return NoteMath.renderFormula(el,latex,true).ok});
            const first = root.firstChild; first.textContent = 'preview cleared';
            NoteMath.renderFormula(first, samples[0], true);
            await document.fonts.ready;
            return {ok,mathml:root.querySelectorAll('math').length,fonts:document.fonts.status};
        });
        assert.deepEqual(result.ok,[true,true,true,true,true]);assert.equal(result.mathml,5);assert.equal(result.fonts,'loaded');
    });
    await test('Inline formulas followed immediately by digits survive source mode round trips', async page => {
        await fixture(page, '<p>面积是<span data-math="inline" data-latex="x^2">x^2</span>2倍。还有<span data-math="inline" data-latex="y^2">y^2</span>3项。</p>');
        const before = await formulas(page);
        const text = await page.evaluate(() => { const root=document.createElement('div'); root.innerHTML=__editor.getHTML(); return root.textContent; });
        for (let i=0;i<2;i++) {
            await page.locator('[data-editor-mode="markdown"]').click();
            assert.ok((await page.locator('#editor-textarea').inputValue()).includes(String.raw`\(x^2\)2倍`));
            await page.locator('[data-editor-mode="rich"]').click();
        }
        assert.deepEqual(await formulas(page), before);
        assert.equal(await page.evaluate(() => { const root=document.createElement('div'); root.innerHTML=__editor.getHTML(); return root.textContent; }),text);
    });
    await test('Mismatched braces and embedded closing delimiters preserve formula nodes and source', async page => {
        await fixture(page, '<p><span data-math="inline" data-latex="\\frac{">\\frac{</span>后文<span data-math="inline" data-latex="x\\)y">x\\)y</span></p><div data-math="block" data-latex="a_{">a_{</div>');
        const before=await formulas(page);
        for (let i=0;i<2;i++) {
            await page.locator('[data-editor-mode="markdown"]').click();
            assert.ok((await page.locator('#editor-textarea').inputValue()).includes('data-latex="\\frac{"'));
            await page.locator('[data-editor-mode="html"]').click();
            await page.locator('[data-editor-mode="rich"]').click();
        }
        assert.deepEqual(await formulas(page),before);
        assert.ok((await page.locator('#editor-rich').innerText()).includes('后文'));
    });
    await test('Unsafe macros, oversized input and errors cannot inject HTML or lose source', async page => {
        const result=await page.evaluate(()=>{
            const root=document.createElement('div');document.body.appendChild(root);
            const samples=[String.raw`\href{javascript:alert(1)}{link}`,String.raw`\includegraphics{https://example.invalid/image}`,String.raw`\htmlClass{evil}{x}`,String.raw`\def\loop{\loop}\loop`,String.raw`\frac{`, 'x'.repeat(10001)];
            const states=samples.map(source=>{const el=document.createElement('div');root.appendChild(el);const result=NoteMath.renderFormula(el,source);return {ok:result.ok,text:el.textContent,error:result.error}});
            const injected=NoteParser.htmlToHtml('<span data-math="inline" data-latex="x"><img src="https://example.invalid/a" onerror="alert(1)"></span><a data-math="block" data-latex="bad">label</a>');
            return {states,hasDangerous:!!root.querySelector('a[href],img,[class="evil"],script'),injected};
        });
        assert.equal(result.hasDangerous,false);
        assert.equal(result.states[3].ok,false); assert.equal(result.states[4].ok,false); assert.equal(result.states[5].ok,false);
        assert.equal(result.states[5].text,'x'.repeat(10001));
        assert.ok(!result.injected.includes('<img')); assert.ok(!result.injected.includes('data-latex="bad"'));
    });
    await test('Large unmatched delimiters and backslash runs remain bounded and preserve text', async page => {
        const result = await page.evaluate(() => {
            const cases = ['\\('.repeat(18000), '\\'.repeat(100000), '$' + 'x'.repeat(100000), '$x '.repeat(20000)];
            const started = performance.now();
            const preserved = cases.map(source => {
                const root = document.createElement('div'); root.innerHTML = NoteParser.htmlToHtml(`<p>${source}</p>`);
                return root.textContent === source;
            });
            const markdown = NoteParser.markdownToHtml('\\('.repeat(18000));
            return {preserved, elapsed: performance.now() - started, rendered: markdown.length};
        });
        assert.deepEqual(result.preserved, [true, true, true, true]);
        assert.ok(result.elapsed < 2500, `Parsing took ${result.elapsed}ms`);
        assert.ok(result.rendered > 0);
    });
    await test('Formula layout changes preserve source and undo as one transaction', async page => {
        await fixture(page, '<p>left <span data-math="inline" data-latex="x^2"></span> right</p>');
        await page.locator('#editor-rich [data-math]').click();
        await page.evaluate(() => __editor.setMath({latex: 'x^2', display: true}));
        assert.deepEqual(await formulas(page), [{latex: 'x^2', display: true}]);
        assert.ok((await page.locator('#editor-rich').innerText()).includes('right'));
        await page.evaluate(() => __editor.run('undo'));
        assert.deepEqual(await formulas(page), [{latex: 'x^2', display: false}]);
    });
    await test('Rich math insertion, editing, deletion and undo preserve adjacent text', async page => {
        await fixture(page,'<p>before after</p>');
        await page.evaluate(()=>{__editor.select(8);__editor.setMath({latex:'x^2',display:false})});
        assert.deepEqual(await formulas(page),[{latex:'x^2',display:false}]);
        await page.locator('#editor-rich [data-math]').click();
        assert.equal(await page.evaluate(()=>__editor.getMath()?.latex),'x^2');
        await page.evaluate(()=>__editor.setMath({latex:'y^2',display:false}));
        assert.equal((await formulas(page))[0].latex,'y^2');
        await page.evaluate(()=>__editor.run('undo'));
        assert.equal((await formulas(page))[0].latex,'x^2');
        await page.evaluate(()=>__editor.run('redo'));
        await page.locator('#editor-rich [data-math]').click();
        await page.evaluate(()=>__editor.setMath({latex:''}));
        assert.equal((await formulas(page)).length,0);
        assert.ok((await page.locator('#editor-rich').innerText()).includes('before after'));
        await page.evaluate(()=>__editor.run('undo'));
        assert.equal((await formulas(page))[0].latex,'y^2');
    });
    await test('Formula toolbar toggles, inserts templates, edits and preserves draft on cancel', async page => {
        await fixture(page,'<p>formula here</p>');
        assert.equal(await page.locator('#math-toolbar').isVisible(),false);
        await page.locator('#editor-math-toggle').click();
        assert.equal(await page.locator('#math-toolbar').isVisible(),true);
        await page.locator('#math-toolbar button', {hasText:'分式'}).click();
        await page.waitForTimeout(80);
        assert.equal(await page.locator('#editor-math-preview .katex').count(),1);
        await page.locator('#editor-math-apply').click();
        const original=await formulas(page);
        assert.equal(original.length,1);
        await page.locator('#editor-rich [data-math]').dblclick();
        await page.locator('#editor-math-input').fill('z^3');
        await page.locator('#editor-math-layer [data-math-dismiss]').last().click();
        assert.deepEqual(await formulas(page),original);
        await page.locator('#editor-math-toggle').click();
        assert.equal(await page.locator('#math-toolbar').isVisible(),false);
        assert.deepEqual(await formulas(page),original);
    });
    await test('Reading checkbox save strips KaTeX DOM and retains exact formula metadata', async page => {
        await fixture(page,'<p><span data-math="inline" data-latex="x^2"></span></p><ul><li data-task="true" data-checked="false"><p>task</p></li></ul>');
        await page.locator('#editor-save').click();
        assert.equal(await page.locator('#note-content .katex').count(),1);
        await page.locator('#note-content .nt-checkbox').click();
        const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('notedown.state.v1')));
        const note=data.notes.find(note=>note.title==='公式验收');
        assert.ok(note.html.includes('data-latex="x^2"'));
        assert.ok(!/katex|<math|<svg/.test(note.html));
        await page.locator('#edit-note-button').click();
        assert.deepEqual(await formulas(page),[{latex:'x^2',display:false}]);
    });
} finally {
    await browser.close(); await new Promise(resolve=>server.close(resolve));
    fs.mkdirSync('.test-artifacts',{recursive:true});
    fs.writeFileSync('.test-artifacts/math-report.json',JSON.stringify(results,null,2));
    const failed=results.filter(result=>!result.passed).length;
    console.log(`${results.length-failed} math checks passed; ${failed} failed.`);
    if(failed) process.exitCode=1;
}
