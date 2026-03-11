// Copyright (c) 2015-2016 Yuya Ochiai
// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {BuildConfig} from 'types/config';

import {DEFAULT_ACADEMY_LINK, DEFAULT_HELP_LINK, DEFAULT_UPGRADE_LINK} from '../../common/constants';

// For detailed guides, please refer to https://docs.mattermost.com/deployment/desktop-app-deployment.html

/**
 * Build-time configuration. End-users can't change these parameters.
 * @prop {Object[]} defaultServers
 * @prop {string} defaultServers[].name - The view name for default server.
 * @prop {string} defaultServers[].url - The URL for default server.
 * @prop {string} defaultServers[].order - Sort order for server views (0, 1, 2)
 * @prop {string} helpLink - The URL for "Help->Learn More..." menu item.
 *                           If null is specified, the menu disappears.
 * @prop {boolean} enableServerManagement - Whether users can edit servers configuration.
 *                                          Specify at least one server for "defaultServers"
 *                                          when "enableServerManagement is set to false
 * @prop {[]} managedResources - Defines which paths are managed
 * @prop {[]} allowedProtocols - Defines which protocols should be automatically allowed
 */
const buildConfig: BuildConfig = {
    defaultServers: [
        {
            name: 'My Workspace',
            url: 'https://localhost:18443/',
        },
    ],
    helpLink: DEFAULT_HELP_LINK,
    academyLink: DEFAULT_ACADEMY_LINK,
    upgradeLink: DEFAULT_UPGRADE_LINK,
    enableServerManagement: true,
    enableAutoUpdater: true,
    enableUpdateNotifications: true,
    updateNotificationURL: 'https://myappx.sourceforge.io/desktop',
    macAppStoreUpdateURL: 'macappstore://apps.apple.com/us/app/myappx-desktop/id0000000000',
    windowsStoreUpdateURL: 'ms-windows-store://pdp/?productid=X0000000000',
    linuxUpdateURL: 'https://myappx.sourceforge.io/desktop/linux-desktop-install.html',
    linuxGitHubReleaseURL: 'https://github.com/longnan/myappx-desktop/releases/tag/v',
    managedResources: ['trusted'],
    allowedProtocols: [
        'myappx',
        'ftp',
        'mailto',
        'tel',
    ],
};

export default buildConfig;
