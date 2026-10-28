import { HttpError } from './httpError.js';

/**
 * Wraps a route handler in the API envelope:
 * success → { success, message, data }; HttpError → its status, message and code; anything else → 500.
 */
export const handle = (label, status, message, run) => async (req, res) => {
    try {
        const data = await run(req);
        return res.status(status).json({ success: true, message, data: data ?? null });
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({
                success: false, message: error.message, code: error.code, data: null,
            });
        }
        console.error(`[${label}]`, error);
        // Locally the real cause goes into the message (the dashboard shows it in its toast); never in production.
        const detail = process.env.NODE_ENV === 'development' ? ` (${label}: ${error.message})` : '';
        return res.status(500).json({ success: false, message: `حدث خطأ في الخادم، حاول مرة أخرى${detail}`, data: null });
    }
};
