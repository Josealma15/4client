import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@4client/shared';
import { useAuthStore } from '../store/auth';

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(_token: string): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io(import.meta.env.VITE_API_URL ?? '/', {
      // Read the token fresh from the store on every (re)connection attempt,
      // so a rotated access token doesn't leave the socket stuck with a stale one.
      auth: (cb) => cb({ token: useAuthStore.getState().accessToken ?? '' }),
      transports: ['websocket'],
    });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
