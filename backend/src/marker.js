'use strict';
// SQS marking-queue consumer: auto-marks MCQs once an attempt is submitted.
const { markAttempt } = require('./marking');

exports.handler = async (event) => {
  const batchItemFailures = [];
  for (const rec of event.Records) {
    try {
      const { attemptId } = JSON.parse(rec.body);
      const s = await markAttempt(attemptId);
      console.log(JSON.stringify({ level: 'info', msg: 'marked', attemptId, ...s }));
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', messageId: rec.messageId, message: err.message }));
      batchItemFailures.push({ itemIdentifier: rec.messageId }); // retried, then DLQ after 5 tries
    }
  }
  return { batchItemFailures };
};
