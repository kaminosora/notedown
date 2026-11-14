// Transaction-based rich editor. Stored notes remain portable, sanitized HTML.
import {Schema, DOMParser, DOMSerializer, Fragment} from 'prosemirror-model';
import {EditorState, TextSelection, NodeSelection, Selection, Plugin} from 'prosemirror-state';
import {EditorView} from 'prosemirror-view';
import {schema as basicSchema} from 'prosemirror-schema-basic';
import {addListNodes, wrapInList, liftListItem, sinkListItem, splitListItem} from 'prosemirror-schema-list';
import {baseKeymap, chainCommands, toggleMark, setBlockType, wrapIn, lift, exitCode, selectAll} from 'prosemirror-commands';
import {history, undo, redo, closeHistory} from 'prosemirror-history';
import {keymap} from 'prosemirror-keymap';
import {inputRules, wrappingInputRule, textblockTypeInputRule, InputRule, undoInputRule} from 'prosemirror-inputrules';
import {gapCursor} from 'prosemirror-gapcursor';
import {dropCursor} from 'prosemirror-dropcursor';
import {tableNodes, tableEditing, addRowAfter, deleteRow, addColumnAfter, deleteColumn, deleteTable, goToNextCell} from 'prosemirror-tables';

const Parser = window.NoteParser;
const struckAttrs = {struck: {default: false}};
const readStruck = (element) => ({struck: element.getAttribute('data-struck') === 'true'});
const writeStruck = (node) => node.attrs.struck ? {'data-struck': 'true'} : {};

function makeSchema() {
    let nodes = basicSchema.spec.nodes;
    nodes = nodes.update('paragraph', {
        ...nodes.get('paragraph'), attrs: struckAttrs,
        parseDOM: [{tag: 'p', getAttrs: readStruck}],
        toDOM: (node) => ['p', writeStruck(node), 0]
    });
    nodes = nodes.update('heading', {
        ...nodes.get('heading'), attrs: {...struckAttrs, level: {default: 1}},
        parseDOM: Array.from({length: 6}, (_, i) => ({tag: `h${i + 1}`, getAttrs: (el) => ({level: i + 1, ...readStruck(el)})})),
        toDOM: (node) => [`h${node.attrs.level}`, writeStruck(node), 0]
    });
    nodes = nodes.update('blockquote', {
        ...nodes.get('blockquote'), attrs: struckAttrs,
        parseDOM: [{tag: 'blockquote', getAttrs: readStruck}],
        toDOM: (node) => ['blockquote', writeStruck(node), 0]
    });
    nodes = nodes.update('code_block', {
        ...nodes.get('code_block'), attrs: {...struckAttrs, language: {default: ''}},
        parseDOM: [{tag: 'pre', preserveWhitespace: 'full', getAttrs: (el) => ({
            ...readStruck(el), language: (el.querySelector('code')?.className.match(/(?:^|\s)language-([\w+-]+)/) || [])[1] || ''
        })}],
        toDOM: (node) => ['pre', writeStruck(node), ['code', node.attrs.language ? {class: `language-${node.attrs.language}`} : {}, 0]]
    });
    nodes = nodes.update('image', {...nodes.get('image'), draggable: true});
    nodes = nodes.update('hard_break', {...nodes.get('hard_break'), linebreakReplacement: true});
    nodes = addListNodes(nodes, 'paragraph block*', 'block');
    nodes = nodes.update('list_item', {
        ...nodes.get('list_item'), attrs: {...struckAttrs, task: {default: false}, checked: {default: false}},
        parseDOM: [{tag: 'li', getAttrs: (el) => ({...readStruck(el), task: el.getAttribute('data-task') === 'true', checked: el.getAttribute('data-checked') === 'true'})}],
        toDOM: (node) => ['li', {...writeStruck(node), ...(node.attrs.task ? {'data-task': 'true', 'data-checked': String(node.attrs.checked)} : {})}, 0]
    });
    nodes = nodes.update('ordered_list', {
        ...nodes.get('ordered_list'), attrs: {order: {default: 1}, reversed: {default: false}, listType: {default: null}},
        parseDOM: [{tag: 'ol', getAttrs: (el) => {
            const reversed = el.hasAttribute('reversed');
            const start = Number.parseInt(el.getAttribute('start'), 10);
            // An implicit reversed list starts at its original item count. Store
            // that value before later splitting the list changes its child count.
            const order = Number.isFinite(start) ? start : reversed ? el.querySelectorAll(':scope > li').length : 1;
            return {order, reversed, listType: el.getAttribute('type')};
        }}],
        toDOM: (node) => ['ol', {...(node.attrs.order !== 1 || node.attrs.reversed ? {start: node.attrs.order} : {}), ...(node.attrs.reversed ? {reversed: ''} : {}), ...(node.attrs.listType ? {type: node.attrs.listType} : {})}, 0]
    });
    nodes = nodes.append({file_label: {
        group: 'block', atom: true, draggable: true, attrs: {name: {default: ''}},
        parseDOM: [{tag: 'div[data-file]', priority: 60, getAttrs: (el) => ({name: el.getAttribute('data-file') || ''})}],
        toDOM: (node) => ['div', {'data-file': node.attrs.name}]
    }});
    // Keep semantic containers from imported HTML editable instead of flattening them.
    for (const [name, tag, content] of [['html_div', 'div', 'block+'], ['figure', 'figure', 'block+'], ['figcaption', 'figcaption', 'inline*'], ['details', 'details', 'block+'], ['summary', 'summary', 'inline*']]) {
        nodes = nodes.append({[name]: {
            group: 'block', content, attrs: struckAttrs, defining: true,
            parseDOM: [{tag, getAttrs: (el) => tag === 'div' && el.hasAttribute('data-file') ? false : readStruck(el)}],
            toDOM: (node) => [tag, writeStruck(node), 0]
        }});
    }
    const tables = tableNodes({tableGroup: 'block', cellContent: 'block+', cellAttributes: {
        align: {default: null, getFromDOM: (el) => el.getAttribute('align'), setDOMAttr(value, attrs) { if (value) attrs.align = value; }},
        scope: {default: null, getFromDOM: (el) => el.getAttribute('scope'), setDOMAttr(value, attrs) { if (value) attrs.scope = value; }}
    }});
    tables.table = {
        ...tables.table, attrs: {...struckAttrs, caption: {default: null}},
        parseDOM: [{tag: 'table', getAttrs: (el) => ({...readStruck(el), caption: el.querySelector(':scope > caption')?.innerHTML || null})}],
        toDOM(node) {
            const dom = document.createElement('table');
            if (node.attrs.struck) dom.setAttribute('data-struck', 'true');
            if (node.attrs.caption) {
                const caption = document.createElement('caption');
                // Captions are preserved as table metadata outside contentDOM.
                // A browser caret here would not map to an editable model position.
                caption.contentEditable = 'false';
                caption.tabIndex = 0;
                caption.title = '表格标题：切换到 HTML 模式编辑';
                caption.setAttribute('aria-label', '表格标题，只读；可在 HTML 模式编辑');
                caption.innerHTML = Parser.sanitizeHtml(node.attrs.caption);
                dom.appendChild(caption);
            }
            const contentDOM = document.createElement('tbody');
            dom.appendChild(contentDOM);
            return {dom, contentDOM};
        }
    };
    tables.table_row = {
        ...tables.table_row, attrs: {section: {default: 'tbody'}},
        parseDOM: [{tag: 'tr', getAttrs: (el) => ({section: ['THEAD', 'TFOOT'].includes(el.parentElement?.tagName) ? el.parentElement.tagName.toLowerCase() : 'tbody'})}],
        toDOM: (node) => ['tr', {'data-pm-section': node.attrs.section}, 0]
    };
    nodes = nodes.append(tables);
    for (const [name, tag, display] of [['math_inline', 'span', false], ['math_block', 'div', true]]) {
        nodes = nodes.append({[name]: {
            group: display ? 'block' : 'inline', inline: !display, atom: true, draggable: true,
            attrs: {latex: {default: ''}},
            parseDOM: [{tag: `${tag}[data-math="${display ? 'block' : 'inline'}"][data-latex]`, priority: 80,
                getAttrs: element => ({latex: element.getAttribute('data-latex')})}],
            toDOM: node => [tag, {'data-math': display ? 'block' : 'inline', 'data-latex': node.attrs.latex}, node.attrs.latex]
        }});
    }
    let marks = basicSchema.spec.marks;
    marks = marks.update('code', {...marks.get('code'), excludes: '_'});
    for (const [name, tags] of [['strike', ['del', 's', 'strike']], ['underline', ['u']], ['highlight', ['mark']], ['small', ['small']], ['subscript', ['sub']], ['superscript', ['sup']], ['keyboard', ['kbd']]]) {
        marks = marks.append({[name]: {parseDOM: tags.map((tag) => ({tag})), toDOM: () => [tags[0], 0]}});
    }
    return new Schema({nodes, marks});
}

const schema = makeSchema();
const parser = new DOMParser(schema, [{tag: 'caption', ignore: true}, ...DOMParser.schemaRules(schema)]);
const serializer = DOMSerializer.fromSchema(schema);

function readDocument(html) {
    const container = document.createElement('div');
    container.innerHTML = Parser.sanitizeHtml(html || '');
    return parser.parse(container, {preserveWhitespace: false});
}

function nearest($pos, type) {
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
        if ($pos.node(depth).type === type) return {node: $pos.node(depth), pos: $pos.before(depth), depth};
    }
    return null;
}

function selectedItems(state) {
    const {from, to, empty, $from} = state.selection;
    if (empty) {
        const item = nearest($from, schema.nodes.list_item);
        return item ? [item] : [];
    }
    const items = [];
    state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type === schema.nodes.list_item) items.push({node, pos});
    });
    return items.filter((item) => !items.some((other) => other !== item && other.pos > item.pos && other.pos + other.node.nodeSize < item.pos + item.node.nodeSize && from >= other.pos && to <= other.pos + other.node.nodeSize));
}

function toggleList(type) {
    return (state, dispatch) => {
        let existing = null;
        for (let depth = state.selection.$from.depth; depth > 0; depth -= 1) {
            const node = state.selection.$from.node(depth);
            if (node.type === schema.nodes.bullet_list || node.type === schema.nodes.ordered_list) {
                existing = {node, pos: state.selection.$from.before(depth), depth};
                break;
            }
        }
        if (existing) {
            if (existing.node.type === type) return liftListItem(schema.nodes.list_item)(state, dispatch);
            if (state.selection.to > existing.pos + existing.node.nodeSize - 1) return false;
            if (!dispatch) return true;
            // Converting selected rows must not silently convert their siblings.
            const before = [], selected = [], after = [];
            let selectedStart = null;
            existing.node.forEach((node, offset) => {
                const pos = existing.pos + 1 + offset;
                if (pos + node.nodeSize <= state.selection.from) before.push(node);
                else if (pos >= state.selection.to && !state.selection.empty) after.push(node);
                else if (state.selection.empty && selected.length) after.push(node);
                else { selected.push(node); if (selectedStart === null) selectedStart = pos; }
            });
            const parts = [];
            if (before.length) parts.push(existing.node.copy(Fragment.fromArray(before)));
            const newStart = existing.pos + (parts[0]?.nodeSize || 0) + 1;
            parts.push(type.create(type === schema.nodes.ordered_list ? {order: 1} : null, selected));
            if (after.length) parts.push(existing.node.type.create({...existing.node.attrs, ...(existing.node.type === schema.nodes.ordered_list ? {order: existing.node.attrs.order + (existing.node.attrs.reversed ? -1 : 1) * (before.length + selected.length)} : {})}, after));
            const tr = state.tr.replaceWith(existing.pos, existing.pos + existing.node.nodeSize, Fragment.fromArray(parts));
            tr.setSelection(TextSelection.between(tr.doc.resolve(newStart + state.selection.anchor - selectedStart), tr.doc.resolve(newStart + state.selection.head - selectedStart)));
            dispatch(tr.scrollIntoView());
            return true;
        }
        return wrapInList(type)(state, dispatch);
    };
}

function toggleTasks(state, dispatch) {
    let items = selectedItems(state);
    let tr = state.tr;
    if (!items.length) {
        if (!wrapInList(schema.nodes.bullet_list)(state, (transaction) => { tr = transaction; })) return false;
        items = selectedItems(state.apply(tr));
    }
    const task = !items.every(({node}) => node.attrs.task);
    for (const {node, pos} of items) tr.setNodeMarkup(pos, null, {...node.attrs, task, checked: task && node.attrs.task ? node.attrs.checked : false});
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
}

function toggleQuote(state, dispatch) {
    return nearest(state.selection.$from, schema.nodes.blockquote) ? lift(state, dispatch) : wrapIn(schema.nodes.blockquote)(state, dispatch);
}

function codeBlock(state, dispatch) {
    const inCode = state.selection.$from.parent.type === schema.nodes.code_block;
    return setBlockType(inCode ? schema.nodes.paragraph : schema.nodes.code_block)(state, dispatch);
}

function clearFormatting(state, dispatch) {
    const {from, to, empty} = state.selection;
    let tr = state.tr;
    if (empty) tr.setStoredMarks([]);
    else tr.removeMark(from, to);
    // Preserve text and list structure, but reset heading/code textblocks.
    state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.isTextblock && node.type !== schema.nodes.paragraph && node.type !== schema.nodes.summary && node.type !== schema.nodes.figcaption) {
            const $pos = tr.doc.resolve(tr.mapping.map(pos));
            if ($pos.parent.canReplaceWith($pos.index(), $pos.index() + 1, schema.nodes.paragraph)) tr.setBlockType(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize), schema.nodes.paragraph);
        }
        if (node.attrs.struck) tr.setNodeMarkup(tr.mapping.map(pos), null, {...tr.doc.nodeAt(tr.mapping.map(pos)).attrs, struck: false});
    });
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
}

function blockTarget(state, action) {
    const selection = state.selection;
    if (selection instanceof NodeSelection && (!selection.node.isInline || action === 'block-delete')) return {node: selection.node, pos: selection.from, depth: selection.$from.depth + 1};
    const item = nearest(selection.$from, schema.nodes.list_item);
    if (item) return item;
    if (selection.$from.depth) return {node: selection.$from.node(1), pos: selection.$from.before(1), depth: 1};
    const node = selection.$from.nodeAfter;
    return node ? {node, pos: selection.from, depth: 1} : null;
}

function manipulateBlock(action) {
    return (state, dispatch) => {
        const target = blockTarget(state, action);
        if (!target) return false;
        const {node, pos} = target;
        // A block control acts on one structural node. Cross-block selections
        // remain text selections; never truncate their bounds to an arbitrary block.
        if (state.selection.from < pos || state.selection.to > pos + node.nodeSize) return false;
        const $pos = state.doc.resolve(pos);
        const parent = $pos.parent;
        const index = $pos.index();
        let tr = state.tr;
        let nextPos = pos;
        if (action === 'block-up' || action === 'block-down') {
            const up = action === 'block-up';
            if (up ? index === 0 : index + 1 >= parent.childCount) return false;
            if (!dispatch) return true;
            const sibling = parent.child(index + (up ? -1 : 1));
            const start = up ? pos - sibling.nodeSize : pos;
            const end = up ? pos + node.nodeSize : pos + node.nodeSize + sibling.nodeSize;
            tr.replaceWith(start, end, Fragment.fromArray(up ? [node, sibling] : [sibling, node]));
            nextPos = up ? start : start + sibling.nodeSize;
            if (state.selection instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, nextPos + state.selection.from - pos));
            else tr.setSelection(TextSelection.between(tr.doc.resolve(nextPos + Math.max(1, state.selection.anchor - pos)), tr.doc.resolve(nextPos + Math.max(1, state.selection.head - pos))));
        } else if (action === 'block-delete') {
            if (!dispatch) return true;
            tr.delete(pos, pos + node.nodeSize);
            tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))));
        } else {
            const paragraph = schema.nodes.paragraph.create();
            const inserted = node.type === schema.nodes.list_item ? schema.nodes.list_item.create({...node.attrs, checked: false, struck: false}, paragraph) : paragraph;
            const insertPos = action === 'block-before' ? pos : pos + node.nodeSize;
            if (!parent.canReplace(index + (action === 'block-before' ? 0 : 1), index + (action === 'block-before' ? 0 : 1), Fragment.from(inserted))) return false;
            if (!dispatch) return true;
            tr.insert(insertPos, inserted);
            tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
        }
        if (dispatch) dispatch(tr.scrollIntoView());
        return true;
    };
}

function insertTable(state, dispatch) {
    if (nearest(state.selection.$from, schema.nodes.table)) return false;
    const rows = Array.from({length: 3}, (_, row) => schema.nodes.table_row.create(null,
        Array.from({length: 3}, () => (row === 0 ? schema.nodes.table_header : schema.nodes.table_cell).createAndFill())));
    if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.table.create(null, rows)).scrollIntoView());
    return true;
}

function insertImage(value) {
    return (state, dispatch) => {
        const attrs = typeof value === 'string' ? {src: value} : value;
        if (!attrs || !/^(https?:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(attrs.src || '')) return false;
        if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.image.create(attrs)).scrollIntoView());
        return true;
    };
}

function nextTableCell(state, dispatch) {
    if (goToNextCell(1)(state, dispatch)) return true;
    if (!nearest(state.selection.$from, schema.nodes.table)) return false;
    let tr;
    if (!addRowAfter(state, (transaction) => { tr = transaction; })) return false;
    if (dispatch) {
        goToNextCell(1)(state.apply(tr), (selection) => {
            for (const step of selection.steps) tr.step(step);
            tr.setSelection(selection.selection.getBookmark().resolve(tr.doc));
        });
        dispatch(tr.scrollIntoView());
    }
    return true;
}

function endCodeOnBlankLine(state, dispatch) {
    const {$from, empty} = state.selection;
    if (!empty || $from.parent.type !== schema.nodes.code_block || $from.parentOffset !== $from.parent.content.size || !$from.parent.textContent.endsWith('\n')) return false;
    if (dispatch) {
        const tr = state.tr.delete($from.pos - 1, $from.pos);
        const next = state.apply(tr);
        exitCode(next, (exit) => {
            for (const step of exit.steps) tr.step(step);
            tr.setSelection(exit.selection.getBookmark().resolve(tr.doc));
        });
        dispatch(tr.scrollIntoView());
    }
    return true;
}

function enterList(state, dispatch) {
    const item = nearest(state.selection.$from, schema.nodes.list_item);
    if (!item) return false;
    if (state.selection.empty && state.selection.$from.parent.content.size === 0) return liftListItem(schema.nodes.list_item)(state, dispatch);
    return splitListItem(schema.nodes.list_item, {...item.node.attrs, checked: false, struck: false})(state, dispatch);
}

function buildInputRules() {
    const {paragraph, heading, code_block, blockquote, ordered_list, bullet_list} = schema.nodes;
    const rules = [
        wrappingInputRule(/^\s*>\s$/, blockquote),
        wrappingInputRule(/^\s*([-+*])\s$/, bullet_list),
        wrappingInputRule(/^(\d+)\.\s$/, ordered_list, (match) => ({order: +match[1]}), (match, node) => node.childCount + node.attrs.order === +match[1]),
        textblockTypeInputRule(/^(#{1,6})\s$/, heading, (match) => ({level: match[1].length})),
        textblockTypeInputRule(/^```([\w+-]*)\s$/, code_block, (match) => ({language: match[1]})),
        new InputRule(/^\[([ xX])\]\s$/, (state, match, start, end) => {
            let tr = state.tr.delete(start, end);
            const next = state.apply(tr);
            let wrapped;
            const existing = nearest(next.selection.$from, schema.nodes.list_item);
            if (existing) tr.setNodeMarkup(existing.pos, null, {...existing.node.attrs, task: true, checked: match[1].toLowerCase() === 'x'});
            else {
                if (!wrapInList(bullet_list)(next, (transaction) => { wrapped = transaction; })) return null;
                for (const step of wrapped.steps) tr.step(step);
                tr.setSelection(wrapped.selection.getBookmark().resolve(tr.doc));
                const item = nearest(tr.selection.$from, schema.nodes.list_item);
                if (item) tr.setNodeMarkup(item.pos, null, {...item.node.attrs, task: true, checked: match[1].toLowerCase() === 'x'});
            }
            return tr;
        })
    ];
    return inputRules({rules});
}

function makeListItemView(node, view, getPos) {
    const dom = document.createElement('li');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'nt-checkbox';
    checkbox.contentEditable = 'false';
    checkbox.tabIndex = -1;
    checkbox.setAttribute('aria-label', '切换完成状态');
    const contentDOM = document.createElement('div');
    contentDOM.className = 'rich-list-content';
    dom.append(checkbox, contentDOM);
    let current = node;
    function update(next) {
        if (next.type !== schema.nodes.list_item) return false;
        current = next;
        checkbox.hidden = !next.attrs.task;
        checkbox.checked = next.attrs.checked;
        dom.classList.toggle('nt-task', next.attrs.task);
        dom.classList.toggle('is-done', next.attrs.task && next.attrs.checked);
        dom.classList.toggle('is-struck', next.attrs.struck);
        if (next.attrs.task) {
            dom.setAttribute('data-task', 'true');
            dom.setAttribute('data-checked', String(next.attrs.checked));
        } else {
            dom.removeAttribute('data-task');
            dom.removeAttribute('data-checked');
        }
        return true;
    }
    checkbox.addEventListener('mousedown', (event) => event.preventDefault());
    checkbox.addEventListener('change', () => {
        const pos = getPos();
        if (typeof pos === 'number') view.dispatch(closeHistory(view.state.tr).setNodeMarkup(pos, null, {...current.attrs, checked: checkbox.checked}));
    });
    update(node);
    return {dom, contentDOM, update, stopEvent: (event) => event.target === checkbox, ignoreMutation: (mutation) => mutation.type !== 'selection' && (mutation.target === checkbox || mutation.target === dom)};
}

function commandFor(action, value) {
    const marks = schema.marks;
    switch (action) {
        case 'undo': return undo;
        case 'redo': return redo;
        case 'bold': return toggleMark(marks.strong);
        case 'italic': return toggleMark(marks.em);
        case 'strike': return toggleMark(marks.strike);
        case 'inline-code': return toggleMark(marks.code);
        case 'format': {
            const level = Number(String(value).match(/h([1-6])/i)?.[1]);
            return setBlockType(level ? schema.nodes.heading : schema.nodes.paragraph, level ? {level} : null);
        }
        case 'quote': return toggleQuote;
        case 'code-block': return codeBlock;
        case 'bullet-list': return toggleList(schema.nodes.bullet_list);
        case 'number-list': return toggleList(schema.nodes.ordered_list);
        case 'task-list': return toggleTasks;
        case 'divider': return (state, dispatch) => { if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create()).scrollIntoView()); return true; };
        case 'clear': return clearFormatting;
        case 'table': return insertTable;
        case 'add-row': return addRowAfter;
        case 'delete-row': return deleteRow;
        case 'add-column': return addColumnAfter;
        case 'delete-column': return deleteColumn;
        case 'delete-table': return deleteTable;
        case 'image': return insertImage(value);
        case 'unlink': return (state, dispatch) => { if (dispatch) dispatch(state.tr.removeMark(state.selection.from, state.selection.to, marks.link)); return true; };
        default: return action.startsWith('block-') ? manipulateBlock(action) : null;
    }
}

function activeMark(state, type) {
    return state.selection.empty ? Boolean(type.isInSet(state.storedMarks || state.selection.$from.marks())) : state.doc.rangeHasMark(state.selection.from, state.selection.to, type);
}

function currentLink(state) {
    const {$from, from, to} = state.selection;
    let mark = schema.marks.link.isInSet(state.storedMarks || $from.marks());
    if (!mark && state.selection.empty) mark = schema.marks.link.isInSet($from.nodeAfter?.marks || []) || schema.marks.link.isInSet($from.nodeBefore?.marks || []);
    if (!mark && to > from) state.doc.nodesBetween(from, to, (node) => { if (!mark) mark = schema.marks.link.isInSet(node.marks); });
    return mark || null;
}

function linkExtent(state) {
    const {$from} = state.selection;
    let index = $from.index();
    let child = $from.parent.maybeChild(index);
    if (!child || !schema.marks.link.isInSet(child.marks)) { index -= 1; child = $from.parent.maybeChild(index); }
    const mark = child && schema.marks.link.isInSet(child.marks);
    if (!mark) return null;
    let from = $from.start();
    for (let i = 0; i < index; i += 1) from += $from.parent.child(i).nodeSize;
    let to = from + child.nodeSize;
    for (let i = index - 1; i >= 0 && mark.isInSet($from.parent.child(i).marks); i -= 1) from -= $from.parent.child(i).nodeSize;
    for (let i = index + 1; i < $from.parent.childCount && mark.isInSet($from.parent.child(i).marks); i += 1) to += $from.parent.child(i).nodeSize;
    return {from, to};
}

function create({element, html = '', onChange = () => {}, onSelectionChange = () => {}, onReveal = () => {}, onEditMath = () => {}}) {
    let destroyed = false;
    const shortcuts = {
        'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo,
        'Mod-b': toggleMark(schema.marks.strong), 'Mod-i': toggleMark(schema.marks.em),
        'Mod-`': toggleMark(schema.marks.code), 'Mod-a': selectAll,
        'Mod-Enter': exitCode,
        Enter: chainCommands((state) => {
            if (!(state.selection instanceof NodeSelection) || !isMath(state.selection.node)) return false;
            onEditMath(); return true;
        }, endCodeOnBlankLine, enterList, baseKeymap.Enter),
        Backspace: chainCommands(undoInputRule, baseKeymap.Backspace),
        Tab: chainCommands(nextTableCell, sinkListItem(schema.nodes.list_item), (state, dispatch) => { if (dispatch) dispatch(state.tr.insertText('    ').scrollIntoView()); return true; }),
        'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(schema.nodes.list_item)),
        'Alt-ArrowUp': manipulateBlock('block-up'), 'Alt-ArrowDown': manipulateBlock('block-down')
    };
    const plugins = [buildInputRules(), history(), keymap(shortcuts), keymap(baseKeymap), gapCursor(), dropCursor(), tableEditing()];
    let state = EditorState.create({doc: readDocument(html), plugins});
    const view = new EditorView({mount: element}, {
        state,
        attributes: {role: 'textbox', 'aria-label': '富文本正文', 'aria-multiline': 'true', spellcheck: 'true'},
        transformPastedHTML: (source) => Parser.htmlToHtml(source),
        handleScrollToSelection() { onReveal(); return true; },
        nodeViews: {
            math_inline: makeMathView,
            math_block: makeMathView,
            list_item: makeListItemView,
            table(node) {
                const rendered = schema.nodes.table.spec.toDOM(node);
                const caption = rendered.dom.querySelector(':scope > caption');
                return {
                    ...rendered,
                    // Caption clicks/keys belong to its read-only focus target.
                    // Mapping them into tbody would edit a different cell instead.
                    stopEvent: (event) => Boolean(caption && caption.contains(event.target)),
                    ignoreMutation: (mutation) => mutation.type !== 'selection' && Boolean(caption && caption.contains(mutation.target))
                };
            },
            file_label(node) {
                const dom = document.createElement('div');
                dom.className = 'nt-file-label';
                dom.contentEditable = 'false';
                dom.textContent = `导入自 ${node.attrs.name}`;
                return {dom};
            }
        },
        handleDOMEvents: {
            click(_view, event) { if (event.target.closest('a[href]')) event.preventDefault(); return false; },
            beforeinput(editor, event) {
                // Soft keyboards can send beforeinput without a reliable keydown.
                // Do not disturb IME composition or non-cancelable native input.
                if (!event.cancelable || event.isComposing || editor.composing) return false;
                let command = null;
                if (event.inputType === 'historyUndo') command = undo;
                if (event.inputType === 'historyRedo') command = redo;
                if (event.inputType === 'insertParagraph') command = chainCommands(endCodeOnBlankLine, enterList);
                if (command && command(editor.state, editor.dispatch, editor)) {
                    event.preventDefault();
                    return true;
                }
                return false;
            }
        },
        dispatchTransaction(transaction) {
            const previous = view.state;
            const result = previous.applyTransaction(transaction);
            view.updateState(result.state);
            if (!previous.doc.eq(result.state.doc)) onChange();
            if (!previous.selection.eq(result.state.selection) || transaction.storedMarksSet || transaction.docChanged) onSelectionChange();
        }
    });
    function makeMathView(node, editor, getPos) {
        let current = node;
        const dom = document.createElement(node.type === schema.nodes.math_block ? 'div' : 'span');
        dom.contentEditable = 'false';
        function update(next) {
            if (next.type !== node.type) return false;
            current = next;
            dom.setAttribute('data-math', current.type === schema.nodes.math_block ? 'block' : 'inline');
            dom.setAttribute('data-latex', current.attrs.latex);
            if (window.NoteMath) window.NoteMath.renderFormula(dom, current.attrs.latex, current.type === schema.nodes.math_block);
            else dom.textContent = current.attrs.latex;
            return true;
        }
        update(node);
        dom.addEventListener('click', event => {
            if (event.defaultPrevented) return;
            const pos = getPos();
            if (typeof pos === 'number') {
                event.preventDefault();
                editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
                editor.focus();
            }
        });
        dom.addEventListener('dblclick', event => {
            event.preventDefault();
            const pos = getPos();
            if (typeof pos === 'number') {
                editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
                onEditMath();
            }
        });
        return {dom, update, ignoreMutation: () => true};
    }
    function isMath(node) { return node && (node.type === schema.nodes.math_inline || node.type === schema.nodes.math_block); }
    function reveal() { if (!destroyed) onReveal(); }
    const api = {
        view,
        getHTML() {
            const container = document.createElement('div');
            container.appendChild(serializer.serializeFragment(view.state.doc.content));
            // Read-only caption hints belong to the editor, not the saved note.
            for (const caption of container.querySelectorAll('caption')) {
                caption.removeAttribute('contenteditable');
                caption.removeAttribute('tabindex');
                caption.removeAttribute('title');
                caption.removeAttribute('aria-label');
            }
            // The editing DOM needs a single table contentDOM. Restore semantic
            // header/footer sections from model attributes when saving the note.
            for (const table of container.querySelectorAll('table')) {
                const bodies = Array.from(table.children).filter((child) => /^(THEAD|TBODY|TFOOT)$/.test(child.tagName));
                const rows = bodies.flatMap((body) => Array.from(body.children).filter((child) => child.tagName === 'TR'));
                let section = null;
                for (const row of rows) {
                    const tag = row.getAttribute('data-pm-section') || 'tbody';
                    if (!section || section.tagName.toLowerCase() !== tag) { section = document.createElement(tag); table.appendChild(section); }
                    row.removeAttribute('data-pm-section');
                    section.appendChild(row);
                }
                for (const body of bodies) body.remove();
            }
            return Parser.sanitizeHtml(container.innerHTML);
        },
        setHTML(source) {
            const doc = readDocument(source);
            view.updateState(EditorState.create({doc, plugins}));
            onChange();
            onSelectionChange();
        },
        focus(where) {
            view.focus();
            if (where === 'start' || where === 'end') view.dispatch(view.state.tr.setSelection(where === 'start' ? Selection.atStart(view.state.doc) : Selection.atEnd(view.state.doc)));
            reveal();
        },
        run(action, value) {
            const command = commandFor(action, value);
            if (!command) return false;
            view.focus();
            // Separate toolbar actions from adjacent typing in the undo history.
            view.dispatch(closeHistory(view.state.tr));
            const result = command(view.state, view.dispatch, view);
            if (result) { onSelectionChange(); reveal(); }
            return result;
        },
        can(action, value) { const command = commandFor(action, value); return command ? command(view.state, null, view) : action === 'link'; },
        isActive(action, value) {
            const state = view.state;
            const mark = {bold: schema.marks.strong, italic: schema.marks.em, strike: schema.marks.strike, 'inline-code': schema.marks.code, link: schema.marks.link}[action];
            if (mark) return activeMark(state, mark);
            const type = {'bullet-list': schema.nodes.bullet_list, 'number-list': schema.nodes.ordered_list, quote: schema.nodes.blockquote, 'code-block': schema.nodes.code_block}[action];
            if (type) return Boolean(nearest(state.selection.$from, type));
            if (action === 'task-list') { const items = selectedItems(state); return items.length > 0 && items.every(({node}) => node.attrs.task); }
            if (action === 'format') { const level = Number(String(value).match(/h([1-6])/i)?.[1]); return state.selection.$from.parent.type === (level ? schema.nodes.heading : schema.nodes.paragraph) && (!level || state.selection.$from.parent.attrs.level === level); }
            return false;
        },
        selectionBookmark() { return view.state.selection.getBookmark(); },
        restoreBookmark(bookmark) {
            if (!bookmark) return false;
            try { view.dispatch(view.state.tr.setSelection(bookmark.resolve(view.state.doc))); return true; } catch (_) { return false; }
        },
        select(anchor, head = anchor, {scroll = false} = {}) {
            const size = view.state.doc.content.size;
            const tr = view.state.tr.setSelection(TextSelection.between(view.state.doc.resolve(Math.max(0, Math.min(size, anchor))), view.state.doc.resolve(Math.max(0, Math.min(size, head)))));
            view.dispatch(scroll ? tr.scrollIntoView() : tr);
        },
        getLink() { return currentLink(view.state)?.attrs.href || ''; },
        getMath() {
            const selection = view.state.selection;
            if (!(selection instanceof NodeSelection) || !isMath(selection.node)) return null;
            return {latex: selection.node.attrs.latex, display: selection.node.type === schema.nodes.math_block, pos: selection.from};
        },
        setMath({latex = '', display = false} = {}) {
            const source = String(latex);
            if (source.length > (window.NoteMath?.MAX_SOURCE_LENGTH || 10000)) return false;
            const selection = view.state.selection;
            const selectedMath = selection instanceof NodeSelection && isMath(selection.node);
            if (!source.trim() && !selectedMath) return false;
            let tr = closeHistory(view.state.tr);
            if (!source.trim()) tr.deleteSelection();
            else {
                const type = display ? schema.nodes.math_block : schema.nodes.math_inline;
                const node = type.create({latex: source});
                if (selectedMath && selection.node.type === type) {
                    tr.setNodeMarkup(selection.from, type, node.attrs);
                } else tr.replaceSelectionWith(node);
            }
            view.dispatch(tr.scrollIntoView());
            onSelectionChange();
            reveal();
            return true;
        },
        setLink(url) {
            const href = String(url || '').trim();
            if (href && !/^(https?:\/\/|mailto:|tel:|#)/i.test(href)) return false;
            const state = view.state;
            let {from, to} = state.selection;
            if (state.selection.empty) { const extent = linkExtent(state); if (extent) ({from, to} = extent); }
            let tr = closeHistory(state.tr);
            if (href && from === to) tr.insertText(href, from, to).addMark(from, from + href.length, schema.marks.link.create({href}));
            else { tr.removeMark(from, to, schema.marks.link); if (href) tr.addMark(from, to, schema.marks.link.create({href})); }
            view.dispatch(tr.scrollIntoView());
            view.focus();
            onSelectionChange();
            return true;
        },
        destroy() { destroyed = true; view.destroy(); }
    };
    return api;
}

window.NoteRichEditor = {create};
