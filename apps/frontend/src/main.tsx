import { createRoot } from 'react-dom/client';

import App from './app/App.tsx';
import { AppStoreProvider } from './store/app-store';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <AppStoreProvider>
    <App />
  </AppStoreProvider>,
);
