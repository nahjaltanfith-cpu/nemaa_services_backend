import { P } from '../config/permissions.js';
import { hasPermission } from '../middlewares/auth.middleware.js';

// Catalog fields guarded by their own permission; every other field needs manage:catalog.
const FIELD_PERMISSIONS = {
    price: P.MANAGE_PRICING,
    requiredAttachments: P.MANAGE_FORM_CONFIGS,
};

/**
 * The catalog form always sends the whole item. Fields the user may not change are taken from
 * `base` instead (the saved item on update, the schema defaults on create), so e.g. a pricing-only
 * role can save a service form but only its price is applied.
 */
export const applyAllowedFields = (user, input, base) => Object.fromEntries(
    Object.entries(input).map(([field, value]) => [
        field,
        hasPermission(user, FIELD_PERMISSIONS[field] || P.MANAGE_CATALOG) ? value : base[field],
    ])
);
