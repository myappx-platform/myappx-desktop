// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {parseURL} from 'common/utils/url';

/** Common HTTP(S) ports for bundled or local MyAppx Server deployments. */
export const MYAPPX_SERVER_PORTS = new Set(['8080', '8443', '18443', '443', '80']);

export function isMyAppxServerUrl(url: URL): boolean {
    if (url.pathname.includes('/webui')) {
        return true;
    }

    return MYAPPX_SERVER_PORTS.has(url.port || '');
}

export function resolveMyAppxWebUiUrl(baseUrl: URL): URL | undefined {
    const parsed = parseURL(baseUrl.toString());
    if (!parsed) {
        return undefined;
    }

    if (parsed.pathname.includes('/webui')) {
        return parsed;
    }

    return parseURL(new URL('webui/', parsed).toString());
}

/** Server root URL (strip trailing /webui path segment). */
export function resolveMyAppxServerRootUrl(baseUrl: URL): URL | undefined {
    const parsed = parseURL(baseUrl.toString());
    if (!parsed) {
        return undefined;
    }

    const pathname = parsed.pathname.replace(/\/webui\/?$/i, '/');
    parsed.pathname = pathname.endsWith('/') ? pathname : `${pathname}/`;
    return parsed;
}

/** idempiereMonitor XML summary (APPLICATION_MAIN_VERSION via Adempiere.getVersion()). */
export function resolveMyAppxMonitorUrl(baseUrl: URL): URL | undefined {
    const root = resolveMyAppxServerRootUrl(baseUrl);
    if (!root) {
        return undefined;
    }

    return parseURL(new URL('idempiereMonitor?responseContentType=xml', root).toString());
}
