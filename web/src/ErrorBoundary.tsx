import React from 'react';

interface State { hasError: boolean; error: Error | null; }
interface Props { children: React.ReactNode; }

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    const { hasError, error } = this.state;
    const { children } = this.props;
    if (hasError) {
      return (
        <div style={{ color: '#fff', background: '#36393f', padding: 24, fontFamily: 'monospace', height: '100vh' }}>
          <h2 style={{ color: '#f04747' }}>App crashed</h2>
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: 16, color: '#f9a839' }}>
            {error?.message}
            {'\n\n'}
            {error?.stack}
          </pre>
        </div>
      );
    }
    return children;
  }
}
