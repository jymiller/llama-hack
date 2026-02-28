# SPCS Deployment Handoff

## Context
Next.js app (timesheet reconciliation) is Dockerized and tested locally. Ready to push to Snowflake Container Services.

## Docker Image
- Image name: `recon-app`
- Platform: `linux/amd64`
- Port: `3000`
- Snowflake credentials: baked in as ENV vars
- Built and tested locally ✓

## Snowflake Connection Details
- Account: `SFSEHOL-LLAMA_LOUNGE_HACKATHON_UCGALS`
- User: `USER`
- Password: `sn0wf@ll`
- Database: `RECONCILIATION`
- Schema: `PUBLIC`
- Warehouse: `DEFAULT_WH`

---

## Step 1: Create Image Repository

Run in Snowflake (requires ACCOUNTADMIN or SYSADMIN):

```sql
CREATE IMAGE REPOSITORY RECONCILIATION.PUBLIC.recon_repo;
SHOW IMAGE REPOSITORIES IN SCHEMA RECONCILIATION.PUBLIC;
```

Note the `repository_url` from the output — you'll need it in Step 2.

---

## Step 2: Push Docker Image to Snowflake Registry

```bash
# Authenticate Docker to Snowflake registry
snow spcs image-registry login

# Tag and push (replace <repository_url> with value from Step 1)
docker tag recon-app <repository_url>/recon-app:latest
docker push <repository_url>/recon-app:latest
```

---

## Step 3: Create Compute Pool

```sql
CREATE COMPUTE POOL recon_pool
  MIN_NODES = 1
  MAX_NODES = 1
  INSTANCE_FAMILY = CPU_X64_XS;

-- Wait for it to reach IDLE state before continuing
DESCRIBE COMPUTE POOL recon_pool;
```

---

## Step 4: Deploy the Service

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
  $$;
```

---

## Step 5: Get the Public URL

```sql
SHOW ENDPOINTS IN SERVICE recon_service;
```

The `ingress_url` column is the public URL judges use to access the app.

---

## Step 6: Verify the Service is Running

```sql
-- Check service status
DESCRIBE SERVICE RECONCILIATION.PUBLIC.recon_service;

-- Check container logs if something is wrong
CALL SYSTEM$GET_SERVICE_LOGS('RECONCILIATION.PUBLIC.recon_service', '0', 'recon-app', 100);
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Service stuck in PENDING | Compute pool not IDLE yet — wait and retry |
| Container keeps restarting | Check logs via `SYSTEM$GET_SERVICE_LOGS` |
| 502 at public URL | App not listening on 0.0.0.0:3000 — already fixed in image |
| Auth error to Snowflake | Credentials are baked into the image, verify with `DESCRIBE SERVICE` |
