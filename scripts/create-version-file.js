// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

const fs = require('fs');
const path = require('path');

/**
 * Creates a .version file in extraResources directory
 * This file is used to track resource versions and trigger updates when needed
 */
function createVersionFile() {
    const packageJson = require('../package.json');
    const version = packageJson.version || '0.0.0';

    const extraResourcesDir = path.join(__dirname, '..', 'extraResources');
    const versionFilePath = path.join(extraResourcesDir, '.version');

    // Ensure extraResources directory exists
    if (!fs.existsSync(extraResourcesDir)) {
        fs.mkdirSync(extraResourcesDir, {recursive: true});
        console.log(`Created directory: ${extraResourcesDir}`);
    }

    // Write version file
    fs.writeFileSync(versionFilePath, version, 'utf-8');
    console.log(`Created version file: ${versionFilePath} (version: ${version})`);
}

// Run if called directly
if (require.main === module) {
    try {
        createVersionFile();
    } catch (error) {
        console.error('Error creating version file:', error);
        process.exit(1);
    }
}

module.exports = createVersionFile;
