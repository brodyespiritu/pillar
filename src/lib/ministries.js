import { P } from './icons';

/*
 * Ministries a new attendee can be connected to during service.
 * `name` is what gets stored on the member profile (as a group tag)
 * and shown under "New Connections" in the Weekly Recap.
 */
export const MINISTRIES = [
  { name: 'Worship & Music',   icon: P.book,     color: '#8B5CF6', desc: 'Vocals, band & production' },
  { name: "Children's",        icon: P.star,     color: '#F59E0B', desc: 'Kids & nursery' },
  { name: 'Youth',             icon: P.users,    color: '#EC4899', desc: 'Middle & high school' },
  { name: 'Young Adults',      icon: P.users,    color: '#06B6D4', desc: '18–30s community' },
  { name: 'Hospitality',       icon: P.handshake,color: '#10B981', desc: 'Greeters, ushers & café' },
  { name: 'Prayer',            icon: P.heart,    color: '#EF4444', desc: 'Intercession & altar' },
  { name: 'Outreach',          icon: P.location, color: '#3B82F6', desc: 'Evangelism & community' },
  { name: 'Missions',          icon: P.radio,    color: '#0EA5E9', desc: 'Local & global missions' },
  { name: 'Media & Tech',      icon: P.grid,     color: '#6366F1', desc: 'Sound, stream & slides' },
  { name: 'Life Groups',       icon: P.layers,   color: '#14B8A6', desc: 'Small groups & discipleship' },
  { name: "Men's",             icon: P.person,   color: '#0B3558', desc: "Men's fellowship" },
  { name: "Women's",           icon: P.person,   color: '#DB2777', desc: "Women's fellowship" },
  { name: 'Care & Benevolence',icon: P.heart,    color: '#F43F5E', desc: 'Support & benevolence' },
  { name: 'Serve Team',        icon: P.check,    color: '#22C55E', desc: 'General volunteering' },
];
