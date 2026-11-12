/*
 * Canonical HTML -> Markdown, for the Markdown editing mode.
 *
 * Turndown handles the standard Markdown syntax and the GFM plugin adds
 * tables and strikethrough. Two small Notedown-specific transforms are done
 * before conversion:
 *
 * - task rows get a literal "[ ] " / "[x] " prefix so Markdown round-trips
 *   back into a checkbox;
 * - data-struck blocks are wrapped in <s>, which the GFM plugin writes as
 *   ~~strikethrough~~.
 *
 * Empty <div data-file="..."> markers are preserved as raw HTML so their
 * provenance labels survive a Markdown edit.
 */
(function (global) {
    'use strict';

    if (!global.TurndownService || !global.turndownPluginGfm || !global.NoteParser) {
        throw new Error('Markdown export dependencies are missing.');
    }

    const Parser = global.NoteParser;

    function makeService() {
        const service = new global.TurndownService({
            headingStyle: 'atx',
            hr: '---',
            bulletListMarker: '-',
            codeBlockStyle: 'fenced',
            fence: '```',
            emDelimiter: '*',
            strongDelimiter: '**',
            linkStyle: 'inlined'
        });

        service.use(global.turndownPluginGfm.gfm);
        service.keep(['mark', 'u', 'sub', 'sup', 'kbd', 'details', 'summary']);

        // The GFM plugin emits single tilde strikethrough. Use the modern
        // two-tilde form, which marked always understands.
        service.addRule('notedownStrikethrough', {
            filter: ['del', 's', 'strike'],
            replacement(content) {
                return `~~${content}~~`;
            }
        });

        service.addRule('notedownFileLabel', {
            filter(node) {
                return node.nodeName === 'DIV' && node.hasAttribute('data-file');
            },
            replacement(content, node) {
                const name = Parser.escapeAttribute(node.getAttribute('data-file') || '');
                return `\n\n<div data-file="${name}"></div>\n\n`;
            }
        });

        return service;
    }

    function prepareHtml(html) {
        const template = document.createElement('template');
        template.innerHTML = Parser.sanitizeHtml(html);
        const fragment = template.content;

        // Turndown skips visually blank block elements before consulting
        // custom rules. A source label is intentionally empty in storage, so
        // give it an invisible non-whitespace sentinel first.
        for (const label of fragment.querySelectorAll('div[data-file]')) {
            label.textContent = '\u2063';
        }

        // Give Turndown a real checkbox input. Its GFM plugin understands
        // input[type=checkbox] directly inside an <li> and writes an
        // unescaped "[x] " prefix, which marked can read back.
        for (const item of fragment.querySelectorAll('li[data-task="true"]')) {
            const checked = item.getAttribute('data-checked') === 'true';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.disabled = true;
            input.checked = checked;
            if (checked) {
                input.setAttribute('checked', 'checked');
            }
            item.insertBefore(input, item.firstChild);
        }

        // data-struck is a block-level app state. Wrap its content in <s>
        // so it becomes visible, editable ~~strikethrough~~ in Markdown.
        const struck = Array.from(fragment.querySelectorAll('[data-struck="true"]'));
        for (const element of struck) {
            const wrapper = document.createElement('s');
            while (element.firstChild) {
                wrapper.appendChild(element.firstChild);
            }
            element.appendChild(wrapper);
            element.removeAttribute('data-struck');
        }

        return template.innerHTML;
    }

    function htmlToMarkdown(html) {
        if (!html || !String(html).trim()) {
            return '';
        }
        const prepared = prepareHtml(html);
        const markdown = makeService().turndown(prepared);
        return markdown
            .replace(/^(\s*[-*+])\s{2,}/gm, '$1 ')
            .replace(/^(\s*\d+\.)\s{2,}/gm, '$1 ')
            .replace(/^(\s*[-*+] \[[ xX]\])\s{2,}/gm, '$1 ')
            .replace(/\n{3,}/g, '\n\n')
            .trim() + '\n';
    }

    global.NoteMarkdown = {
        htmlToMarkdown
    };
})(window);
