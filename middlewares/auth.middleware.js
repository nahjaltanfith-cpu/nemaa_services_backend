import jwt from 'jsonwebtoken';

// Verifies a JWT and its claims; throws on anything invalid. Shared with the Socket.io handshake.
export const verifyAccessToken = (token) => {
    const user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (!Number.isSafeInteger(user.id) || user.id < 1
        || typeof user.role !== 'string' || !Number.isFinite(user.exp)) {
        throw new Error('Invalid token claims.');
    }
    return user;
};

export const authenticate = (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '');
    if (!match) {
        return res.status(401).json({
            success: false, message: 'Access token is missing.', data: null,
        });
    }
    try {
        req.user = verifyAccessToken(match[1]);
    } catch {
        return res.status(401).json({
            success: false, message: 'Invalid or expired token.', data: null,
        });
    }
    return next();
};
// Roles are exact matches: explicitly include legacy roles where appropriate.
export const checkRole = (...roles) => (req, res, next) =>
    roles.includes(req.user?.role)
        ? next()
        : res.status(403).json({
            success: false, message: 'Forbidden: insufficient role.', data: null,
        });

// Staff roles allowed to review NGOs. 'SUPER_ADMIN' is the legacy name the dashboard uses.
export const ADMIN_ROLES = ['admin', 'SUPER_ADMIN'];
// Role carried by NGO tokens (NGOs live in the ngos table, not users).
export const NGO_ROLE = 'ngo';
