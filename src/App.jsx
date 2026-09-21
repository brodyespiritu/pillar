import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/auth/LoginPage';
import RsvpPage from './pages/rsvp/RsvpPage';
import RsvpHome from './pages/rsvp/RsvpHome';
import PublicForm from './pages/rsvp/PublicForm';
import RsvpFormsPage from './pages/rsvp/RsvpFormsPage';
import MobileNav from './components/MobileNav';
import PINPage   from './pages/auth/PINPage';
import HomePage  from './pages/home/HomePage';
import CaresPage from './pages/care/CaresPage';
import GuestsPage from './pages/guests/GuestsPage';
import CalendarPage from './pages/calendar/CalendarPage';
import PlaybooksPage from './pages/playbooks/PlaybooksPage';
import PlaybookDetail from './pages/playbooks/PlaybookDetail';
import CalendarWidget from './pages/calendar/CalendarWidget';
import EmailPage from './pages/email/EmailPage';
import AdminPage from './pages/admin/AdminPage';
import SmsPage from './pages/sms/SmsPage';
import MembersPage from './pages/members/MembersPage';
import ReportsPage from './pages/reports/ReportsPage';
import ServicePlanner from './pages/services/ServicePlanner';
import OnboardingWizard from './pages/onboarding/OnboardingWizard';
import AppHomePage from './pages/app/HomePage';
import BulletinPage from './pages/app/BulletinPage';
import GroupsPage from './pages/app/GroupsPage';
import WatchPage from './pages/app/WatchPage';
import LivePage from './pages/app/LivePage';
import NotificationsPage from './pages/app/NotificationsPage';
import AppSettingsPage from './pages/app/SettingsPage';
import WebsiteHomePage from './pages/website/WebsiteHomePage';
import WebsiteCalendarPage from './pages/website/WebsiteCalendarPage';
import { SettingsProvider } from './context/SettingsContext';
import { ControlProvider } from './context/ControlContext';
import { normalizeRole } from './lib/admin';
import './context/control.css';

/*
 * bethesda.rsvp is the congregation's front door, not the staff app's. Its root
 * is the reservation form, so a link posted as just the domain opens straight
 * onto it — no path, no token, no sign-in.
 *
 * This is decided in the app rather than by a Vercel rewrite: a rewrite changes
 * the path the server resolves but leaves the address bar alone, and the router
 * reads the address bar, so the root would still resolve to the staff home.
 */
const isRsvpHost = typeof window !== 'undefined'
  && /(^|\.)bethesda\.rsvp$/i.test(window.location.hostname);

export default function App() {
  const { user, profile, pinVerified, loading } = useAuth();
  const isAdmin = normalizeRole(profile?.role) === 'Admin';
  const [everVerified, setEverVerified] = useState(false);

  useEffect(() => { if (pinVerified) setEverVerified(true); }, [pinVerified]);
  useEffect(() => { if (!user) setEverVerified(false); }, [user]);

  if (loading) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
      }}>
        <div style={{
          width: 32,
          height: 32,
          border: '2px solid var(--border)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'spin 0.7s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  /*
   * Signed out, the only thing the congregation can reach is the RSVP page —
   * it is the target of a link the church posts publicly, so it must render
   * before the sign-in gate. Everything else is still the login screen.
   */
  if (!user) return (
    <Routes>
      <Route path="/rsvp" element={<RsvpHome />} />
      <Route path="/rsvp/:token" element={<RsvpPage />} />
      <Route path="/dinner" element={<RsvpPage />} />
      <Route path="/form/:slug" element={<PublicForm />} />
      <Route path="/"     element={isRsvpHost ? <RsvpHome /> : <LoginPage />} />
      <Route path="*"     element={<LoginPage />} />
    </Routes>
  );

  // First login → walk the user through account setup before anything else.
  if (profile && profile.onboarded === false) return <OnboardingWizard />;

  const routes = (
    <SettingsProvider>
      <ControlProvider>
      {/* Phones get a bottom tab bar; it hides itself above 767px. */}
      <MobileNav />
      <Routes>
        <Route path="/"       element={isRsvpHost ? <RsvpHome /> : <HomePage />} />
        <Route path="/cares"  element={<CaresPage />} />
        <Route path="/guests"   element={<GuestsPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/playbooks"     element={<PlaybooksPage />} />
        <Route path="/playbooks/:id" element={<PlaybookDetail />} />
        <Route path="/widget/calendar" element={<CalendarWidget />} />
        <Route path="/rsvp" element={<RsvpHome />} />
        <Route path="/rsvp/:token" element={<RsvpPage />} />
        <Route path="/dinner" element={<RsvpPage />} />
        <Route path="/form/:slug" element={<PublicForm />} />
        <Route path="/rsvps" element={<RsvpFormsPage />} />
        <Route path="/email"    element={<EmailPage />} />
        <Route path="/admin"    element={<AdminPage />} />
        <Route path="/sms"      element={<SmsPage />} />
        <Route path="/members"  element={<MembersPage />} />
        <Route path="/reports"  element={<ReportsPage />} />
        <Route path="/services" element={<ServicePlanner />} />

        {/* Bethesda App admin — gated to admins only */}
        <Route path="/app"               element={isAdmin ? <Navigate to="/app/home" replace /> : <Navigate to="/" replace />} />
        <Route path="/app/home"          element={isAdmin ? <AppHomePage />       : <Navigate to="/" replace />} />
        <Route path="/app/bulletin"      element={isAdmin ? <BulletinPage />      : <Navigate to="/" replace />} />
        <Route path="/app/groups"        element={isAdmin ? <GroupsPage />        : <Navigate to="/" replace />} />
        <Route path="/app/watch"         element={isAdmin ? <WatchPage />         : <Navigate to="/" replace />} />
        <Route path="/app/live"          element={isAdmin ? <LivePage />          : <Navigate to="/" replace />} />
        <Route path="/app/notifications" element={isAdmin ? <NotificationsPage /> : <Navigate to="/" replace />} />
        <Route path="/app/settings"      element={isAdmin ? <AppSettingsPage />   : <Navigate to="/" replace />} />
        {/* the App section's older addresses */}
        <Route path="/app/announcements" element={<Navigate to="/app/bulletin" replace />} />
        <Route path="/app/sermons"       element={<Navigate to="/app/watch" replace />} />
        <Route path="/app/media"         element={<Navigate to="/app/watch?tab=featured" replace />} />

        {/* Website — page-by-page editors for the public site. Admin-gated like /app. */}
        <Route path="/website"           element={isAdmin ? <WebsiteHomePage />   : <Navigate to="/" replace />} />
        <Route path="/website/calendar"  element={isAdmin ? <WebsiteCalendarPage /> : <Navigate to="/" replace />} />

        <Route path="*"      element={<Navigate to="/" replace />} />
      </Routes>
      </ControlProvider>
    </SettingsProvider>
  );

  if (!pinVerified) {
    // First PIN after login → full blue screen.
    // Re-lock while already in the app → blur the page they were on, card on top.
    return everVerified
      ? (<>{routes}<PINPage overlay /></>)
      : <PINPage />;
  }

  return routes;
}
