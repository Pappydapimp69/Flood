import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupCrossings } from '../../src/client/crossmarks.js';

const pt = (x, o, extra = {}) => ({ x, z: 0, cross: o === undefined ? null : { o, theirs: 3, mine: 2, ...extra } });

test('a path weaving in and out of one rival channel gets one marker, at the first crossing', () => {
  // The screenshot case: in, out, in, out, in, out, in along Wasserfall's bank.
  const path = [pt(0), pt(100, 5), pt(200), pt(300, 5), pt(400), pt(500, 5), pt(600, 5), pt(700), pt(800, 5)];
  const marks = groupCrossings(path);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].x, 100);
  assert.equal(marks[0].n, 5); // all its points count toward a ride
});

test('two rivals get one marker each, in path order', () => {
  const marks = groupCrossings([pt(0, 2), pt(100, 7), pt(200, 2), pt(300, 7)]);
  assert.deepEqual(marks.map((m) => [m.o, m.x]), [[2, 0], [7, 100]]);
});

test('a marker holds still until its first crossing moves more than 150 m', () => {
  const first = groupCrossings([pt(1000, 4)]);
  const near = groupCrossings([pt(1120, 4)], first);
  assert.equal(near[0].x, 1000);
  const far = groupCrossings([pt(1200, 4)], near);
  assert.equal(far[0].x, 1200);
});

test('no crossings, no markers', () => {
  assert.deepEqual(groupCrossings([pt(0), pt(100)]), []);
});
