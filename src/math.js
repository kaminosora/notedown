// Offline LaTeX display and lossless source tokens. Rendered KaTeX DOM is UI only.
import katex from 'katex';

const MAX_SOURCE_LENGTH = 10000;
const cache = new WeakMap();
const installed = new WeakSet();
let parseBudget = 0;
function beginParse(length) { parseBudget = Math.min(16000000, Math.max(1024, Number(length) * 8)); }
const delimiters = [
    {open: '$$', close: '$$', display: true},
    {open: '\\[', close: '\\]', display: true},
    {open: '\\(', close: '\\)', display: false},
    {open: '$', close: '$', display: false}
];
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
function escaped(source, index) {
    let count = 0;
    while (index > 0 && source[--index] === '\\') count++;
    return count % 2 === 1;
}

function tokenAt(source, start = 0, onlyDisplay = false) {
    if (parseBudget <= 0) return null;
    if (source[start] !== '$' && !(source[start] === '\\' && ['[', '('].includes(source[start + 1]))) return null;
    if (escaped(source, start)) return null;
    for (const delimiter of delimiters) {
        if (onlyDisplay && !delimiter.display || !source.startsWith(delimiter.open, start)) continue;
        if (delimiter.open === '$' && (source[start + 1] === '$' || /\s/.test(source[start + 1] || ' '))) continue;
        const bodyStart = start + delimiter.open.length;
        let depth = 0;
        let slashRun = 0;
        const end = Math.min(source.length, bodyStart + MAX_SOURCE_LENGTH + delimiter.close.length);
        for (let index = bodyStart; index < end; index++) {
            if (--parseBudget <= 0) return null;
            if (delimiter.open === '$' && source[index] === '\n') break;
            if (delimiter.open === '$' && !depth && source[index] === '`') break;
            const isEscaped = slashRun % 2 === 1;
            if (!isEscaped) {
                if (source[index] === '{') depth++;
                if (source[index] === '}') depth = Math.max(0, depth - 1);
            }
            if (!depth && !isEscaped && source.startsWith(delimiter.close, index)) {
                if (delimiter.open === '$' && (/\s/.test(source[index - 1] || ' ') || /\d/.test(source[index + 1] || '') || source[index + 1] === '$')) return null;
                const latex = source.slice(bodyStart, index);
                if (!latex.trim()) return null;
                return {raw: source.slice(start, index + delimiter.close.length), latex, display: delimiter.display};
            }
            slashRun = source[index] === '\\' ? slashRun + 1 : 0;
        }
        // A double dollar opening must never fall back to a single dollar.
        if (delimiter.open === '$$') return null;
    }
    return null;
}

function sourceHtml(latex, display = false, inlineContainer = false) {
    const tag = display && !inlineContainer ? 'div' : 'span';
    return `<${tag} data-math="${display ? 'block' : 'inline'}" data-latex="${escapeHtml(latex)}">${escapeHtml(latex)}</${tag}>`;
}

function toMarkdown(latex, display = false) {
    const source = String(latex);
    // Parenthesized inline syntax has no dollar/currency boundary ambiguity:
    // e.g. an expression immediately followed by "2倍" must remain a formula.
    if (!source.trim() || (!display && /\r|\n/.test(source))) return null;
    const candidate = display ? `$$${source}$$` : `\\(${source}\\)`;
    const previousBudget = parseBudget;
    beginParse(candidate.length);
    const token = tokenAt(candidate);
    parseBudget = previousBudget;
    // Invalid/mismatched source, embedded closing delimiters and oversize
    // input stay as canonical HTML instead of silently becoming plain text.
    return token && token.raw === candidate && token.latex === source && token.display === display ? candidate : null;
}

function installMarkdown(marked) {
    if (installed.has(marked)) return;
    installed.add(marked);
    marked.use({extensions: [
        {
            name: 'notedownMathBlock', level: 'block',
            start: source => source.search(/(?:^|\n)[ \t]{0,3}(?:\$\$|\\\[)/),
            tokenizer(source) {
                const indent = source.match(/^[ \t]{0,3}/)[0].length;
                const token = tokenAt(source, indent, true);
                if (!token) return;
                return {type: 'notedownMathBlock', ...token, raw: source.slice(0, indent) + token.raw};
            },
            renderer: token => sourceHtml(token.latex, true) + '\n'
        },
        {
            name: 'notedownMathInline', level: 'inline',
            start: source => source.search(/\$|\\[([]/),
            tokenizer(source) {
                const token = tokenAt(source);
                if (token) return {type: 'notedownMathInline', ...token};
            },
            renderer: token => sourceHtml(token.latex, token.display, true)
        }
    ]});
}

function normalize(root) {
    for (const element of root.querySelectorAll('[data-math], [data-latex]')) {
        const mode = element.getAttribute('data-math');
        if (!['inline', 'block'].includes(mode) || !['SPAN', 'DIV'].includes(element.tagName) || !element.hasAttribute('data-latex')) {
            element.removeAttribute('data-math');
            element.removeAttribute('data-latex');
            continue;
        }
        element.textContent = element.getAttribute('data-latex');
        // Keep block formulas structurally outside paragraph/heading content.
        if (mode === 'block' && element.tagName === 'SPAN') {
            const block = document.createElement('div');
            block.setAttribute('data-math', 'block');
            block.setAttribute('data-latex', element.getAttribute('data-latex'));
            block.textContent = element.textContent;
            const paragraph = element.closest('p, h1, h2, h3, h4, h5, h6');
            if (paragraph) {
                const before = document.createRange(); before.selectNodeContents(paragraph); before.setEndBefore(element);
                const after = document.createRange(); after.selectNodeContents(paragraph); after.setStartAfter(element);
                const first = paragraph.cloneNode(false); first.appendChild(before.extractContents());
                const last = paragraph.cloneNode(false); last.appendChild(after.extractContents());
                const replacement = document.createDocumentFragment();
                if (first.textContent.trim() || first.querySelector('img, [data-math]')) replacement.appendChild(first);
                replacement.appendChild(block);
                if (last.textContent.trim() || last.querySelector('img, [data-math]')) replacement.appendChild(last);
                paragraph.replaceWith(replacement);
            } else element.replaceWith(block);
        }
    }
}

function parseHtml(root) {
    beginParse(root.textContent.length);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: node => node.parentElement?.closest('pre, code, kbd, script, style, [data-math], [data-latex]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
        const source = node.nodeValue;
        let from = 0;
        const fragment = document.createDocumentFragment();
        let matched = false;
        for (let index = 0; index < source.length; index++) {
            if (parseBudget <= 0) break;
            if (source[index] !== '$' && source[index] !== '\\') continue;
            if (source[index] === '\\' && ['\\', '$'].includes(source[index + 1])) { index++; continue; }
            const token = tokenAt(source, index);
            if (!token) continue;
            matched = true;
            fragment.appendChild(document.createTextNode(source.slice(from, index)));
            const math = document.createElement('span');
            math.setAttribute('data-math', token.display ? 'block' : 'inline');
            math.setAttribute('data-latex', token.latex);
            math.textContent = token.latex;
            fragment.appendChild(math);
            index += token.raw.length - 1;
            from = index + 1;
        }
        if (matched) { fragment.appendChild(document.createTextNode(source.slice(from))); node.replaceWith(fragment); }
    }
    normalize(root);
}

function renderFormula(element, latex, display = false) {
    const source = String(latex ?? '');
    const previous = cache.get(element);
    if (previous && previous.source === source && previous.display === display
        && (previous.result.ok ? element.querySelector('.katex') : element.textContent === source)) return previous.result;
    element.classList.add('nt-math');
    element.classList.toggle('nt-math-block', display);
    element.classList.remove('nt-math-error');
    element.setAttribute('aria-label', `公式：${source}`);
    element.removeAttribute('title');
    let result;
    try {
        if (!source.trim()) throw new Error('请输入 LaTeX 公式');
        if (source.length > MAX_SOURCE_LENGTH) throw new Error(`公式超过 ${MAX_SOURCE_LENGTH} 字符，保留源码显示`);
        katex.render(source, element, {displayMode: display, output: 'htmlAndMathml', throwOnError: true,
            trust: false, strict: 'ignore', maxSize: 20, maxExpand: 1000, macros: {}});
        result = {ok: true};
    } catch (error) {
        element.textContent = source;
        element.classList.add('nt-math-error');
        const message = String(error.message || '无法解析公式').slice(0, 500);
        element.title = message;
        element.setAttribute('aria-label', `公式解析失败：${message}。源码：${source}`);
        result = {ok: false, error: message};
    }
    cache.set(element, {source, display, result});
    return result;
}

function render(root) {
    const formulas = Array.from(root.querySelectorAll('[data-math][data-latex]'));
    for (const element of formulas) renderFormula(element, element.getAttribute('data-latex'), element.getAttribute('data-math') === 'block');
}

window.NoteMath = {MAX_SOURCE_LENGTH, beginParse, installMarkdown, normalize, parseHtml, renderFormula, render, sourceHtml, toMarkdown};
