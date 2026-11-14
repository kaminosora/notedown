/*
 * Notedown content pipeline.
 *
 * Markdown is rendered by marked and every rendered document passes through
 * DOMPurify. HTML imports are reduced to a small, readable set of semantic
 * tags. The canonical note format is safe HTML with four extra data
 * attributes:
 *
 *   data-task="true" data-checked="true|false"  -> task list item
 *   data-struck="true"                         -> crossed-out block
 *   data-file="name"                           -> imported file label
 *
 * Interactive controls are re-created at display time by enhanceContent().
 * That keeps the saved document semantic, portable and clean.
 */
(function (global) {
    'use strict';

    if (!global.marked || !global.DOMPurify) {
        throw new Error('Markdown dependencies are missing.');
    }

    const marked = global.marked;
    const DOMPurify = global.DOMPurify;
    if (global.NoteMath) global.NoteMath.installMarkdown(marked);

    const ALLOWED_TAGS = [
        'a', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'strong', 'b',
        'em', 'i', 'del', 's', 'strike', 'u', 'mark', 'small', 'sub',
        'sup', 'span', 'div', 'table', 'thead', 'tbody', 'tfoot', 'tr',
        'th', 'td', 'caption', 'img', 'figure', 'figcaption', 'details',
        'summary', 'kbd', 'input'
    ];

    const ALLOWED_ATTRIBUTES = [
        'href', 'title', 'alt', 'src', 'start', 'reversed', 'type',
        'checked', 'disabled', 'colspan', 'rowspan', 'scope', 'align', 'class'
    ];

    const APP_DATA_ATTRIBUTES = new Set([
        'data-task', 'data-checked', 'data-struck', 'data-file', 'data-math', 'data-latex'
    ]);

    const PURIFY_CONFIG = {
        ALLOWED_TAGS,
        ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
        ALLOW_DATA_ATTR: true,
        ALLOW_ARIA_ATTR: true,
        FORBID_TAGS: [
            'script', 'style', 'iframe', 'object', 'embed', 'form',
            'button', 'select', 'textarea', 'video', 'audio', 'source',
            'track', 'svg', 'math', 'link', 'meta', 'base', 'template',
            'canvas', 'dialog', 'frame', 'frameset', 'applet', 'noscript'
        ],
        FORBID_ATTR: [
            'style', 'id', 'name', 'target', 'rel', 'srcset',
            'sizes', 'formaction', 'autofocus', 'contenteditable', 'draggable'
        ],
        FORBID_CONTENTS: [
            'script', 'style', 'iframe', 'object', 'embed', 'template',
            'svg', 'math', 'noscript'
        ],
        KEEP_CONTENT: true,
        SANITIZE_DOM: true,
        SAFE_FOR_TEMPLATES: false,
        // USE_PROFILES overrides ALLOWED_TAGS; keep the explicit allowlist.
        ALLOW_UNKNOWN_PROTOCOLS: false
    };

    const MARKDOWN_OPTIONS = {
        gfm: true,
        breaks: true,
        async: false,
        pedantic: false
    };

    let template = null;

    function getTemplate() {
        if (!template) {
            template = document.createElement('template');
        }
        template.innerHTML = '';
        return template;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttribute(value) {
        return escapeHtml(value).replace(/\n/g, ' ');
    }

    function collapseWhitespace(value) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    }

    function truncate(value, maxLength) {
        const text = collapseWhitespace(value);
        if (!maxLength || text.length <= maxLength) {
            return text;
        }
        return text.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
    }

    function removeUnsafeDataAttributes(fragment) {
        const nodes = fragment.querySelectorAll('*');
        for (const element of nodes) {
            for (const attribute of Array.from(element.attributes)) {
                if (attribute.name.startsWith('data-') && !APP_DATA_ATTRIBUTES.has(attribute.name)) {
                    element.removeAttribute(attribute.name);
                }
            }
        }
    }

    function normaliseClasses(fragment) {
        for (const element of fragment.querySelectorAll('[class]')) {
            // Code language is document data; all presentation/editor classes
            // are transient and must never enter the canonical document.
            const language = element.tagName === 'CODE'
                ? Array.from(element.classList).find((name) => /^language-[A-Za-z0-9_+-]{1,64}$/.test(name))
                : null;
            if (language) {
                element.setAttribute('class', language);
            } else {
                element.removeAttribute('class');
            }
        }
    }

    function normaliseLinksAndImages(fragment) {
        for (const anchor of fragment.querySelectorAll('a')) {
            const raw = (anchor.getAttribute('href') || '').trim();
            if (!raw) {
                anchor.removeAttribute('href');
                continue;
            }
            if (!/^(https?:\/\/|mailto:|tel:|#)/i.test(raw)) {
                anchor.removeAttribute('href');
            }
        }

        for (const image of fragment.querySelectorAll('img')) {
            const source = (image.getAttribute('src') || '').trim();
            if (!/^(https?:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(source)) {
                image.remove();
                continue;
            }
            if (!image.getAttribute('alt')) {
                image.setAttribute('alt', '');
            }
        }
    }

    function leadingTaskMarker(li) {
        const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || !node.nodeValue.trim()) {
                    return NodeFilter.FILTER_REJECT;
                }
                const owner = node.parentElement && node.parentElement.closest('li');
                if (owner !== li) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        const textNode = walker.nextNode();
        if (!textNode) {
            return null;
        }
        if (textNode.parentElement.closest('code, pre')) {
            return null;
        }
        const match = textNode.nodeValue.match(/^\s*\[([ xX])\]\s+/);
        if (!match) {
            return null;
        }
        textNode.nodeValue = textNode.nodeValue.replace(/^\s*\[([ xX])\]\s+/, '');
        return match[1].toLowerCase() === 'x';
    }

    function normaliseTasks(fragment) {
        const items = fragment.querySelectorAll('li');
        for (const li of items) {
            const ownInputs = Array.from(li.querySelectorAll('input[type="checkbox"]')).filter((input) => input.closest('li') === li);
            let checked = li.getAttribute('data-task') === 'true'
                ? li.getAttribute('data-checked') === 'true'
                : null;

            if (ownInputs.length > 0) {
                const first = ownInputs[0];
                checked = first.checked || first.hasAttribute('checked');
                // marked inserts a separator after its checkbox, including a
                // newline in loose lists. It is UI syntax, not task content.
                if (first.nextSibling && first.nextSibling.nodeType === Node.TEXT_NODE) {
                    first.nextSibling.nodeValue = first.nextSibling.nodeValue.replace(/^\s+/, '');
                }
            }

            const markerState = leadingTaskMarker(li);
            if (markerState !== null) {
                checked = markerState;
            }

            if (checked === null) {
                li.removeAttribute('data-task');
                li.removeAttribute('data-checked');
            } else {
                li.setAttribute('data-task', 'true');
                li.setAttribute('data-checked', checked ? 'true' : 'false');
            }
        }

        for (const input of fragment.querySelectorAll('input')) {
            input.remove();
        }

        for (const element of fragment.querySelectorAll('[data-struck]')) {
            if (element.getAttribute('data-struck') !== 'true') {
                element.removeAttribute('data-struck');
            }
        }

        for (const label of fragment.querySelectorAll('[data-file]')) {
            const name = collapseWhitespace(label.getAttribute('data-file'));
            if (!name) {
                label.removeAttribute('data-file');
                label.remove();
            } else {
                label.setAttribute('data-file', truncate(name, 120));
                label.textContent = '';
            }
        }
    }

    function canonicalize(rawHtml, parseMath = false) {
        const sanitized = DOMPurify.sanitize(String(rawHtml || ''), PURIFY_CONFIG);
        const holder = getTemplate();
        holder.innerHTML = sanitized;
        const fragment = holder.content;
        removeUnsafeDataAttributes(fragment);
        normaliseClasses(fragment);
        normaliseLinksAndImages(fragment);
        normaliseTasks(fragment);
        if (global.NoteMath) {
            if (parseMath) global.NoteMath.parseHtml(fragment);
            else global.NoteMath.normalize(fragment);
        }
        return holder.innerHTML;
    }

    /**
     * Sanitize an already canonical document for rendering. Unlike an import,
     * this preserves our application data attributes and restores no controls.
     */
    function sanitizeHtml(rawHtml) {
        return canonicalize(rawHtml);
    }

    function htmlBody(rawHtml) {
        const text = String(rawHtml || '');
        try {
            const doc = new DOMParser().parseFromString(text, 'text/html');
            return {
                body: doc.body ? doc.body.innerHTML : text,
                title: collapseWhitespace(doc.title || '')
            };
        } catch (error) {
            return {body: text, title: ''};
        }
    }

    function markdownToHtml(markdown) {
        if (global.NoteMath) global.NoteMath.beginParse(String(markdown || '').length);
        const rendered = marked.parse(String(markdown || ''), MARKDOWN_OPTIONS);
        return canonicalize(rendered);
    }

    function htmlToHtml(html) {
        return canonicalize(htmlBody(html).body, true);
    }

    function plainTextToHtml(text) {
        const blocks = String(text || '')
            .replace(/\r\n?/g, '\n')
            .split(/\n{2,}/)
            .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
            .join('\n');
        return canonicalize(blocks);
    }

    function fragmentFromHtml(html) {
        const holder = getTemplate();
        holder.innerHTML = html;
        return holder.content;
    }

    function firstHeadingText(html) {
        const fragment = fragmentFromHtml(html);
        const heading = fragment.querySelector('h1, h2, h3');
        return heading ? collapseWhitespace(heading.textContent) : '';
    }

    function topText(html) {
        const fragment = fragmentFromHtml(html);
        const selectors = ['h1', 'h2', 'h3', 'p', 'li', 'blockquote'];
        for (const selector of selectors) {
            const element = fragment.querySelector(selector);
            if (element) {
                const text = collapseWhitespace(element.textContent);
                if (text) {
                    return text;
                }
            }
        }
        return '';
    }

    function plainText(html) {
        const fragment = fragmentFromHtml(html);
        for (const label of fragment.querySelectorAll('[data-file]')) {
            label.remove();
        }
        const blocks = fragment.querySelectorAll(
            'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, td, th, figcaption, summary'
        );
        for (const block of blocks) {
            block.appendChild(document.createTextNode(' '));
        }
        return collapseWhitespace(fragment.textContent || '');
    }

    function fileBaseName(name) {
        const clean = String(name || '').replace(/[/\\]+$/, '');
        const base = clean.split(/[/\\]/).pop() || '未命名';
        const dot = base.lastIndexOf('.');
        return collapseWhitespace(dot > 0 ? base.slice(0, dot) : base) || '未命名';
    }

    function detectFormat(name, mime) {
        const lowerName = String(name || '').toLowerCase();
        if (/\.(md|markdown|mdown|mkd)$/.test(lowerName)) {
            return 'markdown';
        }
        if (/\.(html?|xhtml)$/.test(lowerName)) {
            return 'html';
        }
        if (/\.(txt|text)$/.test(lowerName)) {
            return 'text';
        }
        const lowerMime = String(mime || '').toLowerCase();
        if (lowerMime.includes('markdown')) {
            return 'markdown';
        }
        if (lowerMime.includes('html')) {
            return 'html';
        }
        if (lowerMime.startsWith('text/')) {
            return 'text';
        }
        return '';
    }

    function convertFile(file) {
        const name = collapseWhitespace(file && file.name) || '未命名文件';
        const format = file && file.format ? file.format : detectFormat(name, file && file.mime);
        const source = file && typeof file.text === 'string' ? file.text : '';
        let html = '';
        let docTitle = '';
        let fallback = fileBaseName(name);

        if (format === 'html') {
            const parsed = htmlBody(source);
            html = canonicalize(parsed.body, true);
            docTitle = parsed.title;
        } else if (format === 'text') {
            html = plainTextToHtml(source);
        } else {
            html = markdownToHtml(source);
        }

        const heading = firstHeadingText(html);
        const title = truncate(heading || docTitle || topText(html) || fallback, 64) || '未命名笔记';
        return {name, format: format || 'markdown', html, title};
    }

    function combineFiles(files) {
        const list = Array.isArray(files) ? files : [];
        if (list.length === 0) {
            return {html: '', title: '未命名笔记', imported: 0};
        }
        const blocks = [];
        let firstTitle = '';
        let imported = 0;

        for (const file of list) {
            let converted;
            try {
                converted = convertFile(file);
            } catch (error) {
                console.warn('Import failed for', file && file.name, error);
                continue;
            }
            if (!firstTitle) {
                firstTitle = converted.title;
            }
            blocks.push(
                `<div data-file="${escapeAttribute(converted.name)}"></div>\n${converted.html}`
            );
            imported += 1;
        }

        if (blocks.length === 0) {
            return {html: '', title: '未命名笔记', imported: 0};
        }
        const title = list.length > 1
            ? `${truncate(firstTitle, 44)} +${blocks.length - 1}`
            : truncate(firstTitle, 64);
        return {html: blocks.join('\n'), title: title || '导入的笔记', imported};
    }

    function enhanceContent(root) {
        if (!root) {
            return;
        }
        if (global.NoteMath) global.NoteMath.render(root);

        const taskItems = root.querySelectorAll('li[data-task="true"]');
        for (const li of taskItems) {
            const done = li.getAttribute('data-checked') === 'true';
            li.classList.add('nt-task');
            li.classList.toggle('is-done', done);

            const existing = li.querySelector(':scope > .nt-checkbox');
            if (!existing) {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'nt-checkbox';
                checkbox.checked = done;
                checkbox.setAttribute('aria-label', '切换完成状态');
                li.insertBefore(checkbox, li.firstChild);
            }
            if (li.parentElement) {
                li.parentElement.classList.add('nt-task-list');
            }
        }

        for (const element of root.querySelectorAll('[data-struck="true"]')) {
            element.classList.add('is-struck');
        }

        for (const element of root.querySelectorAll('[data-file]')) {
            const file = element.getAttribute('data-file');
            if (!file) {
                continue;
            }
            element.classList.add('nt-file-label');
            element.textContent = `导入自 ${file}`;
        }
    }

    function serializeContent(root) {
        if (!root) {
            return '';
        }
        const clone = root.cloneNode(true);
        // KaTeX markup, SVG/MathML and accessibility helpers are transient.
        // Restore exact LaTeX before any reading controls can save this DOM.
        if (global.NoteMath) global.NoteMath.normalize(clone);

        for (const li of clone.querySelectorAll('li[data-task="true"]')) {
            const checkbox = li.querySelector(':scope > input.nt-checkbox');
            if (checkbox) {
                li.setAttribute('data-checked', checkbox.checked ? 'true' : 'false');
            }
            li.classList.toggle('is-done', li.getAttribute('data-checked') === 'true');
        }

        for (const element of clone.querySelectorAll('.nt-checkbox, .drag-ghost')) {
            element.remove();
        }

        for (const element of clone.querySelectorAll('[data-struck]')) {
            if (!element.hasAttribute('data-struck')) {
                continue;
            }
            const struck = element.classList.contains('is-struck');
            if (struck) {
                element.setAttribute('data-struck', 'true');
            } else {
                element.removeAttribute('data-struck');
            }
        }

        for (const element of clone.querySelectorAll('[data-file]')) {
            element.textContent = '';
        }

        for (const element of clone.querySelectorAll('*')) {
            element.removeAttribute('contenteditable');
            element.removeAttribute('tabindex');
            element.removeAttribute('aria-label');
            element.removeAttribute('aria-hidden');
            element.removeAttribute('role');
        }

        normaliseClasses(clone);
        return clone.innerHTML.trim();
    }

    function countTasks(html) {
        const fragment = fragmentFromHtml(html);
        const tasks = fragment.querySelectorAll('li[data-task="true"]');
        let done = 0;
        for (const task of tasks) {
            if (task.getAttribute('data-checked') === 'true') {
                done += 1;
            }
        }
        return {total: tasks.length, done};
    }

    function titleFromMarkdown(markdown) {
        try {
            const html = markdownToHtml(markdown);
            return truncate(firstHeadingText(html) || topText(html), 64);
        } catch (error) {
            return '';
        }
    }

    global.NoteParser = {
        canonicalize,
        sanitizeHtml,
        markdownToHtml,
        htmlToHtml,
        plainTextToHtml,
        combineFiles,
        detectFormat,
        enhanceContent,
        serializeContent,
        countTasks,
        plainText,
        firstHeadingText,
        topText,
        fileBaseName,
        titleFromMarkdown,
        escapeHtml,
        escapeAttribute,
        collapseWhitespace,
        truncate
    };
})(window);
