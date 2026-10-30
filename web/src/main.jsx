import React from 'react';
import {createRoot} from 'react-dom/client';
import routes from 'virtual:open-admin/routes';
import {Layouts, registerRoutes} from '@jiangood/open-admin';
import './styles/stock.css';

registerRoutes(routes);
createRoot(document.getElementById('root')).render(<Layouts/>);
