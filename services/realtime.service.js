import { Server } from 'socket.io';
import { corsOptions, isAllowedOrigin } from '../config/cors.js';
import { P } from '../config/permissions.js';
import { NGO_ROLE, hasPermission, resolveUser, verifyAccessToken } from '../middlewares/auth.middleware.js';
import { isRequestVisible, viewerOf } from './requestScope.js';

// Server → client events. Clients only listen; every write goes through the REST API,
// so validation and authorization live in one place.
export const EVENTS = {
    MESSAGE_NEW: 'message:new',           // { ngoId, message }
    MESSAGES_READ: 'messages:read',       // { ngoId, reader: 'admin' | 'ngo' }
    NGO_STATUS: 'ngo:status',             // { ngoId, accountStatus, adminNotes, statusUpdatedAt }
    NGO_UPDATED: 'ngo:updated',           // { ngoId } — profile, documents or registration changed
    CONVERSATION_STATE: 'conversation:state', // { ngoId, open }
    // Requests (separate from the general NGO thread above).
    REQUEST_UPDATED: 'request:updated',   // { requestId, ngoId, status } — status null = files changed
    REQUEST_MESSAGE: 'request:message',   // { requestId, ngoId, message }
    REQUEST_READ: 'request:read',         // { requestId, ngoId, reader: 'admin' | 'ngo' }
};

const ADMINS_ROOM = 'admins';
const ngoRoom = (ngoId) => `ngo:${ngoId}`;

// setTimeout overflows above ~24.8 days; longer-lived tokens just keep the default.
const MAX_TIMER_MS = 2 ** 31 - 1;

let io = null;

/** Attaches Socket.io to the HTTP server. Clients pass the same JWT as the REST API in `auth.token`. */
export const initRealtime = (httpServer) => {
    io = new Server(httpServer, {
        // Same origins as the REST API (config/cors.js). `cors` only sets headers for polling;
        // allowRequest also turns away WebSocket handshakes from other sites.
        cors: corsOptions,
        allowRequest: (req, callback) => callback(null, isAllowedOrigin(req.headers.origin)),
    });

    io.use(async (socket, next) => {
        try {
            const payload = verifyAccessToken(socket.handshake.auth?.token || '');
            const user = await resolveUser(payload);
            if (!user || (user.role !== NGO_ROLE && !user.isStaff)) throw new Error('role');
            socket.data.user = user;
            // Kept to re-read the account before each staff event (see emitToStaff).
            socket.data.payload = payload;
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

/**
 * Sends to the staff sockets whose user passes `allowed(user)`. Each account is re-read first, so
 * permission, scope and deactivation changes apply to live connections, not only to new ones.
 */
const emitToStaff = async (allowed, event, payload) => {
    const ids = io?.sockets.adapter.rooms.get(ADMINS_ROOM);
    if (!ids) return;
    await Promise.all([...ids].map(async (id) => {
        const socket = io.sockets.sockets.get(id);
        if (!socket) return;
        const user = await resolveUser(socket.data.payload);
        if (!user) {
            socket.disconnect(true);
            return;
        }
        socket.data.user = user;
        if (await allowed(user)) socket.emit(event, payload);
    }));
};

const report = (promise) => promise.catch((error) => console.error('[realtime] emit:', error));

// NGO account events (profile, status, general thread): staff who may read NGO files.
export const emitToAdmins = (event, payload) =>
    report(emitToStaff((user) => hasPermission(user, P.READ_ORG_DOCS), event, payload));

export const emitToThread = (ngoId, event, payload) => {
    emitToNgo(ngoId, event, payload);
    emitToAdmins(event, payload);
};

// Request events: the NGO (ngoId null = internal change, e.g. assignment) and the staff whose
// request scope includes this request.
export const emitToRequest = (ngoId, requestId, event, payload) => {
    if (ngoId) emitToNgo(ngoId, event, payload);
    report(emitToStaff(
        async (user) => hasPermission(user, P.READ_ORDERS) && isRequestVisible(viewerOf(user), requestId),
        event, payload
    ));
};
