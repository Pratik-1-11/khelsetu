import { Server } from 'socket.io';
import env from '../env.js';
import logger from '../logger/index.js';
import { verifyToken } from '../auth/jwt.js';

let io = null;
const connectedUsers = new Map();
const matchRooms = new Map();

export const initializeWebSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: env.client.url,
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    maxHttpBufferSize: 1e8
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }
      const decoded = verifyToken(token);
      socket.user = decoded;
      socket.userId = decoded.userId;
      socket.organizationId = decoded.organizationId;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    connectedUsers.set(socket.id, {
      userId: socket.user?.userId,
      email: socket.user?.email,
      connectedAt: new Date(),
      socketId: socket.id
    });

    logger.info(`Client connected: ${socket.id}`, { userId: socket.user?.userId });

    socket.on('subscribe:match', (matchId) => {
      socket.join(`match:${matchId}`);
      addToMatchRoom(matchId, socket.id);
      logger.debug(`Socket ${socket.id} subscribed to match ${matchId}`);
      broadcastMatchPresence(matchId);
    });

    socket.on('unsubscribe:match', (matchId) => {
      socket.leave(`match:${matchId}`);
      removeFromMatchRoom(matchId, socket.id);
      logger.debug(`Socket ${socket.id} unsubscribed from match ${matchId}`);
      broadcastMatchPresence(matchId);
    });

    socket.on('subscribe:tournament', (tournamentId) => {
      socket.join(`tournament:${tournamentId}`);
      logger.debug(`Socket ${socket.id} subscribed to tournament ${tournamentId}`);
    });

    socket.on('unsubscribe:tournament', (tournamentId) => {
      socket.leave(`tournament:${tournamentId}`);
      logger.debug(`Socket ${socket.id} unsubscribed from tournament ${tournamentId}`);
    });

    socket.on('subscribe:organization', (organizationId) => {
      socket.join(`organization:${organizationId}`);
      logger.debug(`Socket ${socket.id} subscribed to organization ${organizationId}`);
    });

    socket.on('heartbeat', () => {
      socket.lastHeartbeat = Date.now();
      socket.emit('heartbeat:ack', { timestamp: Date.now() });
    });

    socket.on('ping:server', (callback) => {
      if (typeof callback === 'function') {
        callback({ pong: true, serverTime: Date.now() });
      }
    });

    socket.on('disconnect', (reason) => {
      connectedUsers.delete(socket.id);
      removeFromAllMatchRooms(socket.id);
      logger.info(`Client disconnected: ${socket.id}`, { reason });
    });

    socket.on('error', (error) => {
      logger.error(`Socket error: ${socket.id}`, { error: error.message });
    });

    socket.emit('connected', {
      socketId: socket.id,
      serverTime: Date.now(),
      heartbeatInterval: 30000
    });
  });

  setInterval(() => {
    io.sockets.sockets.forEach((socket) => {
      if (socket.lastHeartbeat && Date.now() - socket.lastHeartbeat > 120000) {
        logger.warn(`Socket ${socket.id} heartbeat timeout, disconnecting`);
        socket.disconnect(true);
      }
    });
  }, 30000);

  logger.info(`Socket.IO server initialized`);
  return io;
};

const addToMatchRoom = (matchId, socketId) => {
  if (!matchRooms.has(matchId)) {
    matchRooms.set(matchId, new Set());
  }
  matchRooms.get(matchId).add(socketId);
};

const removeFromMatchRoom = (matchId, socketId) => {
  const room = matchRooms.get(matchId);
  if (room) {
    room.delete(socketId);
    if (room.size === 0) {
      matchRooms.delete(matchId);
    }
  }
};

const removeFromAllMatchRooms = (socketId) => {
  matchRooms.forEach((sockets, matchId) => {
    if (sockets.has(socketId)) {
      sockets.delete(socketId);
      broadcastMatchPresence(matchId);
    }
  });
};

const broadcastMatchPresence = (matchId) => {
  const room = matchRooms.get(matchId);
  if (room) {
    io.to(`match:${matchId}`).emit('match:presence', {
      matchId,
      viewerCount: room.size,
      timestamp: Date.now()
    });
  }
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
};

export const emitToMatch = (matchId, event, data) => {
  if (!io) return;
  io.to(`match:${matchId}`).emit(event, data);
};

export const emitToTournament = (tournamentId, event, data) => {
  if (!io) return;
  io.to(`tournament:${tournamentId}`).emit(event, data);
};

export const emitToOrganization = (organizationId, event, data) => {
  if (!io) return;
  io.to(`organization:${organizationId}`).emit(event, data);
};

export const emitToAll = (event, data) => {
  if (!io) return;
  io.emit(event, data);
};

export const emitToUser = (userId, event, data) => {
  if (!io) return;
  connectedUsers.forEach((user, socketId) => {
    if (user.userId === userId) {
      io.to(socketId).emit(event, data);
    }
  });
};

export const getConnectedUsers = () => {
  return Array.from(connectedUsers.values());
};

export const getMatchViewerCount = (matchId) => {
  return matchRooms.get(matchId)?.size || 0;
};

export const isUserConnected = (userId) => {
  for (const user of connectedUsers.values()) {
    if (user.userId === userId) return true;
  }
  return false;
};

export default {
  initializeWebSocket,
  getIO,
  emitToMatch,
  emitToTournament,
  emitToOrganization,
  emitToAll,
  emitToUser,
  getConnectedUsers,
  getMatchViewerCount,
  isUserConnected
};