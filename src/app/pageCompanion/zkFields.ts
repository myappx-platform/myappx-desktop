// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Fixed page script for the iDempiere document. The model never supplies this source.
 * Arguments are embedded only as JSON literals.
 */

export type ZkField = {
    instanceName: string;
    column: string;
    label: string;
    value: string;
    mandatory: boolean;
    readonly: boolean;
    error: string;
    role: string;
};

const ZK_SOURCE = `
var SKIP = {
  infopanel: 1,
  findwindow: 1,
  attachment: 1,
  infoparameterpanel: 1,
  recordinfo: 1,
  processbuttonpopup: 1,
  infolistbox: 1,
  importaction: 1,
  exportaction: 1,
  processmodal: 1
};
function clip(value, max) {
  var text = value == null ? '' : String(value).replace(/\\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) : text;
}
function classText(el) {
  if (!el) return '';
  return typeof el.className === 'string' ? el.className : '';
}
function widget(el) {
  try {
    if (window.zk && window.zk.Widget && typeof window.zk.Widget.$ === 'function') {
      return window.zk.Widget.$(el);
    }
  } catch (ignore) {}
  return null;
}
function columnOf(instanceName) {
  var match = /^([A-Za-z][A-Za-z0-9_]*)0([A-Z][A-Za-z0-9_]*)$/.exec(instanceName || '');
  return match ? match[2] : (instanceName || '');
}
function labelFor(el) {
  var aria = clip(el.getAttribute('aria-label'), 80);
  if (aria) return aria;
  var row = el.closest ? el.closest('tr') : null;
  if (row) {
    var lab = row.querySelector('.z-label, .idempiere-label, label');
    if (lab && !el.contains(lab)) return clip(lab.textContent, 80);
  }
  return '';
}
function roleOf(el) {
  var cls = classText(el);
  if (cls.indexOf('z-datebox') >= 0) return 'datebox';
  if (cls.indexOf('z-bandbox') >= 0 || cls.indexOf('z-combobox') >= 0) return 'combobox';
  var area = el.matches && el.matches('textarea') ? el : (el.querySelector ? el.querySelector('textarea') : null);
  if (area) return 'textarea';
  return 'textbox';
}
function valueOf(el) {
  var input = el.matches && el.matches('input,textarea') ? el : (el.querySelector ? el.querySelector('input,textarea') : null);
  if (input && typeof input.value === 'string') return clip(input.value, 500);
  var w = widget(el);
  if (w && typeof w.getValue === 'function') {
    var raw = w.getValue();
    if (raw != null && typeof raw !== 'object') return clip(raw, 500);
  }
  return '';
}
function errorOf(el) {
  var w = widget(el);
  var box = w && w._errbox;
  if (box && typeof box.$n === 'function') {
    var node = box.$n();
    if (node) {
      var content = node.querySelector ? (node.querySelector('.z-errorbox-content') || node) : node;
      return clip(content.textContent, 200);
    }
  }
  return '';
}
function isMandatory(el) {
  if (classText(el).indexOf('idempiere-mandatory') >= 0) return true;
  if (el.querySelector && el.querySelector('.idempiere-mandatory')) return true;
  return false;
}
function isReadOnly(el) {
  var input = el.matches && el.matches('input,textarea') ? el : (el.querySelector ? el.querySelector('input,textarea') : null);
  if (input && (input.disabled || input.readOnly)) return true;
  var cls = classText(el);
  return cls.indexOf('z-textbox-readonly') >= 0 || cls.indexOf('z-combobox-readonly') >= 0;
}
function visible(el) {
  var rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
function inCopilot(el) {
  return !!(el.closest && el.closest('.ai-chat-side-panel'));
}
function collect() {
  var out = [];
  var nodes = document.querySelectorAll('[instanceName]');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var instanceName = clip(el.getAttribute('instanceName'), 120);
    if (!instanceName || SKIP[instanceName.toLowerCase()] || inCopilot(el) || !visible(el)) continue;
    out.push({
      instanceName: instanceName,
      column: columnOf(instanceName),
      label: labelFor(el),
      value: valueOf(el),
      mandatory: isMandatory(el),
      readonly: isReadOnly(el),
      error: errorOf(el),
      role: roleOf(el)
    });
    if (out.length >= 60) break;
  }
  return out;
}
function elementByName(instanceName) {
  var nodes = document.querySelectorAll('[instanceName]');
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].getAttribute('instanceName') === instanceName) return nodes[i];
  }
  return null;
}
function findField(spec) {
  var name = spec && spec.instanceName ? String(spec.instanceName).trim() : '';
  var label = spec && spec.label ? String(spec.label).trim().toLowerCase() : '';
  if (name) {
    var named = elementByName(name);
    if (named) return named;
  }
  if (!label) return null;
  var hits = [];
  var fields = collect();
  for (var i = 0; i < fields.length; i++) {
    var field = fields[i];
    if (field.label.toLowerCase() === label || field.column.toLowerCase() === label) hits.push(field);
  }
  if (hits.length !== 1) return null;
  return elementByName(hits[0].instanceName);
}
function findButton(label) {
  var want = String(label || '').trim().toLowerCase();
  if (!want) return null;
  var nodes = document.querySelectorAll('button, .z-button');
  var hits = [];
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (inCopilot(el) || !visible(el)) continue;
    var text = clip(el.textContent, 80).toLowerCase();
    if (text === want) hits.push(el);
  }
  return hits.length === 1 ? hits[0] : null;
}
function paint(el) {
  var old = document.getElementById('myappx-field-assist');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  if (!el) return false;
  var rect = el.getBoundingClientRect();
  var box = document.createElement('div');
  box.id = 'myappx-field-assist';
  box.setAttribute('aria-hidden', 'true');
  box.style.position = 'fixed';
  box.style.left = rect.left + 'px';
  box.style.top = rect.top + 'px';
  box.style.width = Math.max(rect.width, 8) + 'px';
  box.style.height = Math.max(rect.height, 8) + 'px';
  box.style.pointerEvents = 'none';
  box.style.border = '2px solid #c45c26';
  box.style.borderRadius = '2px';
  box.style.boxSizing = 'border-box';
  box.style.zIndex = '30000';
  document.body.appendChild(box);
  return true;
}
function read() {
  return collect();
}
function clearHighlight() {
  var old = document.getElementById('myappx-field-assist');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  return {ok: true};
}
function showTab(spec) {
  var name = spec && spec.tabName ? String(spec.tabName).trim() : '';
  if (!name) return {ok: false};
  var nodes = document.querySelectorAll('.z-tab-text, .z-tab');
  for (var i = 0; i < nodes.length; i++) {
    var text = (nodes[i].textContent || '').replace(/\\s+/g, ' ').trim();
    if (text !== name) continue;
    var tab = nodes[i].closest ? nodes[i].closest('.z-tab') : nodes[i];
    var w = widget(tab || nodes[i]);
    if (w && typeof w.setSelected === 'function') {
      w.setSelected(true);
      return {ok: true};
    }
    if (tab && typeof tab.click === 'function') {
      tab.click();
      return {ok: true};
    }
  }
  return {ok: false};
}
function scrollField(spec) {
  var el = findField(spec || {}) || findButton(spec && spec.label);
  if (el && el.scrollIntoView) el.scrollIntoView({block: 'center', inline: 'nearest'});
  return {ok: !!el};
}
function highlight(spec) {
  var el = findField(spec || {}) || findButton(spec && spec.label);
  return {ok: true, highlighted: paint(el)};
}
function setText(spec) {
  var el = findField(spec || {});
  if (!el) return {ok: false, error: 'not-found'};
  var role = roleOf(el);
  if (role !== 'textbox' && role !== 'textarea') return {ok: false, error: 'not-text'};
  var value = spec && spec.value != null ? String(spec.value) : '';
  var input = el.matches && el.matches('input,textarea') ? el : el.querySelector('input,textarea');
  if (input) input.value = value;
  var w = widget(el) || (input ? widget(input) : null);
  var fired = false;
  if (w && typeof w.setValue === 'function') {
    try {
      w.setValue(value);
      if (typeof w.fire === 'function') w.fire('onChange', {value: value}, {toServer: true});
      fired = true;
    } catch (ignore) {}
  }
  if (!fired && input) {
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
    input.blur();
    fired = true;
  }
  if (!fired) return {ok: false, error: 'not-text'};
  return {ok: true};
}
function clickLabel(spec) {
  var el = findButton(spec && spec.label) || findField(spec || {});
  if (!el) return {ok: false, error: 'not-found'};
  var target = el.matches && el.matches('button,a,input') ? el : (el.querySelector ? el.querySelector('button,a,input') : null);
  var node = target || el;
  if (typeof node.click === 'function') {
    node.click();
    return {ok: true};
  }
  return {ok: false, error: 'not-found'};
}
function selectLabel(spec) {
  var el = findField(spec || {});
  if (!el) return {ok: false, error: 'not-found'};
  var value = spec && spec.value != null ? String(spec.value) : '';
  var w = widget(el);
  if (w && typeof w.setValue === 'function') {
    try {
      w.setValue(value);
      if (typeof w.fire === 'function') w.fire('onChange', {value: value}, {toServer: true});
      return {ok: true};
    } catch (ignore) {}
  }
  var select = el.matches && el.matches('select') ? el : (el.querySelector ? el.querySelector('select') : null);
  if (!select) return {ok: false, error: 'not-found'};
  select.value = value;
  select.dispatchEvent(new Event('change', {bubbles: true}));
  return {ok: true};
}
`;

export function columnOf(instanceName: string): string {
    const match = /^([A-Za-z][A-Za-z0-9_]*)0([A-Z][A-Za-z0-9_]*)$/.exec(instanceName || '');
    return match ? match[2] : (instanceName || '');
}

export function zkInvoke(fn: 'read' | 'setText' | 'highlight' | 'clearHighlight' | 'showTab' | 'scrollField' | 'clickLabel' | 'selectLabel', arg?: unknown): string {
    return `(() => { const arg = ${JSON.stringify(arg ?? null)}; ${ZK_SOURCE}\nreturn ${fn}(arg); })()`;
}

export function parseFieldList(raw: unknown): ZkField[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out: ZkField[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const row = item as Record<string, unknown>;
        const instanceName = typeof row.instanceName === 'string' ? row.instanceName : '';
        if (!instanceName) {
            continue;
        }
        out.push({
            instanceName,
            column: typeof row.column === 'string' && row.column ? row.column : columnOf(instanceName),
            label: typeof row.label === 'string' ? row.label : '',
            value: typeof row.value === 'string' ? row.value : '',
            mandatory: row.mandatory === true,
            readonly: row.readonly === true,
            error: typeof row.error === 'string' ? row.error : '',
            role: typeof row.role === 'string' ? row.role : '',
        });
        if (out.length >= 60) {
            break;
        }
    }
    return out;
}
