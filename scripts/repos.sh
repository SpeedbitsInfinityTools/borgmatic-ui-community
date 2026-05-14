#!/usr/bin/env bash
#
# Multi-Platform Repository Backup/Download Script
#
# Backs up repositories from Azure DevOps, GitHub, GitLab, or Bitbucket.
# All configuration is done via job files - no command-line switches needed.
#

usage() {
  cat <<'EOF'
================================================================================
                         Repository Backup Script
================================================================================

USAGE:
  repos.sh --job=<job.yml> --dry-run    # Simulate (show what would happen)
  repos.sh --job=<job.yml> --backup     # Run the actual backup
  repos.sh --help                       # Show this help

OPTIONS:
  --job=<file>    Path to the job configuration file (required)
  --dry-run       Simulation mode: test API, list repos, show targets
                  Does NOT clone/fetch - safe to run anytime
  --backup        Execute the actual backup (required to make changes)
  --force         Force re-download of TFVC repos (normally skipped if exists)
  --yes, -y       Auto-confirm prompts (for non-interactive use)
  --help          Show this help message

NOTE: You must specify either --dry-run or --backup. This prevents
      accidental backups.

SUPPORTED PLATFORMS:
  - Azure DevOps (Git + TFVC)
  - GitHub
  - GitLab (cloud or self-hosted)
  - Bitbucket Cloud

SETUP:

  1. Create a KEYS file (contains your credentials):
  
     cp keys.example-azure.yml keys-mycompany.yml
     # Edit and add your Personal Access Token (PAT) or credentials
     
     Keys file format varies by platform:
     ┌─────────────────────────────────────────┐
     │ # Azure, GitHub, GitLab:                │
     │ pat: "your-token-here"                  │
     │                                         │
     │ # Bitbucket:                            │
     │ username: "your-username"               │
     │ appPassword: "your-app-password"        │
     └─────────────────────────────────────────┘

  2. Create a JOB file (contains your backup configuration):
  
     cp job.example-azure.yml job-mycompany.yml
     # Edit and configure all settings
     
     Example job file:
     ┌─────────────────────────────────────────┐
     │ jobName: "my-backup"                    │
     │                                         │
     │ platform: azure    # azure/github/      │
     │                    # gitlab/bitbucket   │
     │ backupType: mirror # mirror/clone       │
     │ repoType: git      # git/tfvc/all       │
     │                                         │
     │ keysFile: "keys-mycompany.yml"          │
     │                                         │
     │ azure:  # (or github/gitlab/bitbucket)  │
     │   organization: "my-org"                │
     │                                         │
     │ backup:                                 │
     │   targetDir: "/path/to/backups"         │
     │                                         │
     │ options:                                │
     │   groupByProject: true                  │
     │   prune: true                           │
     └─────────────────────────────────────────┘

  3. Run the backup:
  
     ./repos.sh --job=job-mycompany.yml --dry-run   # Test first
     ./repos.sh --job=job-mycompany.yml --backup    # Then run for real

JOB FILE OPTIONS:

  platform:     azure | github | gitlab | bitbucket
                The cloud platform to backup from.

  backupType:   mirror | clone
                - mirror: Bare git mirrors (best for disaster recovery)
                - clone:  Working copies (best for browsing/searching code)

  repoType:     git | tfvc | all
                - git:  Only Git repositories
                - tfvc: Only TFVC repositories (Azure DevOps only)
                - all:  Both Git and TFVC

  keysFile:     Path to the YAML file containing credentials.
                Can be relative (to job file) or absolute.

  Platform-specific settings:

  Azure DevOps:
    azure.organization:  Your Azure DevOps organization name
    azure.project:       Optional - backup only this project (empty = all)

  GitHub:
    github.organization: GitHub organization name
    github.user:         OR GitHub username (use one or the other)
    github.includePrivate: true/false - include private repos
    github.includeForks:   true/false - include forked repos

  GitLab:
    gitlab.host:         GitLab URL (default: https://gitlab.com)
    gitlab.group:        GitLab group name
    gitlab.user:         OR GitLab username (use one or the other)
    gitlab.includeArchived: true/false - include archived projects
    gitlab.includeSubgroups: true/false - include subgroups

  Bitbucket:
    bitbucket.workspace: Bitbucket workspace slug
    bitbucket.project:   Optional - backup only this project (empty = all)

  Common:
    backup.targetDir:       Where to store the backups
    options.groupByProject: true/false - create subfolders per project
    options.prune:          true/false - remove deleted branches/tags

REQUIREMENTS:
  - git, curl, jq, python3, python3-yaml
  - unzip (for TFVC)

EXAMPLES:
  ./repos.sh --job=job-mycompany.yml --dry-run     # Test/simulate first
  ./repos.sh --job=job-mycompany.yml --backup      # Run actual backup
  ./repos.sh --help                                # Show this help

================================================================================
EOF
}

# Show usage if no arguments
if [[ $# -eq 0 ]]; then
  echo "ERROR: No arguments provided."
  echo "Run with --help for usage instructions, or --job=<file> to run a backup."
  exit 1
fi

JOB_FILE=""
DRY_RUN="false"
DO_BACKUP="false"
AUTO_YES="false"
FORCE_REDOWNLOAD="false"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --job=*) JOB_FILE="${1#*=}" ;;
    --job) JOB_FILE="$2"; shift ;;
    --dry-run) DRY_RUN="true" ;;
    --backup) DO_BACKUP="true" ;;
    --force) FORCE_REDOWNLOAD="true" ;;
    --yes|-y) AUTO_YES="true" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: Unknown option: $1"; echo "Run with --help for usage instructions."; exit 1 ;;
  esac
  shift
done

# Require either --dry-run or --backup
if [[ "$DRY_RUN" == "false" && "$DO_BACKUP" == "false" ]]; then
  echo "ERROR: You must specify either --dry-run or --backup."
  echo ""
  echo "  --dry-run    Simulate the backup (safe, no changes)"
  echo "  --backup     Execute the actual backup"
  echo ""
  echo "Run with --help for full usage instructions."
  exit 1
fi

# Can't use both
if [[ "$DRY_RUN" == "true" && "$DO_BACKUP" == "true" ]]; then
  echo "ERROR: Cannot use both --dry-run and --backup. Choose one."
  exit 1
fi

if [[ -z "$JOB_FILE" ]]; then
  echo "ERROR: Missing --job argument."
  echo "Run with --help for usage instructions."
  exit 1
fi

set -euo pipefail

if [[ ! -f "$JOB_FILE" ]]; then
  echo "ERROR: Job file not found: $JOB_FILE"
  exit 1
fi

# deps check
command -v git >/dev/null || { echo "ERROR: git is required"; exit 1; }
command -v curl >/dev/null || { echo "ERROR: curl is required"; exit 1; }
command -v jq >/dev/null || { sudo apt-get update -y && sudo apt-get install -y jq; }
command -v python3 >/dev/null || { echo "ERROR: python3 is required"; exit 1; }
command -v unzip >/dev/null || { sudo apt-get update -y && sudo apt-get install -y unzip; }
python3 -c "import yaml" 2>/dev/null || {
  echo "PyYAML missing, installing..."
  sudo apt-get update -y && sudo apt-get install -y python3-yaml
}

# Get script directory for resolving relative paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse job YAML
eval "$(python3 - <<'PY' "$JOB_FILE" "$SCRIPT_DIR"
import sys, yaml, shlex, os

job_file = sys.argv[1]
script_dir = sys.argv[2]

with open(job_file, "r", encoding="utf-8") as f:
    job = yaml.safe_load(f) or {}

def get(d, *keys, default=None):
    cur = d
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            return default
        cur = cur[k]
    return cur

# Core settings
platform = get(job, "platform", default="azure")
backup_type = get(job, "backupType", default="mirror")
repo_type = get(job, "repoType", default="git")
keys_file = get(job, "keysFile", default="")
job_name = get(job, "jobName", default="backup")

# Resolve keys file path
if keys_file:
    job_dir = os.path.dirname(os.path.abspath(job_file))
    if not os.path.isabs(keys_file):
        if os.path.exists(os.path.join(job_dir, keys_file)):
            keys_file = os.path.join(job_dir, keys_file)
        else:
            keys_file = os.path.join(script_dir, keys_file)

# Azure settings
azure_org = get(job, "azure", "organization", default="")
azure_project = get(job, "azure", "project", default="") or ""

# GitHub settings
github_org = get(job, "github", "organization", default="")
github_user = get(job, "github", "user", default="")
github_include_private = get(job, "github", "includePrivate", default=True)
github_include_forks = get(job, "github", "includeForks", default=False)

# GitLab settings
gitlab_host = get(job, "gitlab", "host", default="https://gitlab.com")
gitlab_group = get(job, "gitlab", "group", default="")
gitlab_user = get(job, "gitlab", "user", default="")
gitlab_include_archived = get(job, "gitlab", "includeArchived", default=False)
gitlab_include_subgroups = get(job, "gitlab", "includeSubgroups", default=True)

# Bitbucket settings
bitbucket_workspace = get(job, "bitbucket", "workspace", default="")
bitbucket_project = get(job, "bitbucket", "project", default="") or ""

# Backup settings
target_dir = get(job, "backup", "targetDir", default="")
group_by_project = get(job, "options", "groupByProject", default=True)
prune = get(job, "options", "prune", default=True)

# Logging settings
log_dir = get(job, "logging", "logDir", default="")
log_max_size_mb = get(job, "logging", "maxSizeMB", default=100)

# Repo filter (optional whitelist)
selected_repos = get(job, "selectedRepos", default=[])
if not isinstance(selected_repos, list):
    selected_repos = []

def b(v): return "true" if v else "false"

print(f"PLATFORM={shlex.quote(str(platform))}")
print(f"BACKUP_TYPE={shlex.quote(str(backup_type))}")
print(f"REPO_TYPE={shlex.quote(str(repo_type))}")
print(f"KEYS_FILE={shlex.quote(str(keys_file))}")
print(f"JOB_NAME={shlex.quote(str(job_name))}")

# Azure
print(f"AZURE_ORG={shlex.quote(str(azure_org))}")
print(f"AZURE_PROJECT={shlex.quote(str(azure_project))}")

# GitHub
print(f"GITHUB_ORG={shlex.quote(str(github_org))}")
print(f"GITHUB_USER={shlex.quote(str(github_user))}")
print(f"GITHUB_INCLUDE_PRIVATE={shlex.quote(b(github_include_private))}")
print(f"GITHUB_INCLUDE_FORKS={shlex.quote(b(github_include_forks))}")

# GitLab
print(f"GITLAB_HOST={shlex.quote(str(gitlab_host).rstrip('/'))}")
print(f"GITLAB_GROUP={shlex.quote(str(gitlab_group))}")
print(f"GITLAB_USER={shlex.quote(str(gitlab_user))}")
print(f"GITLAB_INCLUDE_ARCHIVED={shlex.quote(b(gitlab_include_archived))}")
print(f"GITLAB_INCLUDE_SUBGROUPS={shlex.quote(b(gitlab_include_subgroups))}")

# Bitbucket
print(f"BITBUCKET_WORKSPACE={shlex.quote(str(bitbucket_workspace))}")
print(f"BITBUCKET_PROJECT={shlex.quote(str(bitbucket_project))}")

# Common
print(f"BACKUP_DIR={shlex.quote(str(target_dir))}")
print(f"GROUP_BY_PROJECT={shlex.quote(b(group_by_project))}")
print(f"PRUNE_ENABLED={shlex.quote(b(prune))}")

# Logging
print(f"LOG_DIR={shlex.quote(str(log_dir))}")
print(f"LOG_MAX_SIZE_MB={shlex.quote(str(log_max_size_mb))}")

# Repo filter (newline-separated; empty string = all repos)
print(f"SELECTED_REPOS={shlex.quote(chr(10).join(str(r) for r in selected_repos))}")
PY
)"

# Validate configuration
if [[ -z "$BACKUP_DIR" ]]; then
  echo "ERROR: backup.targetDir is required in job file"
  echo "Run with --help for job file format."
  exit 1
fi

if [[ ! "$PLATFORM" =~ ^(azure|github|gitlab|bitbucket)$ ]]; then
  echo "ERROR: Invalid platform '$PLATFORM'. Must be 'azure', 'github', 'gitlab', or 'bitbucket'."
  echo "Run with --help for job file format."
  exit 1
fi

if [[ ! "$BACKUP_TYPE" =~ ^(mirror|clone)$ ]]; then
  echo "ERROR: Invalid backupType '$BACKUP_TYPE'. Must be 'mirror' or 'clone'."
  echo "Run with --help for job file format."
  exit 1
fi

if [[ ! "$REPO_TYPE" =~ ^(git|tfvc|all)$ ]]; then
  echo "ERROR: Invalid repoType '$REPO_TYPE'. Must be 'git', 'tfvc', or 'all'."
  echo "Run with --help for job file format."
  exit 1
fi

if [[ -z "$KEYS_FILE" || ! -f "$KEYS_FILE" ]]; then
  echo "ERROR: Keys file not found: $KEYS_FILE"
  echo "Create a keys file from keys.example-{platform}.yml"
  echo "Run with --help for setup instructions."
  exit 1
fi

# Load credentials from keys file
eval "$(python3 - <<PY "$KEYS_FILE"
import yaml, shlex
with open("$KEYS_FILE", 'r') as f:
    keys = yaml.safe_load(f) or {}
pat = keys.get('pat', '')
username = keys.get('username', '')
app_password = keys.get('appPassword', '')
print(f"PAT={shlex.quote(str(pat))}")
print(f"BB_USERNAME={shlex.quote(str(username))}")
print(f"BB_APP_PASSWORD={shlex.quote(str(app_password))}")
PY
)"

PAT=$(echo "$PAT" | tr -d '\r' | xargs)
BB_USERNAME=$(echo "$BB_USERNAME" | tr -d '\r' | xargs)
BB_APP_PASSWORD=$(echo "$BB_APP_PASSWORD" | tr -d '\r' | xargs)

# Validate credentials based on platform
# Bitbucket supports two auth modes:
#   1. App Password: username + appPassword
#   2. API Token: username/email + pat (Basic auth, git uses x-bitbucket-api-token-auth)
BB_AUTH_MODE="app_password"
if [[ "$PLATFORM" == "bitbucket" ]]; then
  if [[ -n "$PAT" && -n "$BB_USERNAME" ]]; then
    BB_AUTH_MODE="access_token"
  elif [[ -n "$PAT" ]]; then
    echo "ERROR: Bitbucket API Token mode also requires 'username' (Bitbucket username or Atlassian email)"
    exit 1
  elif [[ -n "$BB_USERNAME" && -n "$BB_APP_PASSWORD" ]]; then
    BB_AUTH_MODE="app_password"
  else
    echo "ERROR: Bitbucket requires either 'username' + 'pat' (API token) or 'username' + 'appPassword' in keys file"
    exit 1
  fi
else
  if [[ -z "$PAT" ]]; then
    echo "ERROR: PAT not found in keys file: $KEYS_FILE"
    exit 1
  fi
fi

# Check/create backup directory
if [[ ! -d "$BACKUP_DIR" ]]; then
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "Note: Target directory does not exist: $BACKUP_DIR"
    echo "      It would be created during actual backup."
    echo
  elif [[ "$AUTO_YES" == "true" ]]; then
    # Non-interactive mode: auto-create
    mkdir -p "$BACKUP_DIR"
    echo "Created target directory: $BACKUP_DIR"
    echo
  else
    # Interactive mode: ask user
    echo "Target directory does not exist: $BACKUP_DIR"
    read -p "Do you want to create it? (N/y): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      mkdir -p "$BACKUP_DIR"
      echo "Created: $BACKUP_DIR"
      echo
    else
      echo "Aborted. Please create the directory or update the job file."
      exit 1
    fi
  fi
fi

# ============================================================================
# REPO FILTER (selectedRepos whitelist from job YAML)
# ============================================================================

is_repo_selected() {
  local repo_name="$1"
  local repo_full="${2:-$repo_name}"
  [[ -z "$SELECTED_REPOS" ]] && return 0
  echo "$SELECTED_REPOS" | grep -qxF "$repo_name" || echo "$SELECTED_REPOS" | grep -qxF "$repo_full"
}

# ============================================================================
# LOGGING SETUP
# ============================================================================

LOG_FILE=""

cleanup_old_logs() {
  local log_dir="$1"
  local max_size_mb="$2"
  local max_size_bytes=$((max_size_mb * 1024 * 1024))
  
  # Get current size of log directory
  local current_size
  current_size=$(du -sb "$log_dir" 2>/dev/null | cut -f1) || current_size=0
  
  if [[ "$current_size" -gt "$max_size_bytes" ]]; then
    echo "Log directory size ($(( current_size / 1024 / 1024 ))MB) exceeds limit (${max_size_mb}MB). Cleaning up..."
    
    # Delete oldest log files until under limit
    while [[ "$current_size" -gt "$max_size_bytes" ]]; do
      local oldest
      oldest=$(ls -1t "$log_dir"/*.log 2>/dev/null | tail -1) || break
      [[ -z "$oldest" ]] && break
      
      echo "  Deleting old log: $(basename "$oldest")"
      rm -f "$oldest"
      
      current_size=$(du -sb "$log_dir" 2>/dev/null | cut -f1) || current_size=0
    done
  fi
}

if [[ -n "$LOG_DIR" ]]; then
  # Create log directory if needed
  if [[ ! -d "$LOG_DIR" ]]; then
    mkdir -p "$LOG_DIR" || {
      echo "Warning: Could not create log directory: $LOG_DIR"
      LOG_DIR=""
    }
  fi
  
  if [[ -n "$LOG_DIR" ]]; then
    # Clean up old logs
    cleanup_old_logs "$LOG_DIR" "$LOG_MAX_SIZE_MB"
    
    # Create log file with timestamp
    LOG_TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
    LOG_FILE="$LOG_DIR/${JOB_NAME}_${LOG_TIMESTAMP}.log"
    
    # Redirect all output to both console and log file
    exec > >(tee -a "$LOG_FILE") 2>&1
    
    echo "Logging to: $LOG_FILE"
  fi
fi

# Build auth header for Azure
basic_b64="$(printf ':%s' "$PAT" | base64 -w0)"
git_auth_header="Authorization: Basic ${basic_b64}"

echo "========================================"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "Repository Backup [DRY-RUN MODE]"
else
  echo "Repository Backup"
fi
echo "========================================"
echo "Job:        $JOB_NAME"
echo "Platform:   $PLATFORM"
echo "Backup:     $BACKUP_TYPE"
echo "Repo Type:  $REPO_TYPE"
echo "Target:     $BACKUP_DIR"
[[ -n "$LOG_FILE" ]] && echo "Log:        $LOG_FILE"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "Mode:       SIMULATION (no changes will be made)"
fi
echo "========================================"
echo

# ============================================================================
# ERROR TRACKING
# ============================================================================

TOTAL_REPOS=0
SUCCESS_COUNT=0
FAIL_COUNT=0
FAILED_REPOS=""

PROCESSED_REPOS=""

track_success() {
  local repo_name="${1:-}"
  local status="${2:-OK}"
  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  TOTAL_REPOS=$((TOTAL_REPOS + 1))
  [[ -n "$repo_name" ]] && PROCESSED_REPOS="${PROCESSED_REPOS}  [OK] ${repo_name}\n"
}

track_failure() {
  local repo_name="$1"
  local reason="${2:-unknown}"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  TOTAL_REPOS=$((TOTAL_REPOS + 1))
  FAILED_REPOS="${FAILED_REPOS}  - ${repo_name}: ${reason}\n"
  PROCESSED_REPOS="${PROCESSED_REPOS}  [FAIL] ${repo_name}: ${reason}\n"
}

# ============================================================================
# GIT HELPER FUNCTION
# ============================================================================

# Run git command with optional header authentication
# Usage: run_git [use_header] [git_args...]
# If use_header is "true", adds the auth header; otherwise runs git directly
run_git() {
  local use_header="$1"
  shift
  
  if [[ "$use_header" == "true" ]]; then
    git -c "http.extraHeader=$git_auth_header" "$@"
  else
    git "$@"
  fi
}

# ============================================================================
# DISK SPACE GUARD
# ============================================================================
#
# Aborts the backup early if free space on the target (or staging) volume
# drops below BORGMATIC_GIT_MIN_FREE_PERCENT (default: 10 %). Without this
# guard a single oversized repository can fill the device 100 %, which then
# breaks every subsequent clone partway through and (in some setups) makes
# the host itself unhealthy. With the guard you get a clean, loud error
# instead of a silent disk-full cascade.
#
# Override at run time:
#   BORGMATIC_GIT_MIN_FREE_PERCENT=5   # only abort below 5 % free
#   BORGMATIC_GIT_MIN_FREE_PERCENT=0   # disable the check entirely
#
# Accepts either plain integers ("10") or percentage-style values ("10%").
# If input is malformed, we fall back to a safe default (10) instead of
# letting bash arithmetic behave unexpectedly.
RAW_GIT_MIN_FREE_PERCENT="${BORGMATIC_GIT_MIN_FREE_PERCENT:-10}"
if [[ "$RAW_GIT_MIN_FREE_PERCENT" =~ ^[0-9]+%?$ ]]; then
  GIT_MIN_FREE_PERCENT="${RAW_GIT_MIN_FREE_PERCENT%\%}"
else
  echo "Warning: Invalid BORGMATIC_GIT_MIN_FREE_PERCENT='$RAW_GIT_MIN_FREE_PERCENT'; using default 10%." >&2
  GIT_MIN_FREE_PERCENT="10"
fi

# Keep threshold in a sane range.
if (( GIT_MIN_FREE_PERCENT < 0 || GIT_MIN_FREE_PERCENT > 100 )); then
  echo "Warning: BORGMATIC_GIT_MIN_FREE_PERCENT='$GIT_MIN_FREE_PERCENT' out of range (0-100); using default 10%." >&2
  GIT_MIN_FREE_PERCENT="10"
fi

# Format a kilobyte count as a short human-readable string.
_format_kb_human() {
  awk -v k="$1" 'BEGIN {
    split("KB MB GB TB PB", u);
    i = 1;
    while (k >= 1024 && i < 5) { k /= 1024; i++ }
    printf "%.1f %s", k, u[i];
  }'
}

# Verify free disk space on the volume backing $1.
# Args:   $1 = directory path; $2 = label used in the error message (optional)
# Returns 0 if free >= threshold (or check skipped/unavailable), exits the
# whole script with status 1 if the volume is below the threshold so borgmatic
# treats the before-hook as failed.
check_disk_space() {
  local dir="$1"
  local label="${2:-target}"

  # Threshold of 0 disables the guard entirely.
  if [[ "${GIT_MIN_FREE_PERCENT}" -le 0 ]]; then
    return 0
  fi

  if ! command -v df >/dev/null 2>&1; then
    return 0  # df not installed; nothing we can do, don't false-alarm
  fi

  # Walk up to the nearest existing ancestor — df can't stat a path that
  # doesn't exist yet (we may be called before the parent is created).
  local probe="$dir"
  while [[ -n "$probe" && ! -e "$probe" ]]; do
    probe="$(dirname "$probe")"
    [[ "$probe" == "/" ]] && break
  done
  [[ -z "$probe" ]] && probe="/"

  local df_line
  if ! df_line=$(df -P -k "$probe" 2>/dev/null | awk 'NR==2 {print $2, $3, $4}'); then
    return 0  # df failed (e.g. unmounted FUSE); skip rather than guess
  fi

  local total used avail
  read -r total used avail <<<"$df_line"
  if [[ -z "$total" || "$total" -le 0 ]]; then
    return 0
  fi

  local free_pct=$(( avail * 100 / total ))
  if (( free_pct < GIT_MIN_FREE_PERCENT )); then
    local avail_h total_h
    avail_h=$(_format_kb_human "$avail")
    total_h=$(_format_kb_human "$total")
    cat >&2 <<EOF

================================================================================
ERROR: Low disk space on ${label} (${probe})
  Free:      ${avail_h} of ${total_h}  (${free_pct}%)
  Threshold: ${GIT_MIN_FREE_PERCENT}% free required

The Git backup has been aborted to avoid filling the disk completely.
Free up space, point the target at a larger volume, or change the threshold:

  BORGMATIC_GIT_MIN_FREE_PERCENT=5   # be more permissive
  BORGMATIC_GIT_MIN_FREE_PERCENT=0   # disable the check (not recommended)

If the staging directory is the bottleneck, point it elsewhere with:
  BORGMATIC_GIT_STAGE_DIR=/path/with/space
================================================================================
EOF
    exit 1
  fi

  return 0
}

# ============================================================================
# TARGET FILESYSTEM PROBE
# ============================================================================
#
# Determines whether the target directory supports chmod(). Some network
# mounts — notably CIFS/SMB without the `noperm` option and NFS exports with
# root_squash — reject chmod() with EPERM, which makes `git clone` abort
# during `git init` (it chmods `config.lock`). When that happens we stage
# the clone locally and tar-copy the result onto the target; when chmod is
# supported we skip staging entirely and clone directly (zero overhead).
#
# Results are cached per-parent-directory so a 150-repo job does the probe
# once, not 150 times.

# Associative array cache is available on Bash >= 4.
# On older Bash (e.g. macOS system bash 3.2), we gracefully disable caching.
GIT_TARGET_CHMOD_CACHE_SUPPORTED=0
if [[ -n "${BASH_VERSINFO:-}" && "${BASH_VERSINFO[0]:-0}" -ge 4 ]]; then
  declare -A GIT_TARGET_CHMOD_CACHE
  GIT_TARGET_CHMOD_CACHE_SUPPORTED=1
fi

# Probe a directory's chmod() support.
# Args:   $1 = directory path (will be created if missing)
# Prints: "ok"     if the directory is usable and chmod works
#         "noperm" if writable but chmod returns EPERM (staging required)
#         "error"  if the directory cannot be created or is not writable
# Side effect: populates GIT_TARGET_CHMOD_CACHE[$1].
probe_target_chmod() {
  local dir="$1"

  if [[ "$GIT_TARGET_CHMOD_CACHE_SUPPORTED" -eq 1 && -n "${GIT_TARGET_CHMOD_CACHE[$dir]:-}" ]]; then
    echo "${GIT_TARGET_CHMOD_CACHE[$dir]}"
    return 0
  fi

  if ! mkdir -p "$dir" 2>/dev/null; then
    if [[ "$GIT_TARGET_CHMOD_CACHE_SUPPORTED" -eq 1 ]]; then
      GIT_TARGET_CHMOD_CACHE[$dir]="error"
    fi
    echo "error"
    return 0
  fi

  local probe_file
  probe_file="$(mktemp "${dir}/.borgmatic-git-probe.XXXXXX" 2>/dev/null)" || {
    if [[ "$GIT_TARGET_CHMOD_CACHE_SUPPORTED" -eq 1 ]]; then
      GIT_TARGET_CHMOD_CACHE[$dir]="error"
    fi
    echo "error"
    return 0
  }

  local result="ok"
  if ! chmod 0600 "$probe_file" 2>/dev/null; then
    result="noperm"
  fi

  rm -f "$probe_file" 2>/dev/null || true

  if [[ "$GIT_TARGET_CHMOD_CACHE_SUPPORTED" -eq 1 ]]; then
    GIT_TARGET_CHMOD_CACHE[$dir]="$result"
  fi
  echo "$result"
}

# ============================================================================
# GENERIC GIT BACKUP FUNCTION
# ============================================================================

backup_git_repo() {
  local group="$1"
  local repo_name="$2"
  local repo_url="$3"
  local default_branch="${4:-}"
  local auth_method="${5:-header}"  # header, url, or basic
  
  local repo_dir=""
  if [[ "$GROUP_BY_PROJECT" == "true" ]]; then
    if [[ "$BACKUP_TYPE" == "mirror" ]]; then
      repo_dir="$BACKUP_DIR/$group/$repo_name.git"
    else
      repo_dir="$BACKUP_DIR/$group/$repo_name"
    fi
  else
    if [[ "$BACKUP_TYPE" == "mirror" ]]; then
      repo_dir="$BACKUP_DIR/$repo_name.git"
    else
      repo_dir="$BACKUP_DIR/$repo_name"
    fi
  fi
  
  # Build auth URL or command based on method
  local auth_url="$repo_url"
  local use_header_auth="false"
  
  case "$auth_method" in
    header)
      use_header_auth="true"
      ;;
    url)
      auth_url="${repo_url/https:\/\//https:\/\/$PAT@}"
      ;;
    gitlab_url)
      auth_url="${repo_url/https:\/\//https:\/\/oauth2:$PAT@}"
      ;;
    basic)
      auth_url="${repo_url/https:\/\//https:\/\/$BB_USERNAME:$BB_APP_PASSWORD@}"
      ;;
    bitbucket_token)
      auth_url="${repo_url/https:\/\//https:\/\/x-bitbucket-api-token-auth:$PAT@}"
      ;;
  esac
  
  # DRY-RUN MODE: Show what would happen without doing anything
  if [[ "$DRY_RUN" == "true" ]]; then
    local status="NEW"
    [[ -d "$repo_dir" ]] && status="EXISTS"
    local action="clone"
    [[ -d "$repo_dir" ]] && action="fetch"
    
    echo "[DRY-RUN] $group / $repo_name"
    echo "          Status: $status"
    echo "          Action: Would $action ($BACKUP_TYPE)"
    echo "          Target: $repo_dir"
    echo "          Source: $repo_url"
    track_success "$group/$repo_name"
    return
  fi
  
  if [[ -d "$repo_dir" ]]; then
    local check_cmd="rev-parse --git-dir"
    [[ "$BACKUP_TYPE" == "clone" ]] && check_cmd="rev-parse --is-inside-work-tree"
    
    if ! git -C "$repo_dir" $check_cmd >/dev/null 2>&1; then
      echo "Warning: $repo_name is corrupted. Re-cloning..."
      rm -rf "$repo_dir"
      backup_git_repo "$group" "$repo_name" "$repo_url" "$default_branch" "$auth_method"
      return
    fi
    
    echo "Updating: $group / $repo_name"

    check_disk_space "$repo_dir" "target"

    # Update remote URL if using URL auth
    [[ "$auth_method" != "header" ]] && git -C "$repo_dir" remote set-url origin "$auth_url"
    
    if [[ "$BACKUP_TYPE" == "mirror" ]]; then
      if [[ "$PRUNE_ENABLED" == "true" ]]; then
        if ! run_git "$use_header_auth" -C "$repo_dir" fetch --all --prune 2>&1; then
          echo "ERROR: Fetch failed for $repo_name"
          track_failure "$group/$repo_name" "fetch failed"
          return
        fi
      else
        if ! run_git "$use_header_auth" -C "$repo_dir" fetch --all 2>&1; then
          echo "ERROR: Fetch failed for $repo_name"
          track_failure "$group/$repo_name" "fetch failed"
          return
        fi
      fi
      track_success "$group/$repo_name"
    else
      if ! run_git "$use_header_auth" -C "$repo_dir" fetch --all --prune; then
        echo "ERROR: Fetch failed for $repo_name"
        track_failure "$group/$repo_name" "fetch failed"
        return
      fi
      
      # Determine default branch if not provided
      if [[ -z "$default_branch" ]]; then
        default_branch=$(run_git "$use_header_auth" -C "$repo_dir" remote show origin 2>/dev/null | sed -n '/HEAD branch/s/.*: //p')
      fi
      
      if [[ -z "$default_branch" || "$default_branch" == "(unknown)" ]]; then
        echo "Note: Could not determine default branch for $repo_name. Skipping sync."
        track_success "$group/$repo_name"
      else
        git -C "$repo_dir" clean -fd || true
        if ! git -C "$repo_dir" reset --hard "origin/$default_branch"; then
          echo "Warning: Reset failed for $repo_name (possible NAS filename conflict)."
          # Still count as success since we have the data (fetch worked)
          track_success "$group/$repo_name"
        else
          track_success "$group/$repo_name"
        fi
      fi
    fi
  else
    echo "Cloning: $group / $repo_name"
    local parent_dir
    parent_dir="$(dirname "$repo_dir")"
    if ! mkdir -p "$parent_dir"; then
      echo "ERROR: Cannot create target parent directory: $parent_dir"
      track_failure "$group/$repo_name" "target parent create failed"
      return
    fi

    # Decide whether to clone directly into the target or to stage via a
    # local POSIX directory first. CIFS/SMB without `noperm` and root-squashed
    # NFS exports reject chmod() with EPERM, which makes `git clone` abort
    # during `git init` (it chmods config.lock):
    #   error: chmod on .../config.lock failed: Operation not permitted
    #   fatal: could not set 'core.filemode' to 'false'
    # We probe the target once per parent-directory and cache the verdict.
    # When chmod works, we clone straight to the target with no extra copy.
    # When it doesn't, we clone into $BORGMATIC_GIT_STAGE_DIR (default /tmp)
    # and tar-pipe the result onto the target, which never issues chmod
    # against the NAS. Either way, subsequent `git fetch` updates run
    # directly against the target (fetch doesn't rewrite config).
    local probe_result
    probe_result="$(probe_target_chmod "$parent_dir")"

    if [[ "$probe_result" == "error" ]]; then
      echo "ERROR: Cannot create or write to target directory: $parent_dir"
      track_failure "$group/$repo_name" "target not writable"
      return
    fi

    if [[ "$probe_result" == "ok" ]]; then
      # Direct clone into the target (POSIX-compliant filesystem).
      check_disk_space "$parent_dir" "target"
      if [[ "$BACKUP_TYPE" == "mirror" ]]; then
        if ! run_git "$use_header_auth" clone --mirror "$auth_url" "$repo_dir"; then
          echo "ERROR: Clone failed for $repo_name"
          rm -rf "$repo_dir"
          track_failure "$group/$repo_name" "clone failed"
          return
        fi
      else
        if ! run_git "$use_header_auth" clone "$auth_url" "$repo_dir"; then
          if [[ -d "$repo_dir/.git" ]]; then
            echo "Warning: Clone succeeded but checkout had issues (case-sensitivity collision?)"
          else
            echo "ERROR: Clone failed for $repo_name"
            rm -rf "$repo_dir"
            track_failure "$group/$repo_name" "clone failed"
            return
          fi
        fi
      fi
      track_success "$group/$repo_name"
      return
    fi

    # probe_result == "noperm": target filesystem doesn't accept chmod().
    # Stage the clone locally, then tar-copy onto the target.
    # Staging location can be overridden with BORGMATIC_GIT_STAGE_DIR for
    # hosts where /tmp is too small for a large initial clone.
    if [[ -z "${_GIT_STAGING_WARNED:-}" ]]; then
      echo "Note: Target directory does not accept chmod() (likely CIFS/SMB" \
           "without 'noperm', or root-squashed NFS). Initial clones will be" \
           "staged via ${BORGMATIC_GIT_STAGE_DIR:-/tmp}. Subsequent fetches" \
           "run directly against the target and are unaffected."
      _GIT_STAGING_WARNED=1
    fi

    local stage_parent stage_dir stage_repo
    stage_parent="${BORGMATIC_GIT_STAGE_DIR:-/tmp}"
    if ! mkdir -p "$stage_parent"; then
      echo "ERROR: Cannot create staging directory parent: $stage_parent"
      track_failure "$group/$repo_name" "staging parent not writable"
      return
    fi
    # Both volumes must have headroom: staging holds the entire clone before
    # the tar-pipe, then the target needs the same again.
    check_disk_space "$stage_parent" "staging area"
    check_disk_space "$parent_dir" "target"
    if ! stage_dir=$(mktemp -d "${stage_parent}/borgmatic-git-clone-XXXXXX"); then
      echo "ERROR: Cannot create staging directory in: $stage_parent"
      track_failure "$group/$repo_name" "staging dir create failed"
      return
    fi
    stage_repo="$stage_dir/repo"

    # Always clean up staging, even on early return.
    _cleanup_stage() { rm -rf "$stage_dir"; }

    if [[ "$BACKUP_TYPE" == "mirror" ]]; then
      if ! run_git "$use_header_auth" clone --mirror "$auth_url" "$stage_repo"; then
        echo "ERROR: Clone failed for $repo_name"
        _cleanup_stage
        track_failure "$group/$repo_name" "clone failed"
        return
      fi
    else
      if ! run_git "$use_header_auth" clone "$auth_url" "$stage_repo"; then
        if [[ ! -d "$stage_repo/.git" ]]; then
          echo "ERROR: Clone failed for $repo_name"
          _cleanup_stage
          track_failure "$group/$repo_name" "clone failed"
          return
        fi
        echo "Warning: Clone succeeded but checkout had issues (case-sensitivity collision?)"
      fi
    fi

    # Move staged repo onto the target WITHOUT preserving mode bits — the
    # chmod() attempt is what triggers EPERM on restricted NAS mounts.
    # `tar --no-same-permissions --no-same-owner` is portable to both
    # BusyBox and GNU tar.
    if ! (cd "$stage_repo" && tar cf - .) \
          | (mkdir -p "$repo_dir" && cd "$repo_dir" \
             && tar xf - --no-same-permissions --no-same-owner); then
      echo "ERROR: Failed to move staged clone to $repo_dir"
      rm -rf "$repo_dir" 2>/dev/null || true
      _cleanup_stage
      track_failure "$group/$repo_name" "move to target failed"
      return
    fi

    _cleanup_stage
    track_success "$group/$repo_name"
  fi
}

# ============================================================================
# HTTP ERROR HANDLING
# ============================================================================

# Explains HTTP error codes with actionable messages
explain_http_error() {
  local code="$1"
  local platform="$2"
  
  case "$code" in
    000)
      echo "ERROR: Connection failed (no HTTP response)"
      echo ""
      echo "Details:"
      echo "  URL: ${API_REQUEST_URL:-unknown}"
      if [[ -n "$API_CURL_ERROR" ]]; then
        echo "  Curl error: $API_CURL_ERROR"
      fi
      if [[ "${API_CURL_EXIT:-0}" -ne 0 ]]; then
        echo "  Curl exit code: $API_CURL_EXIT"
      fi
      echo ""
      echo "Possible causes:"
      echo "  - No network connection"
      echo "  - DNS resolution failed"
      echo "  - Firewall blocking the connection"
      echo "  - Server is unreachable"
      echo ""
      echo "How to fix:"
      echo "  - Test manually: curl -v \"${API_REQUEST_URL:-URL}\""
      echo "  - Check your internet connection"
      echo "  - Verify the server URL is correct"
      echo "  - Check if a proxy is required"
      ;;
    302|303)
      echo "ERROR: Authentication failed - redirected to login (HTTP $code)"
      echo ""
      echo "URL: ${API_REQUEST_URL:-unknown}"
      echo ""
      echo "The server redirected to a login page, which means authentication was not accepted."
      echo ""
      echo "Possible causes:"
      echo "  - PAT/token is missing, empty, or has whitespace"
      echo "  - PAT/token format is incorrect"
      echo "  - PAT/token was not sent properly"
      echo ""
      echo "How to fix:"
      case "$platform" in
        azure)
          echo "  1. Verify your keys file has 'pat: YOUR_TOKEN' (no quotes around token)"
          echo "  2. Check for extra spaces or newlines in the PAT"
          echo "  3. Test manually: curl -u \":YOUR_PAT\" \"${API_REQUEST_URL:-URL}\""
          echo "  4. Create a new PAT at: https://dev.azure.com/${AZURE_ORG:-ORG}/_usersSettings/tokens"
          ;;
        *)
          echo "  - Verify your keys file has the correct token format"
          echo "  - Check for extra spaces or newlines"
          ;;
      esac
      ;;
    401)
      echo "ERROR: Authentication failed (HTTP 401)"
      echo ""
      echo "Possible causes:"
      echo "  - PAT/token has expired"
      echo "  - PAT/token was revoked"
      echo "  - PAT/token doesn't have required scopes"
      echo "  - PAT/token is for a different organization"
      echo ""
      echo "How to fix:"
      case "$platform" in
        azure)
          echo "  1. Go to: https://dev.azure.com/${AZURE_ORG}/_usersSettings/tokens"
          echo "  2. Create a new PAT with scopes: Code (Read), Project and Team (Read)"
          echo "  3. Update your keys file with the new PAT"
          ;;
        github)
          echo "  1. Go to: https://github.com/settings/tokens"
          echo "  2. Create a new token with 'repo' scope"
          echo "  3. Update your keys file with the new token"
          ;;
        gitlab)
          echo "  1. Go to: ${GITLAB_HOST}/-/user_settings/personal_access_tokens"
          echo "  2. Create a new token with 'read_api' and 'read_repository' scopes"
          echo "  3. Update your keys file with the new token"
          ;;
        bitbucket)
          echo "  1. Go to: https://bitbucket.org/account/settings/app-passwords/"
          echo "  2. Create a new App Password with 'Repositories: Read' permission"
          echo "  3. Update your keys file with username and new app password"
          ;;
      esac
      ;;
    403)
      echo "ERROR: Access forbidden (HTTP 403)"
      echo ""
      echo "Possible causes:"
      echo "  - PAT/token doesn't have permission for this resource"
      echo "  - Organization/project requires additional permissions"
      echo "  - IP restrictions may be blocking access"
      echo ""
      echo "How to fix:"
      echo "  - Check that your PAT has the required scopes"
      echo "  - Verify you have access to this organization/project"
      case "$platform" in
        github)
          echo ""
          echo "GitHub-specific:"
          echo "  - If the org uses SAML SSO, authorize your PAT:"
          echo "    https://github.com/settings/tokens → click token → Enable SSO → Authorize"
          echo "  - Fine-grained PATs must have the org as resource owner"
          echo "  - Org admins may have restricted PAT access in org settings"
          ;;
      esac
      ;;
    404)
      echo "ERROR: Resource not found (HTTP 404)"
      echo ""
      echo "Possible causes:"
      echo "  - Organization name is incorrect"
      echo "  - Project/group name is incorrect"
      echo "  - Resource has been deleted"
      echo ""
      echo "How to fix:"
      echo "  - Verify the organization/project name in your job file"
      echo "  - Check that the resource exists and you have access"
      case "$platform" in
        github)
          echo ""
          echo "GitHub-specific:"
          echo "  - GitHub returns 404 for private orgs you don't have access to"
          echo "  - If the org uses SAML SSO, authorize your PAT:"
          echo "    https://github.com/settings/tokens → click token → Enable SSO → Authorize"
          echo "  - Fine-grained PATs only work for the account/org selected as resource owner"
          ;;
      esac
      ;;
    500|502|503|504)
      echo "ERROR: Server error (HTTP $code)"
      echo ""
      echo "The server is experiencing issues. This is usually temporary."
      echo "Try again in a few minutes."
      ;;
    *)
      echo "ERROR: HTTP request failed (HTTP $code)"
      echo ""
      echo "An unexpected error occurred. Check your network connection"
      echo "and verify the API endpoint is accessible."
      ;;
  esac
}

# Global variables for API error handling (initialized to avoid unbound errors)
API_HTTP_CODE="000"
API_CURL_ERROR=""
API_CURL_EXIT="0"
API_REQUEST_URL=""
API_RESPONSE_FILE=""

# Make API request with proper error handling
# Returns: JSON response on success, empty string on failure
# Sets: API_HTTP_CODE with the HTTP status code
# Makes API request and stores result in global variables
# Usage: api_request URL AUTH_TYPE
# Sets: API_HTTP_CODE, API_CURL_ERROR, API_CURL_EXIT, API_REQUEST_URL, API_RESPONSE_FILE
# Returns: 0 on success (2xx), 1 on failure
api_request() {
  local url="$1"
  local auth_type="$2"  # basic, token, gitlab, or bitbucket
  local error_file=$(mktemp)
  local http_code="000"
  local curl_exit=0
  
  # Set globals BEFORE curl runs (so they're available even if curl fails)
  API_REQUEST_URL="$url"
  API_RESPONSE_FILE=$(mktemp)
  API_CURL_ERROR=""
  API_CURL_EXIT="0"
  API_HTTP_CODE="000"
  
  case "$auth_type" in
    basic)
      http_code=$(curl -sS -w "%{http_code}" -o "$API_RESPONSE_FILE" -u ":$PAT" "$url" 2>"$error_file") || curl_exit=$?
      ;;
    token)
      http_code=$(curl -sS -w "%{http_code}" -o "$API_RESPONSE_FILE" -H "Authorization: token $PAT" -H "Accept: application/vnd.github.v3+json" "$url" 2>"$error_file") || curl_exit=$?
      ;;
    gitlab)
      http_code=$(curl -sS -w "%{http_code}" -o "$API_RESPONSE_FILE" -H "PRIVATE-TOKEN: $PAT" "$url" 2>"$error_file") || curl_exit=$?
      ;;
    bitbucket)
      http_code=$(curl -sS -w "%{http_code}" -o "$API_RESPONSE_FILE" -u "$BB_USERNAME:$BB_APP_PASSWORD" "$url" 2>"$error_file") || curl_exit=$?
      ;;
    bitbucket_token)
      http_code=$(curl -sS -w "%{http_code}" -o "$API_RESPONSE_FILE" -u "$BB_USERNAME:$PAT" "$url" 2>"$error_file") || curl_exit=$?
      ;;
  esac
  
  API_HTTP_CODE="$http_code"
  API_CURL_ERROR=$(cat "$error_file" 2>/dev/null | tr -d '\n' || echo "")
  API_CURL_EXIT="$curl_exit"
  
  rm -f "$error_file"
  
  # Check for curl failure (http_code would be empty or 000, or curl exited non-zero)
  if [[ -z "$http_code" || "$http_code" == "000" || "$curl_exit" -ne 0 ]]; then
    API_HTTP_CODE="${http_code:-000}"
    rm -f "$API_RESPONSE_FILE"
    API_RESPONSE_FILE=""
    return 1
  fi
  
  if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
    return 0
  else
    rm -f "$API_RESPONSE_FILE"
    API_RESPONSE_FILE=""
    return 1
  fi
}

# ============================================================================
# AZURE DEVOPS FUNCTIONS
# ============================================================================

azure_get_projects() {
  local url="https://dev.azure.com/${AZURE_ORG}/_apis/projects?api-version=6.0"
  
  if ! api_request "$url" "basic"; then
    explain_http_error "$API_HTTP_CODE" "azure" >&2
    return 1
  fi
  
  jq -r '.value[].name' "$API_RESPONSE_FILE" 2>/dev/null || true
  rm -f "$API_RESPONSE_FILE"
}

azure_get_repos_tsv() {
  local project="$1"
  local encoded_project
  encoded_project=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$project") || return 1
  local url="https://dev.azure.com/${AZURE_ORG}/$encoded_project/_apis/git/repositories?api-version=6.0"
  
  if ! api_request "$url" "basic"; then
    echo "Warning: Failed to fetch repos for project '$project' (HTTP $API_HTTP_CODE)" >&2
    return 1
  fi
  
  jq -r '.value[] | select(.isDisabled != true) | [.name, .remoteUrl, (.size // 0 | tostring)] | @tsv' "$API_RESPONSE_FILE" 2>/dev/null || true
  rm -f "$API_RESPONSE_FILE"
}

azure_get_tfvc_paths() {
  local project="$1"
  local encoded_project
  encoded_project=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$project") || return 0
  local url="https://dev.azure.com/${AZURE_ORG}/$encoded_project/_apis/tfvc/items?api-version=7.1"
  local response
  
  # TFVC may not exist for all projects - fail silently
  response=$(curl -sS -u ":$PAT" "$url" 2>/dev/null) || return 0
  echo "$response" | jq -r '.value[]? | select(.isFolder == true) | select(.path | split("/") | length == 2) | .path' 2>/dev/null || true
}

azure_download_tfvc_zip() {
  local project="$1"
  local tfvc_path="$2"
  local target_dir="$3"
  
  local encoded_project encoded_path
  encoded_project=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$project") || return
  encoded_path=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$tfvc_path") || return
  local url="https://dev.azure.com/${AZURE_ORG}/$encoded_project/_apis/tfvc/items?path=$encoded_path&\$format=zip&api-version=7.1"
  
  local safe_name=$(echo "$tfvc_path" | tr -d '$' | tr '/' '_' | sed 's/^_//')
  local zip_file="$target_dir/${safe_name}.zip"
  
  # DRY-RUN MODE
  if [[ "$DRY_RUN" == "true" ]]; then
    local status="NEW"
    [[ -f "$zip_file" ]] && status="EXISTS"
    echo "[DRY-RUN] TFVC: $tfvc_path"
    echo "          Status: $status"
    echo "          Action: Would download ZIP"
    echo "          Target: $zip_file"
    track_success "TFVC:$tfvc_path"
    return
  fi
  
  # Skip if ZIP already exists (unless --force)
  if [[ -f "$zip_file" && "$FORCE_REDOWNLOAD" != "true" ]]; then
    local existing_size=$(du -h "$zip_file" 2>/dev/null | cut -f1)
    echo "TFVC ZIP exists (skipping): $tfvc_path ($existing_size)"
    track_success "TFVC:$tfvc_path"
    return
  fi
  
  # Remove old ZIP if force re-downloading
  [[ -f "$zip_file" ]] && rm -f "$zip_file"
  
  echo "Downloading TFVC: $tfvc_path"
  
  # Start curl in background with connection timeout only
  curl -s -f -u ":$PAT" "$url" -o "$zip_file" --connect-timeout 60 &
  local curl_pid=$!
  
  # Monitor download progress - timeout if no growth for 30 minutes
  local last_size=0
  local no_growth_seconds=0
  local check_interval=30
  local stall_timeout=1800  # 30 minutes without growth = timeout
  local timed_out="false"
  
  while kill -0 $curl_pid 2>/dev/null; do
    sleep $check_interval
    
    local current_size
    current_size=$(stat -c%s "$zip_file" 2>/dev/null || echo 0)
    
    if [[ "$current_size" -gt "$last_size" ]]; then
      # File is growing - show progress and reset timer
      local size_mb=$((current_size / 1024 / 1024))
      echo -ne "\r  Progress: ${size_mb}MB...    "
      last_size=$current_size
      no_growth_seconds=0
    else
      # No growth
      no_growth_seconds=$((no_growth_seconds + check_interval))
      if [[ $no_growth_seconds -ge $stall_timeout ]]; then
        echo ""
        echo "ERROR: No download progress for 30 minutes, timing out..."
        kill $curl_pid 2>/dev/null
        timed_out="true"
        break
      fi
    fi
  done
  
  wait $curl_pid
  local curl_exit=$?
  echo ""  # New line after progress
  
  if [[ "$timed_out" == "true" ]]; then
    rm -f "$zip_file" 2>/dev/null
    track_failure "TFVC:$tfvc_path" "download stalled (no progress for 30 min)"
  elif [[ $curl_exit -eq 0 ]]; then
    local zip_size=$(du -h "$zip_file" 2>/dev/null | cut -f1)
    echo "Downloaded: $zip_file ($zip_size)"
    track_success "TFVC:$tfvc_path"
  else
    rm -f "$zip_file" 2>/dev/null
    echo "ERROR: Failed to download TFVC: $tfvc_path (curl exit: $curl_exit)"
    track_failure "TFVC:$tfvc_path" "download failed"
  fi
}

run_azure() {
  if [[ -z "$AZURE_ORG" ]]; then
    echo "ERROR: azure.organization is required for Azure DevOps"
    exit 1
  fi
  
  echo "Organization: $AZURE_ORG"
  echo "Project filter: ${AZURE_PROJECT:-<all>}"
  echo
  
  local projects=""
  if [[ -n "$AZURE_PROJECT" ]]; then
    projects="$AZURE_PROJECT"
  else
    projects=$(azure_get_projects) || exit 1
  fi
  
  if [[ -z "$projects" ]]; then
    echo "ERROR: No projects found"
    exit 1
  fi
  
  local project_count=$(echo "$projects" | wc -l)
  echo "Found $project_count project(s)"
  echo
  
  while IFS= read -r project; do
    [[ -z "$project" ]] && continue
    echo "--- Project: $project ---"
    
    if [[ "$REPO_TYPE" == "git" || "$REPO_TYPE" == "all" ]]; then
      local repos_tsv
      repos_tsv=$(azure_get_repos_tsv "$project" 2>/dev/null) || repos_tsv=""
      if [[ -n "$repos_tsv" ]]; then
        while IFS=$'\t' read -r repo_name repo_url repo_size; do
          [[ -z "$repo_name" || -z "$repo_url" ]] && continue
          [[ "$repo_size" == "0" ]] && { echo "Skipping empty repo: $repo_name"; continue; }
          is_repo_selected "$repo_name" "$project/$repo_name" || continue
          backup_git_repo "$project" "$repo_name" "$repo_url" "" "header"
        done <<< "$repos_tsv"
      fi
    fi
    
    if [[ "$REPO_TYPE" == "tfvc" || "$REPO_TYPE" == "all" ]]; then
      local tfvc_paths
      tfvc_paths=$(azure_get_tfvc_paths "$project" 2>/dev/null) || tfvc_paths=""
      if [[ -n "$tfvc_paths" ]]; then
        local tfvc_dir="$BACKUP_DIR"
        [[ "$GROUP_BY_PROJECT" == "true" ]] && { tfvc_dir="$BACKUP_DIR/$project/TFVC"; mkdir -p "$tfvc_dir"; }
        
        while IFS= read -r tfvc_path; do
          [[ -z "$tfvc_path" ]] && continue
          azure_download_tfvc_zip "$project" "$tfvc_path" "$tfvc_dir"
        done <<< "$tfvc_paths"
      fi
    fi
  done <<< "$projects"
}

# ============================================================================
# GITHUB FUNCTIONS
# ============================================================================

github_get_repos_tsv() {
  local owner="$1"
  local owner_type="$2"
  
  local visibility="all"
  [[ "$GITHUB_INCLUDE_PRIVATE" != "true" ]] && visibility="public"
  
  # Detect if we're listing the authenticated user's own repos.
  # GET /users/{name}/repos only returns public repos — even with a PAT.
  # GET /user/repos returns ALL repos (including private) for the authenticated user.
  local use_authenticated_endpoint="false"
  if [[ "$owner_type" == "users" && -n "$GH_AUTHENTICATED_USER" && "$owner" == "$GH_AUTHENTICATED_USER" ]]; then
    use_authenticated_endpoint="true"
    echo "Using authenticated endpoint (GET /user/repos) for private repo access" >&2
  fi
  
  # Accumulate output into a buffer so we can dedup across the public listing
  # and the optional collaborator-affiliation augmentation.
  local out=""
  local page=1
  local per_page=100
  local first_call=true

  while true; do
    local url=""
    if [[ "$use_authenticated_endpoint" == "true" ]]; then
      # /user/repos uses 'visibility' and 'affiliation' params (not 'type')
      url="https://api.github.com/user/repos?per_page=${per_page}&page=${page}&visibility=${visibility}&affiliation=owner"
    else
      url="https://api.github.com/${owner_type}/${owner}/repos?per_page=${per_page}&page=${page}&type=${visibility}"
    fi
    
    if ! api_request "$url" "token"; then
      if [[ "$first_call" == "true" ]]; then
        explain_http_error "$API_HTTP_CODE" "github" >&2
        return 1
      fi
      break
    fi
    first_call=false
    
    local count=$(jq 'length' "$API_RESPONSE_FILE")
    [[ "$count" == "0" ]] && { rm -f "$API_RESPONSE_FILE"; break; }
    
    out+="$(jq -r '.[] | select(.fork == false or env.INCLUDE_FORKS == "true") | [.name, .clone_url, .default_branch] | @tsv' "$API_RESPONSE_FILE")"$'\n'
    
    rm -f "$API_RESPONSE_FILE"
    [[ "$count" -lt "$per_page" ]] && break
    ((page++))
  done

  # ---------------------------------------------------------------------------
  # Augmentation: include repos owned by $owner that the PAT can see only via
  # collaborator/organization-member affiliation.
  #
  # The /users/{owner}/repos endpoint never returns repos that the PAT was
  # *invited to* (collaborator) — only repos owned by {owner} that are
  # visible to the PAT through general access. So when {owner} != the
  # authenticated user, we additionally pull from
  #   GET /user/repos?affiliation=collaborator,organization_member
  # and keep only rows whose owner.login matches {owner}. This makes the
  # common single-collaborator-private-repo case work without forcing the
  # user to switch the wizard to "Single Repository" mode.
  # ---------------------------------------------------------------------------
  if [[ "$owner_type" == "users" && -n "$GH_AUTHENTICATED_USER" && "$owner" != "$GH_AUTHENTICATED_USER" ]]; then
    local collab_visibility="$visibility"
    page=1
    while true; do
      local url="https://api.github.com/user/repos?per_page=${per_page}&page=${page}&visibility=${collab_visibility}&affiliation=collaborator,organization_member"
      if ! api_request "$url" "token"; then
        # Not a hard failure — augmentation is best-effort.
        rm -f "$API_RESPONSE_FILE" 2>/dev/null
        break
      fi
      local count
      count=$(jq 'length' "$API_RESPONSE_FILE")
      [[ "$count" == "0" ]] && { rm -f "$API_RESPONSE_FILE"; break; }
      out+="$(jq -r --arg owner "$owner" '.[] | select(.owner.login == $owner) | select(.fork == false or env.INCLUDE_FORKS == "true") | [.name, .clone_url, .default_branch] | @tsv' "$API_RESPONSE_FILE")"$'\n'
      rm -f "$API_RESPONSE_FILE"
      [[ "$count" -lt "$per_page" ]] && break
      ((page++))
    done
  fi

  # Dedup by repo name (column 1), preserving the first occurrence — keeps
  # the public-listing rows ahead of the collaborator-augmentation rows.
  printf '%s' "$out" | awk -F'\t' 'NF>=2 && !seen[$1]++'
}

# ----------------------------------------------------------------------------
# Direct repo lookup helper.
#
# Used as a fallback when the public/owner listing turns up nothing but the
# user has explicitly asked for one or more repos via `selectedRepos`. This
# is the typical PAT-as-collaborator situation: the PAT can access exactly
# one private repo of someone else's account, and that repo is invisible to
# /users/{owner}/repos. /repos/{owner}/{name} works fine in that case.
# ----------------------------------------------------------------------------
github_lookup_selected_repos() {
  local owner="$1"
  local count=0
  while IFS= read -r slug; do
    [[ -z "$slug" ]] && continue
    local repo_owner repo_name
    if [[ "$slug" == *"/"* ]]; then
      repo_owner="${slug%%/*}"
      repo_name="${slug#*/}"
      # Only look up slugs whose owner segment matches the configured owner.
      # A foreign-owner slug here would mean misconfigured input — emit a
      # warning rather than silently fetching a different account's repo.
      if [[ "$repo_owner" != "$owner" ]]; then
        echo "WARNING: Selected repo '${slug}' has a different owner than '${owner}' — skipping" >&2
        continue
      fi
    else
      repo_owner="$owner"
      repo_name="$slug"
    fi
    if api_request "https://api.github.com/repos/${repo_owner}/${repo_name}" "token"; then
      jq -r '
        select(.fork == false or env.INCLUDE_FORKS == "true") |
        [.name, .clone_url, .default_branch] | @tsv
      ' "$API_RESPONSE_FILE"
      rm -f "$API_RESPONSE_FILE"
      ((count++)) || true
    else
      local code="$API_HTTP_CODE"
      rm -f "$API_RESPONSE_FILE" 2>/dev/null
      echo "WARNING: Could not access ${repo_owner}/${repo_name} (HTTP ${code}) — collaborator invite still pending or PAT lacks access" >&2
    fi
  done <<< "$SELECTED_REPOS"
  return 0
}

GH_AUTHENTICATED_USER=""
GH_RESOLVED_OWNER_TYPE=""

github_preflight() {
  local owner="$1"
  local owner_type="$2"

  GH_RESOLVED_OWNER_TYPE="$owner_type"

  # Verify PAT works by calling GET /user
  if ! api_request "https://api.github.com/user" "token"; then
    echo "ERROR: GitHub PAT validation failed (HTTP $API_HTTP_CODE)" >&2
    echo "" >&2
    echo "Your Personal Access Token could not authenticate with GitHub." >&2
    echo "" >&2
    echo "Possible causes:" >&2
    echo "  - Token is expired or revoked" >&2
    echo "  - Token is malformed or has extra whitespace" >&2
    echo "" >&2
    echo "How to fix:" >&2
    echo "  - Classic PAT: https://github.com/settings/tokens" >&2
    echo "  - Fine-grained PAT: https://github.com/settings/personal-access-tokens" >&2
    echo "  - Ensure the token has 'repo' scope (classic) or 'Contents: Read' (fine-grained)" >&2
    return 1
  fi

  local gh_user
  gh_user=$(jq -r '.login // empty' "$API_RESPONSE_FILE" 2>/dev/null)
  rm -f "$API_RESPONSE_FILE"

  GH_AUTHENTICATED_USER="$gh_user"
  echo "Authenticated as: $gh_user"

  if [[ "$owner_type" == "orgs" ]]; then
    # Check if it's an org; if not, auto-detect as user account
    if api_request "https://api.github.com/orgs/${owner}" "token"; then
      rm -f "$API_RESPONSE_FILE"
      echo "Organization '$owner' is accessible"
    else
      local saved_code="$API_HTTP_CODE"
      # 404 → might be a user account, not an org. Try /users/{owner}.
      if [[ "$saved_code" == "404" ]]; then
        if api_request "https://api.github.com/users/${owner}" "token"; then
          local acct_type
          acct_type=$(jq -r '.type // empty' "$API_RESPONSE_FILE" 2>/dev/null)
          rm -f "$API_RESPONSE_FILE"
          echo "'$owner' is a GitHub $acct_type account, not an organization — switching automatically"
          GH_RESOLVED_OWNER_TYPE="users"
        else
          rm -f "$API_RESPONSE_FILE" 2>/dev/null
          echo "" >&2
          echo "ERROR: '$owner' was not found as a GitHub organization or user (HTTP $saved_code)" >&2
          echo "" >&2
          echo "Possible causes:" >&2
          echo "  - Name is misspelled" >&2
          echo "  - The organization uses SAML SSO and your PAT is not authorized" >&2
          echo "    → Go to https://github.com/settings/tokens, click your token," >&2
          echo "      and click 'Enable SSO' / 'Authorize' next to '${owner}'" >&2
          echo "  - Fine-grained PAT: resource owner must be set to '${owner}'" >&2
          echo "    → Fine-grained tokens only work for the account/org they were created for" >&2
          return 1
        fi
      else
        echo "" >&2
        echo "ERROR: Cannot access GitHub organization '${owner}' (HTTP $saved_code)" >&2
        echo "" >&2
        echo "Possible causes:" >&2
        echo "  - Organization has restricted third-party access for PATs" >&2
        echo "  - Your PAT needs to be authorized for SSO" >&2
        echo "    → Go to https://github.com/settings/tokens, click your token," >&2
        echo "      and click 'Enable SSO' / 'Authorize' next to '${owner}'" >&2
        echo "  - Fine-grained PAT: resource owner must be set to '${owner}'" >&2
        return 1
      fi
    fi
  fi

  return 0
}

run_github() {
  local owner="" owner_type=""
  
  if [[ -n "$GITHUB_ORG" ]]; then
    owner="$GITHUB_ORG"; owner_type="orgs"
  elif [[ -n "$GITHUB_USER" ]]; then
    owner="$GITHUB_USER"; owner_type="users"
  else
    echo "ERROR: github.organization or github.user is required"; exit 1
  fi
  
  [[ "$REPO_TYPE" == "tfvc" ]] && { echo "Note: GitHub does not support TFVC. Nothing to do."; exit 0; }
  
  echo "Owner: $owner ($owner_type)"
  echo "Include private: $GITHUB_INCLUDE_PRIVATE"
  echo "Include forks: $GITHUB_INCLUDE_FORKS"
  echo
  
  github_preflight "$owner" "$owner_type" || exit 1
  # Preflight may have auto-detected a user account when "orgs" was specified
  owner_type="$GH_RESOLVED_OWNER_TYPE"
  echo
  
  export INCLUDE_FORKS="$GITHUB_INCLUDE_FORKS"
  
  local repos_tsv
  repos_tsv=$(github_get_repos_tsv "$owner" "$owner_type") || exit 1

  # Listing came back empty. Before giving up, see if the user pointed us at
  # specific repos (selectedRepos / "Single Repository" mode / pasted
  # owner/repo slug). When you're a collaborator on someone else's private
  # repo, /users/{owner}/repos won't list it — but /repos/{owner}/{name} can
  # still fetch it. Try that as a fallback so the common single-collaborator
  # case works.
  if [[ -z "$repos_tsv" && -n "$SELECTED_REPOS" ]]; then
    echo "Listing for '$owner' returned no repos — trying direct lookup of selected repos…" >&2
    repos_tsv=$(github_lookup_selected_repos "$owner")
  fi
  [[ -z "$repos_tsv" ]] && { echo "ERROR: No repositories found"; exit 1; }

  # Warn if private repos were requested but none found (org only —
  # for users, the authenticated endpoint already returns private repos)
  if [[ "$GITHUB_INCLUDE_PRIVATE" == "true" && "$owner_type" == "orgs" ]]; then
    local has_private="false"
    if api_request "https://api.github.com/orgs/${owner}/repos?per_page=1&type=private" "token"; then
      local priv_count
      priv_count=$(jq 'length' "$API_RESPONSE_FILE" 2>/dev/null)
      rm -f "$API_RESPONSE_FILE"
      [[ "$priv_count" -gt 0 ]] && has_private="true"
    else
      rm -f "$API_RESPONSE_FILE" 2>/dev/null
    fi
    
    if [[ "$has_private" == "false" ]]; then
      echo "WARNING: 'Include private' is enabled but no private repos were returned for org '${owner}'." >&2
      echo "" >&2
      echo "  Your PAT may not have access to private repos in this organization." >&2
      echo "  Common causes:" >&2
      echo "    - Classic PAT: needs 'repo' scope (not just 'public_repo')" >&2
      echo "    - SAML SSO org: PAT must be authorized for '${owner}'" >&2
      echo "      → https://github.com/settings/tokens → Enable SSO → Authorize" >&2
      echo "    - Fine-grained PAT: resource owner must be '${owner}', not your personal account" >&2
      echo "      → Fine-grained tokens can only access private repos of their resource owner" >&2
      echo "" >&2
    fi
  fi
  
  while IFS=$'\t' read -r repo_name repo_url default_branch; do
    [[ -z "$repo_name" || -z "$repo_url" ]] && continue
    is_repo_selected "$repo_name" "$owner/$repo_name" || continue
    backup_git_repo "$owner" "$repo_name" "$repo_url" "$default_branch" "url"
  done <<< "$repos_tsv"
}

# ============================================================================
# GITLAB FUNCTIONS
# ============================================================================

gitlab_get_repos_tsv() {
  local page=1
  local per_page=100
  local base_url="${GITLAB_HOST}/api/v4"
  
  local endpoint=""
  if [[ -n "$GITLAB_GROUP" ]]; then
    local encoded_group
    encoded_group=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$GITLAB_GROUP") || return 1
    endpoint="groups/${encoded_group}/projects"
    [[ "$GITLAB_INCLUDE_SUBGROUPS" == "true" ]] && endpoint="${endpoint}?include_subgroups=true"
  elif [[ -n "$GITLAB_USER" ]]; then
    endpoint="users/${GITLAB_USER}/projects"
  else
    endpoint="projects?membership=true"
  fi
  
  local first_call=true
  
  while true; do
    local url="${base_url}/${endpoint}"
    [[ "$url" == *"?"* ]] && url="${url}&" || url="${url}?"
    url="${url}per_page=${per_page}&page=${page}"
    [[ "$GITLAB_INCLUDE_ARCHIVED" != "true" ]] && url="${url}&archived=false"
    
    if ! api_request "$url" "gitlab"; then
      if [[ "$first_call" == "true" ]]; then
        explain_http_error "$API_HTTP_CODE" "gitlab" >&2
        return 1
      fi
      break
    fi
    first_call=false
    
    local count=$(jq 'length' "$API_RESPONSE_FILE")
    [[ "$count" == "0" ]] && { rm -f "$API_RESPONSE_FILE"; break; }
    
    jq -r '.[] | [.path, .http_url_to_repo, .default_branch, .namespace.full_path] | @tsv' "$API_RESPONSE_FILE"
    
    rm -f "$API_RESPONSE_FILE"
    [[ "$count" -lt "$per_page" ]] && break
    ((page++))
  done
}

run_gitlab() {
  [[ "$REPO_TYPE" == "tfvc" ]] && { echo "Note: GitLab does not support TFVC. Nothing to do."; exit 0; }
  
  echo "Host: $GITLAB_HOST"
  echo "Group: ${GITLAB_GROUP:-<all accessible>}"
  echo "User: ${GITLAB_USER:-<not set>}"
  echo "Include archived: $GITLAB_INCLUDE_ARCHIVED"
  echo "Include subgroups: $GITLAB_INCLUDE_SUBGROUPS"
  echo
  
  local repos_tsv
  repos_tsv=$(gitlab_get_repos_tsv) || exit 1
  [[ -z "$repos_tsv" ]] && { echo "ERROR: No repositories found"; exit 1; }
  
  while IFS=$'\t' read -r repo_name repo_url default_branch namespace; do
    [[ -z "$repo_name" || -z "$repo_url" ]] && continue
    local group="${namespace:-gitlab}"
    is_repo_selected "$repo_name" "$group/$repo_name" || continue
    backup_git_repo "$group" "$repo_name" "$repo_url" "$default_branch" "gitlab_url"
  done <<< "$repos_tsv"
}

# ============================================================================
# BITBUCKET FUNCTIONS
# ============================================================================

bitbucket_get_repos_tsv() {
  local workspace="$1"
  local next_url="https://api.bitbucket.org/2.0/repositories/${workspace}?pagelen=100"
  local first_call=true
  local api_auth="bitbucket"
  [[ "$BB_AUTH_MODE" == "access_token" ]] && api_auth="bitbucket_token"
  
  [[ -n "$BITBUCKET_PROJECT" ]] && next_url="${next_url}&q=project.key=\"${BITBUCKET_PROJECT}\""
  
  while [[ -n "$next_url" ]]; do
    if ! api_request "$next_url" "$api_auth"; then
      if [[ "$first_call" == "true" ]]; then
        explain_http_error "$API_HTTP_CODE" "bitbucket" >&2
        return 1
      fi
      break
    fi
    first_call=false
    
    jq -r '.values[] | [.name, (.links.clone[] | select(.name=="https") | .href), (.mainbranch.name // "main"), (.project.key // "default")] | @tsv' "$API_RESPONSE_FILE"
    
    next_url=$(jq -r '.next // empty' "$API_RESPONSE_FILE")
    rm -f "$API_RESPONSE_FILE"
  done
}

run_bitbucket() {
  if [[ -z "$BITBUCKET_WORKSPACE" ]]; then
    echo "ERROR: bitbucket.workspace is required"; exit 1
  fi
  
  [[ "$REPO_TYPE" == "tfvc" ]] && { echo "Note: Bitbucket does not support TFVC. Nothing to do."; exit 0; }
  
  echo "Workspace: $BITBUCKET_WORKSPACE"
  echo "Project filter: ${BITBUCKET_PROJECT:-<all>}"
  echo "Auth mode: $BB_AUTH_MODE"
  echo
  
  local repos_tsv
  repos_tsv=$(bitbucket_get_repos_tsv "$BITBUCKET_WORKSPACE") || exit 1
  [[ -z "$repos_tsv" ]] && { echo "ERROR: No repositories found"; exit 1; }
  
  local git_auth="basic"
  [[ "$BB_AUTH_MODE" == "access_token" ]] && git_auth="bitbucket_token"
  
  while IFS=$'\t' read -r repo_name repo_url default_branch project_key; do
    [[ -z "$repo_name" || -z "$repo_url" ]] && continue
    local group="${project_key:-$BITBUCKET_WORKSPACE}"
    is_repo_selected "$repo_name" "$group/$repo_name" || continue
    backup_git_repo "$group" "$repo_name" "$repo_url" "$default_branch" "$git_auth"
  done <<< "$repos_tsv"
}

# ============================================================================
# MAIN
# ============================================================================

case "$PLATFORM" in
  azure) run_azure ;;
  github) run_github ;;
  gitlab) run_gitlab ;;
  bitbucket) run_bitbucket ;;
esac

# ============================================================================
# SUMMARY AND EXIT CODE
# ============================================================================

echo
echo "========================================"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "DRY-RUN SUMMARY"
else
  echo "BACKUP SUMMARY"
fi
echo "========================================"
echo "Total repositories: $TOTAL_REPOS"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "Would backup:       $SUCCESS_COUNT"
else
  echo "Successful:         $SUCCESS_COUNT"
  echo "Failed:             $FAIL_COUNT"
fi
echo "Target:             $BACKUP_DIR"
echo "========================================"

if [[ -n "$PROCESSED_REPOS" ]]; then
  echo
  echo "REPOSITORIES:"
  echo -e "$PROCESSED_REPOS"
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "========================================"
  echo "This was a DRY-RUN. No changes were made."
  echo "Use --backup instead of --dry-run to perform actual backup."
  echo "Exit code: 0"
  exit 0
elif [[ $FAIL_COUNT -gt 0 ]]; then
  echo "========================================"
  echo "Backup completed with $FAIL_COUNT error(s)."
  echo "Exit code: 1"
  exit 1
else
  echo "========================================"
  echo "All repositories backed up successfully."
  echo "Exit code: 0"
  exit 0
fi
