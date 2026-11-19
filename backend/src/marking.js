'use strict';
// Pure marking logic (unit-tested) + a DB helper used by the marker Lambda.
const db = require('./db');

/**
 * @param {Array<{id:number,type:string,correct_option:number|null,marks:number}>} questions
 * @param {Record<string, any>} answers  questionId -> chosen option index (mcq) or text (short)
 * @param {Record<string, number>} shortMarks questionId -> marks given by tutor
 */
function scoreAttempt(questions, answers, shortMarks = {}) {
  let mcq = 0;
  let shortTotal = 0;
  let max = 0;
  let pendingShort = 0;
  for (const q of questions) {
    max += q.marks;
    const a = answers[String(q.id)];
    if (q.type === 'mcq') {
      if (a !== undefined && a !== null && Number(a) === q.correct_option) mcq += q.marks;
    } else if (shortMarks[String(q.id)] !== undefined) {
      shortTotal += Math.min(Number(shortMarks[String(q.id)]) || 0, q.marks);
    } else {
      pendingShort += 1;
    }
  }
  return { mcq, total: mcq + shortTotal, max, pendingShort };
}

async function markAttempt(attemptId) {
  const { rows } = await db.query(
    'SELECT id, exam_id, answers, short_marks, status FROM attempts WHERE id = $1',
    [attemptId],
  );
  if (!rows.length) return null;
  const att = rows[0];
  const qs = await db.query(
    'SELECT id, type, correct_option, marks FROM questions WHERE exam_id = $1',
    [att.exam_id],
  );
  const s = scoreAttempt(qs.rows, att.answers, att.short_marks);
  await db.query(
    `UPDATE attempts SET mcq_score = $2, total_score = $3, max_score = $4,
       status = CASE WHEN $5 = 0 THEN 'marked' ELSE 'submitted' END
     WHERE id = $1 AND status <> 'in_progress'`,
    [attemptId, s.mcq, s.total, s.max, s.pendingShort],
  );
  return s;
}

module.exports = { scoreAttempt, markAttempt };
