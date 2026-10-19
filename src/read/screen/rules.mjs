export function screenRules(content) {
  const rules = [
    ['instruction_override', /(?:ignore|override|disregard)\s+(?:all\s+)?(?:previous|prior|system)\s+instructions/iu],
    ['role_override', /(?:\[\s*system\s*\]|<\|(?:im_start|system)\|>)/iu],
    ['credential_request', /(?:reveal|send|print|exfiltrate)\s+(?:your\s+)?(?:api[ _-]?key|secret|token|password)/iu],
  ];
  const reasons = rules.filter(([, expression]) => expression.test(content)).map(([name]) => name);
  // Calibration is pending the S1 corpus; an unmatched page needs review.
  return { status: reasons.length ? 'flagged' : 'review', provider: 'rules', reasons: reasons.length ? reasons : ['calibration_pending'] };
}
