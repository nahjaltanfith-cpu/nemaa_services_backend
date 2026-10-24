// Validates req.body against a Joi schema and replaces it with the normalized value.
export const validateBody = (schema) => (req, res, next) => {
    const { value, error } = schema.validate(req.body ?? {}, {
        abortEarly: true, convert: true, stripUnknown: true,
    });
    if (error) {
        return res.status(400).json({
            success: false, message: error.details[0].message, data: null,
        });
    }
    req.body = value;
    return next();
};
