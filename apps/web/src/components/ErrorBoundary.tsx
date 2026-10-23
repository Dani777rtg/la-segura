import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-2xl font-bold">Ay, algo se dañó</h1>
        <p className="my-4">No es tu culpa. Vuelve a cargar la página.</p>
        <button className="btn-primary" onClick={() => window.location.assign('/')}>Volver al inicio</button>
      </main>
    );
  }
}
