/*
 * When a mass text may go out.
 *
 * The TCPA bars telemarketing calls and texts outside 8:00 AM – 9:00 PM in the
 * recipient's local time. Bethesda holds itself to 8:00 AM – 5:00 PM, which is
 * stricter than the law requires, so nothing here needs to be near the edge.
 *
 * "Local" means theirs, not ours. The congregation list reaches California,
 * Colorado, New Mexico and Texas, so an 8:05 AM send from Georgia would land at
 * 5:05 AM on the west coast. The zone is read from the area code — the only
 * signal a phone number carries — and anything unrecognised is treated as the
 * church's own zone.
 */

export const OPEN_HOUR = 8;    // 8:00 AM
export const CLOSE_HOUR = 17;  // 5:00 PM
export const CHURCH_ZONE = 'America/New_York';

const ET = 'America/New_York';
const CT = 'America/Chicago';
const MT = 'America/Denver';
const AZ = 'America/Phoenix';      // no daylight saving
const PT = 'America/Los_Angeles';
const AK = 'America/Anchorage';
const HI = 'Pacific/Honolulu';

const ZONE = {};
const put = (zone, codes) => codes.split(/\s+/).filter(Boolean).forEach(c => { ZONE[c] = zone; });

put(ET, `
  202 203 207 212 215 216 219 220 223 227 229 231 234 239 240 248 252 260 267 269 272 276
  301 302 304 305 313 315 317 321 326 330 332 336 339 347 351 352 380 386 401 404 407 410
  412 413 419 423 434 440 443 445 463 470 475 478 484 502 508 513 516 517 518 540 561
  567 570 571 574 585 586 603 606 607 609 610 614 616 617 631 640 646 667 678 679 680
  681 689 703 704 706 716 717 718 724 727 732 734 740 743 754 757 762 765 770 772 774
  781 786 802 803 804 810 812 813 814 826 828 838 839 843 845 848 854 856 857 859 862 863
  864 865 878 904 906 908 910 912 914 917 919 929 930 934 937 941 943 947 954 973 978
  980 984 989`);

put(CT, `
  205 210 214 217 218 224 225 228 251 254 256 262 270 274 281 308 309 312 314 316 318
  319 320 325 327 331 334 337 346 361 364 402 405 409 414 417 430 432 447 464 469 479
  501 504 507 512 515 531 534 539 557 563 572 573 580 601 605 608 612 615 618 620 629
  630 636 641 651 659 660 662 682 701 708 712 713 715 726 730 731 737 763 769 773 779
  785 806 815 816 817 830 832 847 850 870 872 901 903 913 918 920 931 936 938 940 945
  952 956 972 975 979 985`);

put(MT, `303 307 308 385 406 435 505 575 719 720 915 970 983 986 208`);
put(AZ, `480 520 602 623 928`);
put(PT, `
  206 209 213 253 279 310 323 341 350 360 408 415 424 425 442 458 503 509 510 530 541
  559 562 564 619 626 628 650 657 661 669 702 707 714 725 747 760 775 805 818 820 831
  840 858 909 916 925 949 951 971`);
put(AK, `907`);
put(HI, `808`);

/* Nebraska's 308 and Idaho's 208 straddle a zone line; both are listed above in
   the half that covers most of the state. */

export const areaCode = phone => String(phone || '').replace(/\D/g, '').slice(-10).slice(0, 3);

/** The recipient's IANA zone, or null when the area code is unrecognised. */
export function zoneFor(phone) {
  return ZONE[areaCode(phone)] || null;
}

/** The hour of the day, 0–23, where this number lives. */
export function localHour(phone, now = new Date()) {
  const zone = zoneFor(phone) || CHURCH_ZONE;
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour: 'numeric', hour12: false,
  }).format(now);
  // Some engines render midnight as 24.
  return Number(hour) % 24;
}

/** True when it is inside 8:00 AM – 5:00 PM where this number lives. */
export function canTextNow(phone, now = new Date()) {
  const h = localHour(phone, now);
  return h >= OPEN_HOUR && h < CLOSE_HOUR;
}

/**
 * Split a recipient list into those who may be texted right now and those who
 * may not, so a send is never all-or-nothing because of one distant number.
 */
export function splitByHours(recipients = [], now = new Date()) {
  const ok = [], held = [];
  for (const r of recipients) (canTextNow(r.phone, now) ? ok : held).push(r);
  return { ok, held };
}

/** Whether the church itself is inside the window — what greys the button out. */
export const windowOpen = (now = new Date()) => canTextNow('', now);

export const WINDOW_LABEL = '8:00 AM to 5:00 PM';
