// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {applyCdpPort} from 'app/pageCompanion/cdpPort';
import {pickTabIndex, tabIsCurrent} from 'app/pageCompanion/tabPick';
import {ipcValidate, pageActSchema} from 'common/Validator';

describe('page companion', () => {
    it('does not open a debugging port when MYAPPX_CDP_PORT is unset', () => {
        const appendSwitch = jest.fn();
        expect(applyCdpPort(appendSwitch, undefined)).toBe(false);
        expect(appendSwitch).not.toHaveBeenCalled();
    });

    it('opens the debugging port only on 127.0.0.1', () => {
        const appendSwitch = jest.fn();
        expect(applyCdpPort(appendSwitch, '9333')).toBe(true);
        expect(appendSwitch).toHaveBeenCalledWith('remote-debugging-address', '127.0.0.1');
        expect(appendSwitch).toHaveBeenCalledWith('remote-debugging-port', '9333');
    });

    it('rejects a page act that has no ref', () => {
        const handler = jest.fn();
        const wrapped = ipcValidate(handler, [pageActSchema]);
        wrapped({sender: {id: 1}}, {op: 'click'});
        expect(handler).not.toHaveBeenCalled();
        expect(pageActSchema.validate({op: 'click', ref: 'e12'}).error).toBeUndefined();
        expect(pageActSchema.validate({op: 'fill_form', ref: 'e3', value: 'hello'}).error).toBeUndefined();
    });

    it('selects only the tab whose url matches the active view', () => {
        const list = [
            '- 0: (current) [Other](https://localhost:18443/other)',
            '- 1: [Order](https://localhost:18443/webui/)',
        ].join('\n');
        expect(pickTabIndex(list, 'https://localhost:18443/webui')).toBe(1);
        expect(tabIsCurrent(list, 1)).toBe(false);
        expect(pickTabIndex(list, 'https://localhost:18443/missing')).toBeNull();
    });
});
