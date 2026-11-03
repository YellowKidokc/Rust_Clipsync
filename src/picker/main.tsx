import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { Picker } from './Picker'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Picker />
  </StrictMode>,
)
