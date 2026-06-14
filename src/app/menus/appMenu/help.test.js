// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {clipboard} from 'electron';

import Config from 'common/config';
import ServerManager from 'common/servers/serverManager';
import UpdateManager from 'main/autoUpdater';
import {localizeMessage} from 'main/i18nManager';

import createHelpMenu from './help';

jest.mock('electron', () => ({
    app: {
        getVersion: () => '6.2.1',
    },
    clipboard: {
        writeText: jest.fn(),
    },
}));

jest.mock('main/i18nManager', () => ({
    localizeMessage: jest.fn((id, defaultMessage) => defaultMessage),
}));

jest.mock('common/config', () => ({
    canUpgrade: false,
}));

jest.mock('common/servers/serverManager', () => ({
    getOrderedServers: jest.fn(),
    getRemoteInfo: jest.fn(),
}));

jest.mock('main/autoUpdater', () => ({
    __esModule: true,
    default: {
        versionDownloaded: false,
        versionAvailable: false,
        checkForUpdates: jest.fn(),
        handleUpdate: jest.fn(),
        handleDownload: jest.fn(),
    },
}));

describe('app/menus/appMenu/help', () => {
    const servers = [
        {id: 'server-1', name: 'My Workspace', url: 'https://localhost:18443/webui/'},
    ];

    beforeEach(() => {
        ServerManager.getOrderedServers.mockReturnValue(servers);
        ServerManager.getRemoteInfo.mockReturnValue({serverVersion: '14.0.0'});
        Config.canUpgrade = false;
        UpdateManager.versionDownloaded = false;
        UpdateManager.versionAvailable = false;
    });

    it('should include desktop and server version entries', () => {
        const menu = createHelpMenu();
        expect(menu.submenu.length).toBeGreaterThanOrEqual(3);
        expect(menu.submenu[0].label).toContain('Desktop App Version');
        expect(menu.submenu[1].label).toBe('My Workspace');
    });

    it('should copy desktop version to clipboard when clicked', () => {
        const menu = createHelpMenu();
        menu.submenu[0].click();
        expect(clipboard.writeText).toHaveBeenCalled();
    });

    it('should show check for updates when upgrades are enabled', () => {
        Config.canUpgrade = true;
        const menu = createHelpMenu();
        const updateItem = menu.submenu.find((item) => item.label === 'Check for Updates');
        expect(updateItem).toBeDefined();
        updateItem.click();
        expect(UpdateManager.checkForUpdates).toHaveBeenCalledWith(true);
    });
});
