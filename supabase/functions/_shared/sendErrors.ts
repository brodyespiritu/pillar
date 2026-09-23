/*
 * Why a text didn't go out, in words a person can act on.
 *
 * Telnyx answers in JSON when it has something to say, but an outage in front of
 * it answers with an HTML error page. The sender used to hand that page straight
 * to res.json(), so the log recorded the parser's complaint — "Unexpected token
 * '<', "<!DOCTYPE "... is not valid JSON" — instead of the fact that mattered:
 * the texting service was down for a while.
 *
 * Used by send-prospect-sms when a text fails, and by the app to reword the
 * failures logged before this existed.
 */

/* Read a Telnyx reply without trusting it to be JSON. */
export async function readProviderReply(res: Response): Promise<{ data: any; error: string | null }> {
  const text = await res.text().catch(() => '');
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }

  // A 2xx is Telnyx accepting the message. Treating an odd body as a failure
  // would make the care job send it again, and the person would get it twice.
  if (res.ok) return { data, error: null };

  const detail = data?.errors?.[0]?.detail;
  if (detail) return { data, error: String(detail) };
  if (!data) return { data: null, error: `The texting service was down (HTTP ${res.status}) and sent back an error page` };
  return { data, error: `The texting service refused it (HTTP ${res.status})` };
}

/*
 * The reason, reworded for the screen. Covers both the wording above and the
 * raw provider messages already sitting in the log.
 */
export function readableSendError(raw: unknown): string {
  const e = String(raw ?? '').trim();
  if (!e) return '';
  if (/texting service was down|Unexpected token|<!DOCTYPE|not valid JSON/i.test(e)) return 'The texting service was down';
  if (/Service is unavailable|unexpected error occurred/i.test(e)) return 'The texting service had a temporary outage';
  if (/would be divided into \d+ parts/i.test(e)) return 'Too long to send as one text';
  if (/account has been|cannot be fulfilled because your account/i.test(e)) return 'The texting account was paused';
  if (/Mobile-only|not mobile/i.test(e)) return 'That number is a landline';
  if (/Invalid phone number/i.test(e)) return 'The phone number on file is not valid';
  if (/cannot be sent from/i.test(e)) return 'The carrier refused it';
  return e;
}
