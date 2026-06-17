import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const URL = window.location.origin;

let socket = null;

function getSocket() {
  if (!socket) {
    socket = io(URL, { transports: ['websocket', 'polling'] });
  }
  return socket;
}

export function useSocket(projectId, handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!projectId) return;
    const s = getSocket();
    s.emit('join:project', projectId);

    const events = [
      'scene:image:done',
      'scene:image:error',
      'job:step',
      'job:done',
      'job:error',
      'voice:preview:done',
      'voice:preview:error',
    ];

    const listener = (event) => (data) => {
      handlersRef.current?.[event]?.(data);
    };

    const listeners = events.map((e) => {
      const fn = listener(e);
      s.on(e, fn);
      return [e, fn];
    });

    return () => {
      s.emit('leave:project', projectId);
      listeners.forEach(([e, fn]) => s.off(e, fn));
    };
  }, [projectId]);
}
