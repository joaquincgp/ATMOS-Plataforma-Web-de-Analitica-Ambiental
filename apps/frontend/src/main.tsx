import { createRoot } from 'react-dom/client';

import App from './app/App.tsx';
import { AuthProvider } from './contexts/auth-context';
import { WorkspaceProvider } from './contexts/workspace-context';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <WorkspaceProvider>
      <App />
    </WorkspaceProvider>
  </AuthProvider>,
);
