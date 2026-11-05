import React from 'react';

import Layout from './Layout';
import GlobalStyles from './styles/GlobalStyles';
import { AppProvider } from './context/AppContext';
import ErrorBoundary from './ErrorBoundary';

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <AppProvider>
        <Layout />
        <GlobalStyles />
      </AppProvider>
    </ErrorBoundary>
  );
}

export default App;
