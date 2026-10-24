// Rejects non-numeric :id params before they reach a query (they would never match a row).
export const parseIdParam = (name = 'id') => (req, res, next) => {
    const id = Number(req.params[name]);
    if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(404).json({ success: false, message: 'غير موجود', data: null });
    }
    req.params[name] = id;
    return next();
};
