import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({});

export function AuthProvider({ children }) {
  const [user, setUser]           = useState(null);
  const [profile, setProfile]     = useState(null);
  const [pinVerified, setPinVerified] = useState(false);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setPinVerified(false);
      if (session?.user) fetchProfile(session.user.id);
      else { setProfile(null); setLoading(false); }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId) {
    const { data } = await supabase
      .from('staff')
      .select('*')
      .eq('id', userId)
      .single();
    setProfile(data);
    setLoading(false);
  }

  async function signInWithEmail(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
    return { error };
  }

  // PIN is verified server-side against a bcrypt hash; the hash never leaves the DB.
  /*
   * `holdMs` lets the caller play an unlock animation before the PIN screen
   * disappears. Flipping the flag immediately unmounts the screen mid-frame,
   * so the lock never gets to open. The answer is returned straight away
   * either way — only the state change waits.
   */
  async function verifyPin(pin, holdMs = 0) {
    if (!user) return false;
    const { data, error } = await supabase.rpc('verify_pin', { input: pin });
    if (error) { console.error('verify_pin', error.message); return false; }
    if (data !== true) return false;
    if (holdMs > 0) setTimeout(() => setPinVerified(true), holdMs);
    else setPinVerified(true);
    return true;
  }

  // Set (or change) the current user's PIN — hashed server-side.
  async function setPin(pin) {
    if (!user) return false;
    const { error } = await supabase.rpc('set_pin', { input: pin });
    if (error) { console.error('set_pin', error.message); return false; }
    return true;
  }

  // Finish first-login onboarding: refresh the profile and unlock the app.
  async function completeOnboarding() {
    if (user) await fetchProfile(user.id);
    setPinVerified(true);
  }

  async function signOut() {
    setPinVerified(false);
    setProfile(null);
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{
      user, profile, pinVerified, loading,
      signInWithEmail, signInWithGoogle, verifyPin, setPin, completeOnboarding, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
