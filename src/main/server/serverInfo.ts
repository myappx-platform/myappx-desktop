// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import semver from 'semver';

import type {MattermostServer} from 'common/servers/MattermostServer';
import {parseURL} from 'common/utils/url';
import {isMyAppxServerUrl, resolveMyAppxMonitorUrl, resolveMyAppxWebUiUrl} from 'main/server/myAppxServerUrl';

import type {ClientConfig, RemoteInfo} from 'types/server';

import {getServerAPI} from './serverAPI';

/** Fallback when idempiereMonitor is unreachable; must be valid semver for MattermostWebContentsView. */
const MYAPPX_SERVER_VERSION_FALLBACK = '14.0.0';
const MYAPPX_SERVER_NAME = 'MyAppx';
const MYAPPX_MONITOR_VERSION_PATTERN = /<version>([^<]+)<\/version>/i;

function normalizeSemverVersion(raw: string | undefined): string | undefined {
    if (!raw) {
        return undefined;
    }

    const trimmed = raw.trim();
    if (semver.valid(trimmed)) {
        return trimmed;
    }

    return semver.coerce(trimmed)?.version;
}

export class ServerInfo {
    private server: MattermostServer;
    private remoteInfo: RemoteInfo;

    constructor(server: MattermostServer) {
        this.server = server;
        this.remoteInfo = {};
    }

    pingServer = async () => {
        if (this.isMyAppxServer()) {
            const url = resolveMyAppxWebUiUrl(this.server.url);
            if (!url) {
                throw new Error('Malformed MyAppx server URL');
            }

            await new Promise<void>((resolve, reject) => {
                getServerAPI(
                    url,
                    false,
                    () => resolve(),
                    () => reject(new Error('Aborted')),
                    (error: Error, errorReason?: {needsBasicAuth?: boolean; needsPreAuth?: boolean}) => {
                        const enhancedError = error as Error & { errorReason?: {needsBasicAuth?: boolean; needsPreAuth?: boolean} };
                        enhancedError.errorReason = errorReason;
                        reject(enhancedError);
                    },
                );
            });
            return;
        }

        await this.getRemoteInfo<{status: string}>(
            () => {}, // No callback needed for ping, just checking if it responds
            parseURL(`${this.server.url}/api/v4/system/ping`),
        );
    };

    fetchConfigData = async () => {
        if (this.isMyAppxServer()) {
            this.remoteInfo.serverVersion = await this.fetchMyAppxServerVersion();
            this.remoteInfo.siteURL = resolveMyAppxWebUiUrl(this.server.url)?.toString() ?? this.server.url.toString();
            this.remoteInfo.siteName = this.server.name || MYAPPX_SERVER_NAME;
            return this.remoteInfo;
        }

        await this.getRemoteInfo<ClientConfig>(
            this.onGetConfig,
            parseURL(`${this.server.url}/api/v4/config/client?format=old`),
        );

        return this.remoteInfo;
    };

    fetchRemoteInfo = async () => {
        await this.fetchConfigData();

        if (this.isMyAppxServer()) {
            return this.remoteInfo;
        }

        await this.getRemoteInfo<Array<{id: string; version: string}>>(
            this.onGetPlugins,
            parseURL(`${this.server.url}/api/v4/plugins/webapp`),
        );
        await this.getRemoteInfo<{SkuShortName: string}>(
            this.onGetLicense,
            parseURL(`${this.server.url}/api/v4/license/client?format=old`),
        );

        return this.remoteInfo;
    };

    private getRemoteInfo = <T>(
        callback: (data: T) => void,
        url?: URL,
    ) => {
        if (!url) {
            return Promise.reject(new Error('Malformed URL'));
        }
        return new Promise<void>((resolve, reject) => {
            getServerAPI(
                url,
                false,
                (raw: string) => {
                    try {
                        const data = JSON.parse(raw) as T;
                        callback(data);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                },
                () => reject(new Error('Aborted')),
                (error: Error, errorReason?: {needsBasicAuth?: boolean; needsPreAuth?: boolean}) => {
                    const enhancedError = error as Error & { errorReason?: {needsBasicAuth?: boolean; needsPreAuth?: boolean} };
                    enhancedError.errorReason = errorReason;
                    reject(enhancedError);
                });
        });
    };

    private onGetConfig = (data: ClientConfig) => {
        this.remoteInfo.serverVersion = data.Version;
        this.remoteInfo.siteURL = data.SiteURL;
        this.remoteInfo.siteName = data.SiteName;
        this.remoteInfo.hasFocalboard = this.remoteInfo.hasFocalboard || data.BuildBoards === 'true';
        this.remoteInfo.helpLink = data.HelpLink;
        this.remoteInfo.reportProblemLink = data.ReportAProblemLink;
    };

    private onGetLicense = (data: {SkuShortName: string}) => {
        this.remoteInfo.licenseSku = data.SkuShortName;
    };

    private onGetPlugins = (data: Array<{id: string; version: string}>) => {
        this.remoteInfo.hasFocalboard = this.remoteInfo.hasFocalboard || data.some((plugin) => plugin.id === 'focalboard');
        this.remoteInfo.hasPlaybooks = data.some((plugin) => plugin.id === 'playbooks');
        this.remoteInfo.hasUserSurvey = data.some((plugin) => plugin.id === 'com.mattermost.nps');
    };

    private fetchMyAppxServerVersion = async (): Promise<string> => {
        const monitorUrl = resolveMyAppxMonitorUrl(this.server.url);
        if (!monitorUrl) {
            return MYAPPX_SERVER_VERSION_FALLBACK;
        }

        try {
            const xml = await new Promise<string>((resolve, reject) => {
                getServerAPI(
                    monitorUrl,
                    false,
                    (raw) => resolve(raw),
                    () => reject(new Error('Aborted')),
                    (error) => reject(error),
                );
            });
            const version = normalizeSemverVersion(xml.match(MYAPPX_MONITOR_VERSION_PATTERN)?.[1]);
            if (version) {
                return version;
            }
        } catch {
            // Monitor may be down, blocked, or return HTML login page.
        }

        return MYAPPX_SERVER_VERSION_FALLBACK;
    };

    private isMyAppxServer = () => isMyAppxServerUrl(this.server.url);
}
