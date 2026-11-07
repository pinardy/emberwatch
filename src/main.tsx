import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { GuardedApp } from './ui/ErrorBoundary'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <GuardedApp>
      <App />
    </GuardedApp>
  </StrictMode>,
)
