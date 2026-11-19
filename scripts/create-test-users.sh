#!/usr/bin/env bash
# Creates one user per role with a permanent password (demo only).
#   ./scripts/create-test-users.sh student.test@example.com tutor.test@example.com admin.test@example.com 'Demo-Passw0rd!'
set -euo pipefail
cd "$(dirname "$0")/.."
POOL=$(terraform -chdir=infra output -raw user_pool_id)
PASS=$4

make_user() {
  aws cognito-idp admin-create-user --user-pool-id "$POOL" --username "$1" \
    --user-attributes Name=email,Value="$1" Name=email_verified,Value=true --message-action SUPPRESS > /dev/null || true
  aws cognito-idp admin-set-user-password --user-pool-id "$POOL" --username "$1" --password "$PASS" --permanent
  aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username "$1" --group-name "$2"
  echo "created $1 in $2"
}

make_user "$1" students
make_user "$2" tutors
make_user "$3" admins
