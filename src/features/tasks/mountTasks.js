import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Tasks } from './Tasks.jsx';

let tasksRoot = null;

export function mountTasks(props) {
  const host = document.getElementById('room-view-tasks');
  if (!host) return;
  if (!tasksRoot) {
    host.replaceChildren();
    tasksRoot = createRoot(host);
  }
  tasksRoot.render(createElement(Tasks, props));
}
