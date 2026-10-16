// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

const {spawnSync} = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const NODE_HOST_VERSION = '22.23.3';
const NODE_HOST_FILE = 'win-x64/node.exe';

const dir = path.resolve(__dirname, '../resources/page-companion');

function installPackages() {
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
}

async function ensureNodeHost() {
    const hostDir = path.join(dir, 'host');
    const dest = path.join(hostDir, 'node.exe');
    const versionFile = path.join(hostDir, 'VERSION');
    if (fs.existsSync(dest) && fs.existsSync(versionFile) &&
        fs.readFileSync(versionFile, 'utf8').trim() === NODE_HOST_VERSION) {
        return;
    }
    const base = `https://nodejs.org/dist/v${NODE_HOST_VERSION}/`;
    const sumsResponse = await fetch(`${base}SHASUMS256.txt`);
    if (!sumsResponse.ok) {
        throw new Error(`node host checksum request failed (${sumsResponse.status})`);
    }
    const sums = await sumsResponse.text();
    const line = sums.split(/\r?\n/).find((entry) => entry.endsWith(NODE_HOST_FILE));
    if (!line) {
        throw new Error(`checksum for ${NODE_HOST_FILE} was not published`);
    }
    const expected = line.split(/\s+/)[0];
    const binaryResponse = await fetch(base + NODE_HOST_FILE);
    if (!binaryResponse.ok) {
        throw new Error(`node host download failed (${binaryResponse.status})`);
    }
    const body = Buffer.from(await binaryResponse.arrayBuffer());
    const actual = crypto.createHash('sha256').update(body).digest('hex');
    if (actual !== expected) {
        throw new Error('node host checksum did not match');
    }
    fs.mkdirSync(hostDir, {recursive: true});
    const temp = `${dest}.download`;
    fs.writeFileSync(temp, body);
    fs.renameSync(temp, dest);
    fs.writeFileSync(versionFile, `${NODE_HOST_VERSION}\n`);
}

async function main() {
    installPackages();
    if (process.platform === 'win32') {
        await ensureNodeHost();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    throw error;
});
