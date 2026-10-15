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

/** Index of the single tab whose URL matches the active WebContentsView. */
export function pickTabIndex(listText: string, targetHref: string): number | null {
    const target = stripUrl(targetHref);
    const hits: number[] = [];
    for (const line of listText.split(/\r?\n/)) {
        const match = line.match(/-\s+(\d+):.*?(https?:\/\/[^\s)]+)/);
        if (!match) {
            continue;
        }
        if (stripUrl(match[2]) === target) {
            hits.push(Number(match[1]));
        }
    }
    return hits.length === 1 ? hits[0] : null;
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
