import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

document.documentElement.dataset.theme = localStorage.getItem('gitdesk.theme') === 'dark' ? 'dark' : 'light'

createRoot(document.getElementById('root')!).render(<App />)
