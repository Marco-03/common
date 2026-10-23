# LiveLabs QA Service Deployment

This directory packages the QA test service for an approved private VM. It is intentionally environment-neutral because the repository is public.

The repository does not contain:

- tenancy, compartment, subnet, CIDR, DNS, address, or assigned port values;
- identity-provider tenant details or group names;
- passwords, API keys, client secrets, TLS private keys, PAR tokens, or session values;
- internal provisioning commands or corporate security artifacts.

Those values belong in the approved internal provisioning record and OCI Vault.

## Security boundary

The service fails closed unless all of these controls are available:

- an approved private VM and private network path;
- an active CrowdStrike Falcon sensor;
- corporate OpenID Connect registration with assigned QA Hub groups;
- an OCI instance principal allowed to read only the required Vault secrets;
- an internal CA certificate and private key stored in OCI Vault;
- an approved, digest-pinned corporate SSO proxy container image;
- approved non-standard service ports supplied during deployment;
- private report storage and the normal VM backup policy.

No local Jenkins administrator or shared report password is generated. Jenkins uses corporate SSO and group-based roles. The report portal uses the same SSO registration. Anonymous access and self-registration are disabled.

## Identity roles

The IdP registration must provide three groups through its `groups` claim:

| Role | Access |
| --- | --- |
| Administrator | Manage Jenkins configuration and security |
| Operator | Run, cancel, and inspect QA jobs |
| Viewer | Read jobs, results, reports, and CSV output |

Use named corporate identities. Do not distribute shared accounts.

## Vault inputs

Copy `.env.example` to the ignored `.env` file and set only approved configuration values and Vault secret OCIDs. Required Vault entries are:

- OIDC client secret;
- OIDC proxy cookie secret;
- internal TLS certificate;
- internal TLS private key.

Private-content LiveLabs credentials are optional and must use their own Vault entries. The installer retrieves the current secret versions through the VM instance principal and never prints their values.

The ignored local material is written under `deploy/vm/secrets/` with owner-only permissions. It is consumed as container secrets and must never be copied into reports, Object Storage, logs, or source control.

## Deployment

The infrastructure provisioner must first complete the private VM, networking, CrowdStrike, OIDC application, IdP groups, Vault, TLS, and IAM setup documented internally.

On the VM:

1. Clone the approved repository and branch.
2. Copy `.env.example` to `.env`.
3. Enter the approved generic configuration and Vault secret OCIDs.
4. Run `bash install.sh --help` and supply the approved private values from the internal provisioning record.
5. Confirm that the health check succeeds and that corporate SSO is required before any QA page opens.

The installer rejects public bind addresses, common service ports, missing SSO settings, missing Vault secrets, invalid TLS material, and an inactive CrowdStrike sensor.

## Operation

The portal presents one **LiveLabs overall regression** workflow. Every full or targeted run includes catalog, content, routing, asset, and PAR checks in one report and CSV. Jenkins configuration, report history, and local secret files persist across service restarts. Back up the Jenkins and report volumes according to the approved VM policy.

Confirmed retired workshops are stored in the persistent QA configuration
volume. The authenticated report portal is the only exposed path that can add
or remove entries. Jenkins mounts the same registry read-only and filters those
WMS IDs before each unified catalog scan.

Report history is shared server-side, not stored in a viewer's browser. The VM keeps the five newest complete HTML report folders per channel, including their local JSON and CSV downloads. After a completed run, Jenkins archives `summary.json`, `catalog-results.json`, `results.csv`, and `finding-results.csv` under `<prefix>/<channel>/runs/<run-id>/` in Object Storage, then removes the oldest archived local report folder when there are more than five. The Object Storage archive has no retention limit. The report download menu continues to serve local files; HTML is never uploaded. If an upload fails, the local report remains and pruning does not run.

For a cross-tenancy bucket, set `QA_OBJECT_STORAGE_NAMESPACE`, `QA_OBJECT_STORAGE_BUCKET`, and `QA_OBJECT_STORAGE_PREFIX` in the ignored VM `.env`. Place an object-write PAR ending in `/o/` in `secrets/report-archive-par-url` with owner-only permissions. Jenkins receives the write PAR; the browser never does. Use `bash ./deploy/vm/scripts/publish-reports.sh regression --all` from `qa-automation` inside Jenkins for a one-time backfill of existing runs.

To print non-secret access URLs from an authorized VM session:

```bash
bash scripts/access-info.sh
```

This command prints no credentials, secret OCIDs, group names, or identity-provider details.

## Updates

Pull only an approved branch, review changes, and restart through the managed service. Startup refreshes the current Vault secret versions before containers launch, which supports secret rotation without committing configuration.

Never add real deployment values to examples, screenshots, bug reports, presentation material, or public documentation.
