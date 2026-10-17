// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

function stripUrl(raw: string): string {
    try {
        const url = new URL(raw);
        let path = url.pathname;
        if (path.length > 1 && path.endsWith('/')) {
            path = path.slice(0, -1);
        }
        return `${url.origin}${path}${url.search}`;
    } catch {
        return raw.replace(/\/+$/, '');
    }
}

/** Same webui shell regardless of /webui, /webui/, or /webui/index.zul. */
function webuiKey(raw: string): string | undefined {
    try {
        const url = new URL(raw);
        if (!url.pathname.toLowerCase().includes('/webui')) {
            return undefined;
        }
        return `${url.origin.toLowerCase()}/webui`;
    } catch {
        return raw.toLowerCase().includes('/webui') ? raw.toLowerCase() : undefined;
    }
}

/** Index of the single tab whose URL matches the active WebContentsView. */
export function pickTabIndex(listText: string, targetHref: string): number | null {
    const target = stripUrl(targetHref);
    const targetWebui = webuiKey(targetHref);
    const exact: number[] = [];
    const soft: number[] = [];
    for (const line of listText.split(/\r?\n/)) {
        const match = line.match(/-\s+(\d+):.*?(https?:\/\/[^\s)]+)/);
        if (!match) {
            continue;
        }
        const index = Number(match[1]);
        if (stripUrl(match[2]) === target) {
            exact.push(index);
            continue;
        }
        if (targetWebui && webuiKey(match[2]) === targetWebui) {
            soft.push(index);
        }
    }
    if (exact.length === 1) {
        return exact[0];
    }
    if (exact.length === 0 && soft.length === 1) {
        return soft[0];
    }
    return null;
}

export function tabIsCurrent(listText: string, index: number): boolean {
    for (const line of listText.split(/\r?\n/)) {
        const match = line.match(/-\s+(\d+):/);
        if (match && Number(match[1]) === index && line.includes('(current)')) {
            return true;
        }
    }
    return false;
}
