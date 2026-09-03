import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { Inicio } from './screens/Inicio'
import { Lobby } from './screens/Lobby'
import { Mesa } from './screens/Mesa'
import { Cola } from './screens/Cola'
import { FinPartida } from './screens/FinPartida'

function Splash({ text = 'Entrando' }: { text?: string }) {
  return (
    <div style={{
      minHeight: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16,
      background: 'var(--bg-grad)',
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: '50%',
        border: '2px solid rgba(227,178,60,.25)', borderTopColor: 'var(--gold)',
        animation: 'om-spin 1s linear infinite',
      }} />
      <div className="label" style={{ color: 'var(--gold)' }}>{text}</div>
    </div>
  )
}

function Gate() {
  const { loading, error } = useAuth()

  if (loading) return <Splash />

  if (error) {
    return (
      <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center', minHeight: '100%' }}>
        <div className="label" style={{ color: 'var(--lose)' }}>No se pudo iniciar sesión</div>
        <div style={{ color: 'var(--muted-3)', fontSize: 14, lineHeight: 1.6 }}>{error}</div>
        <div style={{ color: 'var(--muted-2)', fontSize: 13, lineHeight: 1.6 }}>
          Si dice que los inicios anónimos están deshabilitados, actívalos en Supabase →
          Authentication → Sign In / Providers → Anonymous sign-ins.
        </div>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<Inicio />} />
      <Route path="/sala/:code" element={<Lobby />} />
      <Route path="/sala/:code/mesa" element={<Mesa />} />
      <Route path="/sala/:code/cola" element={<Cola />} />
      <Route path="/sala/:code/resultado/:matchId?" element={<FinPartida />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  )
}
