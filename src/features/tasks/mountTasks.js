import { createElement } from 'react';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import { Tasks } from './Tasks.jsx';

const tasksRoot = createHostAwareRoot();

export function mountTasks(props) {
  const host = document.getElementById('room-view-tasks');
  if (!host) return;
  tasksRoot.render(host, createElement(Tasks, props));
}
