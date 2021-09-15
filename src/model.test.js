import { Model } from './model.js';

function stripMetadata(node) {
  // Strip metadata such as nids.
  if (!node.op) {
    return node;
  }
  Object.keys(node).forEach(function (k) {
    if (k !== "op" &&
        k !== "args") {
      delete node[k];
    }
  });
  if (node.args) {
    node.args.forEach(function (n) {
      stripMetadata(n);
    });
  }
  return node;
}

test('1 + 2', () => {
  const nodeRecieved = stripMetadata(Model.create({}, '1 + 2'));
  const nodeExpected = {
    op: Model.ADD,
    args: [{
      op: Model.NUM,
      args: ['1'],
    }, {
      op: Model.NUM,
      args: ['2'],
    }]
  };
  expect(JSON.stringify(nodeRecieved)).toBe(JSON.stringify(nodeExpected));
});
