// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import logoUrl from 'assets/myappx desktop.png?filename=myappx-reload-logo';

/**
 * MyAppx reload mark. Two copies of the same logo are masked into the colored
 * outer ring and the inner arrows so each layer can animate on its own.
 */
function LoadingIcon() {
    return (
        <div
            className='LoadingAnimation__logo'
            aria-hidden={true}
        >
            <img
                className='LoadingAnimation__ring'
                src={logoUrl}
                alt=''
                draggable={false}
            />
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
