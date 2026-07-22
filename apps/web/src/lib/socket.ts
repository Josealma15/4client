import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@4client/shared';
import { useAuthStore } from '../store/auth';
import { resolveApiBase } from './apiBase';

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(_token: string): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io(resolveApiBase(), {
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
