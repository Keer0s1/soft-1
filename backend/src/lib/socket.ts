import { Server as SocketServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';

let io: SocketServer | null = null;

export function initSocket(server: HttpServer): SocketServer {
  io = new SocketServer(server, { cors: { origin: '*' } });
  io.on('connection', (socket) => {
    socket.on('join:project', (projectId: string) => {
      socket.join(`project:${projectId}`);
    });
    socket.on('leave:project', (projectId: string) => {
      socket.leave(`project:${projectId}`);
    });
  });
  return io;
}

export function getIO(): SocketServer | null {
  return io;
}

export function emitToProject(projectId: string, event: string, data?: unknown): void {
  io?.to(`project:${projectId}`).emit(event, data);
}
