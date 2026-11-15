// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import logoUrl from 'assets/icon2.png';

/**
 * MyAppx app mark shown while the app starts up. The animation itself lives in
 * the parent LoadingAnimation styles.
 */
function LoadingIcon() {
    return (
        <div
            className='LoadingAnimation__logo'
            aria-hidden={true}
        >
            <img
                className='LoadingAnimation__mark'
                src={logoUrl}
                alt=''
                draggable={false}
            />
        </div>
    );
}

export default LoadingIcon;
