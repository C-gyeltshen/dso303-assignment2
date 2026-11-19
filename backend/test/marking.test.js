'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

// marking.js requires ./db (which needs AWS); stub it for pure unit tests.
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === './db') return { query: async () => ({ rows: [] }) };
  return origLoad.call(this, req, ...rest);
};
const { scoreAttempt } = require('../src/marking');
const { _detectType } = require('../src/uploadProcessor');
const { HttpError, getUser } = require('../src/http');

const questions = [
  { id: 1, type: 'mcq', correct_option: 2, marks: 2 },
  { id: 2, type: 'mcq', correct_option: 0, marks: 2 },
  { id: 3, type: 'short', correct_option: null, marks: 4 },
];

test('auto-marks MCQs and leaves short answers pending', () => {
  const s = scoreAttempt(questions, { 1: 2, 2: 3, 3: 'text' });
  assert.deepStrictEqual(s, { mcq: 2, total: 2, max: 8, pendingShort: 1 });
});

test('adds tutor short-answer marks, capped at question marks', () => {
  const s = scoreAttempt(questions, { 1: 2, 2: 0 }, { 3: 9 });
  assert.deepStrictEqual(s, { mcq: 4, total: 8, max: 8, pendingShort: 0 });
});

test('unanswered questions score zero', () => {
  assert.strictEqual(scoreAttempt(questions, {}).mcq, 0);
});

test('detects PDF and ZIP magic bytes', () => {
  assert.strictEqual(_detectType(Buffer.from('%PDF-1.7')), 'pdf');
  assert.strictEqual(_detectType(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])), 'zip');
  assert.strictEqual(_detectType(Buffer.from('MZ......')), null);
});

test('parses Cognito groups from JWT claims', () => {
  const u = getUser({ requestContext: { authorizer: { jwt: { claims: { sub: 'abc', email: 'a@b.c', 'cognito:groups': '[tutors admins]' } } } } });
  assert.deepStrictEqual(u.groups, ['tutors', 'admins']);
  assert.throws(() => getUser({ requestContext: {} }), HttpError);
});
