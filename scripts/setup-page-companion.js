// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

const {spawnSync} = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '../resources/page-companion');
const lock = path.join(dir, 'package-lock.json');
const args = fs.existsSync(lock) ? ['ci', '--omit=dev'] : ['install', '--omit=dev'];
const result = spawnSync('npm', args, {
    cwd: dir,
    stdio: 'inherit',
    shell: true,
    env: {
        ...process.env,
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    },
});

if (result.status !== 0) {
    throw new Error(`page companion install failed (${result.status || 1})`);
}
