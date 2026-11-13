/*
 * Canonical HTML -> Markdown for the source editor. Plain tables and lists
 * use Markdown; structures Markdown cannot represent retain safe raw HTML.
 * No global whitespace rewrite may touch the output: code is literal data.
 */
(function (global) {
    'use strict';

    if (!global.TurndownService || !global.turndownPluginGfm || !global.NoteParser) {
        throw new Error('Markdown export dependencies are missing.');
    }

    const Parser = global.NoteParser;

    function rawBlock(node) {
        // Blank lines terminate a Markdown HTML block. Character references
        // preserve literal line breaks (including those in nested <pre>)
        // without letting Markdown reinterpret the remainder of the HTML.
        return `\n\n${node.outerHTML.replace(/\r/g, '&#13;').replace(/\n/g, '&#10;')}\n\n`;
    }

    function listItem(content, node) {
        const parent = node.parentNode;
        let prefix = '- ';
        if (parent.nodeName === 'OL') {
            const start = Number(parent.getAttribute('start') || 1);
            const index = Array.from(parent.children).indexOf(node);
            prefix = `${start + index}. `;
        }
        const task = node.getAttribute('data-task') === 'true'
            ? `[${node.getAttribute('data-checked') === 'true' ? 'x' : ' '}] `
            : '';
        const body = content.replace(/^\n+|\n+$/g, '');
        const indented = (task + body).replace(/\n/g, `\n${' '.repeat(prefix.length)}`);
        return prefix + indented + '\n';
    }

    function isSimpleTable(table) {
        const rows = Array.from(table.rows);
        if (!rows.length || table.querySelector('caption, tfoot, table')) {
            return false;
        }
        const width = rows[0].cells.length;
        if (!width || !Array.from(rows[0].cells).every((cell) => cell.tagName === 'TH')) {
            return false;
        }
        return rows.every((row, index) => row.cells.length === width
            && Array.from(row.cells).every((cell, column) => {
                if (cell.colSpan !== 1 || cell.rowSpan !== 1
                        || (index > 0 && cell.tagName !== 'TD') || cell.hasAttribute('scope')
                        || (cell.getAttribute('align') || '') !== (rows[0].cells[column].getAttribute('align') || '')) {
                    return false;
                }
                const children = Array.from(cell.children);
                const paragraph = children.length === 1 && children[0].tagName === 'P' ? children[0] : null;
                if (paragraph && Array.from(cell.childNodes).some((child) => child !== paragraph && child.textContent.trim())) {
                    return false;
                }
                const content = paragraph || cell;
                return !content.querySelector('p, br, pre, blockquote, ul, ol, table, div, h1, h2, h3, h4, h5, h6, hr, figure, details');
            }));
    }

    function codeBlock(node) {
        const onlyCode = node.childNodes.length === 1 && node.firstChild.nodeName === 'CODE';
        if (node.children.length && !onlyCode) return rawBlock(node);
        const codeNode = onlyCode ? node.firstChild : node;
        const text = codeNode.textContent;
        // Fenced Markdown adds a terminal newline. Raw HTML is necessary to
        // preserve an empty block or code whose original lacks that newline.
        if (!text.endsWith('\n')) {
            return rawBlock(node);
        }
        const language = (codeNode.getAttribute('class') || '').replace(/^language-/, '');
        const runs = text.match(/`+/g) || [];
        const fence = '`'.repeat(runs.reduce((size, run) => Math.max(size, run.length + 1), 3));
        return `\n\n${fence}${language}\n${text}${fence}\n\n`;
    }

    function makeService() {
        const service = new global.TurndownService({
            headingStyle: 'atx',
            hr: '---',
            bulletListMarker: '-',
            codeBlockStyle: 'fenced',
            fence: '```',
            emDelimiter: '*',
            strongDelimiter: '**',
            linkStyle: 'inlined',
            preformattedCode: true,
            blankReplacement(content, node) {
                if (node.nodeName === 'PRE') return codeBlock(node);
                if (node.nodeName === 'UL' || node.nodeName === 'OL') return rawBlock(node);
                if (node.nodeName === 'LI') return listItem('', node);
                return node.isBlock ? '\n\n' : '';
            }
        });

        // Use explicit table/list rules below. The bundled GFM table rule
        // loses merged cells and can throw for whitespace or empty rows.
        service.keep(['mark', 'u', 'sub', 'sup', 'kbd', 'details', 'summary', 'figure', 'figcaption']);

        service.addRule('notedownStrikethrough', {
            filter: ['del', 's', 'strike'],
            replacement(content) {
                return `~~${content}~~`;
            }
        });
        service.addRule('notedownCode', {
            filter: 'pre',
            replacement(content, node) {
                return codeBlock(node);
            }
        });
        service.addRule('notedownListItem', {
            filter: 'li',
            replacement: listItem
        });
        service.addRule('notedownTable', {
            filter: 'table',
            replacement(content, node) {
                if (!isSimpleTable(node)) return rawBlock(node);
                const rows = Array.from(node.rows);
                const renderRow = (row) => '| ' + Array.from(row.cells, (cell) =>
                    makeService().turndown(cell.innerHTML).replace(/\|/g, '\\|').trim()
                ).join(' | ') + ' |';
                const alignments = Array.from(rows[0].cells, (cell) => ({
                    left: ':---', right: '---:', center: ':---:'
                }[cell.getAttribute('align')] || '---'));
                return '\n\n' + [renderRow(rows[0]), '| ' + alignments.join(' | ') + ' |',
                    ...rows.slice(1).map(renderRow)].join('\n') + '\n\n';
            }
        });
        service.addRule('notedownRetainedStructure', {
            filter(node) {
                return node.getAttribute('data-struck') === 'true'
                    || (node.nodeName === 'OL' && node.hasAttribute('reversed'));
            },
            replacement(content, node) {
                return rawBlock(node);
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

        // Turndown's blank-node handling precedes custom rules.
        for (const label of fragment.querySelectorAll('div[data-file]')) {
            label.textContent = '\u2063';
        }

        // Simple struck text remains familiar Markdown. Complex structures
        // retain their canonical HTML instead of invalid <s> block nesting.
        for (const element of fragment.querySelectorAll('[data-struck="true"]')) {
            if (!/^(P|H[1-6]|LI)$/.test(element.tagName)
                    || element.querySelector('p, ul, ol, pre, table, blockquote, div, figure, details')) {
                continue;
            }
            const wrapper = document.createElement('s');
            while (element.firstChild) wrapper.appendChild(element.firstChild);
            element.appendChild(wrapper);
            element.removeAttribute('data-struck');
        }
        return template.innerHTML;
    }

    function htmlToMarkdown(html) {
        if (!html || !String(html).trim()) return '';
        const markdown = makeService().turndown(prepareHtml(html));
        return markdown ? markdown + '\n' : '';
    }

    global.NoteMarkdown = {htmlToMarkdown};
})(window);
