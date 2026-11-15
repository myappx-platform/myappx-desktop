// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import './Logo.scss';

/**
 * MyAppx lockup: the brand mark followed by the wordmark. The mark uses
 * `currentColor`, so the whole lockup follows the surrounding theme.
 */
export default () => (
    <span
        className='MyAppxLogo'
        role='img'
        aria-label='MyAppx'
    >
        <svg
            className='MyAppxLogo__mark'
            viewBox='0 0 28.47 28'
            fill='none'
            aria-hidden={true}
            focusable='false'
            xmlns='http://www.w3.org/2000/svg'
        >
            <path
                fill='currentColor'
                d='M1 0L14.23 10.45L27.47 0L27.41 11.45L23.09 15.64L22.9 9.07L14.23 16.14L5.57 9.07L5.38 15.64L1.06 11.45Z'
            />
            <path
                fill='currentColor'
                d='M8.45 15.08L14.23 20.08L20.02 15.08L27.41 21.21L28.47 28L19.71 20.59L14.23 25.72L8.76 20.59L0 28L1.06 21.21Z'
            />
        </svg>
        <span className='MyAppxLogo__wordmark'>
            {'MyAppx'}
        </span>
    </span>
);
