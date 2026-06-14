// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import en from './en.json';
import zhCN from './zh-CN.json';

export type Language = {
    value: string;
    name: string;
    order: number;
    url: Record<string, string>;
};

export const languages: Record<string, Language> = {
    en: {
        value: 'en',
        name: 'English (US)',
        order: 1,
        url: en,
    },
    'zh-CN': {
        value: 'zh-CN',
        name: '中文 (简体) (Beta)',
        order: 19,
        url: zhCN,
    },
};
