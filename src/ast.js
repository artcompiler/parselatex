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

  Construct new nodes using the following forms:
    ast.create("+").arg(10).arg(20);
    ast.create("+", [10, 20]);
    ast.create({op: "+", args: [10, 20]});

  Node manipulation functions are chainable.

 */

import { every, forEach } from './backward.js';
import { Assert, assert } from './assert.js';

export const Ast = (function () {
  // Pool of nodes. Shared between all Ast instances.

  function Ast() {
    this.nodePool = ['unused'];
    this.nodeMap = {};
  }

  // Create a node for operation 'op'.
  Ast.prototype.create = function create(op, args) {
    assert(false, 'Should not get here');
    // // Create a node that inherits from Ast
    // let node = create(this);
    // if (typeof op === "string") {
    //   node.op = op;
    //   if (args instanceof Array) {
    //     node.args = args;
    //   } else {
    //     node.args = [];
    //   }
    // } else if (op !== null && typeof op === "object") {
    //   let obj = op;
    //   forEach(keys(obj), function (v, i) {
    //     node[v] = obj[v];
    //   });
    // }
    // return node;
  };

  // Append node to this node's args.
  Ast.prototype.arg = function arg(node) {
    if (!isNode(this)) {
      throw 'Malformed node';
    }
    this.args.push(node);
    return this;
  };

  // Get or set the Nth arg of this node.
  Ast.prototype.argN = function argN(i, node) {
    if (!isNode(this)) {
      throw 'Malformed node';
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
      throw 'Malformed node';
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
    const args_nids = [];
    for (let i = 0; i < count; i++) {
      args += ' ';
      if (typeof node.args[i] === 'string') {
        args += args_nids[i] = node.args[i];
      } else {
        args += args_nids[i] = this.intern(node.args[i]);
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
    if (nid === void 0) {
      this.nodePool.push({
        op,
        args: args_nids,
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
    const ast = this;
    forEach(this.nodePool, (n, i) => {
      s += `\n${i}: ${Ast.dump(n)}`;
    });
    return s;
  };

  // Dump the contents of a node.
  Ast.dump = Ast.prototype.dump = function dump(n) {
    if (typeof n === 'string') {
      const s = `"${n}"`;
    } else if (typeof n === 'number') {
      const s = n;
    } else {
      let s = `{ op: "${n.op}", args: [ `;
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
    (function () {
    }());
  }
  if (RUN_SELF_TESTS) {
    test();
  }

  return Ast;
}());
