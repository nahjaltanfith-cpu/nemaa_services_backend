import { Server } from 'socket.io';
import { ADMIN_ROLES, NGO_ROLE, verifyAccessToken } from '../middlewares/auth.middleware.js';

// Server → client events. Clients only listen; every write goes through the REST API,
// so validation and authorization live in one place.
export const EVENTS = {
    MESSAGE_NEW: 'message:new',           // { ngoId, message }
    MESSAGES_READ: 'messages:read',       // { ngoId, reader: 'admin' | 'ngo' }
    NGO_STATUS: 'ngo:status',             // { ngoId, accountStatus, adminNotes, statusUpdatedAt }
    NGO_UPDATED: 'ngo:updated',           // { ngoId } — profile, documents or registration changed
    CONVERSATION_STATE: 'conversation:state', // { ngoId, open }
};

const ADMINS_ROOM = 'admins';
const ngoRoom = (ngoId) => `ngo:${ngoId}`;

// setTimeout overflows above ~24.8 days; longer-lived tokens just keep the default.
const MAX_TIMER_MS = 2 ** 31 - 1;

let io = null;

/** Attaches Socket.io to the HTTP server. Clients pass the same JWT as the REST API in `auth.token`. */
export const initRealtime = (httpServer) => {
    io = new Server(httpServer, {
        // Auth is a bearer token in the handshake (no cookies), so any origin is safe to accept.
        cors: { origin: '*' },
    });

    io.use((socket, next) => {
        try {
            const user = verifyAccessToken(socket.handshake.auth?.token || '');
            if (user.role !== NGO_ROLE && !ADMIN_ROLES.includes(user.role)) throw new Error('role');
            socket.data.user = user;
            return next();
        } catch {
            return next(new Error('unauthorized'));
        }
    });

    io.on('connection', (socket) => {
        const { user } = socket.data;
        socket.join(user.role === NGO_ROLE ? ngoRoom(user.id) : ADMINS_ROOM);
        // Drop the connection when the token expires, as the REST API would.
        const ttl = user.exp * 1000 - Date.now();
        if (ttl < MAX_TIMER_MS) {
            const timer = setTimeout(() => socket.disconnect(true), Math.max(ttl, 0));
            socket.on('disconnect', () => clearTimeout(timer));
        }
    });

    return io;
};

// Emitters are no-ops until initRealtime runs (e.g. in scripts), so services can always call them.
export const emitToNgo = (ngoId, event, payload) => io?.to(ngoRoom(ngoId)).emit(event, payload);
export const emitToAdmins = (event, payload) => io?.to(ADMINS_ROOM).emit(event, payload);
export const emitToThread = (ngoId, event, payload) =>
    io?.to([ngoRoom(ngoId), ADMINS_ROOM]).emit(event, payload);
