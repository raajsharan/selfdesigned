export const PAGE_SIZES = [10, 20, 25, 50, 100, 200];

/**
 * Pagination for a table that holds all its rows in the browser. Use `defaultPageSize`, never `pageSize`: a fixed pageSize makes
 * the "n / page" drop-down do nothing. The pager hides only while every row fits on the smallest page size.
 */
export const pager = (size, total, extra = {}) => ({ defaultPageSize: size, showSizeChanger: true, pageSizeOptions: PAGE_SIZES, hideOnSinglePage: total <= PAGE_SIZES[0], ...extra });
