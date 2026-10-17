// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

const SHELL_LINE_MARKERS = [
    'favorites',
    'recent items',
    'activities',
    'menu alt+m',
    'alt+g',
    'clear all',
    'downloads',
    'desktop downloads',
    'desktop settings',
    'desktop app',
    '### open tabs',
    '### page',
    '### events',
    'ai-chat-side-panel',
    'context ai',
    'gardenworld •',
    '*/gardenworld',
    'superuser',
];

const SHELL_LABELS = [
    'favorites',
    'recent items',
    'activities',
    'menu',
    'downloads',
    'desktop',
    'superuser',
    'gardenworld',
    'ai-chat',
    'context ai',
    'new',
    'save',
    'ignore',
    'delete',
    'refresh',
    'attachment',
    'chat history',
];

/**
 * Pull the open AD window label from the raw a11y snapshot before focus trims chrome.
 * ZK renders the window tab as listitem "*Sales Order: 80002", not as an ARIA tab,
 * and Electron's page title is the product name.
 */
export function extractWindowHint(text: string): string {
    if (!text) {
        return '';
    }
    const marked = text.match(/###\s*Window\s*\r?\n\s*(.+)/i);
    if (marked?.[1] && isWindowLabel(marked[1])) {
        return marked[1].trim();
    }
    const body = (() => {
        const snap = text.toLowerCase().indexOf('### snapshot');
        return snap >= 0 ? text.slice(snap) : text;
    })();
    const anchor = findDocumentAnchor(body);
    const region = anchor > 0 ? body.slice(0, anchor) : body;
    const tabs = [...region.matchAll(/(?:listitem|tab)\s+"([^"]+)"/gi)];
    for (let i = tabs.length - 1; i >= 0; i--) {
        const name = (tabs[i][1] || '').trim();
        if (isWindowLabel(name)) {
            return name;
        }
    }
    const labels = [...region.matchAll(/(?:^|\n)\s*-\s*text:\s*(.+)$/gim)];
    for (let i = labels.length - 1; i >= 0; i--) {
        const name = (labels[i][1] || '').trim();
        if (isWindowLabel(name)) {
            return name;
        }
    }
    return '';
}

/** ZK window tab ("*Sales Order: 80002") rather than an icon glyph or shell chrome. */
function isWindowLabel(name: string): boolean {
    const n = name.trim();
    if (n.length < 3 || n.length > 80 || !/\p{L}/u.test(n)) {
        return false;
    }
    if (isShellLabel(n)) {
        return false;
    }
    if (/^(home|order|order line|order tax|payment schedule|delivery)$/i.test(n)) {
        return false;
    }
    return /^\*/.test(n) || /[:：·]/.test(n) || /\s/.test(n);
}

/** Keep the open document region when a full-page snapshot is too large. */
export function focusDocumentText(text: string, maxChars = 12000): string {
    if (!text) {
        return '';
    }
    const hint = extractWindowHint(text);
    let body = text;
    const snap = body.toLowerCase().indexOf('### snapshot');
    if (snap >= 0) {
        body = body.slice(snap);
    }
    body = stripShellLines(body);
    const grid = focusGridRow(body, hint);
    if (grid) {
        body = grid;
    } else {
        const anchor = findDocumentAnchor(body);
        if (anchor > 0) {
            let start = Math.max(0, anchor - 400);
            const nl = body.lastIndexOf('\n', start);
            if (nl >= 0 && start - nl < 200) {
                start = nl + 1;
            }
            body = body.slice(start);
        }
    }
    if (hint) {
        body = `### Window\n${hint}\n${body}`;
    }
    return body.length <= maxChars ? body : body.slice(0, maxChars);
}

/**
 * Header grid: many rows share one Document No column. Keep the row whose
 * document number is on the window tab. Form view has no such column of values.
 */
function focusGridRow(body: string, hint: string): string | null {
    const lines = body.split('\n');
    const headerAt = lines.findIndex((line) => /columnheader\s+"(?:document no|单据号)"/i.test(line));
    if (headerAt < 0) {
        return null;
    }
    const indent = (lines[headerAt].match(/^\s*/) || [''])[0].length;
    let start = headerAt;
    while (start > 0) {
        const prev = lines[start - 1];
        const pad = (prev.match(/^\s*/) || [''])[0].length;
        if (pad > indent || (pad === indent && /^\s*-\s*columnheader\b/i.test(prev))) {
            start--;
            continue;
        }
        break;
    }
    const headers: string[] = [];
    let i = start;
    while (i < lines.length) {
        const pad = (lines[i].match(/^\s*/) || [''])[0].length;
        if (pad > indent) {
            i++;
            continue;
        }
        if (!(pad === indent && /^\s*-\s*columnheader\b/i.test(lines[i]))) {
            break;
        }
        const label = (lines[i].match(/columnheader\s+"([^"]*)"/i) || [])[1] || '';
        let j = i + 1;
        let nestedCheck = false;
        while (j < lines.length && (lines[j].match(/^\s*/) || [''])[0].length > indent) {
            if (/checkbox/i.test(lines[j])) {
                nestedCheck = true;
            }
            j++;
        }
        if (label || nestedCheck) {
            headers.push(label);
        }
        i = j;
    }
    const cells: {rowStart: boolean; value: string}[] = [];
    let started = false;
    for (; i < lines.length; i++) {
        const pad = (lines[i].match(/^\s*/) || [''])[0].length;
        const trimmed = lines[i].trim();
        if (!trimmed) {
            continue;
        }
        if (pad > indent) {
            continue;
        }
        if (pad === indent && /^\s*-\s*(?:checkbox|generic|gridcell|button)\b/i.test(lines[i])) {
            started = true;
            const value = cellValue(lines[i]);
            if (!value || isIcon(value)) {
                continue;
            }
            cells.push({
                rowStart: /^\s*-\s*checkbox\b/i.test(lines[i]) && !/\[disabled\]/i.test(lines[i]),
                value,
            });
            continue;
        }
        if (!started && /rowgroup|^-\s*text:|^-\s*grid\b/i.test(trimmed)) {
            continue;
        }
        break;
    }
    const rows: string[][] = [];
    let row: string[] = [];
    for (const cell of cells) {
        if (cell.rowStart && row.length) {
            rows.push(row);
            row = [];
        }
        row.push(cell.value);
    }
    if (row.length) {
        rows.push(row);
    }
    const docIdx = headers.findIndex((header) => /^(document no|单据号)$/i.test(header));
    if (docIdx < 0 || rows.length < 2) {
        return null;
    }
    const key = documentKey(hint) || documentKey(extractWindowHint(body));
    let chosen: string[] | undefined;
    if (key) {
        chosen = rows.find((cellsInRow) => cellsInRow.some((value) => value === key));
        if (!chosen) {
            return `### Current row\n当前单据是 ${key}，列表可见行里没有这一行。请滚动到该行，或切回表单。`;
        }
    } else if (rows.length === 1) {
        chosen = rows[0];
    } else {
        return '### Current row\n当前是列表。页签上没有单据号，也没有唯一选中行。请先点中一行，或切回表单。';
    }
    const pairs: string[] = [];
    for (let col = 0; col <= docIdx && col < chosen.length; col++) {
        if (headers[col] && chosen[col]) {
            pairs.push(`${headers[col]}: ${chosen[col]}`);
        }
    }
    const rest = chosen.slice(docIdx + 1).filter((value) => value && value !== 'N');
    const after = headers.slice(docIdx + 1).filter((header) => header);
    return [
        '### Current row',
        ...pairs,
        rest.length ? `Other values: ${rest.join(' | ')}` : '',
        after.length ? `Headers after Document No: ${after.join(' | ')}` : '',
    ].filter(Boolean).join('\n');
}

function documentKey(label: string): string {
    const match = (label || '').match(/[:：]\s*(\d+)\s*$/);
    return match ? match[1] : '';
}

function cellValue(line: string): string {
    if (/^\s*-\s*checkbox\b/i.test(line)) {
        return /\[checked\]/i.test(line) ? 'Y' : 'N';
    }
    const quoted = line.match(/:\s*"([^"]*)"\s*$/);
    if (quoted) {
        return quoted[1].trim();
    }
    const plain = line.match(/:\s*(.+)\s*$/);
    if (plain && !plain[1].startsWith('[')) {
        return plain[1].trim();
    }
    const named = line.match(/^\s*-\s*(?:button|generic|gridcell)\s+"([^"]+)"/i);
    return named ? named[1].trim() : '';
}

function isIcon(value: string): boolean {
    return !/[\p{L}\p{N}]/u.test(value);
}

function isShellLabel(name: string): boolean {
    const n = name.trim().toLowerCase();
    if (!n) {
        return true;
    }
    return SHELL_LABELS.some((marker) => n === marker || (marker.length >= 5 && n.includes(marker)));
}

/**
 * Header field, not a later repeat. "Target Document Type" sits under a long
 * Description, so the last substring drops Document No and the window tab.
 */
function findDocumentAnchor(text: string): number {
    let offset = 0;
    let best = -1;
    for (const line of text.split('\n')) {
        if (isDocumentLabelLine(line)) {
            const at = line.toLowerCase().search(/document no|单据号/);
            if (at >= 0) {
                best = offset + at;
            }
        }
        offset += line.length + 1;
    }
    if (best >= 0) {
        return best;
    }
    const lower = text.toLowerCase();
    for (const marker of ['columnheader "document no"', 'textbox "document no"', 'columnheader "单据号"', 'textbox "单据号"']) {
        const at = lower.indexOf(marker);
        if (at >= 0) {
            return at;
        }
    }
    return -1;
}

function isDocumentLabelLine(line: string): boolean {
    const t = line.trim();
    if (t.length > 180) {
        return false;
    }
    if (/(?:document no|单据号)\s*$/i.test(t)) {
        return true;
    }
    return /(?:columnheader|textbox|generic|strong)\b[^:\n]*[:"]\s*"?(?:document no|单据号)"?/i.test(t);
}

function stripShellLines(text: string): string {
    return text.
        split(/\r?\n/).
        filter((line) => !isShellLine(line)).
        join('\n');
}

function isShellLine(line: string): boolean {
    const n = line.toLowerCase();
    return SHELL_LINE_MARKERS.some((marker) => n.includes(marker));
}
