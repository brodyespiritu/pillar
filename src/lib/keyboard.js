/*
 * How much of the screen the on-screen keyboard is covering.
 *
 * A bottom sheet is position:fixed against the *layout* viewport, which iOS
 * does not shrink when the keyboard opens — so the keyboard simply covers the
 * bottom of the sheet, which is exactly where the text field and the Save
 * button are. visualViewport is the only thing that reports the area actually
 * visible.
 *
 * Published as a CSS variable rather than handed to each component, so a sheet
 * only has to say `padding-bottom: var(--kb)` and every one of them behaves the
 * same way.
 */

const VAR = '--kb';

export function watchKeyboard() {
  if (typeof window === 'undefined') return () => {};
  const vv = window.visualViewport;
  const root = document.documentElement;

  /* No visualViewport (older Android browsers): leave the variable at 0 rather
     than guessing, so layouts fall back to today's behaviour. */
  if (!vv) { root.style.setProperty(VAR, '0px'); return () => {}; }

  const apply = () => {
    /* offsetTop matters: when the page is scrolled under the keyboard the
       visible area both shrinks and moves. */
    const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    /* Under about 80px it is browser chrome shifting, not a keyboard, and
       reacting to it makes sheets jitter while scrolling. */
    root.style.setProperty(VAR, `${covered > 80 ? Math.round(covered) : 0}px`);
  };

  apply();
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  return () => {
    vv.removeEventListener('resize', apply);
    vv.removeEventListener('scroll', apply);
    root.style.setProperty(VAR, '0px');
  };
}
