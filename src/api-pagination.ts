// api-pagination.ts — cursor-based pagination for API list endpoints.
// encodes page position as opaque base64 cursor, supports forward/backward
// navigation with configurable page size. zero dependencies.

/** pagination request parameters */
export interface PaginationParams {
  cursor?: string;         // opaque cursor from previous response
  limit?: number;          // items per page (default: 20, max: 100)
  direction?: "forward" | "backward";
}

/** pagination response metadata */
export interface PaginationMeta {
  cursor: string | null;      // cursor for next page (null = no more pages)
  prevCursor: string | null;  // cursor for previous page (null = first page)
  hasMore: boolean;
  totalItems: number;
  pageSize: number;
  pageIndex: number;          // 0-indexed page number
}

/** paginated response wrapper */
export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMeta;
}

/** internal cursor data */
interface CursorData {
  offset: number;
  direction: "forward" | "backward";
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** encode cursor to opaque base64 string */
export function encodeCursor(offset: number, direction: "forward" | "backward" = "forward"): string {
  const data: CursorData = { offset, direction };
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

/** decode cursor from base64 string */
export function decodeCursor(cursor: string): CursorData | null {
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf-8");
    const data = JSON.parse(json) as CursorData;
    if (typeof data.offset !== "number" || data.offset < 0) return null;
    if (data.direction !== "forward" && data.direction !== "backward") return null;
    return data;
  } catch {
    return null;
  }
}

/** paginate an array of items */
export function paginate<T>(
  allItems: T[],
  params: PaginationParams = {},
): PaginatedResponse<T> {
  const limit = Math.min(Math.max(1, params.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const totalItems = allItems.length;

  let offset = 0;
  if (params.cursor) {
    const decoded = decodeCursor(params.cursor);
    if (decoded) {
      offset = decoded.offset;
    }
  }

  // handle backward navigation
  if (params.direction === "backward") {
    offset = Math.max(0, offset - limit);
  }

  // clamp offset
  offset = Math.min(offset, Math.max(0, totalItems - 1));
  offset = Math.max(0, offset);

  const items = allItems.slice(offset, offset + limit);
  const hasMore = offset + limit < totalItems;
  const hasPrev = offset > 0;
  const pageIndex = Math.floor(offset / limit);

  return {
    items,
    pagination: {
      cursor: hasMore ? encodeCursor(offset + limit) : null,
      prevCursor: hasPrev ? encodeCursor(Math.max(0, offset - limit)) : null,
      hasMore,
      totalItems,
      pageSize: limit,
      pageIndex,
    },
  };
}

/** parse pagination params from URL query parameters */
export function parsePaginationParams(url: URL): PaginationParams {
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitStr = url.searchParams.get("limit");
  const direction = url.searchParams.get("direction") as "forward" | "backward" | undefined;

  return {
    cursor,
    limit: limitStr ? parseInt(limitStr, 10) : undefined,
    direction: direction === "backward" ? "backward" : "forward",
  };
}

/** add pagination headers to an HTTP response */
export function paginationHeaders(meta: PaginationMeta): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Total-Count": String(meta.totalItems),
    "X-Page-Size": String(meta.pageSize),
    "X-Page-Index": String(meta.pageIndex),
    "X-Has-More": String(meta.hasMore),
  };
  if (meta.cursor) headers["X-Next-Cursor"] = meta.cursor;
  if (meta.prevCursor) headers["X-Prev-Cursor"] = meta.prevCursor;
  return headers;
}

/** format pagination info for TUI display */
export function formatPagination(meta: PaginationMeta): string[] {
  const lines: string[] = [];
  lines.push(`pagination: page ${meta.pageIndex + 1} (${meta.pageSize} items/page, ${meta.totalItems} total)`);
  lines.push(`  has more: ${meta.hasMore} | has prev: ${meta.prevCursor !== null}`);
  if (meta.cursor) lines.push(`  next cursor: ${meta.cursor}`);
  return lines;
}
