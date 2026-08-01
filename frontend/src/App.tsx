import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [status, setStatus] = useState<'checking' | 'ok' | 'error'>('checking')

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setStatus(data.status === 'ok' ? 'ok' : 'error'))
      .catch(() => setStatus('error'))
  }, [])

  return (
    <div>
      <h1>AppFair</h1>
      <p>
        Backend status:{' '}
        {status === 'checking' && 'checking...'}
        {status === 'ok' && 'connected'}
        {status === 'error' && 'not reachable (is the backend running?)'}
      </p>
    </div>
  )
}

export default App
