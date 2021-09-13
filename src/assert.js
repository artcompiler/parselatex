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
  ASSERTS AND MESSAGES

  We use the 'assert()' function to trap invalid states of all kinds. External
  messages are distinguished from internal messages by a numeric prefix that
  indicates the error code associated with the message. For example, the
  following two asserts implement an internal and external assert, respectively.

     assert(false, "This code is broken.");
     assert(false, "1001: Invalid user input.");

  To aid in the writing of external messages, we keep them in a single global
  table named 'Assert.messages'. Each module adds to this table its own messages
  with an expression such as

     messages[1001] = "Invalid user input.";

  These messages are accessed with the 'message' function as such

     message(1001);

  Calling 'assert' with 'message' looks like

     assert(x != y, message(1001));

  ALLOCATING ERROR CODES

  In order to avoid error code conflicts, each module claims a range of values
  that is not already taken by the modules in the same system. A module claims
  a range of codes by calling the function reserveCodeRange() like this:

     reserveCodeRange(1000, 1999, "mymodule");

  If the requested code range has any values that are already reserved, then
  an assertion is raised.

  USAGE

  In general, only allocate message codes for external asserts. For internal
  asserts, it is sufficient to simply inline the message text in the assert
  expression.

  It is good to write an assert for every undefined state, regardless of whether
  it is the result of external input or not. Asserts can then be externalized if
  and when they it is clear that they are the result of external input.

  A client module can override the messages provided by the libraries it uses by
  simply redefining those messages after the defining library is loaded. That is,
  the client can copy and past the statements of the form

     messages[1001] = "Invalid user input.";

  and provide new text for the message.

     messages[1001] = "Syntax error.";

  In the same way different sets of messages can be overridden for the purpose
  of localization.

*/

const ASSERT = true;
export const assert = (
  !ASSERT ? () => {} :
  (val, str, location) => {
    if (str === undefined) {
      str = 'failed!';
    }
    if (!val) {
      const err = new Error(str);
      err.location = location || Assert.location;
      throw err;
    }
  });

export const message = (errorCode, args) => {
  let str = Assert.messages[errorCode];
  if (args) {
    args.forEach((arg, i) => {
      str = str.replace(`%${i + 1}`, arg);
    });
  }
  return `${errorCode}: ${str}`;
};

export const reserveCodeRange = (first, last, moduleName) => {
  assert(first <= last, 'Invalid code range');
  const noConflict = Assert.reservedCodes.every((range) => last < range.first || first > range.last);
  assert(noConflict, 'Conflicting request for error code range');
  Assert.reservedCodes.push({ first, last, name: moduleName });
};

export const setLocation = (location) => {
  // assert(location, "Empty location");
  Assert.location = location;
};

export const clearLocation = () => {
  Assert.location = null;
};

const setTimeout = (timeout, message) => {
  if (timeout === undefined) {
    return undefined;
  }
  Assert.timeout = timeout ? Date.now() + timeout : 0;
  Assert.timeoutMessage = message || 'ERROR timeout exceeded';
  return undefined;
};

const checkTimeout = () => {
  assert(!Assert.timeout || Assert.timeout > Date.now(), Assert.timeoutMessage);
};

export const setCounter = (count, message) => {
  Assert.count = count;
  Assert.countMessage = message || 'ERROR count exceeded';
};

export const checkCounter = () => {
  const { count } = Assert;
  if (typeof count !== 'number' || Number.isNaN(count)) {
    assert(false, 'ERROR counter not set');
    return;
  }
  assert(Assert.count--, Assert.countMessage);
};

export const Assert = {
  assert,
  message,
  messages: {},
  reserveCodeRange,
  reservedCodes: [],
  setLocation,
  clearLocation,
  checkTimeout,
  setTimeout,
  setCounter,
  checkCounter,
};
