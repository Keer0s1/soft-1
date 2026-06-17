import { Link, Outlet } from 'react-router-dom';
import StatusBar from './components/StatusBar.jsx';
import ToastContainer from './components/Toast.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">🎬 Генератор роликов</Link>
        <StatusBar />
      </header>
      <main className="container">
        <Outlet />
      </main>
      <ToastContainer />
    </div>
  );
}
