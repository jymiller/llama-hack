import snowflake from "snowflake-sdk";
import fs from "fs";

snowflake.configure({ logLevel: "WARN" });

let connection: snowflake.Connection | null = null;
let connectPromise: Promise<snowflake.Connection> | null = null;

// Detect if running in SPCS (token file exists)
const SPCS_TOKEN_PATH = "/snowflake/session/token";
const isSpcs = fs.existsSync(SPCS_TOKEN_PATH);

function createConn(): snowflake.Connection {
  if (isSpcs) {
    // SPCS OAuth authentication - no external access needed
    const token = fs.readFileSync(SPCS_TOKEN_PATH, "utf-8");
    return snowflake.createConnection({
      account: process.env.SNOWFLAKE_ACCOUNT ?? "SHC18961",
      host: process.env.SNOWFLAKE_HOST,
      authenticator: "OAUTH",
      token: token,
      database: process.env.SNOWFLAKE_DATABASE ?? "RECONCILIATION",
      schema: process.env.SNOWFLAKE_SCHEMA ?? "PUBLIC",
      warehouse: process.env.SNOWFLAKE_WAREHOUSE ?? "DEFAULT_WH",
    });
  }
  
  // Local development - password authentication
  return snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT!,
    username: process.env.SNOWFLAKE_USER!,
    password: process.env.SNOWFLAKE_PASSWORD!,
    database: process.env.SNOWFLAKE_DATABASE ?? "RECONCILIATION",
    schema: process.env.SNOWFLAKE_SCHEMA ?? "PUBLIC",
    warehouse: process.env.SNOWFLAKE_WAREHOUSE ?? "DEFAULT_WH",
  });
}

function ensureConnected(): Promise<snowflake.Connection> {
  // Already up — fast path
  if (connection?.isUp()) return Promise.resolve(connection);

  // Connection attempt already in flight — reuse it
  if (connectPromise) return connectPromise;

  // Start a fresh connection
  connection = createConn();
  connectPromise = new Promise<snowflake.Connection>((resolve, reject) => {
    connection!.connect((err, c) => {
      connectPromise = null;
      if (err) {
        connection = null;
        reject(err);
      } else {
        resolve(c);
      }
    });
  });

  return connectPromise;
}

export async function runQuery<T = Record<string, unknown>>(
  sql: string,
  binds?: unknown[]
): Promise<T[]> {
  const conn = await ensureConnected();
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      binds: binds as snowflake.Binds,
      complete(err, _stmt, rows) {
        if (err) reject(err);
        else resolve((rows ?? []) as T[]);
      },
    });
  });
}

export async function runExecute(
  sql: string,
  binds?: unknown[]
): Promise<void> {
  await runQuery(sql, binds);
}
