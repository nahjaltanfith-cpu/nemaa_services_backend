import Joi from 'joi';

/**
 * Numbered pages for the dashboard tables, shared by the list endpoints.
 * Sending `page` switches an endpoint to the paged answer { items, total, page, pageSize, counts };
 * without it the endpoint keeps answering with the plain array (older callers keep working).
 * pageSize 0 = every matching row (the pager's "all").
 */
export const MAX_PAGE_SIZE = 100;

export const pageFields = {
    page: Joi.number().integer().min(1),
    pageSize: Joi.number().integer().min(0).max(MAX_PAGE_SIZE).default(10),
};

/** LIMIT / OFFSET for a page, its values pushed onto `params`; '' for "all". */
export const pageSql = (params, { page, pageSize }) => {
    if (!pageSize) return '';
    params.push(pageSize, (page - 1) * pageSize);
    return `LIMIT $${params.length - 1} OFFSET $${params.length}`;
};

/** Escapes LIKE wildcards in a search term: "%" or "_" typed by the user match themselves. */
export const likeTerm = (search) => `%${search.replace(/[%_\\]/g, '\\$&')}%`;

/** Rows of { key, count } → { key: count }. */
export const countsBy = (rows) => Object.fromEntries(rows.map((row) => [row.key, Number(row.count)]));
