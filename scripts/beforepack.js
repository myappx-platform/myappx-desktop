// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

const {spawnSync} = require('child_process');
const fs = require('fs');
const path = require('path');

const {path7za} = require('7zip-bin');

const createVersionFile = require('./create-version-file');

/**
 * Zips the contents of appxserver-portable (not the folder itself) into
 * extraResources/appxserver-portable.zip. Removes existing zip first if present.
 */
function zipAppxserverPortable() {
    const projectRoot = path.resolve(__dirname, '..');
    const sourceDir = path.join(projectRoot, 'appxserver-portable');
    const extraResourcesDir = path.join(projectRoot, 'extraResources');
    const zipPath = path.join(extraResourcesDir, 'appxserver-portable.zip');

    if (!fs.existsSync(sourceDir)) {
        console.warn('beforePack: appxserver-portable directory not found, skipping zip');
        return;
    }

    if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
    }

    if (!fs.existsSync(extraResourcesDir)) {
        fs.mkdirSync(extraResourcesDir, {recursive: true});
    }

    // Add only the contents of appxserver-portable (*), cwd=sourceDir so the zip root
    // contains appxserver/, conf/, *.bat, etc., not an appxserver-portable/ wrapper.
    const result = spawnSync(path7za, ['a', '-tzip', zipPath, '*'], {
        cwd: sourceDir,
    });

    if (result.status !== 0) {
        const err = [result.stderr, result.stdout].filter(Boolean).map((b) => b.toString()).join('\n');
        throw new Error(`Failed to create appxserver-portable.zip: ${err}`);
    }
    console.log('beforePack: appxserver-portable.zip created in extraResources');
}

exports.default = async function beforePack(context) {
    // The debian packager (fpm) complains when the directory to output the package to doesn't exist
    // So we have to manually create it first
    const dir = path.join(context.outDir, context.packager.appInfo.version);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }

    // Create version file for persistent resources tracking
    createVersionFile();

    // Zip appxserver-portable into extraResources for packaging
    zipAppxserverPortable();
};
