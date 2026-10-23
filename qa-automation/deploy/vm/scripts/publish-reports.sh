#!/usr/bin/env bash
set -euo pipefail

channel="${1:-}"
case "$channel" in
  regression|retest) ;;
  *) echo "Usage: publish-reports.sh <regression|retest> [--all [--force]]" >&2; exit 2 ;;
esac
all_runs="${2:-}"
[[ -z "$all_runs" || "$all_runs" == "--all" ]] || { echo "Unknown option: $all_runs" >&2; exit 2; }
force="${3:-}"
[[ -z "$force" || ( "$all_runs" == "--all" && "$force" == "--force" ) ]] || {
  echo "Use --force only with --all." >&2; exit 2;
}
[[ $# -le 3 ]] || { echo "Too many options." >&2; exit 2; }

reports_base="${QA_ROOT_REPORTS_BASE:-/var/qa-reports}"
channel_root="${reports_base%/}/${channel}"
latest_summary="${channel_root}/latest/summary.json"
par_file="${QA_REPORT_ARCHIVE_PAR_FILE:-/run/secrets/report_archive_par_url}"

if [[ -s "$par_file" ]]; then
  namespace="${QA_OBJECT_STORAGE_NAMESPACE:-}"
  bucket="${QA_OBJECT_STORAGE_BUCKET:-}"
  prefix="${QA_OBJECT_STORAGE_PREFIX:-}"
  prefix="${prefix#/}"
  prefix="${prefix%/}"
  [[ "$namespace" =~ ^[A-Za-z0-9._-]+$ && "$bucket" =~ ^[A-Za-z0-9._-]+$ ]] || {
    echo "Archive namespace and bucket must be configured." >&2; exit 1;
  }
  [[ "$prefix" =~ ^[A-Za-z0-9._/-]+$ && "/$prefix/" != *"/../"* ]] || {
    echo "Invalid Object Storage archive prefix." >&2; exit 1;
  }
  par_url="$(tr -d '\r\n' < "$par_file")"
  [[ "$par_url" =~ ^https://objectstorage[.][a-z0-9-]+[.]oraclecloud[.]com/p/[^/]+/n/${namespace}/b/${bucket}/o/$ ]] || {
    echo "The private archive PAR must point to the configured bucket object prefix." >&2; exit 1;
  }

  publish_run() {
    local run_id="$1"
    [[ "$run_id" =~ ^[A-Za-z0-9._:-]+$ ]] || { echo "Invalid run ID." >&2; return 1; }
    local run_dir="${channel_root}/runs/${run_id}"
    [[ -f "${run_dir}/summary.json" ]] || { echo "Missing run summary: ${run_id}" >&2; return 1; }
    [[ -f "${run_dir}/.archive-complete" && "$force" != "--force" ]] && return 0
    local stored_id
    stored_id="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(s.runId||""))' "${run_dir}/summary.json")"
    [[ "$stored_id" == "$run_id" ]] || { echo "Run summary ID mismatch." >&2; return 1; }
    local source_name archive_name object_name
    for source_name in catalog-results.json results.csv; do
      [[ -f "${run_dir}/${source_name}" ]] || { echo "Missing archive file ${run_id}/${source_name}." >&2; return 1; }
    done
    for source_name in catalog-results.json results.csv; do
      case "$source_name" in
        catalog-results.json) archive_name="report.json" ;;
        results.csv) archive_name="report.csv" ;;
      esac
      object_name="${prefix}/reports/${channel}/${run_id}/${archive_name}"
      curl --fail --silent --show-error --retry 2 --retry-all-errors --max-time 300 \
        --upload-file "${run_dir}/${source_name}" --output /dev/null "${par_url}${object_name}" || {
          echo "Object Storage upload failed for ${run_id}/${archive_name}." >&2; return 1;
        }
    done
    node ./scripts/reporters/prune-local-reports.mjs --mark "$channel_root" "$run_id"
    echo "Archived ${channel} data for ${run_id}."
  }

  if [[ "$all_runs" == "--all" ]]; then
    for run_dir in "${channel_root}"/runs/*; do
      [[ -d "$run_dir" ]] || continue
      publish_run "$(basename "$run_dir")"
    done
  else
    [[ -f "$latest_summary" ]] || { echo "No ${channel} report to archive."; exit 0; }
    run_id="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(s.runId||""))' "$latest_summary")"
    attempt_id="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(s.attemptId||""))' "$latest_summary")"
    if [[ -n "${BUILD_TAG:-}" && "$attempt_id" != "${BUILD_TAG}-"* ]]; then
      echo "The latest ${channel} report belongs to another build; no archive changed."
      exit 0
    fi
    publish_run "$run_id"
  fi
  node ./scripts/reporters/prune-local-reports.mjs --prune "$channel_root" 5
  exit 0
fi

if [[ "$all_runs" == "--all" ]]; then
  echo "Backfill requires a private archive PAR." >&2
  exit 1
fi
echo "Object Storage archive is not configured; local ${channel} report remains available."
