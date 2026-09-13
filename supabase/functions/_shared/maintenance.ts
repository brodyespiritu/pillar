/*
 * Scheduled maintenance for texting.
 *
 * A window is a row in sms_maintenance with a start and an end. While one is
 * open nothing leaves Pillar by text — no broadcasts, no replies, no scheduled
 * sends, no care digest, no deacon alerts, no automatic acknowledgements.
 * Incoming texts are still recorded; only the sending stops.
 *
 * Kept in the database rather than in code so a window can be set, extended or
 * ended early with one statement and no redeploy, and so it closes itself:
 * nobody has to remember to turn texting back on.
 *
 * WHERE THE CHECK GOES MATTERS. Several senders claim a row as delivered BEFORE
 * they send — the care digest, care reminders, deacon alerts — so that a repeat
 * firing cannot text twice. A check placed only at send-prospect-sms would let
 * those claims land and then block the send, leaving each message marked sent
 * with nothing sent, and a claimed row is never retried. So every sender checks
 * at its own entry, ahead of any claim, and send-prospect-sms checks again as
 * the backstop for everything else.
 */

export type MaintenanceWindow = {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
};

/*
 * The window open right now, or null.
 *
 * Fails OPEN. If the check itself errors, texting stays on and the error is
 * logged. The alternative — treating a failed read as maintenance — would mean
 * any database hiccup at any hour silently stopped the care digest and every
 * deacon alert, which is the failure this system has already had once. A
 * missing table means the feature was never installed, which is also "on".
 */
export async function activeMaintenance(
  supabase: any,
  at: Date = new Date(),
): Promise<MaintenanceWindow | null> {
  const iso = at.toISOString();
  const { data, error } = await supabase
    .from('sms_maintenance')
    .select('id, starts_at, ends_at, reason')
    .lte('starts_at', iso)
    .gt('ends_at', iso)
    .order('ends_at', { ascending: false })
    .limit(1);
  if (error) {
    if (!/does not exist|relation/i.test(error.message || '')) {
      console.error('maintenance check failed; texting stays on:', error.message);
    }
    return null;
  }
  return data?.[0] ?? null;
}

/* What a person trying to send is told. Said in the church's own zone, because
   that is the clock the people reading it are on. */
export function maintenanceNotice(w: MaintenanceWindow) {
  const until = new Date(w.ends_at).toLocaleString('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit',
  });
  return `Texting is paused for scheduled maintenance until ${until} ET. Nothing was sent.`;
}
