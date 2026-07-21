import { createContext, useContext, useState } from 'react';
import SettingsModal from '../pages/settings/SettingsModal';

/*
 * One settings surface for the whole app. Any gear/settings button calls
 * useSettings().openSettings('<section>') to slide up the same card.
 */
const SettingsCtx = createContext({ openSettings: () => {} });

export function SettingsProvider({ children }) {
  const [section, setSection] = useState(null); // null = closed

  return (
    <SettingsCtx.Provider value={{ openSettings: (s = 'general') => setSection(s) }}>
      {children}
      {section && <SettingsModal section={section} onClose={() => setSection(null)} />}
    </SettingsCtx.Provider>
  );
}

export const useSettings = () => useContext(SettingsCtx);
