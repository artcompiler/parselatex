/*
 * Copyright 2013 Art Compiler LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/*
  This module implements the node factory for abstract syntax trees (AST).

  Each node inherits an Ast instance as it prototype.

  All Ast instances share the same node pool and therefore intern trees of
  identical structure to the same node id.

  Node manipulation functions are chainable.

 */

import { assert } from './assert.js';

export const Ast = (() => {
  // Pool of nodes. Shared between all Ast instances.

  function Ast() {
    this.nodePool = ['unused'];
    this.nodeMap = {};
  }

  // Append node to this node's args.
  Ast.prototype.arg = function arg(node) {
    if (!isNode(this)) {
      throw new Error('Malformed node');
    }
    this.args.push(node);
    return this;
  };

  // Get or set the Nth arg of this node.
  Ast.prototype.argN = function argN(i, node) {
    if (!isNode(this)) {
      throw new Error('Malformed node');
    }
    if (node === undefined) {
      return this.args[i];
    }
    this.args[i] = node;
    return this;
  };

  // Get or set the args of this node.
  Ast.prototype.args = function args(a) {
    if (!isNode(this)) {
      throw new Error('Malformed node');
    }
    if (a === undefined) {
      return this.args;
    }
    this.args = a;
    return this;
  };

  // Check if obj is a value node object [private]
  Ast.prototype.isNode = isNode;

  function isNode(obj) {
    if (obj === undefined) {
      obj = this;
    }
    return obj.op && obj.args;
  }

  // Intern an AST into the node pool and return its node id.
  Ast.prototype.intern = function intern(node) {
    if (this instanceof Ast &&
        node === undefined &&
        isNode(this)) {
      // We have an Ast that look like a node
      node = this;
    }
    assert(typeof node === 'object', 'node not an object');
    const { op } = node;
    const count = node.args.length;
    let args = '';
    const argsNids = [];
    for (let i = 0; i < count; i++) {
      args += ' ';
      if (typeof node.args[i] === 'string') {
        args += argsNids[i] = node.args[i];
      } else {
        args += argsNids[i] = this.intern(node.args[i]);
      }
    }
    const TK_LEFTBRACE = 0x7B;
    const TK_LEFTBRACESET = 0x173;
    if (node.lbrk && node.lbrk !== TK_LEFTBRACE && node.lbrk !== TK_LEFTBRACESET) {
      // Make brackets part of the key.
      args += String.fromCharCode(node.lbrk);
      args += String.fromCharCode(node.rbrk);
    }
    const key = op + count + args;
    let nid = this.nodeMap[key];
    if (nid === undefined) {
      this.nodePool.push({
        op,
        args: argsNids,
      });
      nid = this.nodePool.length - 1;
      this.nodeMap[key] = nid;
    }
    return nid;
  };

  // Get a node from the node pool.
  Ast.prototype.node = function node(nid) {
    const n = JSON.parse(JSON.stringify(this.nodePool[nid]));
    for (let i = 0; i < n.args.length; i++) {
      // If string, then not a nid.
      if (typeof n.args[i] !== 'string') {
        n.args[i] = this.node(n.args[i]);
      }
    }
    return n;
  };

  // Dump the contents of the node pool.
  Ast.prototype.dumpAll = function dumpAll() {
    let s = '';
    this.nodePool.forEach((n, i) => {
      s += `\n${i}: ${Ast.dump(n)}`;
    });
    return s;
  };

  // Dump the contents of a node.
  Ast.dump = Ast.prototype.dump = function dump(n) {
    let s;
    if (typeof n === 'string') {
      s = `"${n}"`;
    } else if (typeof n === 'number') {
      s = n;
    } else {
      s = `{ op: "${n.op}", args: [ `;
      for (let i = 0; i < n.args.length; i++) {
        if (i > 0) {
          s += ' , ';
        }
        s += dump(n.args[i]);
      }
      s += ' ] }';
    }
    return s;
  };

  // Self tests
  const RUN_SELF_TESTS = false;
  function test() {
  }
  if (RUN_SELF_TESTS) {
    test();
  }

  return Ast;
})();
