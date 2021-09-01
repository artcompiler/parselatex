/*
 * Copyright 2013-2020 ARTCOMPILER INC
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
  This module defines an object model for evaluating and comparing LaTex
  strings. The primary data structure is the Model class. Instances of the
  Model class contain an AST (Ast instance) and zero or more plugins that
  provide functions for evaluating, transforming and comparing models.

  Basic Terms

  Node - a node is a raw JavaScript object that consists of an 'op' property
  that is a string indicating the node type, an 'args' property that is an array
  that holds the operands of the operation, and any other "attribute" properties
  used by plugins to elaborate the mean meaning of the node.

  AST - an AST is an a Node that is an instance of the Ast class. The Ast class
  provides methods for constructing and managing nodes.

  Model - a model is a Node that is an instance of the Model class, which
  inherits from the Ast class. The model class adds methods for creating nodes
  from LaTex strings and rendering them to LaTex strings. Model values are
  configured by Model plugins that implement operations for evaluating,
  transforming and comparing nodes.

  Overview

  Every model object is also a factory for other model objects that share
  the same set of plugins.

    Model.fn.isEquivalent; // register plugin function
    let model = new Model;
    let expected = model.create(options, "1 + 2");
    let actual = model.create(options, response);
    model.isEquivalent(expected, actual);
    expected.isEquivalent(actual);

  When all models in a particular JavaScript sandbox (global scope) use the same
  plugins, those plugins can be registered with the Model class as default
  plugins, as follows:

*/

import {Assert, assert} from "./assert.js";
import {Ast} from "./ast.js";
import {Decimal} from "decimal.js";

export const Model = (function () {

  function Model() {
  }

  const envStack = [];
  let env = {};
  Model.fn = {};
  Model.env = env;

  Model.pushEnv = function pushEnv(e) {
    envStack.push(env);
    Model.env = env = e;
  };

  Model.popEnv = function popEnv() {
    assert(envStack.length > 0, "1000: Empty envStack");
    Model.env = env = envStack.pop();
  };

  function isChemCore() {
    // Has chem symbols so in chem mode.
    return !!Model.env["Au"];
  }

  const Mp = Model.prototype = new Ast();

  // Add messages here
  Assert.reserveCodeRange(1000, 1999, "model");
  Assert.messages[1000] = "Internal error. %1.";
  Assert.messages[1001] = "Invalid syntax. '%1' expected, '%2' found.";
  Assert.messages[1002] = "Only one decimal separator can be specified.";
  Assert.messages[1003] = "Extra characters in input at position: %1, lexeme: %2, prefix: %3.";
  Assert.messages[1004] = "Invalid character '%1' (%2) in input.";
  Assert.messages[1005] = "Misplaced thousands separator.";
  Assert.messages[1006] = "Invalid syntax. Expression expected, %1 found.";
  Assert.messages[1007] = "Unexpected character: '%1' in '%2'.";
  Assert.messages[1008] = "The same character '%1' is being used as a thousands and decimal separators.";
  Assert.messages[1009] = "Missing argument for '%1' command.";
  Assert.messages[1010] = "Expecting an operator between numbers.";
  Assert.messages[1011] = "Invalid grouping bracket. %1";
  Assert.messages[1012] = "Misplaced subscript in '%1'";
  Assert.messages[1013] = "Mismatched thousands separators: \"%1\" and \"%2\".";
  Assert.messages[1014] = "Missing integration variable in '%1'.";
  const message = Assert.message;

  // Create a model from a node object or expression string
  Model.create = Mp.create = function create(options, node, location) {
    assert(node instanceof Array ||
           typeof node === 'object' && (node.op || node instanceof Model) ||
           typeof node === 'string', JSON.stringify(node));
    assert(node != undefined, "1000: Internal error. Node undefined.");
    // If we already have a model, then just return it.
    if (node instanceof Model) {
      if (location) {
        node.location = location;
      }
      return node;
    }
    let model;
    if (node instanceof Array) {
      model = [];
      node.forEach(function (n) {
        model.push(create(options, n, location));
      });
      return model;
    }
    if (!(this instanceof Model)) {
      return new Model().create(options, node, location);
    }
    // Create a node that inherits from Ast.
    model = create(options, this);
    model.location = location;
    if (typeof node === "string") {
      // console.log("mathcore/create() node=" + node);
      // Got a string, so parse it into a node.
      const parser = parse(options, node, Model.env);
      node = parser.expr();
      // console.log("create() node=" + JSON.stringify(node, null, 2));
    } else {
      // Make a deep copy of the node.
      node = JSON.parse(JSON.stringify(node));
    }
    // Add missing plugin functions to the Model prototype.
    Object.keys(Model.fn).forEach(v => {
      if (!Mp[v]) {
        Mp[v] = function () {
          const fn = Model.fn[v];
          if (arguments.length > 1 &&
              arguments[1] instanceof Model) {
            return fn.apply(this, arguments);
          } else {
            const args = [this];
            for (let i = 0; i < arguments.length; i++) {
              args.push(arguments[i]);
            }
            return fn.apply(this, args);
          }
        };
      }
    });
    // Now copy the node's properties into the model object.
    Object.keys(node).forEach(v => {
      model[v] = node[v];
    });
    return model;
  };

  // Create a Model node from LaTex source.
  Model.fromLaTeX = Mp.fromLaTeX = function fromLaTeX(options, src) {
    assert(typeof src === "string", "1000: Model.prototype.fromLaTex");
    if (!this) {
      return Model.create(options, src);
    }
    return this.create(options, src);
  };

  // Render LaTex from the model node.
  Mp.toLaTeX = function toLaTeX(node) {
    return render(node);
  };

  const OpStr = {
    ADD: "+",
    SUB: "-",
    MUL: "mul",
    TIMES: "times",  // Special case for "*" and "\times" in literals.
    COEFF: "coeff",  // Special case for numeric coefficients in literals.
    DIV: "div",
    FRAC: "frac",
    EQL: "=",
    ATAN2: "atan2",
    SQRT: "sqrt",
    VEC: "vec",
    PM: "pm",
    NOT: "not",
    SIN: "sin",
    COS: "cos",
    TAN: "tan",
    SEC: "sec",
    COT: "cot",
    CSC: "csc",
    ARCSIN: "arcsin",
    ARCCOS: "arccos",
    ARCTAN: "arctan",
    ARCSEC: "arcsec",
    ARCCOT: "arccot",
    ARCCSC: "arccsc",
    SINH: "sinh",
    COSH: "cosh",
    TANH: "tanh",
    SECH: "sech",
    COTH: "coth",
    CSCH: "csch",
    ARCSINH: "arcsinh",
    ARCCOSH: "arccosh",
    ARCTANH: "arctanh",
    ARCSECH: "arcsech",
    ARCCSCH: "arccsch",
    ARCCOTH: "arccoth",
    LOG: "log",
    LN: "ln",
    LG: "lg",
    VAR: "var",
    TEXT: "text",
    NUM: "num",
    CST: "cst",
    COMMA: ",",
    POW: "^",
    SUBSCRIPT: "_",
    ABS: "abs",
    PAREN: "()",
    BRACE: "{}",
    BRACKET: "[]",
    ANGLEBRACKET: "anglebracket",
    HIGHLIGHT: "hi",
    LT: "lt",
    LE: "le",
    GT: "gt",
    GE: "ge",
    NE: "ne",
    NGTR: "ngtr",
    NLESS: "nless",
    NI: "ni",
    SUBSETEQ: "subseteq",
    SUPSETEQ: "supseteq",
    SUBSET: "subset",
    SUPSET: "supset",
    NNI: "nni",
    NSUBSETEQ: "nsubseteq",
    NSUPSETEQ: "nsupseteq",
    NSUBSET: "nsubset",
    NSUPSET: "nsupset",
    APPROX: "approx",
    IMPLIES: "implies",
    CAPRIGHTARROW: "caprightarrow",
    RIGHTARROW: "rightarrow",
    LEFTARROW: "leftarrrow",
    LONGRIGHTARROW: "longrightarrow",
    LONGLEFTARROW: "longleftarrow",
    OVERRIGHTARROW: "overrightarrow",
    OVERLEFTARROW: "overleftarrow",
    CAPLEFTRIGHTARROW: "capleftrightarrow",
    LEFTRIGHTARROW: "leftrightarrow",
    LONGLEFTRIGHTARROW: "longleftrightarrow",
    OVERLEFTRIGHTARROW: "overleftrightarrow",
    PERP: "perp",
    PROPTO: "propto",
    PARALLEL: "parallel",
    NPARALLEL: "nparallel",
    SIM: "sim",
    CONG: "cong",
    INTERVAL: "interval",
    INTERVALOPEN: "intervalopen",
    INTERVALLEFTOPEN: "intervalleftopen",
    INTERVALRIGHTOPEN: "intervalrightopen",
    EVALAT: "eval-at",
    LIST: "list",
    SET: "set",
    EXISTS: "exists",
    IN: "in",
    FORALL: "forall",
    LIM: "lim",
    EXP: "exp",
    TO: "to",
    SUM: "sum",
    DERIV: "deriv",
    PIPE: "pipe",
    INTEGRAL: "integral",
    PROD: "prod",
    CUP: "cup",
    BIGCUP: "bigcup",
    CAP: "cap",
    BIGCAP: "bigcap",
    PERCENT: "%",
    QMARK: "?",
    M: "M",
    FACT: "fact",
    BINOM: "binom",
    ROW: "row",
    COL: "col",
    COLON: "colon",
    MATRIX: "matrix",
    TYPE: "type",
    FORMAT: "format",
    OVERSET: "overset",
    UNDERSET: "underset",
    OVERLINE: "overline",
    DEGREE: "degree",
    BACKSLASH: "backslash",
    MATHBF: "mathbf",
    CDOT: "cdot",
    MATHFIELD: "mathfield",
    DELTA: "delta",
    OPERATORNAME: "operatorname",
    DOT: "dot",
    NONE: "none",
  };

  Object.keys(OpStr).forEach(v => {
    Model[v] = OpStr[v];
  });

  const OpToLaTeX = {};
  OpToLaTeX[OpStr.ADD] = "+";
  OpToLaTeX[OpStr.SUB] = "-";
  OpToLaTeX[OpStr.MUL] = "\\times";
  OpToLaTeX[OpStr.DIV] = "\\div";
  OpToLaTeX[OpStr.FRAC] = "\\frac";
  OpToLaTeX[OpStr.EQL] = "=";
  OpToLaTeX[OpStr.ATAN2] = "\\atan2";
  OpToLaTeX[OpStr.POW] = "^";
  OpToLaTeX[OpStr.SUBSCRIPT] = "_";
  OpToLaTeX[OpStr.PM] = "\\pm";
  OpToLaTeX[OpStr.NOT] = "\\not";
  OpToLaTeX[OpStr.SIN] = "\\sin";
  OpToLaTeX[OpStr.COS] = "\\cos";
  OpToLaTeX[OpStr.TAN] = "\\tan";
  OpToLaTeX[OpStr.SEC] = "\\sec";
  OpToLaTeX[OpStr.COT] = "\\cot";
  OpToLaTeX[OpStr.CSC] = "\\csc";
  OpToLaTeX[OpStr.ARCSIN] = "\\arcsin";
  OpToLaTeX[OpStr.ARCCOS] = "\\arccos";
  OpToLaTeX[OpStr.ARCTAN] = "\\arctan";
  OpToLaTeX[OpStr.ARCSEC] = "\\arcsec";
  OpToLaTeX[OpStr.ARCCOT] = "\\arccot";
  OpToLaTeX[OpStr.ARCCSC] = "\\arccsc";
  OpToLaTeX[OpStr.SEC] = "\\sec";
  OpToLaTeX[OpStr.COT] = "\\cot";
  OpToLaTeX[OpStr.CSC] = "\\csc";
  OpToLaTeX[OpStr.SINH] = "\\sinh";
  OpToLaTeX[OpStr.COSH] = "\\cosh";
  OpToLaTeX[OpStr.TANH] = "\\tanh";
  OpToLaTeX[OpStr.ARCSINH] = "\\arcsinh";
  OpToLaTeX[OpStr.ARCCOSH] = "\\arccosh";
  OpToLaTeX[OpStr.ARCTANH] = "\\arctanh";
  OpToLaTeX[OpStr.ARCSECH] = "\\arcsech";
  OpToLaTeX[OpStr.ARCCSCH] = "\\arccsch";
  OpToLaTeX[OpStr.ARCCOTH] = "\\arccoth";
  OpToLaTeX[OpStr.SECH] = "\\sech";
  OpToLaTeX[OpStr.COTH] = "\\coth";
  OpToLaTeX[OpStr.CSCH] = "\\csch";
  OpToLaTeX[OpStr.LN] = "\\ln";
  OpToLaTeX[OpStr.COMMA] = ",";
  OpToLaTeX[OpStr.M] = "\\M";
  OpToLaTeX[OpStr.BINOM] = "\\binom";
  OpToLaTeX[OpStr.COLON] = "\\colon";
  OpToLaTeX[OpStr.INT] = "\\int";

  Model.fold = function fold(node, env) {
    const args = [];
    let val;
    node.args.forEach(function (n) {
      args.push(fold(n, env));
    });
    node.args = args;
    switch (node.op) {
    case OpStr.VAR:
      if ((val = env[node.args[0]])) {
        node = val;  // Replace var node with its value.
      }
      break;
    default:
      // Nothing to fold.
      break;
    }
    return node;
  };

  function isControlCharCode(c) {
    return (
      c >= 0x0001 && c <= 0x001F && c !== 0x0009 ||
        c >= 0x007F && c <= 0x009F
    );
  }
  function isListBreakToken(tk) {
    return (
      tk === TK_RIGHTPAREN ||
        tk === TK_RIGHTBRACE ||
        tk === TK_RIGHTBRACKET ||
        tk === TK_RANGLE ||
        tk === TK_NEWROW ||
        tk === TK_NEWCOL ||
        tk === TK_END ||
        tk === TK_NONE
    );
  }
  function stripInvisible(src) {
    let out = "";
    let c, lastCharCode;
    let curIndex = 0;
    while(curIndex < src.length) {
      while (curIndex < src.length && isInvisibleCharCode((c = src.charCodeAt(curIndex++)))) {
        if (lastCharCode === 32) {
          // Replace N invisible char with one space char.
          continue;
        }
        c = 9;
        lastCharCode = c;
      }
      if (c === 92) {
        // Backslash.
        out += String.fromCharCode(c);
        if (curIndex < src.length) {
          // Keep next character if not out of chars.
          c = src.charCodeAt(curIndex++);
        }
      }
      out += String.fromCharCode(c);
    }
    return out;
  }
  function isInvisibleCharCode(c) {
    return isControlCharCode(c);
  }
  function isWhitespaceCharCode(c) {
    return (
      c === 32 ||
        c === 9  ||
        c === 10 ||
        c === 13
    );
  }
  function isNumberCharCode(c) {
    return (
      c >= 48 && c <= 57
    );
  }
  // Render AST to LaTeX
  const render = function render(n) {
    let text = "";
    if (typeof n === "string") {
      text = n;
    } else if (typeof n === "number") {
      text = n;
    } else if (typeof n === "object") {
      // Render sub-expressions.
      const args = [];
      for (let i = 0; i < n.args.length; i++) {
        args[i] = render(n.args[i]);
      }
      // Render operator.
      switch (n.op) {
      case OpStr.NUM:
        text = n.args[0];
        break;
      case OpStr.VAR:
      case OpStr.TEXT:
        text = "\\text{" + args[0] + "}";
        break;
      case OpStr.CST:
        text = " " + n.args[0] + " ";
        break;
      case OpStr.SUB:
        if (n.args.length === 1) {
          text = OpToLaTeX[n.op] + "" + args[0];
        } else {
          text = args[0] + " " + OpToLaTeX[n.op] + " " + args[1];
        }
        break;
      case OpStr.DIV:
      case OpStr.PM:
      case OpStr.EQL:
        text = args[0] + " " + OpToLaTeX[n.op] + " " + args[1];
        break;
      case OpStr.POW: {
        // If subexpr is lower precedence, wrap in parens.
        const lhs = n.args[0];
        const rhs = n.args[1];
        if ((lhs.args && lhs.args.length === 2) || (rhs.args && rhs.args.length === 2)) {
          if (lhs.op === OpStr.ADD || lhs.op === OpStr.SUB ||
              lhs.op === OpStr.MUL || lhs.op === OpStr.DIV ||
              lhs.op === OpStr.SQRT) {
            args[0] = " (" + args[0] + ") ";
          }
        }
        text = "{" + args[0] + "^{" + args[1] + "}}";
        break;
      }
      case OpStr.SIN:
      case OpStr.COS:
      case OpStr.TAN:
      case OpStr.ARCSIN:
      case OpStr.ARCCOS:
      case OpStr.ARCTAN:
      case OpStr.ARCSEC:
      case OpStr.ARCCSC:
      case OpStr.ARCCOT:
      case OpStr.SEC:
      case OpStr.COT:
      case OpStr.CSC:
      case OpStr.SINH:
      case OpStr.COSH:
      case OpStr.TANH:
      case OpStr.ARCSINH:
      case OpStr.ARCCOSH:
      case OpStr.ARCTANH:
      case OpStr.ARCSECH:
      case OpStr.ARCCSCH:
      case OpStr.ARCCOTH:
      case OpStr.SECH:
      case OpStr.COTH:
      case OpStr.CSCH:
      case OpStr.LN:
      case OpStr.M:
        text = "{" + OpToLaTeX[n.op] + "{" + args[0] + "}}";
        break;
      case OpStr.FRAC:
        text = "\\frac{" + args[0] + "}{" + args[1] + "}";
        break;
      case OpStr.BINOM:
        text = "\\binom{" + args[0] + "}{" + args[1] + "}";
        break;
      case OpStr.SQRT:
        switch (args.length) {
        case 1:
          text = "\\sqrt{" + args[0] + "}";
          break;
        case 2:
          text = "\\sqrt[" + args[0] + "]{" + args[1] + "}";
          break;
        }
        break;
      case OpStr.INT:
        text = "\\int " + args[0];
        break;
      case OpStr.VEC:
        text = "\\vec{" + args[0] + "}";
        break;
      case OpStr.MUL:
      case OpStr.TIMES: {
        // If subexpr is lower precedence, wrap in parens.
        let prevTerm;
        text = "";
        n.args.forEach(function (term, index) {
          if (term.args && (term.args.length >= 2)) {
            if (term.op === OpStr.ADD || term.op === OpStr.SUB) {
              args[index] = "(" + args[index] + ")";
            }
            if (index !== 0 && typeof term === "number") {
              text += OpToLaTeX[n.op] + " ";
            } else if (n.isMixedNumber) {
              // Do nothing. Implicit plus.
            } else if (n.isScientific) {
              text += "\\times ";
            }
            text += args[index];
          }
          // Elide the times symbol if rhs is parenthesized or a var, or lhs is a number
          // nd rhs is not a number.
          else if (term.op === OpStr.PAREN ||
               term.op === OpStr.VAR ||
               term.op === OpStr.CST ||
               typeof prevTerm === "number" && typeof term !== "number") {
            text += args[index];
          }
          else {
            if (index !== 0) {
              text += " " + OpToLaTeX[n.op] + " ";
            }
            text += args[index];
          }
          prevTerm = term;
        });
        break;
      }
      case OpStr.ADD:
      case OpStr.COMMA:
        args.forEach(function (value, index) {
          if (index === 0) {
            text = value;
          } else {
            text = text + " " + OpToLaTeX[n.op] + " " + value;
          }
        });
        break;
      case OpStr.NONE:
        text = "";
        break;
      default:
        assert(false, "1000: Unimplemented operator translating to LaTeX: " + n.op);
        break;
      }
    }
    else {
      assert(false, "1000: Invalid expression type");
    }
    return text;
  };

  // Character defines.
  const CC_SPACE = 0x20;
  const CC_BANG = 0x21;
  const CC_DOLLAR = 0x24;
  const CC_PERCENT = 0x25;
  const CC_LEFTPAREN = 0x28;
  const CC_MUL = 0x2A;
  const CC_ADD = 0x2B;
  const CC_COMMA = 0x2C;
  const CC_SUB = 0x2D;
  const CC_RIGHTPAREN = 0x29;
  const CC_PERIOD = 0x2E;
  const CC_SLASH = 0x2F;
  const CC_NUM = 0x30;
  const CC_COLON = 0x3A;
  const CC_SEMICOLON = 0x3B;
  const CC_EQL = 0x3D;
  const CC_QMARK = 0x3F;
  const CC_CONST = 0x41;
  const CC_LEFTBRACKET = 0x5B;
  const CC_RIGHTBRACKET = 0x5D;
  const CC_CARET = 0x5E;
  const CC_UNDERSCORE = 0x5F;
  const CC_VAR = 0x61;
  const CC_LEFTBRACE = 0x7B;
  const CC_VERTICALBAR = 0x7C;
  const CC_RIGHTBRACE = 0x7D;
  const CC_SINGLEQUOTE = 0x27;

  // Token defines.
  const TK_NONE = 0;
  const TK_ADD = CC_ADD;
  const TK_CARET = CC_CARET;
  const TK_UNDERSCORE = CC_UNDERSCORE;
  const TK_PERIOD = CC_PERIOD;
  const TK_COS = 0x105;
  const TK_COT = 0x108;
  const TK_CSC = 0x109;
  const TK_FRAC = 0x100;
  const TK_SLASH = CC_SLASH;
  const TK_EQL = CC_EQL;
  const TK_LN = 0x107;
  const TK_LEFTBRACE = CC_LEFTBRACE;
  const TK_VERTICALBAR = CC_VERTICALBAR;
  const TK_LEFTBRACKET = CC_LEFTBRACKET;
  const TK_LEFTPAREN = CC_LEFTPAREN;
  const TK_MUL = CC_MUL;
  const TK_NUM = CC_NUM;
  const TK_PM = 0x102;
  const TK_RIGHTBRACE = CC_RIGHTBRACE;
  const TK_RIGHTBRACKET = CC_RIGHTBRACKET;
  const TK_RIGHTPAREN = CC_RIGHTPAREN;
  const TK_SEC = 0x106;
  const TK_SIN = 0x103;
  const TK_SQRT = 0x101;
  const TK_SUB = CC_SUB;
  const TK_TAN = 0x104;
  const TK_VAR = CC_VAR;
  const TK_CONST = CC_CONST;
  const TK_COMMA = CC_COMMA;
  const TK_PERCENT = CC_PERCENT;
  const TK_QMARK = CC_QMARK;
  const TK_BANG = CC_BANG;
  const TK_COLON = CC_COLON;
  const TK_SEMICOLON = CC_SEMICOLON;
  const TK_LG = 0x10B;
  const TK_LOG = 0x10C;
  const TK_TEXT = 0x10D;
  const TK_LT = 0x10E;
  const TK_LE = 0x10F;
  const TK_GT = 0x110;
  const TK_GE = 0x111;
  const TK_EXISTS = 0x112;
  const TK_IN = 0x113;
  const TK_FORALL = 0x114;
  const TK_LIM = 0x115;
  const TK_EXP = 0x116;
  const TK_TO = 0x117;
  const TK_SUM = 0x118;
  const TK_INT = 0x119;
  const TK_PROD = 0x11A;
  const TK_M = 0x11B;
  const TK_RIGHTARROW = 0x11C;
  const TK_BINOM = 0x11D;
  const TK_NEWROW = 0x11E;
  const TK_NEWCOL = 0x11F;
  const TK_BEGIN = 0x120;
  const TK_END = 0x121;
  const TK_VEC = 0x122;
  const TK_ARCSIN = 0x123;
  const TK_ARCCOS = 0x124;
  const TK_ARCTAN = 0x125;
  const TK_DIV = 0x126;
  const TK_TYPE = 0x127;
  const TK_OVERLINE = 0x128;
  const TK_OVERSET = 0x129;
  const TK_UNDERSET = 0x12A;
  const TK_BACKSLASH = 0x12B;
  const TK_MATHBF = 0x12C;
  const TK_NE = 0x12D;
  const TK_APPROX = 0x12E;
  const TK_ABS = 0x12F;
  const TK_CDOT = 0x130;
  const TK_NGTR = 0x131;
  const TK_NLESS = 0x132;
  const TK_SINH = 0x133;
  const TK_COSH = 0x134;
  const TK_TANH = 0x135;
  const TK_SECH = 0x136;
  const TK_COTH = 0x137;
  const TK_CSCH = 0x138;
  const TK_ARCSINH = 0x139;
  const TK_ARCCOSH = 0x13A;
  const TK_ARCTANH = 0x13B;
  const TK_FORMAT = 0x14C;
  const TK_NI = 0x14D;
  const TK_ARCSECH = 0x14E;
  const TK_ARCCSCH = 0x14F;
  const TK_ARCCOTH = 0x150;
  const TK_ARCSEC = 0x151;
  const TK_ARCCSC = 0x152;
  const TK_ARCCOT = 0x153;
  const TK_MATHFIELD = 0x154;
  const TK_CUP = 0x155;
  const TK_BIGCUP = 0x156;
  const TK_CAP = 0x157;
  const TK_BIGCAP = 0x158;
  const TK_PERP = 0x159;
  const TK_PROPTO = 0x15A;
  const TK_SUBSETEQ = 0x15B;
  const TK_SUPSETEQ = 0x15C;
  const TK_SUBSET = 0x15D;
  const TK_SUPSET = 0x15E;
  const TK_NOT = 0x15F;
  const TK_PARALLEL = 0x160;
  const TK_NPARALLEL = 0x161;
  const TK_SIM = 0x162;
  const TK_CONG = 0x163;
  const TK_LEFTARROW = 0x164;
  const TK_LONGRIGHTARROW = 0x165;
  const TK_LONGLEFTARROW = 0x166;
  const TK_OVERRIGHTARROW = 0x167;
  const TK_OVERLEFTARROW = 0x168;
  const TK_LONGLEFTRIGHTARROW = 0x169;
  const TK_OVERLEFTRIGHTARROW = 0x16A;
  const TK_IMPLIES = 0x16B;
  const TK_LEFTRIGHTARROW = 0x16C;
  const TK_CAPLEFTRIGHTARROW = 0x16D;
  const TK_CAPRIGHTARROW = 0x16E;
  const TK_DELTA = 0x16F;
  const TK_OPERATORNAME = 0x170;
  const TK_LEFTCMD = 0x171;
  const TK_RIGHTCMD = 0x172;
  const TK_LEFTBRACESET = 0x173;
  const TK_RIGHTBRACESET = 0x174;
  const TK_TIMES = 0x175;
  const TK_INFTY = 0x176;
  const TK_LANGLE = 0x177;
  const TK_RANGLE = 0x178;
  const TK_DOT = 0x179;

  // Define mapping from token to operator
  const tokenToOperator = {};
  tokenToOperator[TK_SLASH] = OpStr.FRAC;
  tokenToOperator[TK_FRAC] = OpStr.FRAC;
  tokenToOperator[TK_SQRT] = OpStr.SQRT;
  tokenToOperator[TK_VEC] = OpStr.VEC;
  tokenToOperator[TK_ADD] = OpStr.ADD;
  tokenToOperator[TK_SUB] = OpStr.SUB;
  tokenToOperator[TK_PM] = OpStr.PM;
  tokenToOperator[TK_NOT] = OpStr.NOT;
  tokenToOperator[TK_CARET] = OpStr.POW;
  tokenToOperator[TK_UNDERSCORE] = OpStr.SUBSCRIPT;
  tokenToOperator[TK_MUL] = OpStr.MUL;
  tokenToOperator[TK_CDOT] = OpStr.CDOT;
  tokenToOperator[TK_TIMES] = OpStr.TIMES;
  tokenToOperator[TK_DIV] = OpStr.DIV;
  tokenToOperator[TK_SIN] = OpStr.SIN;
  tokenToOperator[TK_COS] = OpStr.COS;
  tokenToOperator[TK_TAN] = OpStr.TAN;
  tokenToOperator[TK_ARCSIN] = OpStr.ARCSIN;
  tokenToOperator[TK_ARCCOS] = OpStr.ARCCOS;
  tokenToOperator[TK_ARCTAN] = OpStr.ARCTAN;
  tokenToOperator[TK_ARCSEC] = OpStr.ARCSEC;
  tokenToOperator[TK_ARCCSC] = OpStr.ARCCSC;
  tokenToOperator[TK_ARCCOT] = OpStr.ARCCOT;
  tokenToOperator[TK_SEC] = OpStr.SEC;
  tokenToOperator[TK_COT] = OpStr.COT;
  tokenToOperator[TK_CSC] = OpStr.CSC;
  tokenToOperator[TK_SINH] = OpStr.SINH;
  tokenToOperator[TK_COSH] = OpStr.COSH;
  tokenToOperator[TK_TANH] = OpStr.TANH;
  tokenToOperator[TK_ARCSINH] = OpStr.ARCSINH;
  tokenToOperator[TK_ARCCOSH] = OpStr.ARCCOSH;
  tokenToOperator[TK_ARCTANH] = OpStr.ARCTANH;
  tokenToOperator[TK_ARCSECH] = OpStr.ARCSECH;
  tokenToOperator[TK_ARCCSCH] = OpStr.ARCCSCH;
  tokenToOperator[TK_ARCCOTH] = OpStr.ARCCOTH;
  tokenToOperator[TK_SECH] = OpStr.SECH;
  tokenToOperator[TK_COTH] = OpStr.COTH;
  tokenToOperator[TK_CSCH] = OpStr.CSCH;
  tokenToOperator[TK_LN] = OpStr.LN;
  tokenToOperator[TK_LG] = OpStr.LG;
  tokenToOperator[TK_LOG] = OpStr.LOG;
  tokenToOperator[TK_EQL] = OpStr.EQL;
  tokenToOperator[TK_COMMA] = OpStr.COMMA;
  tokenToOperator[TK_TEXT] = OpStr.TEXT;
  tokenToOperator[TK_OPERATORNAME] = OpStr.OPERATORNAME;
  tokenToOperator[TK_LT] = OpStr.LT;
  tokenToOperator[TK_LE] = OpStr.LE;
  tokenToOperator[TK_GT] = OpStr.GT;
  tokenToOperator[TK_GE] = OpStr.GE;
  tokenToOperator[TK_NE] = OpStr.NE;
  tokenToOperator[TK_NGTR] = OpStr.NGTR;
  tokenToOperator[TK_NLESS] = OpStr.NLESS;
  tokenToOperator[TK_NI] = OpStr.NI;
  tokenToOperator[TK_SUBSETEQ] = OpStr.SUBSETEQ;
  tokenToOperator[TK_SUPSETEQ] = OpStr.SUPSETEQ;
  tokenToOperator[TK_SUBSET] = OpStr.SUBSET;
  tokenToOperator[TK_SUPSET] = OpStr.SUPSET;
  tokenToOperator[TK_APPROX] = OpStr.APPROX;
  tokenToOperator[TK_PERP] = OpStr.PERP;
  tokenToOperator[TK_PROPTO] = OpStr.PROPTO;
  tokenToOperator[TK_PARALLEL] = OpStr.PARALLEL;
  tokenToOperator[TK_NPARALLEL] = OpStr.NPARALLEL;
  tokenToOperator[TK_SIM] = OpStr.SIM;
  tokenToOperator[TK_CONG] = OpStr.CONG;
  tokenToOperator[TK_EXISTS] = OpStr.EXISTS;
  tokenToOperator[TK_IN] = OpStr.IN;
  tokenToOperator[TK_FORALL] = OpStr.FORALL;
  tokenToOperator[TK_LIM] = OpStr.LIM;
  tokenToOperator[TK_EXP] = OpStr.EXP;
  tokenToOperator[TK_TO] = OpStr.TO;
  tokenToOperator[TK_VERTICALBAR] = OpStr.PIPE;
  tokenToOperator[TK_SUM] = OpStr.SUM;
  tokenToOperator[TK_INT] = OpStr.INTEGRAL;
  tokenToOperator[TK_PROD] = OpStr.PROD;
  tokenToOperator[TK_CUP] = OpStr.CUP;
  tokenToOperator[TK_BIGCUP] = OpStr.BIGCUP;
  tokenToOperator[TK_CAP] = OpStr.CAP;
  tokenToOperator[TK_BIGCAP] = OpStr.BIGCAP;
  tokenToOperator[TK_M] = OpStr.M;
  tokenToOperator[TK_IMPLIES] = OpStr.IMPLIES;
  tokenToOperator[TK_CAPRIGHTARROW] = OpStr.CAPRIGHTARROW;
  tokenToOperator[TK_RIGHTARROW] = OpStr.RIGHTARROW;
  tokenToOperator[TK_LEFTARROW] = OpStr.LEFTARROW;
  tokenToOperator[TK_LONGRIGHTARROW] = OpStr.LONGRIGHTARROW;
  tokenToOperator[TK_LONGLEFTARROW] = OpStr.LONGLEFTARROW;
  tokenToOperator[TK_OVERRIGHTARROW] = OpStr.OVERRIGHTARROW;
  tokenToOperator[TK_OVERLEFTARROW] = OpStr.OVERLEFTARROW;
  tokenToOperator[TK_LEFTRIGHTARROW] = OpStr.LEFTRIGHTARROW;
  tokenToOperator[TK_CAPLEFTRIGHTARROW] = OpStr.CAPLEFTRIGHTARROW;
  tokenToOperator[TK_LONGLEFTRIGHTARROW] = OpStr.LONGLEFTRIGHTARROW;
  tokenToOperator[TK_OVERLEFTRIGHTARROW] = OpStr.OVERLEFTRIGHTARROW;

  tokenToOperator[TK_BANG] = OpStr.FACT;
  tokenToOperator[TK_BINOM] = OpStr.BINOM;
  tokenToOperator[TK_NEWROW] = OpStr.ROW;
  tokenToOperator[TK_NEWCOL] = OpStr.COL;
  tokenToOperator[TK_COLON] = OpStr.COLON;
  tokenToOperator[TK_SEMICOLON] = OpStr.SEMICOLON;
  tokenToOperator[TK_TYPE] = OpStr.TYPE;
  tokenToOperator[TK_OVERLINE] = OpStr.OVERLINE;
  tokenToOperator[TK_DOT] = OpStr.DOT;
  tokenToOperator[TK_OVERSET] = OpStr.OVERSET;
  tokenToOperator[TK_UNDERSET] = OpStr.UNDERSET;
  tokenToOperator[TK_BACKSLASH] = OpStr.BACKSLASH;
  tokenToOperator[TK_MATHBF] = OpStr.MATHBF;
  tokenToOperator[TK_MATHFIELD] = OpStr.MATHFIELD;
  tokenToOperator[TK_DELTA] = OpStr.DELTA;

  function newNode(op, args) {
    return {
      op: op,
      args: args
    };
  }

  const nodeEmpty = newNode(Model.NONE, [newNode(Model.VAR, ["None"])]);

  const parse = function parse(options, src, env) {
    src = stripInvisible(src);
    function matchThousandsSeparator(ch, lastSeparator) {
      // Check separator and return if there is a match.
      let match = '';
      if (Model.option(options, "allowThousandsSeparator") || Model.option(options, "setThousandsSeparator")) {
        let separators = Model.option(options, "setThousandsSeparator");
        separators = [].concat(separators !== undefined ? separators : ',');
        // If the character matches the last separator or, if not, last is undefined
        // and character is in the provided list, return the character.
        if (separators.indexOf(ch) >= 0) {
          assert(!lastSeparator || ch === lastSeparator, message(1013, [lastSeparator, ch]));
          match = ch;
        }
      }
      return match;
    }

    function matchDecimalSeparator(ch) {
      // We use the thousands separator to determine the conventional decimal
      // separator. If TS is ',' then DS is '.', otherwise DS is ','.
      const decimalSeparator = Model.option(options, "setDecimalSeparator");
      const thousandsSeparators = Model.option(options, "setThousandsSeparator");
      if (typeof decimalSeparator === "string") {
        // Single separator.
        assert(decimalSeparator.length === 1, message(1002));
        const separator = decimalSeparator;
        if (thousandsSeparators instanceof Array &&
            thousandsSeparators.indexOf(separator) >= 0) {
          // There is a conflict between the decimal separator and the
          // thousands separator.
          assert(false, message(1008, [separator]));
        }
        return ch === separator;
      }
      if (decimalSeparator instanceof Array) {
        // Multiple separators.
        decimalSeparator.forEach(function (separator) {
          if (thousandsSeparators instanceof Array &&
              thousandsSeparators.indexOf(separator) >= 0) {
            // There is a conflict between the decimal separator and the
            // thousands separator.
            assert(false, message(1008, [separator]));
          }
        });
        return decimalSeparator.indexOf(ch) >= 0;
      }
      if (thousandsSeparators instanceof Array && thousandsSeparators.indexOf('.') >= 0 || thousandsSeparators === '.') {
        // Period is used as a thousands separator, so cannot be used as a
        // decimal separator.
        assert(decimalSeparator === undefined, message(1008, ['.']));
        return ch === ',';
      }
      // Otherwise, period is used as the decimal separator.
      return ch === ".";
    }

    const nodePositiveInfinity = newNode(Model.NUM, ["Infinity"]);
    // Construct a number node.
    function numberNode(options, n0, doScale, roundOnly) {
      if (n0 === '\\infty') {
        return nodePositiveInfinity;
      }
      // doScale - scale n if true
      // roundOnly - only scale if rounding
      let n2 = "";
      let i, ch;
      let lastSeparatorIndex;
      let separatorCount = 0;
      let numberFormat = "integer";
      if (n0 === ".") {
        assert(false, message(1004, [n0, n0.charCodeAt(0)]));
      }
      for (i = 0; i < n0.length; i++) {
        if (matchThousandsSeparator(ch = n0.charAt(i))) {
          if (separatorCount && lastSeparatorIndex !== i - 4 ||
              !separatorCount && i > 4) {
            assert(false, message(1005));
          }
          lastSeparatorIndex = i;
          separatorCount++;
          // We erase separators so 1,000 and 1000 are equivLiteral.
        } else {
          if (matchDecimalSeparator(ch)) {
            if (numberFormat === "decimal") {
              assert(false, message(1007, [ch, n2 + ch]));
            }
            ch = '.';  // Convert to character the decimal agrees with.
            numberFormat = "decimal";
            if (separatorCount && lastSeparatorIndex !== i - 4) {
              assert(false, message(1005));
            }
            lastSeparatorIndex = i;  // Used for thousandths separators.
            separatorCount++;
          }
          n2 += ch;
        }
      }
      if (numberFormat !== "decimal" && lastSeparatorIndex && lastSeparatorIndex !== i - 4) {
        // If we haven't seen a decimal separator, then make sure the last thousands
        // separator is in the right place.
        assert(false, message(1005));
      }
      if (doScale) {
        const scale = Model.option(options, "decimalPlaces");
        if (!roundOnly || n2.scale() > scale) {
          n2 = n2.setScale(scale, Decimal.ROUND_HALF_UP);
          n2 = String(n2);
        }
      } else {
        n2 = String(n2);
      }
      const arg = Model.option(options, "strict") && n0 || n2;
      return {
        op: Model.NUM,
        args: [arg],
        separatorCount: separatorCount,
        lastSeparatorIndex: lastSeparatorIndex,
        numberFormat: numberFormat,
      };
    }
    function multiplyNode(args, flatten) {
      if (args.length === 0) {
        // We have simplified away all factors.
        args = [nodeOne];
      }
      return binaryNode(Model.MUL, args, flatten);
    }
    function unaryNode(op, args) {
      assert(args.length === 1, "1000: Wrong number of arguments for unary node");
      return newNode(op, args);
    }
    function binaryNode(op, args, flatten) {
      assert(args.length > 0, "1000: Too few argument for binary node");
      if (args.length < 2) {
        return args[0];
      }
      let aa = [];
      args.forEach(function(n) {
        if (flatten && n.op === op && n.args.length > 1) {
          // Flatten binary nodes of the same operator, not unaries.
          aa = aa.concat(n.args);
        } else {
          aa.push(n);
        }
      });
      return newNode(op, aa);
    }

    const nodeOne = numberNode(options, "1");
    const nodeMinusOne = numberNode(options, "-1");

    //
    // PARSER
    //
    // Manage the token stream.
    let T0 = TK_NONE;
    let T1 = TK_NONE;
    let lexemeT0, lexemeT1;
    const scan = scanner(src);
    // Prime the token stream.
    function start(options) {
      T0 = scan.start(options);
      lexemeT0 = scan.lexeme(options);
    }
    // Get the current token.
    function hd() {
      return T0;
    }
    // Get the current lexeme.
    function lexeme() {
      assert(lexemeT0 !== undefined, "1000: Lexeme for token T0=" + T0 + " is missing.");
      return lexemeT0;
    }
    // Advance the next token.
    function next(options) {
      if (T1 === TK_NONE) {
        T0 = scan.start(options);
        lexemeT0 = scan.lexeme(options);
      } else {
        assert(lexemeT1 !== undefined, "1000: Lexeme for token=" + T1 + " is missing.");
        T0 = T1;
        lexemeT0 = lexemeT1;
        T1 = TK_NONE;
      }
    }
    function lookahead(options) {
      if (T1 === TK_NONE) {
        T1 = scan.start(options);
        lexemeT1 = scan.lexeme(options);
      }
      return T1;
    }
    // Consume the current token if it matches, otherwise throw.
    function eat(tc, options) {
      const tk = hd();
      if (tk !== tc) {
        const expected = String.fromCharCode(tc);
        const found = tk ? String.fromCharCode(tk) : "EOS";
        assert(false, message(1001, [expected + "[" + tc + "]", found + "[" + tk + "]"]));
      }
      next(options);
    }
    // Begin parsing functions.
    function isSimpleFraction(node) {
      if (node.op === Model.FRAC) {
        const n0 =
            node.args[0].op === Model.SUB && node.args[0].args.length === 1 && node.args[0].args[0] ||
            node.args[0];
        const n1 =
            node.args[1].op === Model.SUB && node.args[1].args.length === 1 && node.args[1].args[0] ||
            node.args[1];
        return (
          n0.op === Model.NUM && n0.numberFormat === "integer" &&
            n1.op === Model.NUM && n1.numberFormat === "integer"
        );
      }
      return false;
    }
    function isProperFraction(node) {
      if (node.op === Model.FRAC) {
        const n0 = node.args[0];
        const n1 = node.args[1];
        return (
          n0.op === Model.NUM && n0.numberFormat === "integer" &&
          n1.op === Model.NUM && n1.numberFormat === "integer" &&
          +n0.args[0] < n1.args[0]
        );
      }
      return false;
    }
    function primaryExpr() {
      let t, node, tk, op, base, args = [], expr, expr1, expr2, foundDX;
      switch ((tk = hd())) {
      case TK_CONST:
      case TK_VAR:
        args = [lexeme(options)];
        next();
        // // Collect the subscript if there is one. Subscripts make multipart variable names.
        // if ((t=hd())===TK_UNDERSCORE) {
        //   next({oneCharToken: true});
        //   args.push(primaryExpr());   // {op:VAR, args:["Fe", "2"]}
        // }
        node = newNode(Model.VAR, args);
        if (isChemCore()) {
          if (hd() === TK_LEFTBRACE && lookahead() === TK_RIGHTBRACE) {
            // C_2{}^3 -> C_2^3
            eat(TK_LEFTBRACE);
            eat(TK_RIGHTBRACE);
          }
        }
        break;
      case TK_TEXT:
        args = [lexeme(options)];
        next();
        node = newNode(Model.TEXT, [newNode(Model.VAR, args)]);
        break;
      case TK_NUM:
        node = numberNode(options, lexeme(options));
        next();
        break;
      case TK_LEFTCMD:   // \left .. \right
        if (lookahead() === TK_LEFTBRACE) {
          node = braceExpr(tk);
        } else if (lookahead() === TK_LEFTBRACESET) {
          node = braceExpr(tk);
        } else if (lookahead() === TK_VERTICALBAR) {
          node = absExpr(tk);
        } else {
          node = parenExpr(tk);
        }
        break;
      case TK_TYPE:
        node = newNode(Model.TYPE, [newNode(Model.VAR, [lexeme(options)])]);
        next();
        break;
      case TK_LEFTBRACKET:
      case TK_LEFTPAREN:
      case TK_LANGLE:
        node = parenExpr(tk);
        break;
      case TK_RIGHTBRACKET:
        if (!inParenExpr) {
          // French style intervals: ][, ]].
          node = parenExpr(tk);
        } else {
          node = nodeEmpty;
        }
        break;
      case TK_LEFTBRACE:
      case TK_LEFTBRACESET:
        node = braceExpr(tk);
        break;
      case TK_BEGIN: {
        next();
        const figure = braceExpr();
        if (figure.op === Model.VAR) {
          if (figure.args[0].indexOf("array") === 0) {
            if (hd() === TK_LEFTBRACE) {
              while (hd() !== TK_RIGHTBRACE) {
                next();  // Eat column alignment header.
              }
              next();
            }
          } else if (figure.args[0].indexOf("matrix") >= 0) {
            if (hd() === TK_LEFTBRACKET) {
              while (hd() !== TK_RIGHTBRACKET) {
                next();  // Eat column alignment header.
              }
              next();
            }
          }
        }
        const tbl = matrixExpr();
        eat(TK_END);
        braceExpr();
        if (figure.op === Model.VAR) {
          if (figure.args[0].indexOf("matrix") >= 0 || figure.args[0].indexOf("array") === 0) {
            node = newNode(Model.MATRIX, [tbl]);
          } else {
            assert(false, "1000: Unrecognized LaTeX name");
          }
        }
        break;
      }
      case TK_VERTICALBAR:
        node = absExpr();
        break;
      case TK_ABS:
        next();
        node = unaryNode(Model.ABS, [braceExpr()]);
        break;
      case TK_FRAC:
        next();
        expr1 = braceExpr();
        expr2 = braceExpr();
        expr1 = expr1.args.length === 0 ? newNode(Model.COMMA, [nodeEmpty]) : expr1;
        expr2 = expr1.args.length === 0 ? newNode(Model.COMMA, [nodeEmpty]) : expr2;
        node = newNode(Model.FRAC, [expr1, expr2]);
        node.isFraction = isSimpleFraction(node);
        break;
      case TK_BINOM: {
        next();
        const n = braceExpr();
        const k = braceExpr();
        // (n k) = \frac{n!}{k!(n-k)!}
        const num = unaryNode(Model.FACT, [n]);
        const den = binaryNode(Model.POW, [
          binaryNode(Model.MUL, [
            unaryNode(Model.FACT, [k]),
            unaryNode(Model.FACT, [binaryNode(Model.ADD, [n, negate(k)])])
          ]),
          nodeMinusOne
        ]);
        node = binaryNode(Model.MUL, [num, den]);
        node.isBinomial = true;
        break;
      }
      case TK_SQRT:
        next();
        switch(hd()) {
        case TK_LEFTBRACKET: {
          const root = bracketExpr();
          const base = braceExpr();
          node = newNode(Model.SQRT, [base, root]);
          break;
        }
        case TK_LEFTBRACE:
          base = braceExpr();
          node = newNode(Model.SQRT, [base, newNode(Model.NUM, ["2"])]);
          break;
        default:
          assert(false, message(1001, ["{ or (", String.fromCharCode(hd())]));
          break;
        }
        break;
      case TK_VEC:
        next();
        node = newNode(Model.VEC, [braceExpr()]);
        break;
      case TK_OPERATORNAME: {
        const lex = lexeme(options);
        next();
        node = newNode(Model.OPERATORNAME, [newNode(Model.VAR, [lex]), primaryExpr()]);
        break;
      }
      case TK_SIN:
      case TK_COS:
      case TK_TAN:
      case TK_SEC:
      case TK_COT:
      case TK_CSC:
      case TK_SINH:
      case TK_COSH:
      case TK_TANH:
      case TK_SECH:
      case TK_COTH:
      case TK_CSCH:
        next();
        // Collect exponents if there are any
        while (hd() === TK_CARET) {
          next({oneCharToken: true});
          args.push(unaryExpr());
        }
        if (args.length === 1 && isMinusOne(args[0])) {
          // Special case for sin^{-1} and friends.
          op = "arc" + tokenToOperator[tk];
          args.pop();  // Erase ^{-1}.
        } else {
          op = tokenToOperator[tk];
        }
        if ((t = hd()) === TK_LEFTCMD) {
          if (lookahead() === TK_LEFTBRACE || lookahead() === TK_LEFTBRACESET) {
            node = braceExpr(t);
          } else if (lookahead() === TK_VERTICALBAR) {
            node = absExpr(t);
          } else {
            node = parenExpr(t);
          }
          args.unshift(newNode(op, [node]));
        } else if ((t = hd()) === TK_LEFTBRACE || t === TK_LEFTBRACESET) {
          args.unshift(newNode(op, [braceExpr(t)]));
        } else if ((t = hd()) === TK_LEFTPAREN || t === TK_LEFTBRACKET) {
          args.unshift(newNode(op, [parenExpr(t)]));
        } else {
          expr = flattenNestedNodes(multiplicativeExpr(true));
          foundDX = hasDX(options, expr);
          expr = foundDX && stripDX(expr) || expr;
          args.unshift(newNode(op, [expr]));
        }
        if (args.length > 1) {
          node = newNode(Model.POW, args);
        } else {
          node = args[0];
        }
        if (foundDX) {
          node = multiplyNode([node, newNode(Model.VAR, ["d"]), foundDX]);
        }
        return node;
      case TK_ARCSIN:
      case TK_ARCCOS:
      case TK_ARCTAN:
      case TK_ARCSEC:
      case TK_ARCCSC:
      case TK_ARCCOT:
      case TK_ARCSINH:
      case TK_ARCCOSH:
      case TK_ARCTANH:
      case TK_ARCSECH:
      case TK_ARCCSCH:
      case TK_ARCCOTH:
        next();
        // Collect exponents if there are any
        while ((t = hd()) === TK_CARET) {
          next({oneCharToken: true});
          args.push(unaryExpr());
        }
        if ((t = hd()) === TK_LEFTCMD) {
          if (lookahead() === TK_LEFTBRACE || lookahead() === TK_LEFTBRACESET) {
            node = braceExpr(t);
          } else if (lookahead() === TK_VERTICALBAR) {
            node = absExpr(t);
          } else {
            node = parenExpr(t);
          }
          args.unshift(newNode(tokenToOperator[tk], [node]));
        } else if ((t = hd()) === TK_LEFTBRACE || t === TK_LEFTBRACESET) {
          args.unshift(newNode(tokenToOperator[tk], [braceExpr(t)]));
        } else if ((t = hd()) === TK_LEFTPAREN || t === TK_LEFTBRACKET) {
          args.unshift(newNode(tokenToOperator[tk], [parenExpr(t)]));
        } else if ((t = hd()) === TK_VERTICALBAR) {
          args.unshift(newNode(tokenToOperator[tk], [absExpr(t)]));
        } else {
          expr = flattenNestedNodes(multiplicativeExpr(true));
          foundDX = hasDX(options, expr);
          expr = foundDX && stripDX(expr) || expr;
          args.unshift(newNode(tokenToOperator[tk], [expr]));
        }
        if (args.length > 1) {
          node = newNode(Model.POW, args);
        } else {
          node = args[0];
        }
        if (foundDX) {
          node = multiplyNode([node, newNode(Model.VAR, ["d"]), foundDX]);
        }
        return node;
      case TK_LN:
        next();
        if ((t = hd()) === TK_LEFTCMD) {
          if (lookahead() === TK_LEFTBRACE || lookahead() === TK_LEFTBRACESET) {
            node = braceExpr(t);
          } else if (lookahead() === TK_VERTICALBAR) {
            node = absExpr(t);
          } else {
            node = parenExpr(t);
          }
          args.push(node);
        } else if ((t = hd()) === TK_LEFTBRACE || t === TK_LEFTBRACESET) {
          args.push(braceExpr(t));
        } else if ((t = hd()) === TK_LEFTPAREN || t === TK_LEFTBRACKET) {
          args.push(parenExpr(t));
        } else if ((t = hd()) === TK_VERTICALBAR) {
          args.push(absExpr(t));
        } else {
          expr = flattenNestedNodes(multiplicativeExpr(true));
          foundDX = hasDX(options, expr);
          expr = foundDX && stripDX(expr) || expr;
          args.push(expr);
        }
        node = newNode(Model.LOG, [newNode(Model.VAR, ["e"])].concat(args));
        if (foundDX) {
          node = multiplyNode([node, newNode(Model.VAR, ["d"]), foundDX]);
        }
        return node;
      case TK_LG:
        next();
        if ((t = hd()) === TK_LEFTCMD) {
          if (lookahead() === TK_LEFTBRACE || lookahead() === TK_LEFTBRACESET) {
            node = braceExpr(t);
          } else if (lookahead() === TK_VERTICALBAR) {
            node = absExpr(t);
          } else {
            node = parenExpr(t);
          }
          args.push(node);
        } else if ((t = hd()) === TK_LEFTBRACE || t === TK_LEFTBRACESET) {
          args.push(braceExpr(t));
        } else if ((t = hd()) === TK_LEFTPAREN || t === TK_LEFTBRACKET) {
          args.push(parenExpr(t));
        } else if ((t = hd()) === TK_VERTICALBAR) {
          args.push(absExpr(t));
        } else {
          expr = flattenNestedNodes(multiplicativeExpr(true));
          foundDX = hasDX(options, expr);
          expr = foundDX && stripDX(expr) || expr;
          args.push(expr);
        }
        node = newNode(Model.LOG, [newNode(Model.NUM, ["10"])].concat(args));
        if (foundDX) {
          node = multiplyNode([node, newNode(Model.VAR, ["d"]), foundDX]);
        }
        return node;
      case TK_LOG:
        next();
        // Collect the subscript if there is one
        if ((t = hd()) === TK_UNDERSCORE) {
          next({oneCharToken:true});
          args.push(primaryExpr());
        } else {
          args.push(newNode(Model.NUM, ["10"]));    // Default to base 10.
        }
        if ((t = hd()) === TK_LEFTCMD) {
          if (lookahead() === TK_LEFTBRACE || lookahead() === TK_LEFTBRACESET) {
            node = braceExpr(t);
          } else if (lookahead() === TK_VERTICALBAR) {
            node = absExpr(t);
          } else {
            node = parenExpr(t);
          }
          args.push(node);
        } else if ((t = hd()) === TK_LEFTBRACE || t === TK_LEFTBRACESET) {
          args.push(braceExpr(t));
        } else if ((t = hd()) === TK_LEFTPAREN || t === TK_LEFTBRACKET) {
          args.push(parenExpr(t));
        } else if ((t = hd()) === TK_VERTICALBAR) {
          args.push(absExpr(t));
        } else {
          expr = flattenNestedNodes(multiplicativeExpr(true));
          foundDX = hasDX(options, expr);
          expr = foundDX && stripDX(expr) || expr;
          args.push(expr);
        }
        node = newNode(Model.LOG, args);
        if (foundDX) {
          node = multiplyNode([node, newNode(Model.VAR, ["d"]), foundDX]);
        }
        return node;
      case TK_LIM:
        return limitExpr();
      case TK_INT:
        return integralExpr();
      case TK_SUM:
      case TK_PROD:
      case TK_CUP:
      case TK_BIGCUP:
      case TK_CAP:
      case TK_BIGCAP:
        next();
        // Collect the subscript and expression.
        if (hd() === TK_UNDERSCORE) {
          next({oneCharToken: true});
          args.push(primaryExpr());
          if (hd() === TK_CARET) {
            eat(TK_CARET, {oneCharToken: true});
            args.push(primaryExpr());
          }
        }
        args.push(commaExpr());
        return newNode(tokenToOperator[tk], args);
      case TK_EXISTS:
        next();
        return newNode(Model.EXISTS, [equalExpr()]);
      case TK_FORALL:
      case TK_CAPRIGHTARROW:
      case TK_RIGHTARROW:
      case TK_LEFTARROW:
      case TK_LONGRIGHTARROW:
      case TK_LONGLEFTARROW:
      case TK_OVERRIGHTARROW:
      case TK_OVERLEFTARROW:
      case TK_CAPLEFTRIGHTARROW:
      case TK_LEFTRIGHTARROW:
      case TK_LONGLEFTRIGHTARROW:
      case TK_OVERLEFTRIGHTARROW:
        next();
        return newNode(tokenToOperator[tk], [commaExpr()]);
      case TK_EXP:
        next();
        return newNode(Model.EXP, [additiveExpr()]);
      case TK_M:
        next();
        return newNode(Model.M, [multiplicativeExpr()]);
      case TK_FORMAT:
        next();
        return newNode(Model.FORMAT, [braceExpr()]);
      case TK_OVERLINE:
        next();
        return newNode(Model.OVERLINE, [braceExpr()]);
      case TK_DOT:
        // 0.\dot{1}234\dot{5}
        next();
        {
          let n, arg = "";
          n = braceExpr();
          assert(n.op === Model.NUM);
          arg += n.args[0];
          if (hd() === TK_NUM && lookahead() === TK_DOT) {
            n = primaryExpr();
            assert(n.op === Model.NUM);
            arg += n.args[0];
          }
          if (hd() === TK_DOT) {
            next();
            n = braceExpr();
            assert(n.op === Model.NUM);
            arg += n.args[0];
          }
          expr = newNode(Model.OVERLINE, [numberNode(options, arg)]);
        }
        return expr;
      case TK_MATHFIELD:
        next();
        return newNode(tokenToOperator[tk], [braceExpr()]);
      case TK_OVERSET:
      case TK_UNDERSET:
        next();
        expr1 = braceExpr();
        expr2 = braceExpr();
        // Add the annotation to the variable.
        expr2.args.push(newNode(tokenToOperator[tk], [expr1]));
        return expr2;
      case TK_MATHBF:
        // Erase this token.
        next();
        expr1 = braceExpr();
        return newNode(Model.MATHBF, [expr1]);
      case TK_QMARK:
        next();
        return newNode(Model.VAR, ["?"]);
      case TK_DELTA: {
        next();
        let name;
        if (hd() === TK_VAR) {
          name = lexeme(options);
          next();
        } else {
          name = "";
        }
        return newNode(Model.VAR, ["Delta_" + name]);
      }
      case TK_PERIOD:
        next();
        return nodeEmpty;
      default:
        assert(!Model.option(options, "strict"), message(1006, [tk]));
        node = nodeEmpty;
        break;
      }
      return node;
    }
    // Parse '1 & 2 & 3 \\ a & b & c'
    function matrixExpr( ) {
      const args = [];
      args.push(rowExpr());
      while (hd() === TK_NEWROW) {
        next();
        args.push(rowExpr());
      }
      return newNode(tokenToOperator[TK_NEWROW], args);
    }
    // Parse '1 & 2 & 3'
    function rowExpr( ) {
      const args = [];
      args.push(commaExpr());
      while (hd() === TK_NEWCOL) {
        next();
        args.push(equalExpr());
      }
      return newNode(tokenToOperator[TK_NEWCOL], args);
    }
    // Parse '| expr |'
    let pipeTokenCount = 0;
    function absExpr(tk) {
      tk = tk || TK_VERTICALBAR;
      pipeTokenCount++;
      eat(tk);
      let tk1, tk2;
      if (tk === TK_LEFTCMD) {
        eat((tk1 = hd())); // Capture left token.
      } else {
        tk1 = tk;
      }
      const e = additiveExpr();
      eat((tk2 = tk === TK_LEFTCMD && TK_RIGHTCMD || tk1));
      if (tk2 === TK_RIGHTCMD) {
        eat((tk2 = tk1)); // Capture right token.
      }
      pipeTokenCount--;
      return unaryNode(Model.ABS, [e]);
    }
    // Parse '{ expr }'
    function braceExpr(tk) {
      tk = tk || TK_LEFTBRACE;
      eat(tk);
      let tk1, tk2;
      if (tk === TK_LEFTCMD) {
        eat((tk1 = hd() === TK_LEFTBRACESET && TK_LEFTBRACESET || TK_LEFTBRACE));
      } else {
        tk1 = tk;
      }
      let e;
      if (hd() === TK_RIGHTCMD || hd() === TK_RIGHTBRACE || hd() === TK_RIGHTBRACESET) {
        eat((tk2 = hd()));
        if (tk2 === TK_RIGHTCMD) {
          eat((tk2 = hd() === TK_PERIOD && TK_PERIOD ||
               hd() === TK_RIGHTBRACESET && TK_RIGHTBRACESET ||
               TK_RIGHTBRACE));
        }
        e = newNode(Model.COMMA, []);
      } else {
        e = commaExpr();
        eat((tk2 = tk === TK_LEFTCMD && TK_RIGHTCMD ||
             tk === TK_LEFTBRACESET && TK_RIGHTBRACESET ||
             TK_RIGHTBRACE));
        if (tk2 === TK_RIGHTCMD) {
          eat((tk2 = hd() === TK_PERIOD && TK_PERIOD ||
               hd() === TK_RIGHTBRACESET && TK_RIGHTBRACESET ||
               TK_RIGHTBRACE));
        }
        if (e.op === nodeEmpty.op && e.args[0] === nodeEmpty.args[0]) {
          // We've got empty braces.
          e = newNode(Model.COMMA, []);
        }
      }
      e.lbrk = tk1;
      e.rbrk = tk2;
      return e;
    }
    // Parse '[ expr ]'
    let bracketTokenCount = 0;
    function bracketExpr(tk) {
      tk = tk || TK_LEFTBRACKET;
      assert(tk === TK_LEFTCMD || tk === TK_LEFTBRACKET, "1000: Internal error");
      bracketTokenCount++;
      eat(tk);
      let tk2;
      if (tk === TK_LEFTCMD) {
        eat(TK_LEFTBRACKET); // Capture left token.
      }
      const e = commaExpr();
      eat((tk2 = tk === TK_LEFTCMD && TK_LEFTCMD || TK_RIGHTBRACKET));
      if (tk2 === TK_RIGHTCMD) {
        eat((tk2 = TK_RIGHTBRACKET)); // Capture right token.
      }
      bracketTokenCount--;
      return e;
    }
    // Parse '( expr )' and '( expr ]' and '[ expr )' and '[ expr ]'
    //       '\left . expr \right |_3', '\left( expr \right)'
    let inParenExpr;
    function parenExpr(tk) {
      // Handle grouping and intervals.
      bracketTokenCount++;
      eat(tk);
      let tk1, tk2, leftCmdFound;
      if (tk === TK_LEFTCMD) {
        eat((tk1 = hd())); // Capture left token.
        leftCmdFound = true;
      } else {
        tk1 = tk;
      }
      let e;
      if (hd() === TK_RIGHTCMD || hd() === TK_RIGHTPAREN || hd() === TK_RIGHTBRACKET) {
        eat((tk2 = leftCmdFound && TK_RIGHTCMD || hd()));
        if (tk2 === TK_RIGHTCMD) {
          eat((tk2 =
               tk1 === TK_LEFTPAREN && TK_RIGHTPAREN ||
               tk1 === TK_LEFTBRACKET && TK_RIGHTBRACKET ||
               tk1 === TK_LANGLE && TK_RANGLE));
        }
        // We have an empty list.
        e = newNode(Model.COMMA, []);
      } else {
        inParenExpr = true;
        const allowSemicolon = true; // Allow semis if in an interval.
        e = commaExpr(allowSemicolon);
        // (..], [..], [..), (..), ]..], ]..[, [..[
        eat((tk2 =
             leftCmdFound && TK_RIGHTCMD ||
             hd() === TK_RIGHTPAREN && TK_RIGHTPAREN ||
             hd() === TK_RANGLE && TK_RANGLE ||
             tk === TK_LEFTCMD && TK_RIGHTCMD ||
             hd() === TK_LEFTBRACKET && TK_LEFTBRACKET ||
             TK_RIGHTBRACKET));
        if (tk2 === TK_RIGHTCMD) {
          eat((tk2 =
               hd() === TK_RIGHTPAREN && TK_RIGHTPAREN ||
               hd() === TK_RANGLE && TK_RANGLE ||
               hd() === TK_LEFTBRACKET && TK_LEFTBRACKET ||
               TK_RIGHTBRACKET)); // Capture right token.
        }
      }
      // Save the brackets as attributes on the node for later use. Normalize
      // French style brackets.
      tk1 = tk1 === TK_RIGHTBRACKET ? TK_LEFTPAREN : tk1;
      tk2 = tk2 === TK_LEFTBRACKET ? TK_RIGHTPAREN : tk2;
      // intervals: (1, 3), [1, 3], [1, 3), (1, 3]
      if ((tk1 === TK_LEFTPAREN || tk1 === TK_LEFTBRACKET || tk1 === TK_RIGHTBRACKET) &&
          (tk2 === TK_RIGHTPAREN || tk2 === TK_RIGHTBRACKET || tk2 === TK_LEFTBRACKET)) {
        const op = (
          e.op === Model.COMMA && e.args.length === 2 && (
            tk1 === TK_LEFTPAREN && tk2 === TK_RIGHTPAREN && Model.INTERVALOPEN ||
            tk1 === TK_LEFTBRACKET && tk2 === TK_RIGHTBRACKET && Model.INTERVAL
          )) ||
          tk1 === TK_LEFTPAREN && tk2 === TK_RIGHTPAREN && Model.PAREN ||
          tk1 === TK_LEFTBRACKET && tk2 === TK_RIGHTBRACKET && Model.BRACKET ||
          tk1 === TK_LEFTPAREN && tk2 === TK_RIGHTBRACKET && Model.INTERVALLEFTOPEN ||
          tk1 === TK_LEFTBRACKET && tk2 === TK_RIGHTPAREN && Model.INTERVALRIGHTOPEN;
        e = newNode(op, [e]);
      } else if (e.lbrk === TK_PERIOD && e.rbrk === TK_VERTICALBAR) {
        e = newNode(Model.EVALAT, [e]);
      } else if (tk1 === TK_LANGLE && tk2 === TK_RANGLE) {
        e = newNode(Model.ANGLEBRACKET, [e]);
      } else if (e.op === Model.COMMA || tk1 === TK_LEFTPAREN || tk1 === TK_LEFTBRACKET) {
        assert(tk1 === TK_LEFTPAREN && tk2 === TK_RIGHTPAREN ||
               tk1 === TK_LEFTBRACKET && tk2 === TK_RIGHTBRACKET ||
               tk1 === tk2, message(1011, ["tk1=" + tk1 + " tk2=" + tk2]));
        const op =
            tk1 === TK_LEFTBRACKET && Model.BRACKET ||
            Model.PAREN;
        e = newNode(op, [e]);
      }
      bracketTokenCount--;
      inParenExpr = false;
      e.lbrk = tk1;
      e.rbrk = tk2;
      return e;
    }
    // Parse 'x^2'
    function exponentialExpr() {
      const args = [primaryExpr()];
      while (hd() === TK_CARET) {
        next({oneCharToken: true});
        let t;
        if ((isMathSymbol(args[0]) || isChemCore()) &&
            ((t = hd()) === TK_ADD || t === TK_SUB)) {
          next();
          // Na^+
          args.push(unaryNode(tokenToOperator[t], [nodeOne]));
        } else {
          let n = unaryExpr();
          if (n.op === Model.VAR && n.args[0] === "\\circ") {
            // 90^{\circ} -> degree 90
            if (hd() === TK_VAR &&
                lexeme(options) === "K" || lexeme(options) === "C" || lexeme(options) === "F") {
              n = multiplyNode([
                args.pop(),
                unaryNode(Model.VAR, ["\\degree " + lexeme(options)])]);
              next();
            } else {
              n = multiplyNode([
                args.pop(),
                unaryNode(Model.VAR, ["\\degree"])
              ]);
            }
            args.push(n);
          } else {
            // x^2
            args.push(n);
          }
        }
      }
      if (args.length > 1) {
        let expo = args.pop();
        args.reverse().forEach(function (base) {
          expo = newNode(Model.POW, [base, expo]);
        });
        expo.isPolynomial = isPolynomial(expo);
        return expo;
      } else {
        const node = args[0];
        node.isPolynomial = isPolynomial(node);
        return node;
      }
    }
    // Parse '10%', '4!'
    function postfixExpr() {
      let t;
      let expr = exponentialExpr();
      switch (t = hd()) {
      case TK_PERCENT:
        next();
        expr = newNode(Model.PERCENT, [expr]);
        break;
      case TK_BANG:
        next();
        expr = newNode(Model.FACT, [expr]);
        break;
      default:
        if (t === TK_VAR && lexeme(options) === "\\degree") {
          next();
          if (hd() === TK_VAR && (lexeme(options) === "K" || lexeme(options) === "C" || lexeme(options) === "F")) {
            expr = multiplyNode([
              expr,
              unaryNode(Model.VAR, ["\\degree " + lexeme(options)])]);
            next();
          } else {
            expr = multiplyNode([
              expr,
              unaryNode(Model.VAR, ["\\degree"])
            ]);
          }
        } else if (t === TK_VERTICALBAR && lookahead() === TK_UNDERSCORE) {
          // x|_{x=3}, x|_1^2
          next();
          const args = [expr];
          next({oneCharToken: true});
          args.push(newNode(Model.SUBSCRIPT, [equalExpr()]));
          expr = newNode(Model.PIPE, args);
        } else if (isChemCore() && (t === TK_ADD || t === TK_SUB) && lookahead() === TK_RIGHTBRACE) {
          next();
          // 3+, ion
          expr = unaryNode(tokenToOperator[t], [expr]);
        } // Otherwise we're in the middle of a binary expr.
        break;
      }
      return expr;
    }
    function isEndOfMultiplicativeExpression(tk) {
      return tk === TK_ADD ||
        tk === TK_SUB ||
        tk === TK_COMMA ||
        tk === TK_RIGHTBRACE ||
        tk === TK_RIGHTPAREN ||
        tk === TK_RIGHTBRACKET ||
        tk === TK_RANGLE ||
        tk === TK_RIGHTCMD ||
        tk === TK_NONE;
    }
    // Parse '+x', '\pm y'
    function unaryExpr() {
      let t, expr, op;
      switch (t = hd()) {
      case TK_ADD:
      case TK_NOT:
      case TK_SUB:
        next();
        expr = newNode(tokenToOperator[t], [unaryExpr()]);
        break;
      case TK_PM:
        next();
        expr = multiplicativeExpr(true);
        expr = newNode(tokenToOperator[t], [expr]);
        break;
      case TK_UNDERSCORE:
        // _1, _1^2, _+^-
        op = tokenToOperator[t];
        next({oneCharToken: true});
        if ((t = hd()) === TK_ADD || t === TK_SUB) {
          next();
          // ^+, ^-
          expr = nodeOne;
        } else {
          expr = unaryExpr();
        }
        expr = newNode(op, [expr]);
        if ((t = hd()) === TK_CARET) {
          const args = [expr];
          // _1, _1^2, _+^-
          op = tokenToOperator[t];
          next({oneCharToken: true});
          if ((t = hd()) === TK_ADD || t === TK_SUB) {
            next();
            // ^+, ^-
            expr = nodeOne;
          } else {
            expr = unaryExpr();
          }
          args.push(expr);
          expr = newNode(op, args);
        }
        break;
      case TK_CARET:
        op = tokenToOperator[t];
        next({oneCharToken: true});
        if ((t = hd()) === TK_ADD || t === TK_SUB) {
          next();
          // ^+, ^-
          expr = nodeOne;
        } else {
          expr = unaryExpr();
        }
        expr = newNode(op, [expr]);
        break;
      default:
        if (t === TK_VAR && lexeme(options) === "$") {
          next();
          if (!isEndOfMultiplicativeExpression(hd())) {
            // Give $1 a higher precedence than ordinary multiplication.
            expr = multiplyNode([newNode(Model.VAR, ["$"]), postfixExpr()]);
            expr.args[1].isPolynomialTerm = true;
          } else {
            // Standalone "$". Probably not useful but we had a test case for it.
            expr = newNode(Model.VAR, ["$"]);
          }
        } else {
          expr = postfixExpr();
        }
        break;
      }
      return expr;
    }
    // Parse 'x_2', where x might be a exponential.
    // x^2_1 => x_1^2
    function subscriptExpr() {
      const args = [unaryExpr()];
      while (hd() === TK_UNDERSCORE) {
        next({oneCharToken: true});
        args.push(exponentialExpr());
        if (isChemCore()) {
          if (hd() === TK_LEFTBRACE) {
            // C_2{}^3 -> C_2^3
            eat(TK_LEFTBRACE);
            eat(TK_RIGHTBRACE);
          }
        }
      }
      let expr;
      if (args.length === 1) {
        expr = args[0];
        assert(expr.op !== Model.SUBSCRIPT || expr.args.length !== 1, message(1012, [src]));
      } else {
        expr = foldSubs(args);
      }
      return expr;
      function foldSubs(args) {
        let expo;
        let base;
        args.forEach(arg => {
          if (arg.op === Model.SUBSCRIPT) {
            arg = foldSubs(arg.args);
          }
          let baseArgs, argArgs;
          if (arg.op === Model.POW && !arg.lbrk) {
            expo = arg.args[1];
            baseArgs =
                base && base.op === Model.SUBSCRIPT && base.args ||
                base && [base] ||
                [];
            argArgs =
                arg.args[0].op === Model.SUBSCRIPT && arg.args[0].args ||
                [arg.args[0]];
          } else if (base && base.op === Model.POW) {
            expo = base.args[1];
            baseArgs =
                base.args[0].op === Model.SUBSCRIPT && base.args[0].args ||
                [base.args[0]] ||
                [];
            argArgs =
                arg.op === Model.SUBSCRIPT && arg.args ||
                [arg];
          } else {
            baseArgs =
                base && base.op === Model.SUBSCRIPT && base.args ||
                base && [base] ||
                [];
            argArgs =
                arg.op === Model.SUBSCRIPT && arg.args ||
                [arg];
          }
          const args = baseArgs.concat(argArgs);
          base = args.length > 1 && newNode(Model.SUBSCRIPT, args) || args[0];
        });
        return expo && binaryNode(Model.POW, [base, expo]) || base;
      }
    }
    // Parse '1/2/3/4', '1 1/2', '1\frac{1}{2}'
    function fractionExpr() {
      let t, node = subscriptExpr();
      if (isNumber(node) &&
          (hd() === TK_FRAC || hd() === TK_NUM && lookahead() === TK_SLASH)) {
        const frac = fractionExpr();
        if (isMixedNumber(node, frac)) {
          let neg;
          if (isNeg(node)) {
            neg = true;
            node = negate(node);
          }
          node = binaryNode(Model.ADD, [node, frac]);
          node.isMixedNumber = true;
          if (neg) {
            node = negate(node);
          }
        } else {
          node = binaryNode(Model.MUL, [node, frac]);
          frac.isImplicit = true;
        }
      }
      while ((t === undefined || t === hd()) && (t = hd()) === TK_SLASH) {
        next();
        node = newNode(tokenToOperator[t], [node, subscriptExpr()]);
        node.isFraction = isSimpleFraction(node);
        node.isSlash = t === TK_SLASH;
      }
      return node;
    }
    function isMathSymbol(n) {
      if (n.op !== Model.VAR) {
        return false;
      }
      const sym = Model.env[n.args[0]];
      return sym && sym.name ? true : false;  // This is somewhat ad hoc, update as needed.
    }
    function isVar(n, id) {
      // Test if is a variable, possibly to an exponent.
      assert(typeof id === "undefined" || typeof id === "string", "1000: Invalid id");
      if (n.op === Model.VAR) {
        return id === undefined ? true : n.args[0] === id;
      } else if (n.op === Model.POW && isVar(n.args[0]) && isInteger(n.args[1])) {
        return id === undefined ? true : n.args[0].args[0] === id;
      }
      return false;
    }
    function isOne(node) {
      return node.op === Model.NUM &&
        (node.args[0] === "1" || node.args[0] === '1.');
    }
    function isMinusOne(node) {
      return node.op === Model.SUB && node.args.length === 1 && isOne(node.args[0]);
    }
    function isMultiplicative(t) {
      return t === TK_MUL ||
        t === TK_DIV ||
        t === TK_SLASH ||
        t === TK_TIMES ||
        t === TK_CDOT;  // / is only multiplicative for parsing
    }
    function isFunction(t) {
      return t === TK_SIN ||
        t === TK_COS ||
        t === TK_TAN ||
        t === TK_SEC ||
        t === TK_COT ||
        t === TK_CSC ||
        t === TK_SINH ||
        t === TK_COSH ||
        t === TK_TANH ||
        t === TK_SECH ||
        t === TK_COTH ||
        t === TK_CSCH ||
        t === TK_ARCSIN ||
        t === TK_ARCCOS ||
        t === TK_ARCTAN ||
        t === TK_ARCSEC ||
        t === TK_ARCCOT ||
        t === TK_ARCCSC ||
        t === TK_ARCSINH ||
        t === TK_ARCCOSH ||
        t === TK_ARCTANH ||
        t === TK_ARCSECH ||
        t === TK_ARCCOTH ||
        t === TK_ARCCSCH ||
        t === TK_LN ||
        t === TK_LOG ||
        t === TK_LG;
    }
    function isDerivative(n) {
      if (n.op !== Model.FRAC) {
        return false;
      }
      const numer = n.args[0];
      const numerHead =
        numer.op === Model.MUL && numer.args[0].op === Model.VAR && numer.args[0].args[0] ||
        numer.op === Model.VAR && numer.args[0] ||
        numer.op === Model.POW && numer.args[0].op === Model.VAR && numer.args[0].args[0];
      const denom = n.args[1];
      const denomHead =
        denom.op === Model.MUL && denom.args[0].op === Model.VAR && denom.args[0].args[0];
      return numerHead === "d" && denomHead === "d" &&
        (denom.args[1] && denom.args[1].op === Model.VAR ||
         denom.args[1] && denom.args[1].op === Model.POW &&
         denom.args[1].args[0] && denom.args[1].args[0].op === Model.VAR);
    }
    function derivativeExpr(node) {
      if (node.op !== Model.FRAC) {
        return null;
      }
      const numer = node.args[0];
      const denom = node.args[1];
      const n =
        numer.op === Model.MUL &&
        numer.args.slice(1).length > 0 &&
        multiplyNode(numer.args.slice(1)) || nodeOne;
      assert(denom.args.length === 2);
      const arg = denom.args[1];
      const sym = arg.op === Model.POW && arg.args[0] || arg;
      const order = arg.op === Model.POW && arg.args[1] || nodeOne;
      return newNode(Model.DERIV, [n, sym, order]);
    }
    function multiplicativeExpr(implicitOnly = false) {
      let t, expr, explicitOperator = false, args = [];
      let n0;
      expr = fractionExpr();
      if (isDerivative(expr)) {
        expr = derivativeExpr(expr);
      }
      if (expr.op === Model.MUL &&
          !expr.isBinomial &&
          !Model.option(options, "compareGrouping") &&
          expr.args[expr.args.length - 1].op !== Model.VAR &&
          expr.args[expr.args.length - 1].args[0] === "\\degree") {
        // FIXME binomials and all other significant syntax should not be desugared
        // during parsing. It breaks equivLiteral and equivSyntax.
        args = expr.args;
      } else {
        args = [expr];
      }
      // While lookahead is not a lower precedent operator
      // FIXME need a better way to organize this condition
      let loopCount = 0;
      while((t = hd()) && !isAdditive(t) && !isRelational(t) && !isImplies(t) &&
            t !== TK_COMMA && t !== TK_SEMICOLON && !isEquality(t) &&
            t !== TK_RIGHTBRACE && t !== TK_RIGHTBRACESET && t !== TK_RIGHTPAREN &&
            t !== TK_RIGHTCMD && t !== TK_RANGLE &&
            !((t === TK_LEFTBRACKET || t === TK_RIGHTBRACKET) && bracketTokenCount > 0) &&
            t !== TK_RIGHTARROW && t !== TK_CAPRIGHTARROW && t !== TK_LT &&
            !(t === TK_VERTICALBAR && pipeTokenCount > 0) &&
            t !== TK_NEWROW && t !== TK_NEWCOL && t !== TK_END) {
        if (isDerivative(expr)) {
          expr.isDerivative = true;
        }
        if (implicitOnly &&
            (isMultiplicative(t) || isFunction(t) ||
             t === TK_LEFTPAREN || t === TK_LEFTCMD || t === TK_LEFTBRACKET ||
             t === TK_LANGLE || t === TK_MATHBF)) {
          break; // Stop parsing
        }
        if (hasDX(options, flattenNestedNodes(expr))) {
          break; //Stop parsing
        }
        explicitOperator = false;
        if (isMultiplicative(t)) {
          next();
          explicitOperator = true;
        }
        expr = fractionExpr();
        if (isDerivative(expr)) {
          expr = derivativeExpr(expr);
        }
        if (t === TK_CDOT || t === TK_TIMES || t === TK_DIV) {
          expr = newNode(tokenToOperator[t], [args.pop(), expr]);
        }
        if (!(explicitOperator ||
              args.length === 0 ||
              expr.lbrk ||
              args[args.length - 1].op !== Model.NUM ||
              !(args[args.length - 1].numberFormat === 'decimal' && args[args.length - 1].lastSeparatorIndex === args[args.length - 1].args[0].length - 1) ||
              args[args.length - 1].lastSeparatorIndex === args[args.length - 1].args[0].length ||
              args[args.length - 1].lbrk ||
              isRepeatingDecimal([args[args.length - 1], expr]) ||
              expr.op !== Model.NUM)) {
          assert(false, "Shouldn't get here");
          // We have two adjacent numbers so merge them into one.
          const n = args.pop();
          expr = newNode(Model.NUM, [n.args[0] + expr.args[0]]);  // Don't use numberNode() to avoid separator checks.
        }
        assert(explicitOperator ||
               args.length === 0 ||
               expr.lbrk ||
               args[args.length - 1].op !== Model.NUM ||
               args[args.length - 1].lbrk ||
               isRepeatingDecimal([args[args.length - 1], expr]) ||
               expr.op !== Model.NUM, message(1010));
        if (isChemCore() && t === TK_LEFTPAREN && isVar(args[args.length - 1], "M")) {
          // M(x) -> \M(x)
          args.pop();
          expr = unaryNode(Model.M, [expr]);
        } else if (!explicitOperator && args.length > 0) {
          // Attempt to make units bind harder than multiplication. Reverted
          // because of usability and compatibility issues.
          if (args.length > 0 &&
              isMixedNumber(args[args.length - 1], expr)) {
            // 3 \frac{1}{2} -> 3 + \frac{1}{2}
            t = args.pop();
            if (isNeg(t)) {
              expr = binaryNode(Model.MUL, [nodeMinusOne, expr]);
            }
            expr = binaryNode(Model.ADD, [t, expr]);
            expr.isMixedNumber = true;
          } else if (args.length > 0 &&
                     args[args.length - 1].op === Model.VAR &&
                     expr.op === Model.VAR && expr.args[0].indexOf("'") === 0) {
            // Merge previous var with current '.
            expr = binaryNode(Model.POW, [args.pop(), expr]);
            expr.isImplicit = expr.args[0].isImplicit;
          } else if (args.length > 0 &&
                     (args[args.length - 1].op === Model.MUL || args[args.length - 1].op === Model.DOT) &&  // 2x', 2*x', 2\cdot x'
                     args[args.length - 1].args[args[args.length - 1].args.length - 1].op === Model.VAR &&
                     expr.op === Model.VAR && expr.args[0].indexOf("'") === 0) {
            t = args.pop();
            expr = multiplyNode(t.args.concat(binaryNode(Model.POW, [t.args.pop(), expr])));
            expr.isImplicit = expr.args[0].isImplicit;
          } else if (args.length > 0 &&
                     args[args.length - 1].op === Model.VAR &&
                     expr.op === Model.POW &&
                     expr.args[0].op === Model.VAR &&
                     expr.args[0].args[0].indexOf("'") === 0) {
            // Merge previous var with current ' and raise to the power.
            expr = newNode(Model.POW, [binaryNode(Model.POW, [args.pop(), expr.args[0]])].concat(expr.args.slice(1)));
          } else if (args.length > 0 &&
                     (n0 = isRepeatingDecimal([args[args.length - 1], expr]))) {
            args.pop();
            expr = n0;
          } else if (isENotation(args, expr)) {
            // 1E2, 1E-2, 1e2
            const tmp = args.pop();
            expr = binaryNode(Model.POW, [numberNode(options, "10"), unaryExpr()]);
            expr = binaryNode(Model.TIMES, [tmp, expr]);
            expr.isScientific = true;
          } else if (!isChemCore() && isPolynomialTerm(args[args.length - 1], expr)) {
            // 2x, -3y but not CH (in chem)
            expr.isPolynomialTerm = true;
            const t = args.pop();
            if (!t.isPolynomialTerm) {
              if (t.op === Model.MUL && t.args[t.args.length - 1].isPolynomialTerm) {
                assert(t.args.length === 2);
                const prefix = t.args[0];
                const suffix = t.args[1];
                expr.isPolynomialTerm = suffix.isPolynomialTerm = false;
                expr = binaryNode(Model.MUL, [prefix, binaryNode(Model.MUL, [suffix, expr], true)]);
                expr.args[1].isPolynomialTerm = true;
                // ...
              } else {
                expr = binaryNode(Model.MUL, [t, expr]);
              }
            }
          } else if (args[args.length - 1].op === Model.DERIV) {
            // Fold expr into derivative expr.
            const arg = args.pop();
            let e = arg.args[0];
            e = isOne(e) && expr || multiplyNode([e, expr]);
            expr = newNode(Model.DERIV, [e].concat(arg.args.slice(1)));
          }
        } else if ((t === TK_TIMES || t === TK_CDOT) && isScientific(expr.args)) {
          // 1.2 \times 10 ^ {-3}
          expr.isScientific = true;
        }
        args.push(expr);
        assert(loopCount++ < 1000, "1000: Stuck in loop in multiplicativeExpr()");
      }
      if (args.length > 1) {
        return trimEmptyBraces(multiplyNode(args));
      } else {
        return args[0];
      }
    }
    function trimEmptyBraces(node) {
      assert(node.op === Model.MUL, "1000: Internal error");
      let args = node.args;
      let n = args[0];
      if (n.op === Model.COMMA && n.args.length === 0) {
        args = args.slice(1, args.length);
        args[0].isImplicit = false;
      }
      n = args[args.length - 1];
      if (n.op === Model.COMMA && n.args.length === 0) {
        args = args.slice(0, args.length - 1);
      }
      return newNode(node.op, args);
    }
    function isNumber(n) {
      if ((n.op === Model.SUB || n.op === Model.ADD) &&
          n.args.length === 1) {
        n = n.args[0];
      }
      if (n.op === Model.NUM) {
        return n;
      }
      return false;
    }
    function isMixedNumber(n0, n1) {
      // 3\frac{1}{2} but not 3(\frac{1}{2}) or 3 1.0/2 or 3 3/2
      if (n0.op === Model.SUB && n0.args.length === 1) {
        n0 = n0.args[0];
      }
      if (!n0.lbrk && !n1.lbrk &&
          n0.op === Model.NUM &&
          isProperFraction(n1)) {
        return true;
      }
      return false;
    }

    function isPolynomialPart(n) {
      return (
        n.op === Model.NUM ||
        isVar(n) ||
        n.op === Model.FORMAT &&
        n.args[0].op === Model.VAR &&
        ['\\integer', '\\decimal', '\\number', '\\variable'].includes(n.args[0].args[0])
      );
    }

    function isPolynomialTerm(n0, n1) {
      // 3x but not 3(x)
      if (n0.op === Model.SUB && n0.args.length === 1) {
        n0 = n0.args[0];
      }
      if (!n0.lbrk && !n1.lbrk &&
          (isPolynomialPart(n0) && isPolynomialPart(n1) ||
           n0.op === Model.MUL && n0.args[n0.args.length - 1].isPolynomialTerm && isPolynomialPart(n1))) {
        return true;
      }
      return false;
    }

    function isInteger(node) {
      let mv;
      if (!node) {
        return false;
      }
      if (node.op === Model.SUB && node.args.length === 1) {
        node = node.args[0];
      }
      if (node.op === Model.NUM &&
          (mv = new Decimal(node.args[0])) &&
          isInteger(mv)) {
        return true;
      } else if (node instanceof Decimal) {
        return node.modulo(bigOne).cmp(bigZero) === 0;
      }
      return false;
    }

    const bigZero = new Decimal("0");
    const bigOne = new Decimal("1");

    function isPolynomial(node) {
      // This recognizes some common shapes of polynomials.
      let degree = 0;
      if (node.op === Model.POW) {
        const base = node.args[0];
        const expo = node.args[1];
        if ((base.op === Model.VAR ||
             base.isPolynomial ||
             base.op === Model.PAREN &&
             isPolynomial(base.args[0])) &&
            isInteger(expo)) {
          degree = parseInt(expo.args[0]);
        }
      } else if (node.op === Model.VAR) {
        degree = 1;
      } else if (node.op === Model.ADD || node.op === Model.SUB) {
        node.args.forEach(n => {
          const d = isPolynomial(n) ;
          degree = d > degree && d || degree;
        });
      } else if (node.op === Model.MUL) {
        node.args.forEach(n => {
          const d = isPolynomial(n) ;
          degree = d > degree && d || degree;
        });
      }
      return degree;
    }
    function isMultiplicativeNode(node) {
      return node.op === Model.MUL || node.op === Model.TIMES || node.op === Model.CDOT;
    }
    function isRepeatingDecimal(args) {
      // "3." "\overline{..}"
      // "10\times3." "\overline{..}", prefix=10
      let prefix;
      let isNeg = false;
      if (args[0].op === Model.SUB && args[0].args[0].op === Model.NUM) {
        args[0] = args[0].args[0];
        isNeg = true;
      }
      if (isMultiplicativeNode(args[0]) && args[0].args[args[0].args.length - 1].numberFormat === "decimal") {
        prefix = args[0].args.slice(0, args[0].args.length - 1);
        args = args[0].args.slice(args[0].args.length - 1).concat(args[1]);
      }
      let expr, n0, n1;
      if (!args[0].lbrk &&
          (args[0].op === Model.NUM && args[0].numberFormat === "decimal" ||
           args[0].op === Model.VAR && args[0].args[0] === "?" ||
           args[0].op === Model.TYPE && args[0].args[0].op === Model.VAR && args[0].args[0].args[0] === "decimal")) {
        // No lbrk so we are in the same number literal.
        if (!args[1].lbrk && args[1].op === Model.OVERLINE) {
          // 3.\overline{12} --> 3.+(12, repeating)
          // 0.3\overline{12} --> 0.3+(12, repeating)
          n0 = args[0];
          n1 = args[1].args[0];
        } else {
          return null;
        }
        n0.isRepeating = true;
        n1.isRepeating = true;
        expr = binaryNode(Model.ADD, [n0, n1]);
        expr.numberFormat = "decimal";
        expr.isRepeating = true;
        if (prefix) {
          expr = multiplyNode(prefix.concat(expr));
        }
      } else {
        expr = null;
      }
      expr = expr !== null && isNeg && unaryNode(Model.SUB, [expr]) || expr;
      return expr;
    }

    function isENotation(args, expr) {
      if (args.length > 0 && isNumber(args[args.length - 1]) &&
          expr.op === Model.TEXT &&
          (expr.args[0].args[0] === "E" || expr.args[0].args[0] === "e") &&
          (hd() === TK_NUM || (hd() === 45 || hd() === 43) && lookahead() === TK_NUM)) {
        // 1E-2, 1E2
        return true;
      }
      return false;
    }

    function isScientific(args) {
      let n;
      if (args.length === 1) {
        // 1.2, 10^2
        if ((n = isNumber(args[0])) &&
            (n.args[0].length === 1 || n.args[0].indexOf(".") === 1)) {
          return true;
        } else if (args[0].op === Model.POW &&
                   (n = isNumber(args[0].args[0])) && n.args[0] === "10" &&
                   isInteger(args[0].args[1])) {
          return true;
        }
        return false;
      } else if (args.length === 2) {
        // 1.0 \times 10 ^ 1
        const a = args[0];
        const e = args[1];
        if ((n = isNumber(a)) &&
            (n.args[0].length === 1 || n.args[0].indexOf(".") === 1) &&
            e.op === Model.POW &&
            (n = isNumber(e.args[0])) && n.args[0] === "10" &&
            isInteger(e.args[1])) {
          return true;
        }
        return false;
      }
      return false;
    }

    function isNeg(n) {
      if (typeof n === "number") {
        return n < 0;
      } else if (n.args.length === 1) {
        return n.op === OpStr.SUB && n.args[0].args[0] > 0 ||  // Is unary minus.
               n.op === Model.NUM && +n.args[0] < 0;           // Is negative number.
      } else if (n.args.length === 2) {
        return n.op === OpStr.MUL && isNeg(n.args[0]);  // Leading term is neg.
      }
      return false;
    }
    // Return the numeric inverse of the argument.
    function negate(n) {
      if (typeof n === "number") {
        return -n;
      } else if (n.op === Model.SUB && n.args.length === 1) {
        return n.args[0];
      } else if (n.op === Model.MUL) {
        const args = n.args.slice(0); // Copy.
        return multiplyNode([negate(args.shift())].concat(args));
      } else if (n.op === Model.POW && isMinusOne(n.args[1])) {
        return binaryNode(Model.POW, [negate(n.args[0]), nodeMinusOne]);
      }
      return unaryNode(Model.SUB, [n]);
    }
    function isAdditive(t) {
      return (
        t === TK_ADD || t === TK_SUB || t === TK_PM ||
        t === TK_BACKSLASH || t === TK_CUP || t === TK_CAP
      );
    }
    // Parse 'a + b'
    function additiveExpr() {
      let expr = multiplicativeExpr();
      let t;
      while (isAdditive(t = hd())) {
        next();
        let expr2 = multiplicativeExpr();
        switch(t) {
        case TK_BACKSLASH:
        case TK_CUP:
        case TK_CAP:
          if (expr.lbrk === TK_LEFTBRACESET &&
              expr.rbrk === TK_RIGHTBRACESET) {
            expr = newNode(Model.SET, [expr]);
          }
          if (expr2.lbrk === TK_LEFTBRACESET &&
              expr2.rbrk === TK_RIGHTBRACESET) {
            expr2 = newNode(Model.SET, [expr2]);
          }
          expr = binaryNode(tokenToOperator[t], [expr, expr2]);
          break;
        case TK_PM:
          expr = binaryNode(Model.PM, [expr, expr2]);
          break;
        case TK_SUB:
          expr = binaryNode(Model.SUB, [expr, expr2]);
          break;
        default: {
          const flatten =
            !Model.option(options, "compareGrouping") &&
            !(expr.isMixedNumber || expr2.isMixedNumber);
          expr = binaryNode(Model.ADD, [expr, expr2], flatten);
          break;
        }
        }
      }
      expr.isPolynomial = isPolynomial(expr);
      return expr;
    }
    function isFunctionNode(node) {
      return node.op === Model.SIN ||
        node.op === Model.COS ||
        node.op === Model.TAN ||
        node.op === Model.SEC ||
        node.op === Model.COT ||
        node.op === Model.CSC ||
        node.op === Model.SINH ||
        node.op === Model.COSH ||
        node.op === Model.TANH ||
        node.op === Model.SECH ||
        node.op === Model.COTH ||
        node.op === Model.CSCH ||
        node.op === Model.ARCSIN ||
        node.op === Model.ARCCOS ||
        node.op === Model.ARCTAN ||
        node.op === Model.ARCSEC ||
        node.op === Model.ARCCOT ||
        node.op === Model.ARCCSC ||
        node.op === Model.ARCSINH ||
        node.op === Model.ARCCOSH ||
        node.op === Model.ARCTANH ||
        node.op === Model.ARCSECH ||
        node.op === Model.ARCCOTH ||
        node.op === Model.ARCCSCH ||
        node.op === Model.LN ||
        node.op === Model.LOG ||
        node.op === Model.LG;
    }
    function flattenNestedNodes(node) {
      let args = [];
      if (node.op === Model.NUM || node.op === Model.VAR) {
        return node;
      }
      if (node.op === Model.CDOT || node.op === Model.TIMES) {
        node.op = Model.MUL;
      }
      node.args.forEach(function (n) {
        n = flattenNestedNodes(n);
        if (node.op !== Model.INTEGRAL && n.op === node.op) {
          args = args.concat(n.args);
        } else {
          args.push(n);
        }
      });
      const isMixedNumber = node.isMixedNumber;
      node = newNode(node.op, args);
      node.isMixedNumber = isMixedNumber;
      return node;
    }
    // Parse '\int a + b dx'
    function hasDX(options, node) {
      if (!Model.option(options, 'parsingIntegralExpr')) {
        return null;
      }
      const len = node.args.length;
      if (node.op === Model.MUL && node.args[len - 1].op === Model.FRAC) {
        return hasDX(options, node.args[len - 1]);
      } else if (isMultiplicativeNode(node) && isFunctionNode(node.args[len - 1])) {
        return hasDX(options, node.args[len - 1]);
      } else if (node.op === Model.FRAC) {
        return hasDX(options, node.args[0]);  // Numerator
      } else if (isFunctionNode(node)) {
        return hasDX(options, node.args[len - 1]); // Function arg
      }
      const dvar = node.args[len - 2];
      const ivar = node.args[len - 1];
      return (
        node && node.op === Model.MUL &&
          dvar.op === Model.VAR && dvar.args[0] === "d" &&
          ivar.op === Model.VAR && ivar || null
      );
    }
    function stripDX(node) {
      assert(isMultiplicativeNode(node) || node.op === Model.FRAC || isFunctionNode(node));
      // Strip off last two args ('dx')
      let nodeLast = node.args[node.args.length - 1];
      if (node.op === Model.MUL && nodeLast.op === Model.FRAC) {
        // 2\frac{dx}{x}
        nodeLast = stripDX(nodeLast);
        node = multiplyNode(node.args.slice(0, node.args.length - 1).concat(nodeLast));
      } else if (isMultiplicativeNode(node) && isFunctionNode(nodeLast)) {
        // 2 \ln(x dx)
        nodeLast = stripDX(nodeLast);
        node = newNode(node.op, node.args.slice(0, node.args.length - 1).concat(nodeLast));
      } else if (node.op === Model.FRAC) {
        // \frac{dx}{x}
        node = newNode(Model.FRAC, [
          stripDX(node.args[0]),
          node.args[1]
        ]);
      } else if (isFunctionNode(node)) {
        // \ln(x dx)
        node = newNode(node.op, [stripDX(node.args[node.args.length - 1])]);
      } else {
        node = multiplyNode(node.args.slice(0, node.args.length - 2));
      }
      return node;
    }
    function integralExpr() {
      eat(TK_INT);
      const parsingIntegralExpr = Model.option(options, 'parsingIntegralExpr', true);
      const args = [];
      // Collect the subscript and expression
      if (hd() === TK_UNDERSCORE) {
        next({oneCharToken: true});
        args.push(primaryExpr());
        if (hd() === TK_CARET) {
          eat(TK_CARET, {oneCharToken: true});
          args.push(primaryExpr());
        }
      }
      let expr, foundDX;
      if (hd() === TK_INT) {
        expr = integralExpr();
        foundDX = hasDX(options, flattenNestedNodes(multiplicativeExpr()));
      } else {
        expr = flattenNestedNodes(multiplicativeExpr());
        let t;
        foundDX = hasDX(options, expr);
        expr = foundDX && stripDX(expr) || expr;
        while (isAdditive(t = hd()) && !foundDX) {
          next();
          let expr2 = flattenNestedNodes(multiplicativeExpr());
          foundDX = hasDX(options, expr2);
          expr2 = foundDX && stripDX(expr2) || expr2;
          switch(t) {
          case TK_SUB:
            expr = binaryNode(Model.SUB, [expr, expr2]);
            break;
          default:
            expr = binaryNode(Model.ADD, [expr, expr2], true /*flatten*/);
            break;
          }
        }
      }
      args.push(expr);
      args.push(foundDX || nodeEmpty);
      // [sub, sup,  expr, var], [expr, var]
      Model.option(options, 'parsingIntegralExpr', parsingIntegralExpr);
      assert(foundDX, message(1014, [src.replace(new RegExp("\\\\", "g"), "\\")]));
      return newNode(Model.INTEGRAL, args);
    }
    function limitExpr() {
      eat(TK_LIM);
      const args = [];
      // Collect the subscript and expression
      if (hd() === TK_UNDERSCORE) {
        next({oneCharToken: true});
        args.push(primaryExpr());
      }
      args.push(multiplicativeExpr());
      return newNode(Model.LIM, args);
    }
    function isRelational(t) {
      return t === TK_LT || t === TK_LE || t === TK_GT || t === TK_GE ||
        t === TK_NGTR || t === TK_NLESS ||
        t === TK_IN || t === TK_TO || t === TK_COLON ||
        t === TK_PERP || t === TK_PROPTO ||
        t === TK_NI || t === TK_NOT ||
        t === TK_SUBSETEQ || t === TK_SUPSETEQ ||
        t === TK_SUBSET || t === TK_SUPSET ||
        t === TK_PARALLEL || t === TK_NPARALLEL || t === TK_SIM || t === TK_CONG;
    }
    // Parse 'x < y'
    // x + y > z ==> (x + y) > z, x + (y > z)
    function relationalExpr() {
      let t = hd();
      let expr = additiveExpr();
      const args = [];
      let isNot = false;
      while (isRelational(t = hd())) {
        // x < y < z -> [x < y, y < z]
        next();
        if (t === TK_NOT) {
          // Remember it and continue.
          isNot = true;
          continue;
        }
        const expr2 = additiveExpr();
        expr = newNode(tokenToOperator[t], [expr, expr2]);
        if (isNot) {
          // Modify with not.
          expr.op = "n" + expr.op; // Negate the operator: subset --> nsubset.
          isNot = false;
        }
        args.push(expr);
        // Make a copy of the reused node.
        expr = Model.create(options, expr2);
      }
      if (args.length === 0) {
        return expr;
      } else if (args.length === 1) {
        return args[0];
      } else {
        return newNode(Model.COMMA, args);
      }
    }
    // Parse 'x = 10'
    function isEquality(t) {
      return t === TK_EQL || t === TK_NE || t === TK_APPROX;
    }
    function equalExpr() {
      let expr = relationalExpr();
      let t;
      const args = [];
      while (isEquality(t = hd()) ||
             t === TK_RIGHTARROW) {
        // x = y = z -> [x = y, y = z]
        next();
        const expr2 = additiveExpr();
        expr = newNode(tokenToOperator[t], [expr, expr2]);
        args.push(expr);
        // Make a copy of the reused node.
        expr = Model.create(options, expr2);
      }
      if (args.length === 0) {
        return expr;
      } else if (args.length === 1) {
        return args[0];
      } else {
        return newNode(Model.COMMA, args);
      }
    }
    function isImplies(t) {
      return t === TK_IMPLIES || t === TK_RIGHTARROW || t === TK_CAPRIGHTARROW ||
             t === TK_LEFTARROW || t === TK_LONGRIGHTARROW || t === TK_LONGLEFTARROW ||
             t === TK_OVERRIGHTARROW || t === TK_OVERLEFTARROW || t === TK_CAPLEFTRIGHTARROW ||
             t === TK_LEFTRIGHTARROW || t === TK_LONGLEFTRIGHTARROW || t === TK_OVERLEFTRIGHTARROW;
    }
    function impliesExpr() {
      let expr = equalExpr();
      let t;
      while (isImplies(t = hd())) {
        next();
        const expr2 = equalExpr();
        expr = newNode(tokenToOperator[t], [expr, expr2]);
      }
      return expr;
    }
    // Parse 'a, b, c, d'
    function commaExpr(allowSemicolon) {
      const expr = impliesExpr();
      const args = [expr];
      let t;
      while ((t = hd()) === TK_COMMA ||
             allowSemicolon && t === TK_SEMICOLON) {
        // If commas are thousands or decimal separator then they are already
        // consumed as part of the number.
        next();
        if (!isListBreakToken(hd())) {
          args.push(impliesExpr());
        }
      }
      if (args.length > 1) {
        return newNode(tokenToOperator[TK_COMMA], args);
      } else {
        return expr;
      }
    }
    // Root syntax.
    function tokenize() {
      // Just return a list of lexemes.
      const args = [];
      start();
      while (hd()) {
        const lex = lexeme(options);
        args.push(newNode(hd(), lex ? [lex] : []));
        next();
      }
      const node = newNode(Model.COMMA, args);
      return node;
    }
    function expr() {
      try {
        start();
        if (hd()) {
          let n = commaExpr();
          assert(!hd(), message(1003, [
            scan.pos(),
            scan.lexeme(options), "'" + src.substring(scan.pos() - 1) + "'"
          ]));
          if (n.lbrk === TK_LEFTBRACESET) {
            n = newNode(Model.SET, [n]);
          }
          return n;
        }
      } catch (x) {
        console.log("SYNTAX ERROR in: " + src + "\n" + x.stack);
        throw x;
      }
      // No meaningful input. Return a dummy node to avoid choking.
      return nodeEmpty;
    }
    // Return a parser object.
    return {
      expr: expr,
      tokenize: tokenize,
    };
    // SCANNER
    // Find tokens in the input stream.
    function scanner(src) {
      let curIndex = 0;
      let lexeme = "";
      const lexemeToToken = {
        "\\Delta": TK_DELTA,
        "\\cdot": TK_CDOT,
        "\\times": TK_TIMES,
        "\\div": TK_DIV,
        "\\dfrac": TK_FRAC,
        "\\frac": TK_FRAC,
        "\\sqrt": TK_SQRT,
        "\\vec": TK_VEC,
        "\\pm": TK_PM,
        "\\not": TK_NOT,
        "\\sin": TK_SIN,
        "\\cos": TK_COS,
        "\\tan": TK_TAN,
        "\\sec": TK_SEC,
        "\\cot": TK_COT,
        "\\csc": TK_CSC,
        "\\arcsin": TK_ARCSIN,
        "\\arccos": TK_ARCCOS,
        "\\arctan": TK_ARCTAN,
        "\\arcsec": TK_ARCSEC,
        "\\arccsc": TK_ARCCSC,
        "\\arccot": TK_ARCCOT,
        "\\asin": TK_ARCSIN, // \operatorname{asin}
        "\\acos": TK_ARCCOS,
        "\\atan": TK_ARCTAN,
        "\\asec": TK_ARCSEC,
        "\\acsc": TK_ARCCSC,
        "\\acot": TK_ARCCOT,
        "\\sinh": TK_SINH,
        "\\cosh": TK_COSH,
        "\\tanh": TK_TANH,
        "\\sech": TK_SECH,
        "\\coth": TK_COTH,
        "\\csch": TK_CSCH,
        "\\arcsinh": TK_ARCSINH,
        "\\arccosh": TK_ARCCOSH,
        "\\arctanh": TK_ARCTANH,
        "\\arcsech": TK_ARCSECH,
        "\\arccsch": TK_ARCCSCH,
        "\\arccoth": TK_ARCCOTH,
        "\\ln": TK_LN,
        "\\lg": TK_LG,
        "\\log": TK_LOG,
        "\\left": TK_LEFTCMD,
        "\\right": TK_RIGHTCMD,
        "\\big": null,  // whitespace
        "\\Big": null,
        "\\bigg": null,
        "\\Bigg": null,
        "\\ ": null,
        "\\quad": null,
        "\\qquad": null,
        "\\text": TK_TEXT,
        "\\textrm": TK_TEXT,
        "\\textit": TK_TEXT,
        "\\textbf": TK_TEXT,
        "\\operatorname": TK_OPERATORNAME,
        "\\lt": TK_LT,
        "\\le": TK_LE,
        "\\leq": TK_LE,
        "\\gt": TK_GT,
        "\\ge": TK_GE,
        "\\geq": TK_GE,
        "\\ne": TK_NE,
        "\\neq": TK_NE,
        "\\ngtr": TK_NGTR,
        "\\nless": TK_NLESS,
        "\\ni": TK_NI,
        "\\subseteq": TK_SUBSETEQ,
        "\\supseteq": TK_SUPSETEQ,
        "\\subset": TK_SUBSET,
        "\\supset": TK_SUPSET,
        "\\approx": TK_APPROX,
        "\\implies": TK_IMPLIES,
        "\\Rightarrow": TK_CAPRIGHTARROW,
        "\\rightarrow": TK_RIGHTARROW,
        "\\leftarrow": TK_LEFTARROW,
        "\\longrightarrow": TK_LONGRIGHTARROW,
        "\\longleftarrow": TK_LONGLEFTARROW,
        "\\overrightarrow": TK_OVERRIGHTARROW,
        "\\overleftarrow": TK_OVERLEFTARROW,
        "\\Leftrightarrow": TK_CAPLEFTRIGHTARROW,
        "\\leftrightarrow": TK_LEFTRIGHTARROW,
        "\\longleftrightarrow": TK_LONGLEFTRIGHTARROW,
        "\\overleftrightarrow": TK_OVERLEFTRIGHTARROW,
        "\\perp": TK_PERP,
        "\\propto": TK_PROPTO,
        "\\parallel": TK_PARALLEL,
        "\\nparallel": TK_NPARALLEL,
        "\\sim": TK_SIM,
        "\\cong": TK_CONG,
        "\\exists": TK_EXISTS,
        "\\in": TK_IN,
        "\\forall": TK_FORALL,
        "\\lim": TK_LIM,
        "\\exp": TK_EXP,
        "\\to": TK_TO,
        "\\sum": TK_SUM,
        "\\int": TK_INT,
        "\\prod": TK_PROD,
        "\\cup": TK_CUP,
        "\\bigcup": TK_BIGCUP,
        "\\cap": TK_CAP,
        "\\bigcap": TK_BIGCAP,
        "\\%": TK_PERCENT,
        "\\binom": TK_BINOM,
        "\\begin": TK_BEGIN,
        "\\end": TK_END,
        "\\colon": TK_COLON,
        "\\vert": TK_VERTICALBAR,
        "\\lvert": TK_VERTICALBAR,
        "\\rvert": TK_VERTICALBAR,
        "\\mid": TK_VERTICALBAR,
        "\\type": TK_TYPE,
        "\\format": TK_FORMAT,
        "\\overline": TK_OVERLINE,
        "\\dot": TK_DOT,
        "\\overset": TK_OVERSET,
        "\\underset": TK_UNDERSET,
        "\\backslash": TK_BACKSLASH,
        "\\mathbf": TK_MATHBF,
        "\\abs": TK_ABS,
        "\\MathQuillMathField": TK_MATHFIELD,
        "\\ldots": TK_VAR,  // ... and var are close syntactic alternatives
        "\\vdots": TK_VAR,
        "\\ddots": TK_VAR,
        "\\infty": TK_INFTY,
        "\\langle": TK_LANGLE,
        "\\rangle": TK_RANGLE,
      };
      const unicodeToLaTeX = {
        0x00B0: "\\degree",
        0x2200: "\\forall",
        0x2201: "\\complement",
        0x2202: "\\partial",
        0x2203: "\\exists",
        0x2204: "\\nexists",
        0x2205: "\\varnothing",
        0x2206: "\\triangle",
        0x2207: "\\nabla",
        0x2208: "\\in",
        0x2209: "\\notin",
        0x220A: "\\in",
        0x220B: "\\ni",
        0x220C: "\\notni",
        0x220D: "\\ni",
        0x220E: "\\blacksquare",
        0x220F: "\\sqcap",
        0x2210: "\\amalg",
        0x2211: "\\sigma",
        0x2212: "-",
        0x2213: "\\mp",
        0x2214: "\\dotplus",
        0x2215: "/",
        0x2216: "\\setminus",
        0x2217: "*",
        0x2218: "\\circ",
        0x2219: "\\bullet",
        0x221A: "\\sqrt",
        0x221B: null,
        0x221C: null,
        0x221D: "\\propto",
        0x221E: "\\infty",
        0x221F: "\\llcorner",
        0x2220: "\\angle",
        0x2221: "\\measuredangle",
        0x2222: "\\sphericalangle",
        0x2223: "\\divides",
        0x2224: "\\notdivides",
        0x2225: "\\parallel",
        0x2226: "\\nparallel",
        0x2227: "\\wedge",
        0x2228: "\\vee",
        0x2229: "\\cap",
        0x222A: "\\cup",
        0x222B: "\\int",
        0x222C: "\\iint",
        0x222D: "\\iiint",
        0x222E: "\\oint",
        0x222F: "\\oiint",
        0x2230: "\\oiiint",
        0x2231: null,
        0x2232: null,
        0x2233: null,
        0x2234: "\\therefore",
        0x2235: "\\because",
        0x2236: "\\colon",
        0x2237: null,
        0x2238: null,
        0x2239: null,
        0x223A: null,
        0x223B: null,
        0x223C: "\\sim",
        0x223D: "\\backsim",
        0x223E: null,
        0x223F: null,
        0x2240: "\\wr",
        0x2241: "\\nsim",
        0x2242: "\\eqsim",
        0x2243: "\\simeq",
        0x2244: null,
        0x2245: "\\cong",
        0x2246: null,
        0x2247: "\\ncong",
        0x2248: "\\approx",
        0x2249: null,
        0x224A: "\\approxeq",
        0x224B: null,
        0x224C: null,
        0x224D: "\\asymp",
        0x224E: "\\Bumpeq",
        0x224F: "\\bumpeq",
        0x2250: "\\doteq",
        0x2251: "\\doteqdot",
        0x2252: "\\fallingdotseq",
        0x2253: "\\risingdotseq",
        0x2254: null,
        0x2255: null,
        0x2256: "\\eqcirc",
        0x2257: "\\circeq",
        0x2258: null,
        0x2259: null,
        0x225A: null,
        0x225B: null,
        0x225C: "\\triangleq",
        0x225D: null,
        0x225E: null,
        0x225F: null,
        0x2260: "\\ne",
        0x2261: "\\equiv",
        0x2262: null,
        0x2263: null,
        0x2264: "\\le",
        0x2265: "\\ge",
        0x2266: "\\leqq",
        0x2267: "\\geqq",
        0x2268: "\\lneqq",
        0x2269: "\\gneqq",
        0x226A: "\\ll",
        0x226B: "\\gg",
        0x226C: "\\between",
        0x226D: null,
        0x226E: "\\nless",
        0x226F: "\\ngtr",
        0x2270: "\\nleq",
        0x2271: "\\ngeq",
        0x2272: "\\lessim",
        0x2273: "\\gtrsim",
        0x2274: null,
        0x2275: null,
        0x2276: "\\lessgtr",
        0x2277: "\\gtrless",
        0x2278: null,
        0x2279: null,
        0x227A: "\\prec",
        0x227B: "\\succ",
        0x227C: "\\preccurlyeq",
        0x227D: "\\succcurlyeq",
        0x227E: "\\precsim",
        0x227F: "\\succsim",
        0x2280: "\\nprec",
        0x2281: "\\nsucc",
        0x2282: "\\subset",
        0x2283: "\\supset",
        0x2284: null,
        0x2285: null,
        0x2286: "\\subseteq",
        0x2287: "\\supseteq",
        0x2288: "\\nsubseteq",
        0x2289: "\\nsupseteq",
        0x228A: "\\subsetneq",
        0x228B: "\\supsetneq",
        0x228C: null,
        0x228D: null,
        0x228E: null,
        0x228F: "\\sqsubset",
        0x2290: "\\sqsupset",
        0x2291: null,
        0x2292: null,
        0x2293: "\\sqcap",
        0x2294: "\\sqcup",
        0x2295: "\\oplus",
        0x2296: "\\ominus",
        0x2297: "\\otimes",
        0x2298: "\\oslash",
        0x2299: "\\odot",
        0x229A: "\\circledcirc",
        0x229B: "\\circledast",
        0x229C: null,
        0x229D: "\\circleddash",
        0x229E: "\\boxplus",
        0x229F: "\\boxminus",
        0x22A0: "\\boxtimes",
        0x22A1: "\\boxdot",
        0x22A2: "\\vdash",
        0x22A3: "\\dashv",
        0x22A4: "\\top",
        0x22A5: "\\bot",
        0x22A6: null,
        0x22A7: "\\models",
        0x22A8: "\\vDash",
        0x22A9: "\\Vdash",
        0x22AA: "\\Vvdash",
        0x22AB: "\\VDash*",
        0x22AC: "\\nvdash",
        0x22AD: "\\nvDash",
        0x22AE: "\\nVdash",
        0x22AF: "\\nVDash",
        0x22B0: null,
        0x22B1: null,
        0x22B2: "\\vartriangleleft",
        0x22B3: "\\vartriangleright",
        0x22B4: "\\trianglelefteq",
        0x22B5: "\\trianglerighteq",
        0x22B6: null,
        0x22B7: null,
        0x22B8: "\\multimap",
        0x22B9: null,
        0x22BA: "\\intercal",
        0x22BB: "\\veebar",
        0x22BC: "\\barwedge",
        0x22BD: null,
        0x22BE: null,
        0x22BF: null,
        0x22C0: "\\wedge",
        0x22C1: "\\vee",
        0x22C2: "\\cap",
        0x22C3: "\\cup",
        0x22C4: "\\diamond",
        0x22C5: "\\cdot",
        0x22C6: "\\star",
        0x22C7: null,
        0x22C8: "\\bowtie",
        0x22C9: "\\ltimes",
        0x22CA: "\\rtimes",
        0x22CB: "\\leftthreetimes",
        0x22CC: "\\rightthreetimes",
        0x22CD: "\\backsimeq",
        0x22CE: "\\curlyvee",
        0x22CF: "\\curlywedge",
        0x22D0: "\\Subset",
        0x22D1: "\\Supset",
        0x22D2: "\\Cap",
        0x22D3: "\\Cup",
        0x22D4: "\\pitchfork",
        0x22D5: "\\lessdot",
        0x22D6: "\\gtrdot",
        0x22D7: null,
        0x22D8: "\\lll",
        0x22D9: "\\ggg",
        0x22DA: "\\lesseqgtr",
        0x22DB: "\\gtreqless",
        0x22DC: null,
        0x22DD: null,
        0x22DE: "\\curlyeqprec",
        0x22DF: "\\curlyeqsucc",
        0x22E0: null,
        0x22E1: null,
        0x22E2: null,
        0x22E3: null,
        0x22E4: null,
        0x22E5: null,
        0x22E6: "\\lnsim",
        0x22E7: "\\gnsim",
        0x22E8: "\\precnsim",
        0x22E9: "\\succnsim",
        0x22EA: "\\ntriangleleft",
        0x22EB: "\\ntriangleright",
        0x22EC: "\\ntrianglelefteq",
        0x22ED: "\\ntrianglerighteq",
        0x22EE: "\\vdots",
        0x22EF: "\\cdots",
        0x22F0: null,
        0x22F1: "\\ddots",
        0x22F2: null,
        0x22F3: null,
        0x22F4: null,
        0x22F5: null,
        0x22F6: null,
        0x22F7: null,
        0x22F8: null,
        0x22F9: null,
        0x22FA: null,
        0x22FB: null,
        0x22FC: null,
        0x22FD: null,
        0x22FE: null,
        0x22FF: null,
        0x03B1: "\\alpha",
        0x03B2: "\\beta",
        0x03B3: "\\gamma",
        0x03B4: "\\delta",
        0x03B5: "\\epsilon",
        0x03B6: "\\zeta",
        0x03B7: "\\eta",
        0x03B8: "\\theta",
        0x03B9: "\\iota",
        0x03BA: "\\kappa",
        0x03BB: "\\lambda",
        0x03BC: "\\mu",
        0x03BD: "\\nu",
        0x03BE: "\\xi",
        0x03BF: "o",
        0x03C0: "\\pi",
        0x03C1: "\\rho",
        0x03C2: null,
        0x03C3: "\\sigma",
        0x03C4: "\\tau",
        0x03C5: "\\upsilon",
        0x03C6: "\\phi",
        0x03C7: "\\chi",
        0x03C8: "\\psi",
        0x03C9: "\\omega",
        0x0391: "A",
        0x0392: "B",
        0x0393: "\\Gamma",
        0x0394: "\\Delta",
        0x0395: "E",
        0x0396: "Z",
        0x0397: "H",
        0x0398: "\\Theta",
        0x0399: "I",
        0x039A: "K",
        0x039B: "\\Lambda",
        0x039C: "M",
        0x039D: "N",
        0x039E: "\\Xi",
        0x039F: "O",
        0x03A0: "\\Pi",
        0x03A1: "P",
        0x03A2: null,
        0x03A3: "\\Sigma",
        0x03A4: "T",
        0x03A5: "\\Upsilon",
        0x03A6: "\\Phi",
        0x03A7: "X",
        0x03A8: "\\Psi",
        0x03A9: "\\Omega",
      };
      const identifiers = Object.keys(env);
      // Add keywords to the list of identifiers.
      identifiers.push("to");
      function isAlphaCharCode(c) {
        return (
          c >= 65 && c <= 90 ||
          c >= 97 && c <= 122
        );
      }
      // Start scanning for one token.
      function start(options) {
        if (!options) {
          options = {};
        }
        let c;
        lexeme = "";
        let t;
        while (curIndex < src.length) {
          let tk;
          switch ((c = src.charCodeAt(curIndex++))) {
          case 32:  // space
          case 9:   // tab
          case 10:  // new line
          case 13:  // carriage return
          case 0x00A0: // non-breaking space (&nbsp;)
          case 0x200B: // zero width space
            continue;
          case 38:  // ampersand (new column or entity)
            if (src.substring(curIndex).indexOf("nbsp;") === 0) {
              // Skip &nbsp;
              curIndex += 5;
              continue;
            }
            return TK_NEWCOL;
          case 92:  // backslash
            lexeme += String.fromCharCode(c);
            switch (src.charCodeAt(curIndex)) {
            case 92:
              curIndex++;
              return TK_NEWROW;   // double backslash = new row
            case 123: // left brace
              curIndex++;
              return TK_LEFTBRACESET;
            case 124: // vertical bar
              curIndex++;
              return TK_VERTICALBAR;
            case 125: // right brace
              curIndex++;
              return TK_RIGHTBRACESET;
            }
            tk = latex();
            if (tk !== null) {
              return tk;
            }
            lexeme = "";
            continue;  // whitespace
          case 42:  // asterisk
          case 0x2217:
            if (src.charCodeAt(curIndex) === 42) { // ** => ^
              curIndex++;
              return TK_CARET;
            }
            return TK_TIMES;
          case 45:  // dash
          case 0x2212:  // unicode minus
            if (src.charCodeAt(curIndex) === 62) {
              curIndex++;
              return TK_RIGHTARROW;
            }
            return TK_SUB;
          case 47:  // slash
          case 0x2215:
            return TK_SLASH;
          case 33:  // bang, exclamation point
            if (src.charCodeAt(curIndex) === 61) { // equals
              curIndex++;
              return TK_NE;
            }
            return c; // char code is the token id
          case 58:  // colon
          case 0x2236:
            return TK_COLON;
          case 59:  // semicolon
            return TK_SEMICOLON;
          case 37:  // percent
          case 40:  // left paren
          case 41:  // right paren
          case 43:  // plus
          case 44:  // comma
          case 61:  // equal
          case 63:  // question mark
          case 91:  // left bracket
          case 93:  // right bracket
          case 94:  // caret
          case 95:  // underscore
          case 123: // left brace
          case 124: // vertical bar
          case 125: // right brace
            lexeme += String.fromCharCode(c);
            return c; // char code is the token id
          case 36:  // dollar
            lexeme += String.fromCharCode(c);
            return TK_VAR;
          case 39:  // prime (single quote)
            return prime(c);
          case 60:  // left angle
            if (src.charCodeAt(curIndex) === 61) { // equals
              curIndex++;
              return TK_LE;
            }
            return TK_LT;
          case 62:  // right angle
            if (src.charCodeAt(curIndex) === 61) { // equals
              curIndex++;
              return TK_GE;
            }
            return TK_GT;
          default:
            if (isAlphaCharCode(c) ||
                c === CC_SINGLEQUOTE) {
              return variable(c);
            } else if ((t = unicodeToLaTeX[c])) {
              lexeme = t;
              let tk = lexemeToToken[lexeme];
              if (tk === void 0) {
                tk = TK_VAR;   // e.g. \\theta
              }
              return tk;
            } else if (matchDecimalSeparator(String.fromCharCode(c)) ||
                       isNumberCharCode(c)) {
              if (options.oneCharToken) {
                lexeme += String.fromCharCode(c);
                return TK_NUM;
              }
              return number(c);
            } else {
              assert(false, message(1004, [String.fromCharCode(c), c]));
              return 0;
            }
          }
        }
        return 0;
      }
      // Recognize 1, 1.2, 0.3, .3, 1\ 234.00
      let lastSeparator;
      function number(c) {
        let match;
        while (isNumberCharCode(c) ||
               matchDecimalSeparator(String.fromCharCode(c)) ||
               (match = matchThousandsSeparator(String.fromCharCode(c), lastSeparator))) {
          lastSeparator = match || lastSeparator;  // Remember the last separator.
          // While the next char is a num.
          lexeme += String.fromCharCode(c);
          c = src.charCodeAt(curIndex++);
          if (c === 92 && src.charCodeAt(curIndex) === 32) {
            // We have an explicit space. Remember it in case it is a decimal separator.
            // Convert '\ ' to ' '.
            c = 32;
            curIndex++;
          }
          if (matchDecimalSeparator(String.fromCharCode(c)) ||
              (match = matchThousandsSeparator(String.fromCharCode(c), lastSeparator))) {
            lastSeparator = match || lastSeparator;  // Remember the last separator.
            // Erase whitespace after punctuation.
            lexeme += String.fromCharCode(c);
            c = src.charCodeAt(curIndex++);
            while (c === 92 && (c = src.charCodeAt(curIndex)) === 32 && curIndex++ ||
                   isWhitespaceCharCode(c)) {
              // Eat all the whitespace until the next non-whitespace character.
              c = src.charCodeAt(curIndex++);
            }
          }
          if (c === 92 && src.charCodeAt(curIndex) === 32) {
            // We have an explicit space. Remember it in case it is a decimal separator.
            // Convert '\ ' to ' '.
            c = 32;
            curIndex++;
          }
        }
        if (lexeme === "." &&
            (src.substring(curIndex).indexOf("overline") === 0 ||
             src.substring(curIndex).indexOf("dot") === 0)) {
          // .\overline --> 0.\overline
          // .\dot --> 0.\dot
          lexeme = "0.";
        }
        curIndex--;
        return TK_NUM;
      }
      // Recognize x, cm, kg.
      function variable(c) {
        // Normal variables are a single character, but we treat units as
        // variables too so we need to scan the whole unit string as a variable
        // name.
        let ch = String.fromCharCode(c);
        lexeme += ch;
        let identifier = lexeme;
        const startIndex = curIndex + 1;
        while (isAlphaCharCode(c) || c === CC_SINGLEQUOTE) {
          // All single character names are valid variable lexemes. Now we check
          // for longer match against unit names. The longest one wins.
          c = src.charCodeAt(curIndex++);
          if (!isAlphaCharCode(c)) {
            // Past end of identifier.
            break;
          }
          ch = String.fromCharCode(c);
          const match = identifiers.some(function (u) {
            const ident = identifier + ch;
            // Check of not an explicit variable and has a prefix that is a unit.
            return u.indexOf(ident) === 0;
          });
          if (!match) {
            // No match, so we know it is not a unit, so bail.
            break;
          }
          identifier += ch;
        }
        if (identifiers.indexOf(identifier) >= 0) {
          // Found an identifier, so make it the lexeme.
          lexeme = identifier;
        } else {
          // Reset curIndex.
          curIndex = startIndex;
        }
        // Group primes into a single var.
        while (lexeme.lastIndexOf("'") === lexeme.length - 1 && c === CC_SINGLEQUOTE) {
          lexeme += String.fromCharCode(c);
          c = src.charCodeAt(curIndex++);
        }
        curIndex--;
        return TK_VAR;
      }
      function latex() {
        let c = src.charCodeAt(curIndex++);
        if (c === CC_DOLLAR) {
          // don't include \
          lexeme = String.fromCharCode(c);
        } else if (c === CC_PERCENT) {
          lexeme += String.fromCharCode(c);
        } else if ([
          CC_SPACE,
          CC_COLON,
          CC_SEMICOLON,
          CC_COMMA,
          CC_BANG].indexOf(c) >= 0) {
          lexeme = "\\ ";
        } else {
          while (isAlphaCharCode(c)) {
            lexeme += String.fromCharCode(c);
            c = src.charCodeAt(curIndex++);
          }
          curIndex--;
        }
        let tk = lexemeToToken[lexeme];
        if (tk === void 0) {
          tk = TK_VAR;   // e.g. \\theta
        } else if (tk === TK_OPERATORNAME) {
          c = src.charCodeAt(curIndex++);
          // Skip whitespace before '{'
          while (c && c !== CC_LEFTBRACE) {
            c = src.charCodeAt(curIndex++);
          }
          lexeme = "";
          c = src.charCodeAt(curIndex++);
          while (c && c !== CC_RIGHTBRACE) {
            const ch = String.fromCharCode(c);
            if (ch === "&" && src.substring(curIndex).indexOf("nbsp;") === 0) {
              // Skip &nbsp;
              curIndex += 5;
            } else if (ch === " " || ch === "\t") {
              // Skip space and tab
            } else {
              lexeme += ch;
            }
            c = src.charCodeAt(curIndex++);
          }
          tk = lexemeToToken["\\" + lexeme];
          if (tk === void 0) {
            tk = TK_OPERATORNAME;
          }
        } else if (tk === TK_TEXT || tk === TK_TYPE) {
          c = src.charCodeAt(curIndex++);
          // Skip whitespace before '{'
          while (c && c !== CC_LEFTBRACE) {
            c = src.charCodeAt(curIndex++);
          }
          lexeme = "";
          c = src.charCodeAt(curIndex++);
          const keepTextWhitespace = Model.option(options, "keepTextWhitespace");
          while (c && c !== CC_RIGHTBRACE) {
            const ch = String.fromCharCode(c);
            if (!keepTextWhitespace && ch === "&" && src.substring(curIndex).indexOf("nbsp;") === 0) {
              // Skip &nbsp;
              curIndex += 5;
            } else if (!keepTextWhitespace && (ch === " " || ch === "\t")) {
              // Skip space and tab
            } else {
              lexeme += ch;
            }
            c = src.charCodeAt(curIndex++);
          }
          if (tk !== TK_TYPE) {
            if (!lexeme || Model.option(options, "ignoreText")) {
              tk = null;   // Treat as whitespace.
            } else {
              tk = TK_TEXT;
            }
          }
        } else if (tk === TK_INFTY) {
          tk = TK_NUM;
        }
        return tk;
      }
      function prime(c) {
        assert(c === 39);
        lexeme = "'";
        while (src.charCodeAt(curIndex) === 39) {
          curIndex++;
          lexeme += "'";
        }
        return TK_VAR;
      }
      // Return a scanner object.
      return {
        start: start,
        lexeme: function () {
          return lexeme;
        },
        pos: function() { return curIndex; }
      };
    }
  };
  return Model;
})();
