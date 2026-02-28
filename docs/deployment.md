# SPCS Deployment (Snowpark Container Services)

The Next.js app is containerized and deployed to Snowflake's Snowpark Container Services for production access.

## Live Demo

| Item | Value |
|------|-------|
| **App URL** | `https://iqzdjx-sfsehol-llama-lounge-hackathon-ucgals.snowflakecomputing.app` |
| **Username** | `JUDGE` |
| **Password** | *(ask the team)* |

## Deployment Architecture

```
Docker Image (linux/amd64)
    └── Next.js standalone build
    └── SPCS OAuth authentication via /snowflake/session/token
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│  Snowflake Account: SFSEHOL-LLAMA_LOUNGE_HACKATHON      │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Image Repository: RECONCILIATION.PUBLIC.recon_repo│  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Compute Pool: recon_pool (CPU_X64_XS, 1 node)    │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Service: recon_service (port 3000, public)       │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## SPCS OAuth Authentication

Containers in SPCS cannot reach external endpoints by default. Instead of using password authentication (which requires external network access), the app detects if it's running in SPCS by checking for the token file at `/snowflake/session/token` and uses OAuth:

```typescript
// frontend/lib/snowflake.ts
const SPCS_TOKEN_PATH = "/snowflake/session/token";
const isSpcs = fs.existsSync(SPCS_TOKEN_PATH);

if (isSpcs) {
  const token = fs.readFileSync(SPCS_TOKEN_PATH, "utf-8");
  return snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT,
    host: process.env.SNOWFLAKE_HOST,  // auto-set by SPCS
    authenticator: "OAUTH",
    token: token,
    // ...
  });
}
```

## Deployment Steps

### 1. Create Image Repository

```sql
CREATE IMAGE REPOSITORY RECONCILIATION.PUBLIC.recon_repo;
SHOW IMAGE REPOSITORIES IN SCHEMA RECONCILIATION.PUBLIC;
```

Note the `repository_url` from the output — you'll need it in Step 2.

### 2. Build & Push Docker Image

```bash
# Authenticate Docker to Snowflake registry
snow spcs image-registry login

# Build for linux/amd64 (required for SPCS)
cd frontend
docker build --platform linux/amd64 -t recon-app .

# Tag and push (replace <repository_url> with value from Step 1)
docker tag recon-app <repository_url>/recon-app:latest
docker push <repository_url>/recon-app:latest
```

### 3. Create Compute Pool

```sql
CREATE COMPUTE POOL recon_pool
  MIN_NODES = 1
  MAX_NODES = 1
  INSTANCE_FAMILY = CPU_X64_XS;

-- Wait for it to reach IDLE state before continuing
DESCRIBE COMPUTE POOL recon_pool;
```

### 4. Deploy the Service

```sql
CREATE SERVICE RECONCILIATION.PUBLIC.recon_service
  IN COMPUTE POOL recon_pool
  FROM SPECIFICATION $$
    spec:
      containers:
        - name: recon-app
          image: <repository_url>/recon-app:latest
          ports:
            - containerPort: 3000
      endpoints:
        - name: ui
          port: 3000
          public: true
          protocol: HTTP
  $$;
```

### 5. Grant Public Access

```sql
GRANT USAGE ON DATABASE RECONCILIATION TO ROLE PUBLIC;
GRANT USAGE ON SCHEMA RECONCILIATION.PUBLIC TO ROLE PUBLIC;
GRANT SELECT ON ALL TABLES IN SCHEMA RECONCILIATION.PUBLIC TO ROLE PUBLIC;
GRANT SELECT ON ALL VIEWS IN SCHEMA RECONCILIATION.PUBLIC TO ROLE PUBLIC;
GRANT SERVICE ROLE RECONCILIATION.PUBLIC.recon_service!ALL_ENDPOINTS_USAGE TO ROLE PUBLIC;
```

### 6. Get Public URL

```sql
SHOW ENDPOINTS IN SERVICE RECONCILIATION.PUBLIC.recon_service;
-- ingress_url column contains the public URL
```

### 7. Verify the Service

```sql
-- Check service status
DESCRIBE SERVICE RECONCILIATION.PUBLIC.recon_service;

-- Check container logs if something is wrong
CALL SYSTEM$GET_SERVICE_LOGS('RECONCILIATION.PUBLIC.recon_service', '0', 'recon-app', 100);
```

## Redeploying (updating the running service)

`SUSPEND`/`RESUME` does **not** re-pull `:latest` — SPCS reuses the cached image. Use a versioned tag instead:

```bash
# 1. Build
cd frontend
docker build --platform linux/amd64 -t recon-app .

# 2. Push with a versioned tag
REPO="sfsehol-llama-lounge-hackathon-ucgals.registry.snowflakecomputing.com/reconciliation/public/recon_repo"
TAG="v$(date +%Y%m%d%H%M%S)"
docker tag recon-app "$REPO/recon-app:$TAG"
docker push "$REPO/recon-app:$TAG"

# 3. Update the service spec — this triggers a fresh pull
snow sql -q "
ALTER SERVICE RECONCILIATION.PUBLIC.recon_service
FROM SPECIFICATION \$\$
spec:
  containers:
    - name: recon-app
      image: ${REPO}/recon-app:${TAG}
  endpoints:
    - name: ui
      port: 3000
      public: true
      protocol: HTTP
\$\$;"
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Login prompt at URL | Expected — SPCS requires Snowflake auth. Use the JUDGE credentials. |
| Service stuck in PENDING | Compute pool not ready — wait for IDLE state |
| Container keeps restarting | Check logs: `CALL SYSTEM$GET_SERVICE_LOGS('...', '0', 'recon-app', 100)` |
| No data in app | Verify grants on tables/views to PUBLIC role |
| Connection error in logs | Ensure using SPCS OAuth (token file), not password auth |
| 502 at public URL | App not listening on 0.0.0.0:3000 — already fixed in image |
| App unchanged after redeploy | `SUSPEND`/`RESUME` does **not** re-pull `:latest`. Push a versioned tag and use `ALTER SERVICE ... FROM SPECIFICATION` with the new tag to force a fresh pull. |
