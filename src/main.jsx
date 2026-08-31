import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import App from './App';
import Dialogs from './components/Dialogs';
import { startAutoUpdate } from './lib/autoUpdate';
import './styles/global.css';
/* After global so its .modal.sheet rules land on top of the page stylesheets. */
import './styles/mobileForms.css';
import { watchKeyboard } from './lib/keyboard';

startAutoUpdate();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Dialogs />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

/* Publishes --kb so every bottom sheet can sit above the keyboard. */
watchKeyboard();
