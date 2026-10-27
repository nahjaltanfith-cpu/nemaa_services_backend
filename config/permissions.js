// Permission action keys ('<verb>:<object>'), as stored in permissions.key (migration 020).
// Routes check them with requirePermission / requireAnyPermission; super admins pass every check.
export const P = {
    READ_ORG_DOCS: 'read:org_docs',
    APPROVE_ORG_ACCOUNTS: 'approve:org_accounts',
    READ_ORDERS: 'read:orders',
    ASSIGN_ORDERS: 'assign:orders',
    REQUEST_ORDER_INFO: 'request:order_info',
    APPROVE_SERVICE_ORDERS: 'approve:service_orders',
    EXECUTE_ORDERS: 'execute:orders',
    DOCUMENT_UPDATES: 'document:updates',
    UPLOAD_RESULTS: 'upload:results',
    COMPLETE_ORDER: 'complete:order',
    MANAGE_CATALOG: 'manage:catalog',
    MANAGE_PRICING: 'manage:pricing',
    MANAGE_FORM_CONFIGS: 'manage:form_configs',
    MANAGE_EMPLOYEES: 'manage:employees',
    MANAGE_ROLES: 'manage:roles',
    READ_ACTIVITY_LOG: 'read:activity_log',
    MANAGE_CONTACT_REQUESTS: 'manage:contact_requests',
};

// Any of these lets a user edit (part of) a service or center; the controller checks each field.
export const CATALOG_EDIT = [P.MANAGE_CATALOG, P.MANAGE_PRICING, P.MANAGE_FORM_CONFIGS];

/**
 * Which services a role's request permissions cover (roles.scope_type):
 * all_services · specific_services (role_services) · specific_centers (role_centers — a center's
 * own requests plus requests for the services it offers). roles.assigned_only narrows that further
 * to requests assigned to the user.
 */
export const SCOPE_TYPES = ['all_services', 'specific_services', 'specific_centers'];
