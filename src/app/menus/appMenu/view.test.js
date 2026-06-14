// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import CallsWidgetWindow from 'app/callsWidgetWindow';
import MainWindow from 'app/mainWindow/mainWindow';
import TabManager from 'app/tabs/tabManager';
import WebContentsManager from 'app/views/webContentsManager';
import Config from 'common/config';
import ServerManager from 'common/servers/serverManager';
import {clearAllData, clearDataForServer} from 'main/app/utils';
import DeveloperMode from 'main/developerMode';
import downloadsManager from 'main/downloadsManager';
import {localizeMessage} from 'main/i18nManager';

import createViewMenu from './view';

jest.mock('main/i18nManager', () => ({
    localizeMessage: jest.fn(),
}));

jest.mock('app/callsWidgetWindow', () => ({
    isOpen: jest.fn(),
    isPopoutOpen: jest.fn(),
    openDevTools: jest.fn(),
    openPopoutDevTools: jest.fn(),
}));

jest.mock('app/mainWindow/mainWindow', () => ({
    get: jest.fn(),
}));

jest.mock('app/tabs/tabManager', () => ({
    getCurrentActiveTabView: jest.fn(),
}));

jest.mock('app/views/webContentsManager', () => ({
    getFocusedView: jest.fn(),
    clearCacheAndReloadView: jest.fn(),
}));

jest.mock('common/config', () => ({
    darkMode: false,
    set: jest.fn(),
}));

jest.mock('common/servers/serverManager', () => ({
    getCurrentServerId: jest.fn(),
    getServer: jest.fn(),
}));

jest.mock('main/developerMode', () => ({
    enabled: jest.fn(),
    get: jest.fn(),
    toggle: jest.fn(),
}));

jest.mock('main/downloadsManager', () => ({
    hasDownloads: jest.fn(),
    openDownloadsDropdown: jest.fn(),
}));

jest.mock('main/app/utils', () => ({
    clearAllData: jest.fn(),
    clearDataForServer: jest.fn(),
}));

describe('app/menus/appMenu/view', () => {
    const mockView = {
        reload: jest.fn(),
        currentURL: 'https://example.com/current-page',
        openDevTools: jest.fn(),
    };

    const mockServer = {
        id: 'server-1',
        name: 'example',
        url: 'http://example.com',
    };

    beforeEach(() => {
        ServerManager.getCurrentServerId.mockReturnValue(mockServer.id);
        ServerManager.getServer.mockReturnValue(mockServer);
        WebContentsManager.getFocusedView.mockReturnValue(mockView);
        TabManager.getCurrentActiveTabView.mockReturnValue(mockView);
        CallsWidgetWindow.isOpen.mockReturnValue(false);
        CallsWidgetWindow.isPopoutOpen.mockReturnValue(false);
        DeveloperMode.enabled.mockReturnValue(false);
        downloadsManager.hasDownloads.mockReturnValue(false);
    });

    describe('createViewMenu', () => {

        it('should show downloads menu item when downloads are available', () => {
            downloadsManager.hasDownloads.mockReturnValue(true);

            localizeMessage.mockImplementation((id) => {
                if (id === 'main.menus.app.view.downloads') {
                    return 'Downloads';
                }
                return id;
            });

            const menu = createViewMenu();
            const downloadsMenuItem = menu.submenu.find((item) => item.id === 'app-menu-downloads');
            expect(downloadsMenuItem).not.toBe(undefined);
            expect(downloadsMenuItem.enabled).toBe(true);
        });

        it('should call downloadsManager.openDownloadsDropdown when downloads is clicked', () => {
            downloadsManager.hasDownloads.mockReturnValue(true);

            localizeMessage.mockImplementation((id) => {
                if (id === 'main.menus.app.view.downloads') {
                    return 'Downloads';
                }
                return id;
            });

            const menu = createViewMenu();
            const downloadsMenuItem = menu.submenu.find((item) => item.id === 'app-menu-downloads');
            downloadsMenuItem.click();
            expect(downloadsManager.openDownloadsDropdown).toHaveBeenCalled();
        });

        it('should show clear data for server option when server is available', () => {
            localizeMessage.mockImplementation((id) => {
                if (id === 'main.menus.app.view.clearDataForServer') {
                    return 'Clear Data for Current Server';
                }
                return id;
            });

            const menu = createViewMenu();
            const clearDataMenuItem = menu.submenu.find((item) => item.id === 'clear-data-for-server');
            expect(clearDataMenuItem).not.toBe(undefined);
        });

        it('should call clearDataForServer when clear data for server is clicked', async () => {
            localizeMessage.mockImplementation((id) => {
                if (id === 'main.menus.app.view.clearDataForServer') {
                    return 'Clear Data for Current Server';
                }
                return id;
            });

            const menu = createViewMenu();
            const clearDataMenuItem = menu.submenu.find((item) => item.id === 'clear-data-for-server');
            await clearDataMenuItem.click();
            expect(clearDataForServer).toHaveBeenCalledWith(mockServer);
        });

        it('should show clear all data option', () => {
            localizeMessage.mockImplementation((id) => {
                if (id === 'main.menus.app.view.clearAllData') {
                    return 'Clear All Data';
                }
                return id;
            });

            const menu = createViewMenu();
            const clearAllDataMenuItem = menu.submenu.find((item) => item.id === 'clear-data');
            expect(clearAllDataMenuItem).not.toBe(undefined);
        });

        it('should call clearAllData when clear all data is clicked', async () => {
            localizeMessage.mockImplementation((id) => {
                if (id === 'main.menus.app.view.clearAllData') {
                    return 'Clear All Data';
                }
                return id;
            });

            const menu = createViewMenu();
            const clearAllDataMenuItem = menu.submenu.find((item) => item.id === 'clear-data');
            await clearAllDataMenuItem.click();
            expect(clearAllData).toHaveBeenCalled();
        });

        it('should show toggle dark mode option on Linux', () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, 'platform', {
                value: 'linux',
            });

            localizeMessage.mockImplementation((id) => {
                if (id === 'main.menus.app.view.toggleDarkMode') {
                    return 'Toggle Dark Mode';
                }
                return id;
            });

            const menu = createViewMenu();
            const toggleDarkModeMenuItem = menu.submenu.find((item) => item.label === 'Toggle Dark Mode');
            expect(toggleDarkModeMenuItem).not.toBe(undefined);
            toggleDarkModeMenuItem.click();
            expect(Config.set).toHaveBeenCalledWith('darkMode', true);

            Object.defineProperty(process, 'platform', {
                value: originalPlatform,
            });
        });
    });
});
