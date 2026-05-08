import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { LocaleProvider } from './i18n'
import { initTheme } from './lib/theme'
import './styles.css'

initTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </React.StrictMode>,
)
