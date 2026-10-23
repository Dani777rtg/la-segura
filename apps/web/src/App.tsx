import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import Chat from './pages/Chat';
import Presentation from './pages/Presentation';
import PresentationControl from './pages/PresentationControl';
import Community from './pages/Community';
import Call from './pages/Call';
import Credits from './pages/Credits';
import Forgot from './pages/Forgot';
import Lookup from './pages/Lookup';
import MapPage from './pages/MapPage';
import Login from './pages/Login';
import Profile from './pages/Profile';
import Reports from './pages/Reports';
import Register from './pages/Register';
import Share from './pages/Share';
import Verify from './pages/Verify';
import Welcome from './pages/Welcome';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Welcome />} />
      <Route path="/registro" element={<Register />} />
      <Route path="/verificar" element={<Verify />} />
      <Route path="/entrar" element={<Login />} />
      <Route path="/recuperar" element={<Forgot />} />
      <Route path="/presentacion" element={<Presentation />} />
      <Route path="/presentacion/control" element={<PresentationControl />} />
      <Route path="/compartir" element={<Share />} />
      <Route path="/app" element={<AppLayout />}>
        <Route index element={<Community />} />
        <Route path="revisar" element={<Chat />} />
        <Route path="llamar" element={<Call />} />
        <Route path="consulta" element={<Lookup />} />
        <Route path="comunidad" element={<Navigate to="/app" replace />} />
        <Route path="mapa" element={<MapPage />} />
        <Route path="creditos" element={<Credits />} />
        <Route path="perfil" element={<Profile />} />
        <Route path="reportes" element={<Reports />} />
      </Route>
      <Route path="*" element={<Welcome />} />
    </Routes>
  );
}
