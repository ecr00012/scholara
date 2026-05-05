import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installTestHooks } from './testHooks';
import './index.css';

installTestHooks();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
