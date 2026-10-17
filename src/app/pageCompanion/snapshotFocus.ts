// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

const DOCUMENT_ANCHORS = [
    'columnheader "Document No"',
    'columnheader "单据号"',
    'textbox "Document No"',
    'textbox "单据号"',
    'Document No',
    '单据号',
    'Order Reference',
    '订单引用',
    'Target Document Type',
    '目标单据类型',
];

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

/** Keep the open document region when a full-page snapshot is too large. */
export function focusDocumentText(text: string, maxChars = 12000): string {
    if (!text) {
        return '';
    }
    let body = text;
    const snap = body.toLowerCase().indexOf('### snapshot');
    if (snap >= 0) {
        body = body.slice(snap);
    }
    body = stripShellLines(body);
    const anchor = findDocumentAnchor(body);
    if (anchor > 0) {
        body = body.slice(Math.max(0, anchor - 400));
    }
    return body.length <= maxChars ? body : body.slice(0, maxChars);
}

function findDocumentAnchor(text: string): number {
    const lower = text.toLowerCase();
    let best = -1;
    for (const marker of DOCUMENT_ANCHORS) {
        const at = lower.lastIndexOf(marker.toLowerCase());
        if (at > best) {
            best = at;
        }
    }
    return best;
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
