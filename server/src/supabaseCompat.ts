import type { Pool, QueryResult } from "pg";

/** Minimal subset of @supabase/supabase-js used by authHandler (Postgres via pg Pool). */

function ident(s: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`Invalid identifier: ${s}`);
  return s;
}

type Filter =
  | { kind: "eq"; col: string; val: unknown }
  | { kind: "neq"; col: string; val: unknown }
  | { kind: "is"; col: string; val: unknown }
  | { kind: "in"; col: string; vals: unknown[] }
  | { kind: "ilike"; col: string; pattern: string }
  | { kind: "not"; col: string; op: "is"; val: unknown };

export async function rpcCall(
  pool: Pool,
  fn: string,
  params: Record<string, unknown>
): Promise<{ data: unknown; error: Error | null }> {
  try {
    let r: QueryResult;
    if (fn === "admin_voters_upsert_chunk") {
      r = await pool.query("SELECT admin_voters_upsert_chunk($1::jsonb) AS result", [
        JSON.stringify(params.p_rows ?? []),
      ]);
      return { data: r.rows[0]?.result, error: null };
    }
    if (fn === "admin_voter_upload_stats") {
      r = await pool.query("SELECT admin_voter_upload_stats() AS result");
      return { data: r.rows[0]?.result, error: null };
    }
    if (fn === "admin_voter_assembly_list") {
      r = await pool.query("SELECT admin_voter_assembly_list($1::text, $2::int) AS result", [
        params.p_filter ?? "",
        params.p_limit ?? 200,
      ]);
      return { data: r.rows[0]?.result, error: null };
    }
    if (fn === "admin_voter_booths_page") {
      r = await pool.query("SELECT admin_voter_booths_page($1::text, $2::int, $3::int) AS result", [
        params.p_assembly ?? "",
        params.p_limit ?? 500,
        params.p_offset ?? 0,
      ]);
      return { data: r.rows[0]?.result, error: null };
    }
    if (fn === "admin_refresh_voter_assembly_summary") {
      await pool.query("SELECT admin_refresh_voter_assembly_summary()");
      return { data: null, error: null };
    }
    if (fn === "submission_mobile_taken") {
      r = await pool.query("SELECT submission_mobile_taken($1::text) AS result", [
        params.p_ten_digits ?? "",
      ]);
      return { data: r.rows[0]?.result, error: null };
    }
    if (fn === "admin_list_incharges_page") {
      r = await pool.query(
        `SELECT * FROM admin_list_incharges_page($1::text, $2::text, $3::int, $4::int)`,
        [
          params.p_search ?? null,
          params.p_designation ?? null,
          Number(params.p_limit ?? 50),
          Number(params.p_offset ?? 0),
        ]
      );
      return { data: r.rows, error: null };
    }
    if (fn === "admin_incharge_filtered_stats") {
      r = await pool.query(
        `SELECT * FROM admin_incharge_filtered_stats($1::text, $2::text)`,
        [params.p_search ?? null, params.p_designation ?? null]
      );
      return { data: r.rows, error: null };
    }
    return { data: null, error: new Error(`Unknown RPC: ${fn}`) };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

type Op = "select" | "insert" | "update" | "delete" | "upsert" | "";

export class TableQuery {
  private op: Op = "";
  private table: string;
  private pool: Pool;
  private filters: Filter[] = [];
  private selectColumns = "*";
  private countOpt?: { count: "exact"; head: boolean };
  private orderBy?: { col: string; asc: boolean };
  private rangeFrom?: number;
  private rangeTo?: number;
  private limitN?: number;
  private insertData?: Record<string, unknown> | Record<string, unknown>[];
  private updateData?: Record<string, unknown>;
  private upsertRows?: Record<string, unknown>[];
  private upsertOnConflict?: string;
  private upsertIgnoreDup?: boolean;
  private returningCols?: string;
  private resultMode: "many" | "maybe" | "one" = "many";

  constructor(pool: Pool, table: string) {
    this.pool = pool;
    this.table = table;
  }

  select(columns?: string, options?: { count?: "exact"; head?: boolean }) {
    if (this.op === "insert" || this.op === "upsert") {
      this.returningCols = columns ?? "*";
      return this;
    }
    this.op = "select";
    this.selectColumns = columns ?? "*";
    if (options?.count === "exact" && options?.head) {
      this.countOpt = { count: "exact", head: true };
    }
    return this;
  }

  insert(data: Record<string, unknown> | Record<string, unknown>[]) {
    this.op = "insert";
    this.insertData = data;
    return this;
  }

  update(data: Record<string, unknown>) {
    this.op = "update";
    this.updateData = data;
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  upsert(
    rows: Record<string, unknown>[],
    opts: { onConflict: string; ignoreDuplicates?: boolean }
  ) {
    this.op = "upsert";
    this.upsertRows = rows;
    this.upsertOnConflict = opts.onConflict;
    this.upsertIgnoreDup = opts.ignoreDuplicates ?? false;
    return this;
  }

  eq(col: string, val: unknown) {
    this.filters.push({ kind: "eq", col, val });
    return this;
  }

  neq(col: string, val: unknown) {
    this.filters.push({ kind: "neq", col, val });
    return this;
  }

  is(col: string, val: unknown) {
    this.filters.push({ kind: "is", col, val });
    return this;
  }

  in(col: string, vals: unknown[]) {
    this.filters.push({ kind: "in", col, vals });
    return this;
  }

  ilike(col: string, pattern: string) {
    this.filters.push({ kind: "ilike", col, pattern });
    return this;
  }

  not(col: string, op: "is", val: unknown) {
    this.filters.push({ kind: "not", col, op, val });
    return this;
  }

  order(col: string, opts: { ascending: boolean }) {
    this.orderBy = { col, asc: opts.ascending };
    return this;
  }

  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  maybeSingle() {
    this.resultMode = "maybe";
    return this;
  }

  single() {
    this.resultMode = "one";
    return this;
  }

  private buildWhere(startParam: number): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    let p = startParam;
    const parts: string[] = [];
    const t = ident(this.table);

    for (const f of this.filters) {
      switch (f.kind) {
        case "eq":
          if (f.val === null) parts.push(`${t}.${ident(f.col)} IS NULL`);
          else {
            parts.push(`${t}.${ident(f.col)} = $${p++}`);
            params.push(f.val);
          }
          break;
        case "neq":
          parts.push(`${t}.${ident(f.col)} <> $${p++}`);
          params.push(f.val);
          break;
        case "is":
          if (f.val === null) parts.push(`${t}.${ident(f.col)} IS NULL`);
          else {
            parts.push(`${t}.${ident(f.col)} IS NOT NULL`);
          }
          break;
        case "in":
          parts.push(`${t}.${ident(f.col)} = ANY($${p++}::uuid[])`);
          params.push(f.vals);
          break;
        case "ilike":
          parts.push(`${t}.${ident(f.col)} ILIKE $${p++}`);
          params.push(f.pattern);
          break;
        case "not":
          if (f.op === "is" && f.val === null) {
            parts.push(`${t}.${ident(f.col)} IS NOT NULL`);
          }
          break;
        default:
          break;
      }
    }

    return { sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
  }

  /** DELETE/UPDATE: single table, no alias */
  private buildWhereSimple(startParam: number): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    let p = startParam;
    const parts: string[] = [];

    for (const f of this.filters) {
      const col = ident(f.col);
      switch (f.kind) {
        case "eq":
          if (f.val === null) parts.push(`${col} IS NULL`);
          else {
            parts.push(`${col} = $${p++}`);
            params.push(f.val);
          }
          break;
        case "neq":
          parts.push(`${col} <> $${p++}`);
          params.push(f.val);
          break;
        case "is":
          if (f.val === null) parts.push(`${col} IS NULL`);
          else parts.push(`${col} IS NOT NULL`);
          break;
        case "in":
          parts.push(`${col} = ANY($${p++}::uuid[])`);
          params.push(f.vals);
          break;
        case "ilike":
          parts.push(`${col} ILIKE $${p++}`);
          params.push(f.pattern);
          break;
        case "not":
          if (f.op === "is" && f.val === null) parts.push(`${col} IS NOT NULL`);
          break;
        default:
          break;
      }
    }

    return { sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
  }

  then<TResult1 = { data: unknown; error: Error | null; count?: number | null }, TResult2 = never>(
    onfulfilled?: ((value: TResult1) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled as never, onrejected);
  }

  private async execute(): Promise<{ data: unknown; error: Error | null; count?: number | null }> {
    const t = ident(this.table);
    try {
      if (this.op === "select") {
        return await this.execSelect();
      }
      if (this.op === "insert") {
        return await this.execInsert();
      }
      if (this.op === "update") {
        return await this.execUpdate();
      }
      if (this.op === "delete") {
        return await this.execDelete();
      }
      if (this.op === "upsert") {
        return await this.execUpsert();
      }
      return { data: null, error: new Error("No operation") };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      return { data: null, error: err };
    }
  }

  private async execSelect(): Promise<{ data: unknown; error: Error | null; count?: number | null }> {
    const t = ident(this.table);
    const { sql: whereSql, params: whereParams } = this.buildWhere(1);

    if (this.countOpt?.head) {
      const q = `SELECT COUNT(*)::int AS c FROM ${t} ${whereSql}`;
      const r = await this.pool.query(q, whereParams);
      return { data: null, error: null, count: r.rows[0]?.c ?? 0 };
    }

    let orderSql = "";
    if (this.orderBy) {
      orderSql = ` ORDER BY ${t}.${ident(this.orderBy.col)} ${this.orderBy.asc ? "ASC" : "DESC"}`;
    }

    let limOff = "";
    const pBase = whereParams.length;
    if (this.rangeFrom !== undefined && this.rangeTo !== undefined) {
      const limit = this.rangeTo - this.rangeFrom + 1;
      limOff = ` LIMIT $${pBase + 1} OFFSET $${pBase + 2}`;
    } else if (this.limitN !== undefined) {
      limOff = ` LIMIT $${pBase + 1}`;
    }

    const cols = this.selectColumns.trim() === "*" ? `${t}.*` : this.selectColumns.split(",").map((c) => `${t}.${c.trim()}`).join(", ");

    const allParams = [...whereParams];
    if (this.rangeFrom !== undefined && this.rangeTo !== undefined) {
      const limit = this.rangeTo - this.rangeFrom + 1;
      allParams.push(limit, this.rangeFrom);
    } else if (this.limitN !== undefined) {
      allParams.push(this.limitN);
    }

    const q = `SELECT ${cols} FROM ${t} ${whereSql}${orderSql}${limOff}`;
    const r = await this.pool.query(q, allParams);
    const rows = r.rows;

    if (this.resultMode === "maybe") {
      if (rows.length === 0) return { data: null, error: null };
      if (rows.length > 1) return { data: null, error: new Error("multiple rows") };
      return { data: rows[0], error: null };
    }
    if (this.resultMode === "one") {
      if (rows.length !== 1) return { data: null, error: new Error("single row expected") };
      return { data: rows[0], error: null };
    }

    return { data: rows, error: null };
  }

  private async execInsert(): Promise<{ data: unknown; error: Error | null }> {
    const t = ident(this.table);
    const data = this.insertData;
    if (!data) return { data: null, error: new Error("no insert data") };
    const rows = Array.isArray(data) ? data : [data];
    if (rows.length === 0) return { data: null, error: null };
    const keys = Object.keys(rows[0]).filter((k) => rows[0][k] !== undefined);
    return this.execInsertFixed(t, rows, keys);
  }

  private async execInsertFixed(
    t: string,
    rows: Record<string, unknown>[],
    keys: string[]
  ): Promise<{ data: unknown; error: Error | null }> {
    const cols = keys.map((k) => ident(k)).join(", ");
    const params: unknown[] = [];
    let p = 1;
    const valueGroups: string[] = [];

    for (const row of rows) {
      const phs: string[] = [];
      for (const k of keys) {
        const v = row[k];
        if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && !(v instanceof Buffer)) {
          phs.push(`$${p++}::jsonb`);
          params.push(JSON.stringify(v));
        } else if (Array.isArray(v) || (v !== null && typeof v === "object")) {
          phs.push(`$${p++}::jsonb`);
          params.push(JSON.stringify(v));
        } else {
          phs.push(`$${p++}`);
          params.push(v);
        }
      }
      valueGroups.push(`(${phs.join(", ")})`);
    }

    let ret = "";
    if (this.returningCols) {
      const rc = this.returningCols === "*" ? "*" : this.returningCols.split(",").map((c) => ident(c.trim())).join(", ");
      ret = ` RETURNING ${rc}`;
    }

    const q = `INSERT INTO ${t} (${cols}) VALUES ${valueGroups.join(", ")}${ret}`;
    const r = await this.pool.query(q, params);

    if (!this.returningCols) {
      return { data: null, error: null };
    }

    const out = r.rows;
    if (this.resultMode === "one") {
      if (out.length !== 1) return { data: null, error: new Error("single row expected") };
      return { data: out[0], error: null };
    }
    if (this.resultMode === "maybe") {
      if (out.length === 0) return { data: null, error: null };
      if (out.length > 1) return { data: null, error: new Error("multiple rows") };
      return { data: out[0], error: null };
    }
    return { data: out, error: null };
  }

  private async execUpdate(): Promise<{ data: unknown; error: Error | null }> {
    const t = ident(this.table);
    if (!this.updateData) return { data: null, error: new Error("no update data") };
    const keys = Object.keys(this.updateData);
    const sets: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (const k of keys) {
      const v = this.updateData[k];
      if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
        sets.push(`${ident(k)} = $${p++}::jsonb`);
        params.push(JSON.stringify(v));
      } else if (Array.isArray(v)) {
        sets.push(`${ident(k)} = $${p++}::jsonb`);
        params.push(JSON.stringify(v));
      } else {
        sets.push(`${ident(k)} = $${p++}`);
        params.push(v);
      }
    }
    const { sql: whereSql, params: wparams } = this.buildWhereSimple(p);
    params.push(...wparams);
    const q = `UPDATE ${t} SET ${sets.join(", ")} ${whereSql}`;
    await this.pool.query(q, params);
    return { data: null, error: null };
  }

  private async execDelete(): Promise<{ data: unknown; error: Error | null }> {
    const t = ident(this.table);
    const { sql: whereSql, params } = this.buildWhereSimple(1);
    const q = `DELETE FROM ${t} ${whereSql}`;
    await this.pool.query(q, params);
    return { data: null, error: null };
  }

  private async execUpsert(): Promise<{ data: unknown; error: Error | null }> {
    const t = ident(this.table);
    const rows = this.upsertRows ?? [];
    const conflict = ident(this.upsertOnConflict ?? "id");
    if (rows.length === 0) return { data: [], error: null };

    const keys = Object.keys(rows[0]);
    const cols = keys.map((k) => ident(k)).join(", ");
    const params: unknown[] = [];
    let p = 1;
    const valueGroups: string[] = [];

    for (const row of rows) {
      const phs: string[] = [];
      for (const k of keys) {
        const v = row[k];
        if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
          phs.push(`$${p++}::jsonb`);
          params.push(JSON.stringify(v));
        } else if (Array.isArray(v)) {
          phs.push(`$${p++}::jsonb`);
          params.push(JSON.stringify(v));
        } else {
          phs.push(`$${p++}`);
          params.push(v);
        }
      }
      valueGroups.push(`(${phs.join(", ")})`);
    }

    const action = this.upsertIgnoreDup ? "NOTHING" : "UPDATE";
    let onConflictSql = `ON CONFLICT (${conflict}) DO ${action}`;
    if (!this.upsertIgnoreDup) {
      onConflictSql += " SET " + keys.map((k) => `${ident(k)} = EXCLUDED.${ident(k)}`).join(", ");
    }

    let ret = "";
    if (this.returningCols) {
      const rc = this.returningCols === "*" ? "*" : this.returningCols.split(",").map((c) => ident(c.trim())).join(", ");
      ret = ` RETURNING ${rc}`;
    }

    const q = `INSERT INTO ${t} (${cols}) VALUES ${valueGroups.join(", ")} ${onConflictSql}${ret}`;
    const r = await this.pool.query(q, params);
    return { data: r.rows, error: null };
  }
}

export function createPgSupabaseClient(pool: Pool) {
  return {
    from(table: string) {
      return new TableQuery(pool, table);
    },
    rpc(fn: string, params: Record<string, unknown> = {}) {
      return rpcCall(pool, fn, params);
    },
  };
}

export type PgSupabaseClient = ReturnType<typeof createPgSupabaseClient>;
