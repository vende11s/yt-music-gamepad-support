import { createPlugin } from '@/utils';
import { onPlayerApiReady, onUnload } from './renderer';

export default createPlugin({
  name: () => 'Gamepad Support',
  description: () => 'Adds gamepad spatial navigation and media controls',
  restartNeeded: false,
  config: {
    enabled: true,
  },
  renderer: {
    onPlayerApiReady,
    stop: onUnload,
  },
});
