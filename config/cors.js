// Browser origins allowed to call the API and open Socket.io connections.
// CORS_ORIGINS: comma-separated, e.g. "https://namaa.sa,https://admin.namaa.sa". Unset = the local
// Vite dev servers (NGO site on 5173, dashboard on 5174), so production must always set it.
// Auth is a bearer token (no cookies), so this limits which sites can use the API from a browser;
// requests without an Origin header (server-to-server, curl, health checks) are always allowed.
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:5174'];

const normalize = (origin) => origin.trim().replace(/\/+$/, '').toLowerCase();

export const allowedOrigins = () => {
    const configured = (process.env.CORS_ORIGINS || '').split(',').map(normalize).filter(Boolean);
    return configured.length ? configured : DEV_ORIGINS;
};

export const isAllowedOrigin = (origin) => !origin || allowedOrigins().includes(normalize(origin));

// Shared by Express (cors) and Socket.io's polling transport.
export const corsOptions = {
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
};
