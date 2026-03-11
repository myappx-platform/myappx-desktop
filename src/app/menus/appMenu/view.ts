// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {type MenuItemConstructorOptions} from 'electron';

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

export default function createViewMenu() {
    const viewSubMenu: Electron.MenuItemConstructorOptions[] = [{
        label: localizeMessage('main.menus.app.view.find', 'Find..'),
        accelerator: 'CmdOrCtrl+F',
        click() {
            WebContentsManager.getFocusedView()?.openFind();
        },
    }, {
        label: localizeMessage('main.menus.app.view.reload', 'Reload'),
        accelerator: 'CmdOrCtrl+R',
        click() {
            const view = WebContentsManager.getFocusedView();
            if (view) {
                view.reload(view.currentURL);
            }
        },
    }, {
        label: localizeMessage('main.menus.app.view.clearCacheAndReload', 'Clear Cache and Reload'),
        accelerator: 'Shift+CmdOrCtrl+R',
        click() {
            const view = WebContentsManager.getFocusedView();
            if (view) {
                WebContentsManager.clearCacheAndReloadView(view.id);
            }
        },
    }];

    if (process.platform !== 'linux') {
        viewSubMenu.push({
            role: 'togglefullscreen',
            label: localizeMessage('main.menus.app.view.fullscreen', 'Toggle Full Screen'),
            accelerator: process.platform === 'darwin' ? 'Ctrl+Cmd+F' : 'F11',
        });
    }

    viewSubMenu.push({type: 'separator'}, {
        id: 'app-menu-downloads',
        label: localizeMessage('main.menus.app.view.downloads', 'Downloads'),
        enabled: downloadsManager.hasDownloads(),
        click() {
            return downloadsManager.openDownloadsDropdown();
        },
    }, {type: 'separator'});

    const currentServerId = ServerManager.getCurrentServerId();
    if (currentServerId) {
        viewSubMenu.push({
            id: 'clear-data-for-server',
            label: localizeMessage('main.menus.app.view.clearDataForServer', 'Clear Data for Current Server'),
            async click() {
                const server = ServerManager.getServer(currentServerId);
                if (!server) {
                    return;
                }
                clearDataForServer(server);
            },
        });
    }

    viewSubMenu.push({
        id: 'clear-data',
        label: localizeMessage('main.menus.app.view.clearAllData', 'Clear All Data'),
        async click() {
            return clearAllData();
        },
    });

    if (process.platform === 'linux') {
        viewSubMenu.push({type: 'separator'});
        viewSubMenu.push({
            label: localizeMessage('main.menus.app.view.toggleDarkMode', 'Toggle Dark Mode'),
            click() {
                Config.set('darkMode', !Config.darkMode);
            },
        });
    }

    return {
        id: 'view',
        label: localizeMessage('main.menus.app.view', '&View'),
        submenu: viewSubMenu,
    };
}
