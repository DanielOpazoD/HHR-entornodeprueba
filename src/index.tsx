import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from '@/App';
import { firebaseReady, mountConfigWarning } from '@/firebaseConfig';
import { queryClient } from '@/config/queryClient';
import { GlobalErrorBoundary } from '@/components/shared/GlobalErrorBoundary';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

const renderApp = () => {
  console.warn('[Index] 🚀 Rendering Application...');
  root.render(
    <React.StrictMode>
      <GlobalErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </GlobalErrorBoundary>
    </React.StrictMode>
  );
};

firebaseReady.then(renderApp).catch((error) => {
  console.error('Firebase initialization failed', error);
  mountConfigWarning('No se pudo inicializar Firebase. Revisa las variables de entorno en Netlify.');
});
