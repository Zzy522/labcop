#!/usr/bin/env node
/**
 * Patch @arco-design/web-react for React 19 compatibility.
 *
 * Issue: Arco's `callbackOriginRef` in `_util/react-dom.js` accesses
 * `children.ref` directly, triggering React 19's deprecation warning:
 *   "Accessing element.ref was removed in React 19. ref is now a regular prop."
 *
 * Fix: rewrite callbackOriginRef to read ref from props.ref (React 19 style)
 * or via Object.getOwnPropertyDescriptor (avoiding the deprecated getter).
 *
 * Covers BOTH build artifacts: es/ (ESM, used by Turbopack) and lib/ (CJS, SSR fallback).
 */

const fs = require('fs');
const path = require('path');

const arcoRoot = path.join(__dirname, '..', 'node_modules', '@arco-design', 'web-react');

const ES_OLD = `// 回调children的原始 ref ，适配函数 ref or ref.current 场景
export var callbackOriginRef = function (children, node) {
    if (children && children.ref) {
        if (isFunction(children.ref)) {
            children === null || children === void 0 ? void 0 : children.ref(node);
        }
        if ('current' in children.ref) {
            children.ref.current = node;
        }
    }
};`;

const ES_NEW = `// __patched_for_react19
// 回调children的原始 ref ，适配函数 ref or ref.current 场景
export var callbackOriginRef = function (children, node) {
    if (!children) return;
    // React 19 moved ref from element.ref to element.props.ref
    var refValue = undefined;
    try {
        if (children.props && children.props.ref !== undefined) {
            refValue = children.props.ref;
        } else {
            var descriptor = Object.getOwnPropertyDescriptor(children, 'ref');
            if (descriptor && 'value' in descriptor) {
                refValue = descriptor.value;
            } else if (descriptor && typeof descriptor.get === 'function') {
                refValue = undefined;
            }
        }
    } catch (e) {}
    if (refValue) {
        if (isFunction(refValue)) {
            refValue(node);
        }
        if (typeof refValue === 'object' && 'current' in refValue) {
            refValue.current = node;
        }
    }
};`;

const LIB_OLD = `// 回调children的原始 ref ，适配函数 ref or ref.current 场景
var callbackOriginRef = function (children, node) {
    if (children && children.ref) {
        if ((0, is_1.isFunction)(children.ref)) {
            children === null || children === void 0 ? void 0 : children.ref(node);
        }
        if ('current' in children.ref) {
            children.ref.current = node;
        }
    }
};`;

const LIB_NEW = `// __patched_for_react19
// 回调children的原始 ref ，适配函数 ref or ref.current 场景
var callbackOriginRef = function (children, node) {
    if (!children) return;
    // React 19 moved ref from element.ref to element.props.ref
    var refValue = undefined;
    try {
        if (children.props && children.props.ref !== undefined) {
            refValue = children.props.ref;
        } else {
            var descriptor = Object.getOwnPropertyDescriptor(children, 'ref');
            if (descriptor && 'value' in descriptor) {
                refValue = descriptor.value;
            } else if (descriptor && typeof descriptor.get === 'function') {
                refValue = undefined;
            }
        }
    } catch (e) {}
    if (refValue) {
        if ((0, is_1.isFunction)(refValue)) {
            refValue(node);
        }
        if (typeof refValue === 'object' && 'current' in refValue) {
            refValue.current = node;
        }
    }
};`;

const targets = [
  { file: path.join(arcoRoot, 'es', '_util', 'react-dom.js'), oldCode: ES_OLD, newCode: ES_NEW, label: 'es' },
  { file: path.join(arcoRoot, 'lib', '_util', 'react-dom.js'), oldCode: LIB_OLD, newCode: LIB_NEW, label: 'lib' },
];

let patchedCount = 0;
let skippedCount = 0;

for (const t of targets) {
  if (!fs.existsSync(t.file)) {
    console.log(`[patch-arco] ${t.label}: target not found, skipping: ${t.file}`);
    continue;
  }
  const content = fs.readFileSync(t.file, 'utf-8');

  if (content.includes('__patched_for_react19')) {
    console.log(`[patch-arco] ${t.label}: already patched, skipping.`);
    skippedCount++;
    continue;
  }

  if (content.includes(t.oldCode)) {
    fs.writeFileSync(t.file, content.replace(t.oldCode, t.newCode), 'utf-8');
    console.log(`[patch-arco] ${t.label}: successfully patched callbackOriginRef for React 19.`);
    patchedCount++;
  } else {
    console.log(`[patch-arco] ${t.label}: expected code block not found, manual patch may be needed.`);
  }
}

console.log(`[patch-arco] done. patched=${patchedCount} skipped=${skippedCount}`);
