import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from '@/App';
import { UIProvider } from '@/context/UIContext';
import { DemoModeProvider } from '@/context/DemoModeContext';
import { AuthProvider } from '@/context/AuthContext';
import { firebaseReady, mountConfigWarning } from '@/firebaseConfig';
import { AuditProvider } from '@/context';
import { queryClient } from '@/config/queryClient';
import { GlobalErrorBoundary } from '@/components/shared/GlobalErrorBoundary';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

const renderApp = () => {
  console.log('[Index] 🚀 Rendering Application...');
  root.render(
    <React.StrictMode>
      <GlobalErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <UIProvider>
              <DemoModeProvider>
                <AuditProvider userId="anon">
                  <App />
                </AuditProvider>
              </DemoModeProvider>
            </UIProvider>
          </AuthProvider>
        </QueryClientProvider>
      </GlobalErrorBoundary>
    </React.StrictMode>
  );
};

firebaseReady.then(renderApp).catch((error) => {
  console.error('Firebase initialization failed', error);
  mountConfigWarning('No se pudo inicializar Firebase. Revisa las variables de entorno en Netlify.');
});
