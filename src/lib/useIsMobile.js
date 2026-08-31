import { useEffect, useState } from 'react';

/*
 * True on a phone-width viewport. Matches the 767px breakpoint the rest of the
 * app uses, so the bottom tab bar and the mobile layouts appear together rather
 * than one flipping before the other.
 */
const QUERY = '(max-width: 767px)';

export function useIsMobile() {
  const [is, setIs] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = e => setIs(e.matches);
    mq.addEventListener('change', on);
    setIs(mq.matches);
    return () => mq.removeEventListener('change', on);
  }, []);

  return is;
}
